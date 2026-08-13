import type { AutofillField, AutofillPageDetails } from "./models";
import { qualifyCardFields, qualifyIdentityFields, qualifyLoginFields } from "./qualify-fields";

/**
 * 填充脚本。
 *
 * 背景页把"往哪个字段填什么"编译成一串极简指令交给页面执行，页面侧不需要
 * 知道任何密码库概念。这样注入到页面里的代码面可以压到最小。
 *
 * opid 是字段在采集列表中的下标标识，填充侧用同一个查询函数还原成元素。
 */

export type FillAction =
  | ["click_on_opid", string]
  | ["focus_by_opid", string]
  | ["fill_by_opid", string, string];

export interface FillScript {
  actions: FillAction[];
  /** 用于填充后向用户说明填了多少，不含具体值。 */
  filledFieldCount: number;
}

export interface LoginCredentials {
  username?: string;
  password?: string;
  /** 已算好的一次性验证码。TOTP 生成在 Phase 6，这里只负责填。 */
  totp?: string;
}

export interface CardCredentials {
  cardholderName?: string;
  number?: string;
  expMonth?: string;
  expYear?: string;
  code?: string;
  brand?: string;
}

export interface IdentityCredentials {
  title?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  username?: string;
  company?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/**
 * 逐字段追加动作。
 *
 * 顺序刻意模仿真人操作：先点一下、聚焦、再写值。很多站点（尤其是带前端校验的）
 * 只在收到交互事件后才认这个值，直接赋值会被判为"未填写"。
 */
class ScriptBuilder {
  private readonly actions: FillAction[] = [];
  private count = 0;
  private firstFilled?: AutofillField;

  add(field: AutofillField | undefined, value: string | undefined): void {
    if (field == null || value == null || value === "") {
      return;
    }
    this.actions.push(["click_on_opid", field.opid]);
    this.actions.push(["focus_by_opid", field.opid]);
    this.actions.push(["fill_by_opid", field.opid, value]);
    this.count += 1;
    this.firstFilled ??= field;
  }

  /**
   * 收尾把焦点交还给**第一个真正填过**的字段，光标位置更符合"刚填完表单"的预期。
   *
   * 只认填过的字段：对一个没碰过的空字段触发聚焦再失焦，会让不少站点当场
   * 弹出"此项必填"的校验错误。
   */
  finish(): FillScript {
    if (this.firstFilled != null) {
      this.actions.push(["focus_by_opid", this.firstFilled.opid]);
    }
    return { actions: this.actions, filledFieldCount: this.count };
  }
}

export function buildLoginFillScript(
  details: AutofillPageDetails,
  credentials: LoginCredentials,
): FillScript {
  const { usernameField, passwordFields, totpField } = qualifyLoginFields(details);
  const builder = new ScriptBuilder();

  builder.add(usernameField, credentials.username);
  for (const field of passwordFields) {
    builder.add(field, credentials.password);
  }
  builder.add(totpField, credentials.totp);

  return builder.finish();
}

export function buildCardFillScript(
  details: AutofillPageDetails,
  card: CardCredentials,
): FillScript {
  const fields = qualifyCardFields(details);
  const builder = new ScriptBuilder();

  builder.add(fields.cardholderName, card.cardholderName);
  builder.add(fields.number, card.number);
  builder.add(fields.brand, card.brand);
  builder.add(fields.code, card.code);

  if (fields.expCombined != null) {
    builder.add(fields.expCombined, combinedExpiry(fields.expCombined, card));
  } else {
    builder.add(fields.expMonth, normalizeMonth(fields.expMonth, card.expMonth));
    builder.add(fields.expYear, normalizeYear(fields.expYear, card.expYear));
  }

  return builder.finish();
}

export function buildIdentityFillScript(
  details: AutofillPageDetails,
  identity: IdentityCredentials,
): FillScript {
  const fields = qualifyIdentityFields(details);
  const builder = new ScriptBuilder();

  builder.add(fields.title, identity.title);
  builder.add(fields.firstName, identity.firstName);
  builder.add(fields.middleName, identity.middleName);
  builder.add(fields.lastName, identity.lastName);
  builder.add(
    fields.fullName,
    [identity.firstName, identity.middleName, identity.lastName].filter(Boolean).join(" ") ||
      undefined,
  );
  builder.add(fields.email, identity.email);
  builder.add(fields.phone, identity.phone);
  builder.add(fields.username, identity.username);
  builder.add(fields.company, identity.company);
  builder.add(fields.address1, identity.address1);
  builder.add(fields.address2, identity.address2);
  builder.add(fields.address3, identity.address3);
  builder.add(fields.city, identity.city);
  builder.add(fields.state, identity.state);
  builder.add(fields.postalCode, identity.postalCode);
  builder.add(fields.country, identity.country);

  return builder.finish();
}

// --- 有效期格式处理 --------------------------------------------------------

/**
 * 月份补零。
 *
 * 若目标是 `<select>`，则尽量选一个它真的有的选项——有些站点的月份下拉用
 * `1`~`12`，有些用 `01`~`12`，填错值等于没填。
 */
function normalizeMonth(field: AutofillField | undefined, month: string | undefined): string | undefined {
  if (month == null || month === "") {
    return undefined;
  }

  const numeric = Number.parseInt(month, 10);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 12) {
    return month;
  }

  const padded = String(numeric).padStart(2, "0");
  const bare = String(numeric);

  const options = field?.selectInfo?.options;
  if (options != null) {
    const values = options.map((entry) => entry[1]);
    if (values.includes(padded)) {
      return padded;
    }
    if (values.includes(bare)) {
      return bare;
    }
  }

  return padded;
}

/** 年份：按目标字段的长度限制决定给两位还是四位。 */
function normalizeYear(field: AutofillField | undefined, year: string | undefined): string | undefined {
  if (year == null || year === "") {
    return undefined;
  }

  const digits = year.replace(/\D/g, "");
  const short = digits.slice(-2);
  const long = digits.length === 4 ? digits : `20${short}`;

  const options = field?.selectInfo?.options;
  if (options != null) {
    const values = options.map((entry) => entry[1]);
    if (values.includes(long)) {
      return long;
    }
    if (values.includes(short)) {
      return short;
    }
  }

  return field?.maxLength === 2 ? short : long;
}

/**
 * 月年合并框。
 *
 * 站点常在 placeholder 里写明期望格式（`MM/YY`、`MM-YYYY`…），据此拼装。
 * 认不出格式时退回最常见的 `MM/YY`。
 */
function combinedExpiry(field: AutofillField, card: CardCredentials): string | undefined {
  if (card.expMonth == null || card.expYear == null) {
    return undefined;
  }

  const month = String(Number.parseInt(card.expMonth, 10)).padStart(2, "0");
  const digits = card.expYear.replace(/\D/g, "");
  const shortYear = digits.slice(-2);
  const longYear = digits.length === 4 ? digits : `20${shortYear}`;

  const hint = [field.placeholder, field["label-tag"], field["label-left"], field.title]
    .filter((value): value is string => value != null && value !== "")
    .join(" ")
    .toLowerCase();

  const separator = hint.includes("-") ? "-" : hint.includes(".") ? "." : "/";
  const wantsLongYear = /y{4}|j{4}|a{4}|г{4}|r{4}/.test(hint);
  const yearFirst = /^[^my]*(y{2,4}|j{2,4})\s*[-./]\s*m{2}/.test(hint);

  const year = wantsLongYear ? longYear : shortYear;
  return yearFirst ? `${year}${separator}${month}` : `${month}${separator}${year}`;
}
