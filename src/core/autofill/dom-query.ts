/**
 * DOM 查询。
 *
 * 普通 `querySelectorAll` 穿不透 shadow DOM，而现代前端框架（尤其是 Web Components
 * 体系）大量使用它。漏掉 shadow root 里的输入框，等于在这些站点上完全失效，
 * 因此必须自己走一遍树。
 */

/** 遍历时无需深入的标签，跳过它们能显著减少无谓的节点访问。 */
const SKIPPED_TAGS = new Set([
  "script",
  "style",
  "link",
  "meta",
  "noscript",
  "template",
  "head",
  "svg",
  "path",
]);

/**
 * 取元素的 shadow root。
 *
 * closed 模式的 shadow root 无法从外部访问，Chrome 给扩展提供了
 * `chrome.dom.openOrClosedShadowRoot`；拿不到时退回公开的 `shadowRoot`。
 */
function shadowRootOf(element: Element): ShadowRoot | null {
  const chromeDom = (globalThis as { chrome?: { dom?: { openOrClosedShadowRoot?: unknown } } })
    .chrome?.dom;

  if (typeof chromeDom?.openOrClosedShadowRoot === "function") {
    try {
      return (
        chromeDom.openOrClosedShadowRoot as (el: Element) => ShadowRoot | null
      )(element);
    } catch {
      // 元素不是 shadow host 时该 API 会抛错，视作没有。
      return null;
    }
  }

  return element.shadowRoot;
}

/**
 * 深度查询，含 shadow DOM。
 *
 * 先尝试原生 `querySelectorAll`（快得多），页面确实存在 shadow root 时再补一次遍历。
 */
export function deepQuerySelectorAll(root: Document | ShadowRoot | Element, selector: string): Element[] {
  const results: Element[] = [];
  const seen = new Set<Element>();

  const collect = (node: Element) => {
    if (!seen.has(node)) {
      seen.add(node);
      results.push(node);
    }
  };

  for (const element of root.querySelectorAll(selector)) {
    collect(element);
  }

  // 逐个 shadow host 递归。层级通常很浅，递归深度不构成风险。
  const walkShadowRoots = (scope: Document | ShadowRoot | Element) => {
    for (const element of scope.querySelectorAll("*")) {
      if (SKIPPED_TAGS.has(element.tagName.toLowerCase())) {
        continue;
      }

      const shadow = shadowRootOf(element);
      if (shadow == null) {
        continue;
      }

      for (const match of shadow.querySelectorAll(selector)) {
        collect(match);
      }
      walkShadowRoots(shadow);
    }
  };

  walkShadowRoots(root);

  return results;
}

/** 页面是否用到了 shadow DOM。用于决定要不要走开销更大的深度遍历。 */
export function pageContainsShadowDom(root: Document | ShadowRoot = document): boolean {
  for (const element of root.querySelectorAll("*")) {
    if (shadowRootOf(element) != null) {
      return true;
    }
  }
  return false;
}
