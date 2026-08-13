import { CipherType } from "@/core/vault/enums";
import type { CipherView } from "@/core/vault/models";

/**
 * 各条目类型的字段描述表。
 *
 * 查看与编辑两个界面都由它驱动——8 种类型若各写一份表单，光是"新增字段忘了
 * 同步到另一个界面"就够踩很多次。登录与安全笔记有 URI、TOTP 等特殊结构，
 * 单独处理；其余六类都是平铺的文本字段，正好由表驱动。
 */

export interface FieldSpec {
  key: string;
  label: string;
  /** 默认遮蔽显示，需点击才可见。 */
  secret?: boolean;
  multiline?: boolean;
}

export const TYPE_FIELDS: Partial<Record<CipherType, FieldSpec[]>> = {
  [CipherType.Card]: [
    { key: "cardholderName", label: "持卡人" },
    { key: "brand", label: "卡组织" },
    { key: "number", label: "卡号", secret: true },
    { key: "expMonth", label: "有效期月" },
    { key: "expYear", label: "有效期年" },
    { key: "code", label: "安全码", secret: true },
  ],
  [CipherType.Identity]: [
    { key: "title", label: "称谓" },
    { key: "firstName", label: "名" },
    { key: "middleName", label: "中间名" },
    { key: "lastName", label: "姓" },
    { key: "username", label: "用户名" },
    { key: "email", label: "邮箱" },
    { key: "phone", label: "电话" },
    { key: "company", label: "公司" },
    { key: "ssn", label: "社会保险号", secret: true },
    { key: "passportNumber", label: "护照号", secret: true },
    { key: "licenseNumber", label: "驾照号", secret: true },
    { key: "address1", label: "地址 1" },
    { key: "address2", label: "地址 2" },
    { key: "address3", label: "地址 3" },
    { key: "city", label: "城市" },
    { key: "state", label: "省/州" },
    { key: "postalCode", label: "邮编" },
    { key: "country", label: "国家" },
  ],
  [CipherType.SshKey]: [
    { key: "privateKey", label: "私钥", secret: true, multiline: true },
    { key: "publicKey", label: "公钥", multiline: true },
    { key: "keyFingerprint", label: "指纹" },
  ],
  [CipherType.BankAccount]: [
    { key: "bankName", label: "银行" },
    { key: "nameOnAccount", label: "户名" },
    { key: "accountType", label: "账户类型" },
    { key: "accountNumber", label: "账号", secret: true },
    { key: "routingNumber", label: "路由号", secret: true },
    { key: "branchNumber", label: "支行号" },
    { key: "pin", label: "PIN", secret: true },
    { key: "swiftCode", label: "SWIFT" },
    { key: "iban", label: "IBAN", secret: true },
    { key: "bankContactPhone", label: "客服电话" },
  ],
  [CipherType.DriversLicense]: [
    { key: "firstName", label: "名" },
    { key: "middleName", label: "中间名" },
    { key: "lastName", label: "姓" },
    { key: "dateOfBirth", label: "出生日期" },
    { key: "licenseNumber", label: "驾照号", secret: true },
    { key: "licenseClass", label: "准驾类型" },
    { key: "issuingCountry", label: "签发国家" },
    { key: "issuingState", label: "签发省/州" },
    { key: "issuingAuthority", label: "签发机关" },
    { key: "issueDate", label: "签发日期" },
    { key: "expirationDate", label: "有效期至" },
  ],
  [CipherType.Passport]: [
    { key: "surname", label: "姓" },
    { key: "givenName", label: "名" },
    { key: "passportNumber", label: "护照号", secret: true },
    { key: "passportType", label: "护照类型" },
    { key: "nationality", label: "国籍" },
    { key: "sex", label: "性别" },
    { key: "dateOfBirth", label: "出生日期" },
    { key: "birthPlace", label: "出生地" },
    { key: "nationalIdentificationNumber", label: "身份证号", secret: true },
    { key: "issuingCountry", label: "签发国家" },
    { key: "issuingAuthority", label: "签发机关" },
    { key: "issueDate", label: "签发日期" },
    { key: "expirationDate", label: "有效期至" },
  ],
};

/** 类型对应的载荷所在属性名。 */
export const TYPE_PAYLOAD_KEY: Record<CipherType, keyof CipherView> = {
  [CipherType.Login]: "login",
  [CipherType.SecureNote]: "secureNote",
  [CipherType.Card]: "card",
  [CipherType.Identity]: "identity",
  [CipherType.SshKey]: "sshKey",
  [CipherType.BankAccount]: "bankAccount",
  [CipherType.DriversLicense]: "driversLicense",
  [CipherType.Passport]: "passport",
};

/** 读取平铺类型的字段值。 */
export function readPayload(cipher: CipherView, key: string): string {
  const payload = cipher[TYPE_PAYLOAD_KEY[cipher.type]] as Record<string, unknown> | undefined;
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

/** 写入平铺类型的字段值；空串一律删键，避免导出文件里堆满空字段。 */
export function writePayload(cipher: CipherView, key: string, value: string): void {
  const payloadKey = TYPE_PAYLOAD_KEY[cipher.type];
  const payload = ((cipher[payloadKey] as Record<string, unknown> | undefined) ??
    {}) as Record<string, unknown>;

  if (value === "") {
    delete payload[key];
  } else {
    payload[key] = value;
  }

  (cipher as unknown as Record<string, unknown>)[payloadKey] = payload;
}
