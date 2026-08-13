import {
  attributesContainAny,
  autoCompleteIncludes,
  autoCompleteIncludesAny,
  matchKeywordIndex,
  matchesAnyKeyword,
} from "./field-matching";
import {
  AMBIGUOUS_TOTP_FIELD_NAMES,
  CARD_BRAND_FIELD_NAMES,
  CARD_CVV_FIELD_NAMES,
  CARD_EXPIRY_FIELD_NAMES,
  CARD_EXPIRY_MONTH_FIELD_NAMES,
  CARD_EXPIRY_YEAR_FIELD_NAMES,
  CARD_HOLDER_FIELD_NAMES,
  CARD_NUMBER_FIELD_NAMES,
  FIELD_IGNORE_LIST,
  IDENTITY_ADDRESS1_FIELD_NAMES,
  IDENTITY_ADDRESS2_FIELD_NAMES,
  IDENTITY_ADDRESS3_FIELD_NAMES,
  IDENTITY_ADDRESS_FIELD_NAMES,
  IDENTITY_CITY_FIELD_NAMES,
  IDENTITY_COMPANY_FIELD_NAMES,
  IDENTITY_COUNTRY_FIELD_NAMES,
  IDENTITY_EMAIL_FIELD_NAMES,
  IDENTITY_FIRST_NAME_FIELD_NAMES,
  IDENTITY_FULL_NAME_FIELD_NAMES,
  IDENTITY_LAST_NAME_FIELD_NAMES,
  IDENTITY_MIDDLE_NAME_FIELD_NAMES,
  IDENTITY_PHONE_FIELD_NAMES,
  IDENTITY_POSTAL_CODE_FIELD_NAMES,
  IDENTITY_STATE_FIELD_NAMES,
  IDENTITY_TITLE_FIELD_NAMES,
  IDENTITY_USERNAME_FIELD_NAMES,
  PASSWORD_FIELD_EXCLUDE_LIST,
  SEARCH_FIELD_NAMES,
  TOTP_FIELD_NAMES,
  USERNAME_FIELD_NAMES,
} from "./keywords";
import type { AutofillField, AutofillPageDetails } from "./models";

/**
 * 字段语义判定。
 *
 * 三级策略，可信度递减：
 *   1. `autocomplete` 属性——W3C 标准，站点明确声明了字段用途，最可信
 *   2. 关键词匹配——比对 id/name/各类标签/placeholder
 *   3. 位置推断——仅用于用户名：密码框上方最近的文本框
 *
 * 逐级下降而非平权投票，是因为一旦站点给了 autocomplete，它几乎不会错；
 * 而位置推断在"页面顶部有搜索框"之类的布局里很容易误判，只该做最后兜底。
 */

/** 可以承载用户名的输入类型。 */
const USERNAME_INPUT_TYPES = new Set(["text", "email", "tel", "number", ""]);

/** 一次性验证码通常很短，用长度上限过滤掉"优惠码"这类同名字段。 */
const MAX_TOTP_FIELD_LENGTH = 10;

export interface QualifiedLoginFields {
  usernameField?: AutofillField;
  passwordFields: AutofillField[];
  totpField?: AutofillField;
}

export interface QualifiedCardFields {
  cardholderName?: AutofillField;
  number?: AutofillField;
  expMonth?: AutofillField;
  expYear?: AutofillField;
  /** 月年合并在一个框里的情形。 */
  expCombined?: AutofillField;
  code?: AutofillField;
  brand?: AutofillField;
}

export interface QualifiedIdentityFields {
  title?: AutofillField;
  firstName?: AutofillField;
  middleName?: AutofillField;
  lastName?: AutofillField;
  fullName?: AutofillField;
  email?: AutofillField;
  phone?: AutofillField;
  username?: AutofillField;
  company?: AutofillField;
  address1?: AutofillField;
  address2?: AutofillField;
  address3?: AutofillField;
  city?: AutofillField;
  state?: AutofillField;
  postalCode?: AutofillField;
  country?: AutofillField;
}

/** 字段是否可被填充：看得见、没禁用、非只读、不在忽略名单里。 */
export function isFillable(field: AutofillField): boolean {
  if (!field.viewable || field.disabled === true || field.readonly === true) {
    return false;
  }
  // captcha / forgot 这类字段填进去只会帮倒忙。
  return !attributesContainAny(field, FIELD_IGNORE_LIST);
}

function fillableFields(details: AutofillPageDetails): AutofillField[] {
  return details.fields.filter(isFillable);
}

function isTextLike(field: AutofillField): boolean {
  return field.tagName === "input" && USERNAME_INPUT_TYPES.has(field.type ?? "");
}

/**
 * 站内搜索框长得跟用户名框一模一样，但把凭据填进去会直接把它送进对方的搜索日志。
 */
function isSearchField(field: AutofillField): boolean {
  return field.type === "search" || matchesAnyKeyword(field, SEARCH_FIELD_NAMES);
}

// --- 登录 -----------------------------------------------------------------

export function qualifyLoginFields(details: AutofillPageDetails): QualifiedLoginFields {
  const fillable = fillableFields(details);

  const passwordFields = fillable.filter(
    (field) => field.type === "password" && !attributesContainAny(field, PASSWORD_FIELD_EXCLUDE_LIST),
  );

  const usernameField = findUsernameField(fillable, passwordFields[0]);
  const totpField = findTotpField(fillable, usernameField);

  const result: QualifiedLoginFields = { passwordFields };
  if (usernameField != null) {
    result.usernameField = usernameField;
  }
  if (totpField != null) {
    result.totpField = totpField;
  }
  return result;
}

function findUsernameField(
  fillable: AutofillField[],
  firstPassword: AutofillField | undefined,
): AutofillField | undefined {
  const candidates = fillable.filter(
    (field) => isTextLike(field) && !isSearchField(field) && field !== firstPassword,
  );

  if (candidates.length === 0) {
    return undefined;
  }

  // 第 1 级：站点自己声明的 autocomplete。
  const declared = candidates.find((field) =>
    autoCompleteIncludesAny(field, ["username", "email"]),
  );
  if (declared != null) {
    return declared;
  }

  // 第 2 级：关键词，取优先级最高（下标最小）的那个。
  let best: { field: AutofillField; rank: number } | undefined;
  for (const field of candidates) {
    const rank = matchKeywordIndex(field, USERNAME_FIELD_NAMES);
    if (rank !== -1 && (best == null || rank < best.rank)) {
      best = { field, rank };
    }
  }
  if (best != null) {
    return best.field;
  }

  // 第 3 级：位置兜底——密码框上方最近的文本框，同表单优先。
  if (firstPassword == null) {
    return candidates[0];
  }

  const before = candidates.filter((field) => field.elementNumber < firstPassword.elementNumber);
  if (before.length === 0) {
    return undefined;
  }

  const sameForm = before.filter((field) => field.form === firstPassword.form);
  const pool = sameForm.length > 0 ? sameForm : before;
  return pool[pool.length - 1];
}

function findTotpField(
  fillable: AutofillField[],
  usernameField: AutofillField | undefined,
): AutofillField | undefined {
  const candidates = fillable.filter(
    (field) => isTextLike(field) && field !== usernameField && field.type !== "password",
  );

  const declared = candidates.find((field) => autoCompleteIncludes(field, "one-time-code"));
  if (declared != null) {
    return declared;
  }

  const byKeyword = candidates.find((field) => matchesAnyKeyword(field, TOTP_FIELD_NAMES));
  if (byKeyword != null) {
    return byKeyword;
  }

  // "code" / "pin" 这类词单独出现时含义不明，再要求字段足够短才采信——
  // 优惠码、邮编等同名字段通常没有这么严的长度限制。
  return candidates.find(
    (field) =>
      matchesAnyKeyword(field, AMBIGUOUS_TOTP_FIELD_NAMES) &&
      field.maxLength != null &&
      field.maxLength <= MAX_TOTP_FIELD_LENGTH,
  );
}

// --- 卡片 -----------------------------------------------------------------

/** 先看 autocomplete，再看关键词子串。 */
function findByAutoCompleteOrKeywords(
  fields: AutofillField[],
  tokens: readonly string[],
  keywords: readonly string[],
  extraFilter: (field: AutofillField) => boolean = () => true,
): AutofillField | undefined {
  const candidates = fields.filter(extraFilter);

  const declared = candidates.find((field) => autoCompleteIncludesAny(field, tokens));
  if (declared != null) {
    return declared;
  }

  return candidates.find((field) => attributesContainAny(field, keywords));
}

export function qualifyCardFields(details: AutofillPageDetails): QualifiedCardFields {
  const fillable = fillableFields(details);
  const result: QualifiedCardFields = {};

  const assign = <K extends keyof QualifiedCardFields>(
    key: K,
    field: AutofillField | undefined,
  ) => {
    if (field != null) {
      result[key] = field;
    }
  };

  assign("number", findByAutoCompleteOrKeywords(fillable, ["cc-number"], CARD_NUMBER_FIELD_NAMES));
  assign("code", findByAutoCompleteOrKeywords(fillable, ["cc-csc"], CARD_CVV_FIELD_NAMES));
  assign("brand", findByAutoCompleteOrKeywords(fillable, ["cc-type"], CARD_BRAND_FIELD_NAMES));

  // 持卡人姓名放在卡号之后判定：CARD_HOLDER 里有个宽泛的 "name"，
  // 先判卡号能避免把 "cc-name" 之外的字段抢走。
  assign(
    "cardholderName",
    findByAutoCompleteOrKeywords(
      fillable,
      ["cc-name"],
      CARD_HOLDER_FIELD_NAMES,
      (field) => field !== result.number && field !== result.code,
    ),
  );

  const taken = new Set([result.number, result.code, result.brand, result.cardholderName]);
  const remaining = fillable.filter((field) => !taken.has(field));

  assign(
    "expMonth",
    findByAutoCompleteOrKeywords(remaining, ["cc-exp-month"], CARD_EXPIRY_MONTH_FIELD_NAMES),
  );
  assign(
    "expYear",
    findByAutoCompleteOrKeywords(
      remaining.filter((field) => field !== result.expMonth),
      ["cc-exp-year"],
      CARD_EXPIRY_YEAR_FIELD_NAMES,
    ),
  );

  // 只有在没拆成月/年两个框时，才去找合并的有效期框。
  if (result.expMonth == null && result.expYear == null) {
    assign(
      "expCombined",
      findByAutoCompleteOrKeywords(remaining, ["cc-exp"], CARD_EXPIRY_FIELD_NAMES),
    );
  }

  return result;
}

// --- 身份 -----------------------------------------------------------------

export function qualifyIdentityFields(details: AutofillPageDetails): QualifiedIdentityFields {
  const fillable = fillableFields(details).filter((field) => !isSearchField(field));
  const result: QualifiedIdentityFields = {};
  const taken = new Set<AutofillField>();

  /** 判定顺序即优先级：先被认领的字段不会再被后面的规则抢走。 */
  const claim = <K extends keyof QualifiedIdentityFields>(
    key: K,
    tokens: readonly string[],
    keywords: readonly string[],
  ) => {
    const field = findByAutoCompleteOrKeywords(
      fillable.filter((candidate) => !taken.has(candidate)),
      tokens,
      keywords,
    );
    if (field != null) {
      result[key] = field;
      taken.add(field);
    }
  };

  // 具体的先认领，宽泛的后认领——否则 "address" 会把 "address-line-2" 抢走。
  claim("email", ["email"], IDENTITY_EMAIL_FIELD_NAMES);
  claim("phone", ["tel"], IDENTITY_PHONE_FIELD_NAMES);
  claim("title", ["honorific-prefix"], IDENTITY_TITLE_FIELD_NAMES);
  claim("firstName", ["given-name"], IDENTITY_FIRST_NAME_FIELD_NAMES);
  claim("middleName", ["additional-name"], IDENTITY_MIDDLE_NAME_FIELD_NAMES);
  claim("lastName", ["family-name"], IDENTITY_LAST_NAME_FIELD_NAMES);
  claim("company", ["organization"], IDENTITY_COMPANY_FIELD_NAMES);
  claim("username", ["username"], IDENTITY_USERNAME_FIELD_NAMES);

  claim("address2", ["address-line2"], IDENTITY_ADDRESS2_FIELD_NAMES);
  claim("address3", ["address-line3"], IDENTITY_ADDRESS3_FIELD_NAMES);
  claim("address1", ["address-line1", "street-address"], IDENTITY_ADDRESS1_FIELD_NAMES);

  claim("postalCode", ["postal-code"], IDENTITY_POSTAL_CODE_FIELD_NAMES);
  claim("city", ["address-level2"], IDENTITY_CITY_FIELD_NAMES);
  claim("state", ["address-level1"], IDENTITY_STATE_FIELD_NAMES);
  claim("country", ["country", "country-name"], IDENTITY_COUNTRY_FIELD_NAMES);

  // 兜底：拆不出名/姓时，看有没有一个整名字段。
  if (result.firstName == null && result.lastName == null) {
    claim("fullName", ["name"], IDENTITY_FULL_NAME_FIELD_NAMES);
  }
  // 地址行 1 仍未认领时，用宽泛的 address 词表再试一次。
  if (result.address1 == null) {
    claim("address1", [], IDENTITY_ADDRESS_FIELD_NAMES);
  }

  return result;
}
