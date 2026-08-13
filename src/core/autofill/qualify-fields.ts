import type { AutofillField, AutofillPageDetails } from "./models";

/**
 * 字段语义判定（第 1 版）。
 *
 * ⚠️ 这是**刻意做浅**的版本，只覆盖最典型的登录表单，目的是让填充链路先端到端跑通。
 * 完整的关键词启发式（用户名/邮箱/手机号/卡号/身份字段，以及注册与改密场景的区分）
 * 是下一步的事，届时会替换本文件而不是在此堆砌。
 *
 * 当前规则：
 *   密码 = type=password 且可见可编辑的字段
 *   用户名 = 该密码框**之前**最近的一个可见可编辑文本类字段（同表单优先）
 *
 * 这条"就近向前找"的规则来自 Bitwarden，覆盖面出奇地好——绝大多数登录表单
 * 都把用户名放在密码上方。
 */

/** 可以承载用户名的输入类型。 */
const USERNAME_INPUT_TYPES = new Set(["text", "email", "tel", "number", ""]);

export interface QualifiedLoginFields {
  usernameField?: AutofillField;
  passwordFields: AutofillField[];
}

/** 字段是否可被填充：看得见、没禁用、非只读。 */
export function isFillable(field: AutofillField): boolean {
  return field.viewable && field.disabled !== true && field.readonly !== true;
}

function isPasswordField(field: AutofillField): boolean {
  return field.type === "password";
}

function isUsernameCandidate(field: AutofillField): boolean {
  if (field.tagName !== "input") {
    return false;
  }
  return USERNAME_INPUT_TYPES.has(field.type ?? "");
}

/**
 * 从页面详情里挑出登录字段。
 *
 * 只在可填充字段中判定——不可见的字段往往是框架留下的残骸或钓鱼陷阱，
 * 把密码填进用户看不见的地方是这里最不能犯的错。
 */
export function qualifyLoginFields(details: AutofillPageDetails): QualifiedLoginFields {
  const fillable = details.fields.filter(isFillable);
  const passwordFields = fillable.filter(isPasswordField);

  if (passwordFields.length === 0) {
    // 没有密码框：可能是分步登录的第一步，此时只填用户名。
    const usernameField = fillable.find(isUsernameCandidate);
    return usernameField == null ? { passwordFields: [] } : { usernameField, passwordFields: [] };
  }

  const firstPassword = passwordFields[0]!;
  const usernameField = findUsernameBefore(fillable, firstPassword);

  return usernameField == null
    ? { passwordFields }
    : { usernameField, passwordFields };
}

/** 在密码框之前就近向前找用户名，优先同一表单内的字段。 */
function findUsernameBefore(
  fillable: AutofillField[],
  passwordField: AutofillField,
): AutofillField | undefined {
  const candidates = fillable.filter(
    (field) => field.elementNumber < passwordField.elementNumber && isUsernameCandidate(field),
  );

  if (candidates.length === 0) {
    return undefined;
  }

  const sameForm = candidates.filter((field) => field.form === passwordField.form);
  const pool = sameForm.length > 0 ? sameForm : candidates;

  // 就近原则：取 DOM 顺序上离密码框最近的那个。
  return pool[pool.length - 1];
}
