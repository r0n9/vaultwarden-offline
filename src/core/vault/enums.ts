/**
 * 保险库枚举。数值与 Bitwarden 严格一致——它们会原样出现在导出文件里，
 * 改动即意味着导出的文件 Vaultwarden 读不懂。
 */

export const CipherType = {
  Login: 1,
  SecureNote: 2,
  Card: 3,
  Identity: 4,
  SshKey: 5,
  BankAccount: 6,
  DriversLicense: 7,
  Passport: 8,
} as const;

export type CipherType = (typeof CipherType)[keyof typeof CipherType];

export function isCipherType(value: unknown): value is CipherType {
  return Object.values(CipherType).includes(value as CipherType);
}

export const FieldType = {
  Text: 0,
  Hidden: 1,
  Boolean: 2,
  /** 关联到条目自身的某个字段（如"用户名"），值存的是字段编号而非文本。 */
  Linked: 3,
} as const;

export type FieldType = (typeof FieldType)[keyof typeof FieldType];

export const CipherRepromptType = {
  None: 0,
  /** 查看/填充前需要重新输入主密码。 */
  Password: 1,
} as const;

export type CipherRepromptType = (typeof CipherRepromptType)[keyof typeof CipherRepromptType];

export const SecureNoteType = {
  Generic: 0,
} as const;

export type SecureNoteType = (typeof SecureNoteType)[keyof typeof SecureNoteType];

/**
 * URI 匹配策略。
 *
 * Domain     顶级域+二级域相同即匹配（默认，最宽松也最实用）
 * Host       主机名与端口相同
 * StartsWith 目标 URL 以该 URI 开头
 * Exact      完全相同
 * RegularExpression 按正则匹配
 * Never      该条目永不参与自动填充
 */
export const UriMatchStrategy = {
  Domain: 0,
  Host: 1,
  StartsWith: 2,
  Exact: 3,
  RegularExpression: 4,
  Never: 5,
} as const;

export type UriMatchStrategy = (typeof UriMatchStrategy)[keyof typeof UriMatchStrategy];
