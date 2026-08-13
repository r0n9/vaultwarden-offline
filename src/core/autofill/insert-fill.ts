import { queryFieldElements, type FieldElement } from "./collect-page-details";
import type { FillAction, FillScript } from "./fill-script";

/**
 * 在页面中执行填充脚本。
 *
 * ## 为什么不能直接 `element.value = x`
 *
 * React 会在元素实例上重写 `value` 的属性描述符，用来追踪"值有没有变过"。
 * 直接赋值会走它的 setter，追踪器的记录同步被更新，于是 React 认为**什么都没变**，
 * `onChange` 不触发，用户看到框里有字、点提交却提示"请填写此项"。
 *
 * 解法是拿到**原型上**的原生 setter 直接调用，绕过实例上的那层覆盖，
 * 让追踪器的记录变成陈旧值，React 随后就能识别出变化。Vue、Angular 等
 * 依赖 `input` 事件的框架也一并受益。
 *
 * 上游 Bitwarden 用的是直接赋值，在部分 React 站点上会出现上述症状。
 */

/** 动作之间的间隔。太快会让部分站点的前端校验来不及反应。 */
const ACTION_DELAY_MS = 20;

const FILLABLE_CHECKED_VALUES = new Set(["true", "y", "1", "yes", "✓"]);

export interface FillResult {
  filled: number;
  skipped: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** opid 形如 `__12`，对应字段元素列表中的下标。 */
function elementByOpid(elements: FieldElement[], opid: string): FieldElement | undefined {
  const index = Number.parseInt(opid.replace(/^__/, ""), 10);
  return Number.isInteger(index) ? elements[index] : undefined;
}

export async function executeFillScript(
  script: FillScript,
  doc: Document = globalThis.document,
): Promise<FillResult> {
  // 就地重新查询：与采集用的是同一个函数，保证 opid 下标口径一致。
  const elements = queryFieldElements(doc);
  const result: FillResult = { filled: 0, skipped: 0 };

  for (const action of script.actions) {
    await sleep(ACTION_DELAY_MS);
    applyAction(action, elements, doc, result);
  }

  return result;
}

function applyAction(
  action: FillAction,
  elements: FieldElement[],
  doc: Document,
  result: FillResult,
): void {
  const element = elementByOpid(elements, action[1]);
  if (element == null) {
    if (action[0] === "fill_by_opid") {
      result.skipped += 1;
    }
    return;
  }

  switch (action[0]) {
    case "click_on_opid":
      clickElement(element);
      return;

    case "focus_by_opid":
      if (doc.activeElement === element) {
        (element as HTMLElement).blur();
      }
      focusElement(element);
      return;

    case "fill_by_opid":
      if (insertValue(element, action[2])) {
        result.filled += 1;
      } else {
        result.skipped += 1;
      }
      return;
  }
}

function isReadonlyOrDisabled(element: FieldElement): boolean {
  const input = element as HTMLInputElement;
  return input.disabled === true || input.readOnly === true;
}

function insertValue(element: FieldElement, value: string): boolean {
  if (value === "" || isReadonlyOrDisabled(element)) {
    return false;
  }

  // 已经是目标值就别动：重复触发事件可能让站点的校验状态反复闪烁。
  const current = (element as HTMLInputElement).value ?? "";
  if (current === value) {
    return true;
  }

  if (element instanceof HTMLSpanElement) {
    withSimulatedEvents(element, () => {
      element.innerText = value;
    });
    return true;
  }

  const input = element as HTMLInputElement;
  if (
    input.type === "checkbox" ||
    input.type === "radio"
  ) {
    if (!FILLABLE_CHECKED_VALUES.has(String(value).toLowerCase())) {
      return false;
    }
    withSimulatedEvents(element, () => {
      input.checked = true;
    });
    return true;
  }

  withSimulatedEvents(element, () => setNativeValue(input, value));
  return true;
}

/**
 * 绕过框架在实例上覆盖的 setter，调用原型上的原生 setter。
 */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as object | null;
  const descriptor =
    prototype == null ? undefined : Object.getOwnPropertyDescriptor(prototype, "value");

  if (typeof descriptor?.set === "function") {
    descriptor.set.call(element, value);
    return;
  }

  element.value = value;
}

/**
 * 在赋值前后模拟真人交互事件。
 *
 * 前置事件可能被站点的脚本改动当前值，因此赋值前后都要把值还原回来，
 * 否则会出现"填了又被自己的模拟事件清掉"的怪象。
 */
function withSimulatedEvents(element: FieldElement, assign: () => void): void {
  const hasValue = "value" in element;
  const input = element as HTMLInputElement;
  const beforeValue = hasValue ? input.value : "";

  clickElement(element);
  focusElement(element);
  dispatchKeyboardEvents(element);

  // 还原也必须走原生 setter：用实例 setter 会让框架的值追踪器同步更新，
  // 把上面刚绕开的那层覆盖又请了回来。
  if (hasValue && input.value !== beforeValue) {
    setNativeValue(input, beforeValue);
  }

  assign();

  const afterValue = hasValue ? input.value : "";
  dispatchKeyboardEvents(element);

  if (hasValue && input.value !== afterValue) {
    setNativeValue(input, afterValue);
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function dispatchKeyboardEvents(element: FieldElement): void {
  for (const type of ["keydown", "keypress", "keyup"]) {
    element.dispatchEvent(new KeyboardEvent(type, { bubbles: true }));
  }
}

function clickElement(element: FieldElement): void {
  if (typeof (element as HTMLElement).click === "function") {
    (element as HTMLElement).click();
  }
}

function focusElement(element: FieldElement): void {
  if (typeof (element as HTMLElement).focus === "function") {
    (element as HTMLElement).focus();
  }
}
