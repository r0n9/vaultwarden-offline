/**
 * 元素可见性判定。
 *
 * "看得见"比想象中复杂：元素可能被 CSS 隐藏、可能在视口外、可能被其它元素盖住，
 * 也可能只是被做成了 1×1 像素的埋点陷阱。判定错了的后果是把密码填进用户看不见的
 * 字段——这正是钓鱼页面惯用的伎俩，因此宁可判"不可见"也不能放松。
 */

const MIN_VISIBLE_SIZE = 10;

/** 被认为等同于隐藏的 clip-path 取值。 */
const HIDING_CLIP_PATHS = new Set([
  "inset(50%)",
  "inset(100%)",
  "circle(0)",
  "circle(0px)",
  "circle(0px at 50% 50%)",
  "polygon(0 0, 0 0, 0 0, 0 0)",
  "polygon(0px 0px, 0px 0px, 0px 0px, 0px 0px)",
]);

export interface VisibilityChecker {
  isViewable(element: HTMLElement): boolean;
}

function styleOf(element: HTMLElement): CSSStyleDeclaration {
  const view = element.ownerDocument.defaultView ?? globalThis;
  return view.getComputedStyle(element);
}

function isInvisible(element: HTMLElement): boolean {
  return Number.parseFloat(styleOf(element).opacity) < 0.1;
}

export function isHiddenByCss(element: HTMLElement): boolean {
  const style = styleOf(element);

  if (
    Number.parseFloat(style.opacity) < 0.1 ||
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    HIDING_CLIP_PATHS.has(style.clipPath)
  ) {
    return true;
  }

  // 祖先透明会连带隐藏子元素，因此要一路向上查。
  let parent = element.parentElement;
  while (parent != null && parent !== element.ownerDocument.documentElement) {
    if (isInvisible(parent)) {
      return true;
    }
    parent = parent.parentElement;
  }

  return false;
}

export function isOutsideViewportBounds(element: HTMLElement, rect?: DOMRectReadOnly): boolean {
  const documentElement = element.ownerDocument.documentElement;
  const bounds = rect ?? element.getBoundingClientRect();

  const topOffset = bounds.top - documentElement.clientTop;
  const leftOffset = bounds.left - documentElement.clientLeft;

  return (
    // 过小的元素通常是埋点或占位，不是给人填的。
    bounds.width < MIN_VISIBLE_SIZE ||
    bounds.height < MIN_VISIBLE_SIZE ||
    leftOffset < 0 ||
    topOffset < 0 ||
    leftOffset + bounds.width > documentElement.scrollWidth ||
    topOffset + bounds.height > documentElement.scrollHeight
  );
}

/**
 * 判断字段中心点是否被别的元素盖住。
 *
 * 命中自身或自身的 label 都算没被遮挡——点 label 会聚焦到字段，用户感知上是同一个东西。
 */
export function isNotHiddenBehindAnotherElement(
  element: HTMLElement,
  rect?: DOMRectReadOnly,
): boolean {
  const bounds = rect ?? element.getBoundingClientRect();
  const rootNode = element.getRootNode();
  const root: Document | ShadowRoot =
    rootNode instanceof ShadowRoot ? rootNode : element.ownerDocument;

  const centerElement = root.elementFromPoint(
    bounds.left + bounds.width / 2,
    bounds.top + bounds.height / 2,
  );

  if (centerElement === element) {
    return true;
  }

  const labels = (element as HTMLInputElement).labels;
  if (labels != null && centerElement instanceof HTMLLabelElement) {
    return Array.from(labels).includes(centerElement);
  }

  return false;
}

/** 浏览器环境下的真实判定。 */
export const domVisibilityChecker: VisibilityChecker = {
  isViewable(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();

    if (isOutsideViewportBounds(element, rect) || isHiddenByCss(element)) {
      return false;
    }

    return isNotHiddenBehindAnotherElement(element, rect);
  },
};

/**
 * 测试用判定：一律认为可见。
 *
 * jsdom 不实现布局，`getBoundingClientRect` 一律返回 0、`elementFromPoint` 返回 null，
 * 真实判定在其中毫无意义。把可见性做成可注入的依赖，结构化采集逻辑才能被单测覆盖。
 */
export const alwaysViewableChecker: VisibilityChecker = {
  isViewable: () => true,
};
