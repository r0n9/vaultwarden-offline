import type {
  CipherRepromptType,
  CipherType,
  FieldType,
  SecureNoteType,
  UriMatchStrategy,
} from "./enums";

/**
 * 保险库数据模型。
 *
 * 同一套结构有明文与密文两种形态，用泛型参数 `S` 区分：
 *   `CipherView` = CipherData<string>          字段是明文
 *   `Cipher`     = CipherData<EncryptedString> 字段是序列化后的密文
 *
 * `EncryptedString` 是品牌类型 —— 把明文赋给密文字段（或反过来）会**编译报错**。
 * 在密码管理器里，"某个字段忘了加密就落盘"是最致命也最容易犯的错，
 * 让类型系统来堵这个口子比靠人眼审查可靠得多。
 *
 * 字段命名与 Bitwarden 导出 JSON 严格一致，导入导出因此几乎是零成本映射。
 */

export type EncryptedString = string & { readonly __brand: "EncryptedString" };

/** 把已知是密文的字符串标记为 EncryptedString（解析导入数据时使用）。 */
export function asEncrypted(value: string): EncryptedString {
  return value as EncryptedString;
}

// --- 子结构 ---------------------------------------------------------------

export interface LoginUriData<S extends string> {
  uri?: S;
  uriChecksum?: S;
  /** 匹配策略是枚举数值，不加密。 */
  match?: UriMatchStrategy;
}

export interface Fido2CredentialData<S extends string> {
  credentialId: S;
  keyType: S;
  keyAlgorithm: S;
  keyCurve: S;
  keyValue: S;
  rpId: S;
  userHandle?: S;
  userName?: S;
  counter: S;
  rpName?: S;
  userDisplayName?: S;
  discoverable: S;
  /** ISO 时间串，不加密。 */
  creationDate: string;
}

export interface LoginData<S extends string> {
  uris?: LoginUriData<S>[];
  username?: S;
  password?: S;
  totp?: S;
  passwordRevisionDate?: string;
  fido2Credentials?: Fido2CredentialData<S>[];
}

export interface SecureNoteData {
  /** 仅有类型枚举，无可加密内容；正文存在条目的 notes 字段里。 */
  type: SecureNoteType;
}

export interface CardData<S extends string> {
  cardholderName?: S;
  brand?: S;
  number?: S;
  expMonth?: S;
  expYear?: S;
  code?: S;
}

export interface IdentityData<S extends string> {
  title?: S;
  firstName?: S;
  middleName?: S;
  lastName?: S;
  address1?: S;
  address2?: S;
  address3?: S;
  city?: S;
  state?: S;
  postalCode?: S;
  country?: S;
  company?: S;
  email?: S;
  phone?: S;
  ssn?: S;
  username?: S;
  passportNumber?: S;
  licenseNumber?: S;
}

export interface SshKeyData<S extends string> {
  privateKey?: S;
  publicKey?: S;
  keyFingerprint?: S;
}

export interface BankAccountData<S extends string> {
  bankName?: S;
  nameOnAccount?: S;
  accountType?: S;
  accountNumber?: S;
  routingNumber?: S;
  branchNumber?: S;
  pin?: S;
  swiftCode?: S;
  iban?: S;
  bankContactPhone?: S;
}

export interface DriversLicenseData<S extends string> {
  firstName?: S;
  middleName?: S;
  lastName?: S;
  dateOfBirth?: S;
  licenseNumber?: S;
  issuingCountry?: S;
  issuingState?: S;
  issueDate?: S;
  expirationDate?: S;
  issuingAuthority?: S;
  licenseClass?: S;
}

export interface PassportData<S extends string> {
  surname?: S;
  givenName?: S;
  dateOfBirth?: S;
  sex?: S;
  birthPlace?: S;
  nationality?: S;
  issuingCountry?: S;
  passportNumber?: S;
  passportType?: S;
  nationalIdentificationNumber?: S;
  issuingAuthority?: S;
  issueDate?: S;
  expirationDate?: S;
}

export interface FieldData<S extends string> {
  name?: S;
  value?: S;
  /** 字段类型枚举，不加密。 */
  type: FieldType;
  linkedId?: number;
}

export interface PasswordHistoryData<S extends string> {
  password: S;
  lastUsedDate: string;
}

/**
 * 附件元数据。
 *
 * 元数据随条目加密存储（fileName 加密，其余为明文）；
 * 文件二进制本体存在 IndexedDB（vwo-attachments），键为 attachmentId，
 * 以 UserKey 加密（EncString type 2 的 iv/data/mac 拆开存放）。
 */
export interface AttachmentData<S extends string> {
  id: string;
  fileName: S;
  /** 明文：文件字节数。 */
  size: number;
  /** 明文：IndexedDB 对象仓库名，固定 "files"。 */
  containerName: string;
  creationDate: string;
}

// --- 条目 -----------------------------------------------------------------

export interface CipherData<S extends string> {
  id: string;
  type: CipherType;
  name: S;
  notes?: S;

  /** 以下为非敏感元数据，明文存储：不加密便于锁定态下也能统计与排序。 */
  favorite: boolean;
  reprompt: CipherRepromptType;
  folderId?: string;
  organizationId?: string;
  collectionIds?: string[];

  login?: LoginData<S>;
  secureNote?: SecureNoteData;
  card?: CardData<S>;
  identity?: IdentityData<S>;
  sshKey?: SshKeyData<S>;
  bankAccount?: BankAccountData<S>;
  driversLicense?: DriversLicenseData<S>;
  passport?: PassportData<S>;

  fields?: FieldData<S>[];
  passwordHistory?: PasswordHistoryData<S>[];
  attachments?: AttachmentData<S>[];

  creationDate: string;
  revisionDate: string;
  deletedDate?: string;
  archivedDate?: string;

  /**
   * 条目自有密钥（per-cipher key），本身用 UserKey 包裹。
   * 存在时，该条目的所有字段用它加密而非直接用 UserKey。
   */
  key?: EncryptedString;
}

export type Cipher = CipherData<EncryptedString>;
export type CipherView = CipherData<string>;

export interface FolderData<S extends string> {
  id: string;
  name: S;
  revisionDate: string;
}

export type Folder = FolderData<EncryptedString>;
export type FolderView = FolderData<string>;

/** 落盘的保险库主体。字段级加密，形态贴近 Bitwarden 导出 JSON。 */
export interface VaultData {
  ciphers: Cipher[];
  folders: Folder[];
}

export function emptyVaultData(): VaultData {
  return { ciphers: [], folders: [] };
}
