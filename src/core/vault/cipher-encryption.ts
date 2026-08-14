import {
  EncString,
  SymmetricCryptoKey,
  decryptToBytes,
  decryptToString,
  encryptString,
} from "@/core/crypto";

import type {
  Cipher,
  CipherView,
  EncryptedString,
  Folder,
  FolderView,
} from "./models";

/**
 * 条目的加解密映射。
 *
 * ## 为什么用"字段规格表"
 *
 * 密码管理器最致命也最隐蔽的 bug 是：给模型加了个新字段，忘了把它接进加密路径，
 * 于是它以明文落盘，而所有测试照样全绿。
 *
 * 这里的对策是：每个结构都必须把自己的字段**逐个登记**为 `encrypted` 或 `plain`，
 * 遇到未登记的字段直接抛错。新增字段若忘了登记，第一次读写就会炸——
 * 响亮地失败，而不是安静地泄漏。
 *
 * ## per-cipher key
 *
 * 解密时若条目带 `key`，先用 UserKey 解开它，再用它解该条目的字段（Bitwarden 新版行为）。
 * 加密时我们统一直接用 UserKey 并不产出 `key` —— 这在格式上完全合法（该字段可选），
 * 少一层密钥也少一处出错的可能。
 */

interface FieldSpec {
  readonly encrypted: readonly string[];
  readonly plain: readonly string[];
}

const SPEC = {
  loginUri: { encrypted: ["uri", "uriChecksum"], plain: ["match"] },
  fido2Credential: {
    encrypted: [
      "credentialId",
      "keyType",
      "keyAlgorithm",
      "keyCurve",
      "keyValue",
      "rpId",
      "userHandle",
      "userName",
      "counter",
      "rpName",
      "userDisplayName",
      "discoverable",
    ],
    plain: ["creationDate"],
  },
  login: {
    encrypted: ["username", "password", "totp"],
    plain: ["passwordRevisionDate", "uris", "fido2Credentials"],
  },
  card: {
    encrypted: ["cardholderName", "brand", "number", "expMonth", "expYear", "code"],
    plain: [],
  },
  identity: {
    encrypted: [
      "title",
      "firstName",
      "middleName",
      "lastName",
      "address1",
      "address2",
      "address3",
      "city",
      "state",
      "postalCode",
      "country",
      "company",
      "email",
      "phone",
      "ssn",
      "username",
      "passportNumber",
      "licenseNumber",
    ],
    plain: [],
  },
  sshKey: { encrypted: ["privateKey", "publicKey", "keyFingerprint"], plain: [] },
  bankAccount: {
    encrypted: [
      "bankName",
      "nameOnAccount",
      "accountType",
      "accountNumber",
      "routingNumber",
      "branchNumber",
      "pin",
      "swiftCode",
      "iban",
      "bankContactPhone",
    ],
    plain: [],
  },
  driversLicense: {
    encrypted: [
      "firstName",
      "middleName",
      "lastName",
      "dateOfBirth",
      "licenseNumber",
      "issuingCountry",
      "issuingState",
      "issueDate",
      "expirationDate",
      "issuingAuthority",
      "licenseClass",
    ],
    plain: [],
  },
  passport: {
    encrypted: [
      "surname",
      "givenName",
      "dateOfBirth",
      "sex",
      "birthPlace",
      "nationality",
      "issuingCountry",
      "passportNumber",
      "passportType",
      "nationalIdentificationNumber",
      "issuingAuthority",
      "issueDate",
      "expirationDate",
    ],
    plain: [],
  },
  field: { encrypted: ["name", "value"], plain: ["type", "linkedId"] },
  passwordHistory: { encrypted: ["password"], plain: ["lastUsedDate"] },
  attachment: {
    encrypted: ["fileName"],
    plain: ["id", "size", "containerName", "creationDate"],
  },
  secureNote: { encrypted: [], plain: ["type"] },
  cipher: {
    encrypted: ["name", "notes"],
    plain: [
      "id",
      "type",
      "favorite",
      "reprompt",
      "folderId",
      "organizationId",
      "collectionIds",
      "creationDate",
      "revisionDate",
      "deletedDate",
      "archivedDate",
      "key",
      "login",
      "secureNote",
      "card",
      "identity",
      "sshKey",
      "bankAccount",
      "driversLicense",
      "passport",
      "fields",
      "passwordHistory",
      "attachments",
    ],
  },
  folder: { encrypted: ["name"], plain: ["id", "revisionDate"] },
} as const satisfies Record<string, FieldSpec>;

type Transform = (value: string) => Promise<string>;

/**
 * 按规格表逐字段变换。未登记的字段直接抛错——这是本模块的安全阀。
 */
async function transformStruct(
  source: Record<string, unknown> | undefined,
  spec: FieldSpec,
  transform: Transform,
  label: string,
): Promise<Record<string, unknown> | undefined> {
  if (source == null) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }

    if (spec.plain.includes(key)) {
      result[key] = value;
      continue;
    }

    if (!spec.encrypted.includes(key)) {
      throw new Error(
        `${label} 含未登记字段 "${key}"：请在 cipher-encryption.ts 的规格表中声明它属于 encrypted 还是 plain`,
      );
    }

    result[key] = value === null ? null : await transform(String(value));
  }

  return result;
}

async function transformArray(
  source: unknown,
  spec: FieldSpec,
  transform: Transform,
  label: string,
): Promise<unknown[] | undefined> {
  if (!Array.isArray(source)) {
    return undefined;
  }
  return await Promise.all(
    source.map((item) =>
      transformStruct(item as Record<string, unknown>, spec, transform, label),
    ),
  );
}

/** 条目内各子结构共用的变换流程，加密与解密仅 transform 不同。 */
async function transformCipher(
  source: Record<string, unknown>,
  transform: Transform,
): Promise<Record<string, unknown>> {
  const result = (await transformStruct(source, SPEC.cipher, transform, "条目")) ?? {};

  const login = source["login"] as Record<string, unknown> | undefined;
  if (login != null) {
    const transformedLogin = (await transformStruct(login, SPEC.login, transform, "登录信息")) ?? {};
    transformedLogin["uris"] = await transformArray(login["uris"], SPEC.loginUri, transform, "URI");
    transformedLogin["fido2Credentials"] = await transformArray(
      login["fido2Credentials"],
      SPEC.fido2Credential,
      transform,
      "Passkey",
    );
    // 数组字段若原本不存在就别凭空造出来，否则导出结果会与源文件产生无谓差异。
    if (transformedLogin["uris"] === undefined) {
      delete transformedLogin["uris"];
    }
    if (transformedLogin["fido2Credentials"] === undefined) {
      delete transformedLogin["fido2Credentials"];
    }
    result["login"] = transformedLogin;
  }

  const simpleStructs = [
    ["secureNote", SPEC.secureNote, "安全笔记"],
    ["card", SPEC.card, "银行卡"],
    ["identity", SPEC.identity, "身份"],
    ["sshKey", SPEC.sshKey, "SSH 密钥"],
    ["bankAccount", SPEC.bankAccount, "银行账户"],
    ["driversLicense", SPEC.driversLicense, "驾照"],
    ["passport", SPEC.passport, "护照"],
  ] as const;

  for (const [key, spec, label] of simpleStructs) {
    const value = source[key] as Record<string, unknown> | undefined;
    if (value != null) {
      result[key] = await transformStruct(value, spec, transform, label);
    }
  }

  const fields = await transformArray(source["fields"], SPEC.field, transform, "自定义字段");
  if (fields != null) {
    result["fields"] = fields;
  }

  const history = await transformArray(
    source["passwordHistory"],
    SPEC.passwordHistory,
    transform,
    "密码历史",
  );
  if (history != null) {
    result["passwordHistory"] = history;
  }

  const attachments = await transformArray(
    source["attachments"],
    SPEC.attachment,
    transform,
    "附件",
  );
  if (attachments != null) {
    result["attachments"] = attachments;
  }

  return result;
}

function encryptor(key: SymmetricCryptoKey): Transform {
  return async (value) => (await encryptString(value, key)).toString();
}

function decryptor(key: SymmetricCryptoKey): Transform {
  return async (value) => await decryptToString(EncString.parse(value), key);
}

export async function encryptCipher(
  view: CipherView,
  userKey: SymmetricCryptoKey,
): Promise<Cipher> {
  const result = await transformCipher(
    view as unknown as Record<string, unknown>,
    encryptor(userKey),
  );
  // 统一用 UserKey 加密，不产出 per-cipher key。
  delete result["key"];
  return result as unknown as Cipher;
}

export async function decryptCipher(
  cipher: Cipher,
  userKey: SymmetricCryptoKey,
): Promise<CipherView> {
  const key = await resolveCipherKey(cipher, userKey);
  const result = await transformCipher(cipher as unknown as Record<string, unknown>, decryptor(key));
  delete result["key"];
  return result as unknown as CipherView;
}

/** 条目自带 key 时用它，否则直接用 UserKey。 */
async function resolveCipherKey(
  cipher: Cipher,
  userKey: SymmetricCryptoKey,
): Promise<SymmetricCryptoKey> {
  if (cipher.key == null) {
    return userKey;
  }
  return new SymmetricCryptoKey(await decryptToBytes(EncString.parse(cipher.key), userKey));
}

export async function encryptFolder(
  view: FolderView,
  userKey: SymmetricCryptoKey,
): Promise<Folder> {
  const result = await transformStruct(
    view as unknown as Record<string, unknown>,
    SPEC.folder,
    encryptor(userKey),
    "文件夹",
  );
  return result as unknown as Folder;
}

export async function decryptFolder(
  folder: Folder,
  userKey: SymmetricCryptoKey,
): Promise<FolderView> {
  const result = await transformStruct(
    folder as unknown as Record<string, unknown>,
    SPEC.folder,
    decryptor(userKey),
    "文件夹",
  );
  return result as unknown as FolderView;
}

/** 判断一个字符串是否已是密文形态，用于导入时识别数据状态。 */
export function looksEncrypted(value: string | undefined): value is EncryptedString {
  return value != null && EncString.isSerialized(value);
}
