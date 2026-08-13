/**
 * 字段判定关键词表。
 *
 * 直接取自 Bitwarden，含其积累的多语言词条（德/法等）——这些词条覆盖的是真实
 * 站点上出现过的写法，凭空想是想不全的。
 *
 * ## 两类表的匹配方式不同
 *
 * `LOGIN_*` 走**精确相等**：整个属性值必须等于词条。数组顺序即优先级，
 *   越靠前越可信。支持三种前缀写法：
 *     `regex=…`  按正则匹配
 *     `csv=a,b`  匹配其中任一值
 *     `id=…` / `name=…` / `label=…` / `placeholder=…`  只比对指定属性
 *
 * `CARD_*` 与 `IDENTITY_*` 走**子串包含**：去掉空格后看属性值里有没有这个片段。
 *   卡片和身份字段的命名远比登录字段发散，精确匹配几乎命不中。
 */

// --- 登录 -----------------------------------------------------------------

export const EMAIL_FIELD_NAMES = [
  "email",
  "email address",
  "e-mail",
  "e-mail address",
  // 德语
  "email adresse",
  "e-mail adresse",
];

export const USERNAME_FIELD_NAMES = [
  "username",
  "user name",
  "userid",
  "user id",
  "customer id",
  "login id",
  "login",
  // 德语
  "benutzername",
  "benutzer name",
  "benutzerid",
  "benutzer id",
  ...EMAIL_FIELD_NAMES,
];

export const TOTP_FIELD_NAMES = [
  "2facode",
  "approvals_code",
  "mfacode",
  "onetimecode",
  "onetimepassword",
  "otc-code",
  "otp-code",
  "otpcode",
  "second-factor",
  "security_code",
  "security code",
  "totp",
  "totpcode",
  "twofa",
  "twofactor",
  "twofactorcode",
  "verificationcode",
  "verification code",
  "otc-confirmation",
];

/**
 * 这些词单独出现时含义不明（"code" 可能是验证码，也可能是优惠码），
 * 只在页面确实处于两步验证语境时才采信。
 */
export const AMBIGUOUS_TOTP_FIELD_NAMES = ["code", "pin", "otc", "otp", "2fa", "mfa"];

export const SEARCH_FIELD_NAMES = ["search", "query", "find", "go"];

/** 命中即完全排除的字段——填进去只会帮倒忙。 */
export const FIELD_IGNORE_LIST = ["captcha", "findanything", "forgot"];

/** 密码框中需要排除的：密保提示不是密码。 */
export const PASSWORD_FIELD_EXCLUDE_LIST = ["hint", ...FIELD_IGNORE_LIST];

// --- 卡片 -----------------------------------------------------------------

export const CARD_HOLDER_FIELD_NAMES = [
  "accountholdername",
  "cc-name",
  "card-name",
  "cardholder-name",
  "cardholder",
  "name",
  "nom",
];

export const CARD_NUMBER_FIELD_NAMES = [
  "cc-number",
  "cc-num",
  "card-number",
  "card-num",
  "number",
  "cc",
  "cc-no",
  "card-no",
  "credit-card",
  "numero-carte",
  "carte",
  "carte-credit",
  "num-carte",
  "cb-num",
  "card-pan",
];

export const CARD_EXPIRY_FIELD_NAMES = [
  "cc-exp",
  "card-exp",
  "cc-expiration",
  "card-expiration",
  "cc-ex",
  "card-ex",
  "card-expire",
  "card-expiry",
  "validite",
  "expiration",
  "expiry",
  "mm-yy",
  "mm-yyyy",
  "yy-mm",
  "yyyy-mm",
  "expiration-date",
  "payment-card-expiration",
  "payment-cc-date",
];

export const CARD_EXPIRY_MONTH_FIELD_NAMES = [
  "exp-month",
  "cc-exp-month",
  "cc-month",
  "card-month",
  "cc-mo",
  "card-mo",
  "exp-mo",
  "card-exp-mo",
  "cc-exp-mo",
  "card-expiration-month",
  "expiration-month",
  "cc-mm",
  "cc-m",
  "card-mm",
  "card-m",
  "card-exp-mm",
  "cc-exp-mm",
  "exp-mm",
  "exp-m",
  "expire-month",
  "expire-mo",
  "expiry-month",
  "expiry-mo",
  "card-expire-month",
  "card-expire-mo",
  "card-expiry-month",
  "card-expiry-mo",
  "mois-validite",
  "mois-expiration",
  "m-validite",
  "m-expiration",
  "expiry-date-field-month",
  "expiration-date-month",
  "expiration-date-mm",
  "exp-mon",
  "validity-mo",
  "exp-date-mo",
  "cb-date-mois",
  "date-m",
];

export const CARD_EXPIRY_YEAR_FIELD_NAMES = [
  "exp-year",
  "cc-exp-year",
  "cc-year",
  "card-year",
  "cc-yr",
  "card-yr",
  "exp-yr",
  "card-exp-yr",
  "cc-exp-yr",
  "card-expiration-year",
  "expiration-year",
  "cc-yy",
  "cc-y",
  "card-yy",
  "card-y",
  "card-exp-yy",
  "cc-exp-yy",
  "exp-yy",
  "exp-y",
  "cc-yyyy",
  "card-yyyy",
  "card-exp-yyyy",
  "cc-exp-yyyy",
  "expire-year",
  "expire-yr",
  "expiry-year",
  "expiry-yr",
  "card-expire-year",
  "card-expire-yr",
  "card-expiry-year",
  "card-expiry-yr",
  "an-validite",
  "an-expiration",
  "annee-validite",
  "annee-expiration",
  "expiry-date-field-year",
  "expiration-date-year",
  "cb-date-ann",
  "expiration-date-yy",
  "expiration-date-yyyy",
  "validity-year",
  "exp-date-year",
  "date-y",
];

export const CARD_CVV_FIELD_NAMES = [
  "cvv",
  "cvc",
  "cvv2",
  "cc-csc",
  "cc-cvv",
  "card-csc",
  "card-cvv",
  "cvd",
  "cid",
  "cvc2",
  "cnv",
  "cvn2",
  "cc-code",
  "card-code",
  "code-securite",
  "security-code",
  "crypto",
  "card-verif",
  "verification-code",
  "csc",
  "ccv",
];

export const CARD_BRAND_FIELD_NAMES = ["cc-type", "card-type", "card-brand", "cc-brand", "cb-type"];

// --- 身份 -----------------------------------------------------------------

export const IDENTITY_TITLE_FIELD_NAMES = ["honorific-prefix", "prefix", "title", "anrede"];

export const IDENTITY_FIRST_NAME_FIELD_NAMES = [
  "f-name",
  "first-name",
  "given-name",
  "first-n",
  "vorname",
];

export const IDENTITY_MIDDLE_NAME_FIELD_NAMES = [
  "m-name",
  "middle-name",
  "additional-name",
  "middle-initial",
  "middle-n",
  "middle-i",
];

export const IDENTITY_LAST_NAME_FIELD_NAMES = [
  "l-name",
  "last-name",
  "s-name",
  "surname",
  "family-name",
  "family-n",
  "last-n",
  "nachname",
  "familienname",
];

export const IDENTITY_FULL_NAME_FIELD_NAMES = ["name", "full-name", "your-name"];

export const IDENTITY_ADDRESS_FIELD_NAMES = [
  "address",
  "street-address",
  "addr",
  "street",
  "mailing-addr",
  "billing-addr",
  "mail-addr",
  "bill-addr",
  "strasse",
  "adresse",
];

export const IDENTITY_ADDRESS1_FIELD_NAMES = [
  "address-1",
  "address-line-1",
  "addr-1",
  "street-1",
];

export const IDENTITY_ADDRESS2_FIELD_NAMES = [
  "address-2",
  "address-line-2",
  "addr-2",
  "street-2",
  "address-ext",
];

export const IDENTITY_ADDRESS3_FIELD_NAMES = [
  "address-3",
  "address-line-3",
  "addr-3",
  "street-3",
];

export const IDENTITY_POSTAL_CODE_FIELD_NAMES = [
  "postal",
  "zip",
  "zip2",
  "zip-code",
  "postal-code",
  "post-code",
  "postcode",
  "address-zip",
  "address-postal",
  "address-code",
  "address-postal-code",
  "address-zip-code",
  "plz",
  "postleitzahl",
];

export const IDENTITY_CITY_FIELD_NAMES = [
  "city",
  "town",
  "address-level-2",
  "address-city",
  "address-town",
  "ort",
  "stadt",
  "wohnort",
];

export const IDENTITY_STATE_FIELD_NAMES = [
  "state",
  "province",
  "provence",
  "address-level-1",
  "address-state",
  "address-province",
  "bundesland",
];

export const IDENTITY_COUNTRY_FIELD_NAMES = [
  "country",
  "country-code",
  "country-name",
  "address-country",
  "address-country-name",
  "address-country-code",
  "land",
];

export const IDENTITY_PHONE_FIELD_NAMES = [
  "phone",
  "mobile",
  "mobile-phone",
  "tel",
  "telephone",
  "phone-number",
  "telefon",
  "telefonnummer",
  "mobil",
  "handy",
];

export const IDENTITY_COMPANY_FIELD_NAMES = [
  "company",
  "company-name",
  "organization",
  "organization-name",
  "firma",
];

export const IDENTITY_USERNAME_FIELD_NAMES = ["user-name", "user-id", "screen-name"];

export const IDENTITY_EMAIL_FIELD_NAMES = ["e-mail", "email-address"];
