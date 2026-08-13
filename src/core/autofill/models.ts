/**
 * 自动填充的页面数据模型。
 *
 * 字段命名刻意与 Bitwarden 保持一致（包括 `label-left` 这种带连字符的怪名字）——
 * 后续要移植的字段判定启发式有数千行，它们全都按这些名字取值。改名字省不下什么，
 * 却会在移植时制造大量无谓的翻译错误。
 */

/** 页面上一个可填充的表单。 */
export interface AutofillForm {
  /** 采集期分配的唯一标识。 */
  opid: string;
  htmlName: string;
  htmlID: string;
  htmlAction: string;
  htmlMethod: string;
}

/** 页面上一个可填充的字段。 */
export interface AutofillField {
  /** 采集期分配的唯一标识。 */
  opid: string;
  /**
   * 按 DOM 顺序递增的序号。
   * 判定"用户名在密码框上方"这类相对位置关系时要用到它。
   */
  elementNumber: number;
  /** 用户当前是否真的看得见（视口内、未被 CSS 隐藏、未被遮挡）。 */
  viewable: boolean;

  htmlID: string | null;
  htmlName: string | null;
  htmlClass: string | null;
  tabindex: string | null;
  title: string | null;
  tagName: string | null;

  type?: string;
  value?: string;
  disabled?: boolean;
  readonly?: boolean;
  checked?: boolean;
  maxLength: number | null;
  autoCompleteType?: string | null;
  placeholder?: string | null;
  rel?: string | null;
  /** 所属表单的 opid，无表单则为 null。 */
  form?: string | null;

  /** `<label>` 元素的文本。 */
  "label-tag"?: string;
  /** `data-label` 属性。 */
  "label-data"?: string | null;
  /** `aria-label` 属性。 */
  "label-aria"?: string | null;
  /** 表格布局中位于该字段正上方单元格的文本。 */
  "label-top"?: string | null;
  /** DOM 中位于该字段右侧的文本。 */
  "label-right"?: string;
  /** DOM 中位于该字段左侧的文本。 */
  "label-left"?: string;

  "aria-describedby"?: string | null;
  "aria-hidden"?: boolean;
  "aria-disabled"?: boolean;
  "aria-haspopup"?: boolean;
  "data-stripe"?: string | null;

  /** `data-*` 属性汇总，便于判定时做补充参考。 */
  dataSetValues?: string;
  /** `<select>` 的选项，形如 [[规范化文本, value], …]。 */
  selectInfo?: { options: (string | null)[][] } | null;
}

/** 一次页面采集的完整结果。 */
export interface AutofillPageDetails {
  title: string;
  url: string;
  documentUrl: string;
  /** 以 opid 为键的表单集合。 */
  forms: Record<string, AutofillForm>;
  fields: AutofillField[];
  collectedTimestamp: number;
}

/**
 * 不参与填充的 input 类型。
 *
 * `search` 与 `url` 也在其中：它们看着像文本框，但把密码填进搜索框会直接把密码
 * 送进站点的搜索日志。
 */
export const IGNORED_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "reset",
  "button",
  "image",
  "file",
  "search",
  "url",
  "date",
  "time",
  "datetime",
  "datetime-local",
  "week",
  "color",
  "range",
]);

/** 除 input 外同样可填充的标签。 */
export const NON_INPUT_FIELD_TAGS = new Set(["textarea", "select"]);

/**
 * 站点可用这两个属性显式控制本扩展的行为，语义沿用 Bitwarden：
 *   data-bwignore   该字段不参与填充
 *   data-bwautofill 让非表单元素（如 span）也参与采集
 */
export const IGNORE_ATTRIBUTE = "data-bwignore";
export const OPT_IN_ATTRIBUTE = "data-bwautofill";
