import { deepQuerySelectorAll } from "./dom-query";
import { alwaysViewableChecker, type VisibilityChecker } from "./dom-visibility";
import {
  type AutofillField,
  type AutofillForm,
  type AutofillPageDetails,
  IGNORED_INPUT_TYPES,
  IGNORE_ATTRIBUTE,
  NON_INPUT_FIELD_TAGS,
  OPT_IN_ATTRIBUTE,
} from "./models";

/**
 * 页面表单与字段采集。
 *
 * 移植自 Bitwarden 的 collect-autofill-content.service，保留其算法与字段命名，
 * 去掉了 Angular 依赖与增量更新（MutationObserver）机制——后者属于内联菜单的
 * 实时性需求，等浮层那一步再接。
 *
 * 采集只负责"如实描述页面上有什么"，**不做任何字段语义判定**（哪个是用户名、
 * 哪个是密码）。语义判定是下一步的事，两者分开能让各自都可单独测试。
 */

/** `opid` 会被写回 DOM 元素，供后续填充阶段按标识找回元素。 */
const OPID_PROPERTY = "opid";

export type FieldElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement
  | HTMLSpanElement;

export interface CollectOptions {
  document?: Document;
  visibility?: VisibilityChecker;
}

/**
 * 按 DOM 顺序取出所有候选字段元素。
 *
 * 采集与填充**必须共用**这一个函数：字段的 opid 就是它在本列表中的下标，
 * 填充阶段正是靠下标把 opid 还原成元素。两边各自实现查询，迟早会因为筛选
 * 条件的细微差异而错位，把密码填进错误的框里。
 */
export function queryFieldElements(doc: Document = globalThis.document): FieldElement[] {
  return queryFormAndFieldElements(doc).fieldElements;
}

export function collectPageDetails(options: CollectOptions = {}): AutofillPageDetails {
  const doc = options.document ?? globalThis.document;
  const visibility = options.visibility ?? alwaysViewableChecker;

  const { formElements, fieldElements } = queryFormAndFieldElements(doc);

  const forms = buildForms(formElements, doc);
  const fields: AutofillField[] = [];

  for (let index = 0; index < fieldElements.length; index++) {
    const field = buildField(fieldElements[index]!, index, visibility);
    if (field != null) {
      fields.push(field);
    }
  }

  return {
    title: doc.title,
    url: doc.defaultView?.location.href ?? doc.URL,
    documentUrl: doc.location.href,
    forms,
    fields,
    collectedTimestamp: Date.now(),
  };
}

// --- 元素查询 -------------------------------------------------------------

const FIELD_SELECTOR = [
  "input:not([type=hidden]):not([type=submit]):not([type=reset])",
  "input:not([type=button]):not([type=image]):not([type=file])",
  "textarea",
  "select",
  `span[${OPT_IN_ATTRIBUTE}]`,
].join(", ");

function queryFormAndFieldElements(doc: Document): {
  formElements: HTMLFormElement[];
  fieldElements: FieldElement[];
} {
  const formElements: HTMLFormElement[] = [];
  const fieldElements: FieldElement[] = [];

  for (const element of deepQuerySelectorAll(doc, `form, ${FIELD_SELECTOR}`)) {
    if (element instanceof HTMLFormElement) {
      formElements.push(element);
      continue;
    }
    if (isFieldElement(element)) {
      fieldElements.push(element);
    }
  }

  return { formElements, fieldElements };
}

function isFieldElement(node: Element): node is FieldElement {
  const tagName = node.tagName.toLowerCase();

  // 站点可用 data-bwautofill 让自定义的非 input 元素参与采集。
  if (tagName === "span") {
    return node.hasAttribute(OPT_IN_ATTRIBUTE);
  }

  if (node.hasAttribute(IGNORE_ATTRIBUTE)) {
    return false;
  }

  if (tagName === "input") {
    return !IGNORED_INPUT_TYPES.has((node as HTMLInputElement).type.toLowerCase());
  }

  return NON_INPUT_FIELD_TAGS.has(tagName);
}

// --- 表单 -----------------------------------------------------------------

function buildForms(formElements: HTMLFormElement[], doc: Document): Record<string, AutofillForm> {
  const forms: Record<string, AutofillForm> = {};

  for (let index = 0; index < formElements.length; index++) {
    const element = formElements[index]!;
    const opid = `__form__${index}`;
    setOpid(element, opid);

    forms[opid] = {
      opid,
      htmlAction: resolveFormAction(element, doc),
      htmlName: getPropertyOrAttribute(element, "name") ?? "",
      htmlID: getPropertyOrAttribute(element, "id") ?? "",
      htmlMethod: getPropertyOrAttribute(element, "method") ?? "",
    };
  }

  return forms;
}

/** action 可能是相对路径，统一解析成绝对地址便于后续比对。 */
function resolveFormAction(element: HTMLFormElement, doc: Document): string {
  const action = getPropertyOrAttribute(element, "action");
  if (action == null) {
    return "";
  }
  try {
    return new URL(action, doc.location.href).href;
  } catch {
    return action;
  }
}

// --- 字段 -----------------------------------------------------------------

function buildField(
  element: FieldElement,
  index: number,
  visibility: VisibilityChecker,
): AutofillField | null {
  // 提交按钮内部的元素不是给用户填的。
  if (element.closest("button[type='submit']") != null) {
    return null;
  }

  const opid = `__${index}`;
  setOpid(element, opid);

  const base: AutofillField = {
    opid,
    elementNumber: index,
    maxLength: getMaxLength(element),
    viewable: visibility.isViewable(element),
    htmlID: getPropertyOrAttribute(element, "id"),
    htmlName: getPropertyOrAttribute(element, "name"),
    htmlClass: getPropertyOrAttribute(element, "class"),
    tabindex: getPropertyOrAttribute(element, "tabindex"),
    title: getPropertyOrAttribute(element, "title"),
    tagName: element.tagName.toLowerCase(),
    dataSetValues: getDataSetValues(element),
  };

  // span 是 data-bwautofill 选进来的展示型元素，没有表单语义，但它的文字内容
  // 正是站点想让扩展读到的东西（上游此处只返回基础信息，等于白采集一场）。
  if (element instanceof HTMLSpanElement) {
    return { ...base, value: getElementValue(element) };
  }

  const type = getAttributeLowerCase(element, "type");

  // 隐藏字段没有可视标签可言，跳过标签提取省下大量 DOM 遍历。
  const labels =
    type === "hidden"
      ? {}
      : {
          "label-tag": createLabelTag(element),
          "label-data": getPropertyOrAttribute(element, "data-label"),
          "label-aria": getPropertyOrAttribute(element, "aria-label"),
          "label-top": createTopLabel(element),
          "label-right": createRightLabel(element),
          "label-left": createLeftLabel(element),
          placeholder: getPropertyOrAttribute(element, "placeholder"),
        };

  const form = (element as HTMLInputElement).form;

  return {
    ...base,
    ...labels,
    rel: getPropertyOrAttribute(element, "rel"),
    type,
    value: getElementValue(element),
    checked: getAttributeBoolean(element, "checked"),
    autoCompleteType: getAutoCompleteAttribute(element),
    disabled: getAttributeBoolean(element, "disabled"),
    readonly: getAttributeBoolean(element, "readonly"),
    selectInfo: element instanceof HTMLSelectElement ? getSelectOptions(element) : null,
    form: form == null ? null : ((form as HTMLFormElement & { opid?: string }).opid ?? null),
    "aria-describedby": getPropertyOrAttribute(element, "aria-describedby"),
    "aria-hidden": getAttributeBoolean(element, "aria-hidden", true),
    "aria-disabled": getAttributeBoolean(element, "aria-disabled", true),
    "aria-haspopup": getAttributeBoolean(element, "aria-haspopup", true),
    "data-stripe": getPropertyOrAttribute(element, "data-stripe"),
  };
}

// --- 标签提取 -------------------------------------------------------------
//
// 很多站点根本不写 <label>，字段的语义只能从周围文字推断。下面几种取法各自
// 覆盖一类常见排版，最终由判定阶段综合使用。

function createLabelTag(element: HTMLElement): string {
  const labelSet = new Set<HTMLElement>();

  const nativeLabels = (element as HTMLInputElement).labels;
  if (nativeLabels != null) {
    for (const label of Array.from(nativeLabels)) {
      labelSet.add(label);
    }
  }

  if (labelSet.size === 0) {
    for (const label of queryLabelsByForAttribute(element)) {
      labelSet.add(label);
    }
  }

  // 字段被 <label> 直接包裹的写法。
  let current: HTMLElement | null = element;
  while (current != null && current !== element.ownerDocument.documentElement) {
    if (current instanceof HTMLLabelElement) {
      labelSet.add(current);
    }
    current = current.parentElement?.closest("label") ?? null;
  }

  // <dl><dt>标签</dt><dd><input></dd></dl> 这种定义列表排版。
  const parent = element.parentElement;
  if (labelSet.size === 0 && parent instanceof HTMLElement && parent.tagName === "DD") {
    const previous = parent.previousElementSibling;
    if (previous instanceof HTMLElement && previous.tagName === "DT") {
      labelSet.add(previous);
    }
  }

  return Array.from(labelSet)
    .map((label) => normalizeText(label.textContent ?? ""))
    .join("");
}

function queryLabelsByForAttribute(element: HTMLElement): HTMLLabelElement[] {
  const selectors: string[] = [];
  const id = (element as HTMLInputElement).id;
  const name = (element as HTMLInputElement).name;

  // CSS.escape 在个别宿主环境里缺失，退化为朴素转义即可——这里只需要处理
  // id/name 中可能出现的引号与反斜杠。
  const escape = (value: string) =>
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(value)
      : value.replace(/["\\]/g, "\\$&");

  if (id) {
    selectors.push(`label[for="${escape(id)}"]`);
  }
  if (name) {
    selectors.push(`label[for="${escape(name)}"]`);
  }
  if (selectors.length === 0) {
    return [];
  }

  const root = element.getRootNode() as Document | ShadowRoot;
  try {
    return Array.from(root.querySelectorAll<HTMLLabelElement>(selectors.join(", ")));
  } catch {
    // id 含有无法安全转义的字符时不至于让整次采集失败。
    return [];
  }
}

/** 表格排版：取正上方单元格的文字。 */
function createTopLabel(element: HTMLElement): string | null {
  const cell = element.closest("td");
  if (cell == null || cell.cellIndex < 0) {
    return null;
  }

  const previousRow = cell.closest("tr")?.previousElementSibling;
  if (!(previousRow instanceof HTMLTableRowElement)) {
    return null;
  }

  const aboveCell = previousRow.cells[cell.cellIndex];
  return aboveCell == null ? null : normalizeText(aboveCell.textContent ?? "");
}

/** 取字段右侧的文字，遇到新区块或另一个字段就停。 */
function createRightLabel(element: HTMLElement): string {
  const parts: string[] = [];
  let current: ChildNode | null = element;

  while (current?.nextSibling != null) {
    current = current.nextSibling;

    if (isNewSectionElement(current) || containsChildField(current)) {
      break;
    }

    const text = getTextContent(current);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join("");
}

function createLeftLabel(element: HTMLElement): string {
  return collectPreviousSiblingText(element).reverse().join("");
}

/**
 * 向前收集文字。
 *
 * 同级找不到就上溯一层继续找——`<div><span>用户名</span></div><div><input></div>`
 * 这种排版下，标签文字并不在字段的同级兄弟里。
 */
function collectPreviousSiblingText(element: Node): string[] {
  const parts: string[] = [];
  let current: Node | null = element;

  while (current != null && current.previousSibling != null) {
    current = current.previousSibling;

    if (isNewSectionElement(current) || containsChildField(current)) {
      return parts;
    }

    const text = getTextContent(current);
    if (text) {
      parts.push(text);
    }
  }

  if (current == null || parts.length > 0) {
    return parts;
  }

  const parent = current.parentElement ?? current.parentNode;
  if (parent == null) {
    return parts;
  }

  let sibling: Node | null =
    parent instanceof Element ? parent.previousElementSibling : parent.previousSibling;

  // 走到前一个兄弟的最深处——排版上离字段最近的文字通常在那里。
  while (
    sibling != null &&
    sibling.lastChild != null &&
    !isNewSectionElement(sibling) &&
    !containsChildField(sibling)
  ) {
    sibling = sibling.lastChild;
  }

  if (sibling == null || isNewSectionElement(sibling) || containsChildField(sibling)) {
    return parts;
  }

  const text = getTextContent(sibling);
  if (text) {
    parts.push(text);
    return parts;
  }

  return collectPreviousSiblingText(sibling);
}

/** 这些标签意味着"另一个区块开始了"，跨过去取到的文字与本字段无关。 */
const SECTION_BOUNDARY_TAGS = new Set([
  "html",
  "body",
  "button",
  "form",
  "head",
  "iframe",
  "input",
  "option",
  "script",
  "select",
  "table",
  "textarea",
]);

function isNewSectionElement(node: Node | null): boolean {
  if (node == null) {
    return true;
  }
  if (!(node instanceof Element)) {
    return false;
  }
  return SECTION_BOUNDARY_TAGS.has(node.tagName.toLowerCase());
}

function containsChildField(node: Node): boolean {
  return node instanceof Element && node.querySelector("input, textarea, select, button") != null;
}

function getTextContent(node: Node): string | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue == null ? null : normalizeText(node.nodeValue);
  }
  return node.textContent == null ? null : normalizeText(node.textContent);
}

/**
 * 去掉不可打印字符并压缩连续空白——页面上的换行缩进不该混进标签文字。
 *
 * 分两步走：先把控制字符换成空格，再压缩所有空白。上游把两者写在同一个正则的
 * 交替分支里，遇到 `"\n\n  "` 会先吃掉换行产出一个空格、再吃掉空格产出一个空格，
 * 结果留下两个连续空格。判定阶段对标签做的是子串匹配，多出来的空格会造成漏匹配。
 */
function normalizeText(text: string): string {
  return text
    .replace(/\p{C}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- 取值助手 -------------------------------------------------------------

function setOpid(element: Element, opid: string): void {
  (element as Element & Record<string, unknown>)[OPID_PROPERTY] = opid;
}

/** 优先取 DOM 属性（property），取不到再退回 HTML 特性（attribute）。 */
function getPropertyOrAttribute(element: Element, name: string): string | null {
  const record = element as unknown as Record<string, unknown>;

  if (name in record) {
    const value = record[name];
    if (typeof value === "string") {
      return value;
    }
    if (value != null && typeof value !== "object") {
      return String(value);
    }
  }

  return element.getAttribute(name);
}

function getAttributeLowerCase(element: Element, name: string): string | undefined {
  return getPropertyOrAttribute(element, name)?.toLowerCase();
}

/**
 * 布尔特性判定。
 *
 * `checkString` 用于 aria-* 这类"值是字符串 'true'"的特性，与 `disabled` 这种
 * 存在即为真的原生布尔特性语义不同。
 *
 * 两个坑：
 *   - 原生布尔属性在 DOM 上是驼峰（`readOnly`），HTML 特性名却是全小写（`readonly`）
 *   - `<input readonly>` 的 `getAttribute("readonly")` 返回空串，`Boolean("")` 是 false
 * 因此这里先查驼峰属性，再退回 `hasAttribute`——判错的后果是往只读框里填内容。
 */
const BOOLEAN_PROPERTY_ALIASES: Record<string, string> = {
  readonly: "readOnly",
  maxlength: "maxLength",
  tabindex: "tabIndex",
};

function getAttributeBoolean(element: Element, name: string, checkString = false): boolean {
  if (checkString) {
    return getPropertyOrAttribute(element, name) === "true";
  }

  const propertyName = BOOLEAN_PROPERTY_ALIASES[name] ?? name;
  const record = element as unknown as Record<string, unknown>;

  if (propertyName in record && typeof record[propertyName] === "boolean") {
    return record[propertyName];
  }

  return element.hasAttribute(name);
}

function getAutoCompleteAttribute(element: Element): string | null {
  return (
    getPropertyOrAttribute(element, "x-autocompletetype") ??
    getPropertyOrAttribute(element, "autocompletetype") ??
    getPropertyOrAttribute(element, "autocomplete")
  );
}

function getMaxLength(element: Element): number | null {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    return null;
  }
  // 上限截到 999：某些站点会写一个天文数字，那对判定没有意义。
  return Math.min(element.maxLength > -1 ? element.maxLength : 999, 999);
}

function getElementValue(element: FieldElement): string {
  if (element instanceof HTMLSpanElement) {
    return element.textContent ?? "";
  }

  const value = (element as HTMLInputElement).value || "";

  if (String((element as HTMLInputElement).type).toLowerCase() === "checkbox") {
    return (element as HTMLInputElement).checked ? "✓" : "";
  }

  // 上游此处还有一段针对 hidden 字段的截断逻辑。本实现在查询阶段就排除了
  // hidden，那段代码永远走不到，留着只会让人以为 hidden 会被采集。
  return value;
}

function getDataSetValues(element: Element): string {
  const dataset = (element as HTMLElement).dataset;
  if (dataset == null) {
    return "";
  }

  let result = "";
  for (const key in dataset) {
    result += `${key}: ${dataset[key]}, `;
  }
  return result;
}

function getSelectOptions(element: HTMLSelectElement): { options: (string | null)[][] } {
  const options = Array.from(element.options).map((option) => {
    const text = option.text
      ? String(option.text)
          .toLowerCase()
          // 去掉空白与标点，让"Visa / 信用卡"这类写法能与判定表匹配上。
          .replace(/[\s~`!@$%^&#*()\-_+=:;'"[\]|\\,<.>?]/gm, "")
      : null;
    return [text, option.value];
  });

  return { options };
}
