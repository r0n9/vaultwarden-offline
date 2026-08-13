import {
  EncString,
  KdfType,
  type KdfConfig,
  decryptToString,
  deriveVaultExportKey,
  validateKdfConfig,
} from "@/core/crypto";
import { CipherRepromptType, CipherType, isCipherType } from "@/core/vault/enums";
import type { CipherView, FolderView } from "@/core/vault/models";

import { ImportError, ImportPasswordError, type ParsedVault } from "./types";

/**
 * Bitwarden / Vaultwarden JSON 导出文件的解析。
 *
 * 该格式共有三种形态：
 *
 *   1. 明文        `{ encrypted: false, folders, items }`
 *   2. 密码保护    `{ encrypted: true, passwordProtected: true, salt, kdfType, …, data }`
 *                  data 是一个 EncString，解开后就是形态 1 的 JSON
 *   3. 账户密钥加密 `{ encrypted: true, encKeyValidation_DO_NOT_EDIT, folders, items }`
 *                  用导出者账户的 UserKey 加密，**只有那个账户能解**，我们无能为力
 *
 * 输入来自用户提供的文件，一律按不可信数据处理：字段可能缺失、类型可能不对、
 * KDF 参数可能被恶意调低。
 */

interface RawExport {
  encrypted?: unknown;
  passwordProtected?: unknown;
  salt?: unknown;
  kdfType?: unknown;
  kdfIterations?: unknown;
  kdfMemory?: unknown;
  kdfParallelism?: unknown;
  encKeyValidation_DO_NOT_EDIT?: unknown;
  data?: unknown;
  items?: unknown;
  folders?: unknown;
  collections?: unknown;
}

export function looksLikeBitwardenJson(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const raw = JSON.parse(text) as RawExport;
    return "items" in raw || ("data" in raw && "encrypted" in raw);
  } catch {
    return false;
  }
}

export function isPasswordProtected(text: string): boolean {
  try {
    const raw = JSON.parse(text) as RawExport;
    return raw.encrypted === true && raw.passwordProtected === true;
  } catch {
    return false;
  }
}

/**
 * 解析导出文件。密码保护的文件需传入 `password`。
 */
export async function parseBitwardenJson(text: string, password?: string): Promise<ParsedVault> {
  let raw: RawExport;
  try {
    raw = JSON.parse(text) as RawExport;
  } catch {
    throw new ImportError("文件不是合法的 JSON");
  }

  if (raw.encrypted === true && raw.passwordProtected === true) {
    if (password == null || password === "") {
      throw new ImportError("该文件受口令保护，请提供导出时设置的口令");
    }
    return parsePlainExport(await decryptPasswordProtected(raw, password));
  }

  if (raw.encrypted === true) {
    throw new ImportError(
      "这是「账户密钥加密」的导出文件，只有产出它的那个 Bitwarden 账户才能解密。" +
        "请在网页端重新导出，格式选择「密码保护」或未加密的 JSON。",
    );
  }

  return parsePlainExport(raw);
}

async function decryptPasswordProtected(raw: RawExport, password: string): Promise<RawExport> {
  const salt = asString(raw.salt);
  const data = asString(raw.data);
  const validation = asString(raw.encKeyValidation_DO_NOT_EDIT);

  if (salt == null || data == null) {
    throw new ImportError("密码保护的导出文件缺少 salt 或 data 字段");
  }

  const kdf = kdfFromExport(raw);
  try {
    validateKdfConfig(kdf);
  } catch (e) {
    throw new ImportError(`导出文件的 KDF 参数不可接受：${(e as Error).message}`);
  }

  // salt 在文件里是 base64 字符串，但 Bitwarden 是把这个**字符串本身**按 UTF-8
  // 喂给 KDF 的，而不是先 base64 解码。此处必须照做，否则派生出的密钥完全不同。
  const key = await deriveVaultExportKey(password, salt, kdf);

  // 先用校验字段判断口令对不对，这样能把"口令错"与"文件损坏"区分开。
  if (validation != null) {
    try {
      await decryptToString(EncString.parse(validation), key);
    } catch {
      throw new ImportPasswordError();
    }
  }

  let json: string;
  try {
    json = await decryptToString(EncString.parse(data), key);
  } catch {
    throw new ImportPasswordError();
  }

  try {
    return JSON.parse(json) as RawExport;
  } catch {
    throw new ImportError("解密成功但内容不是合法 JSON，文件可能已损坏");
  }
}

function kdfFromExport(raw: RawExport): KdfConfig {
  const iterations = asNumber(raw.kdfIterations);
  if (iterations == null) {
    throw new ImportError("密码保护的导出文件缺少 kdfIterations");
  }

  if (asNumber(raw.kdfType) === KdfType.Argon2id) {
    const memory = asNumber(raw.kdfMemory);
    const parallelism = asNumber(raw.kdfParallelism);
    if (memory == null || parallelism == null) {
      throw new ImportError("Argon2id 导出文件缺少 kdfMemory 或 kdfParallelism");
    }
    return { type: KdfType.Argon2id, iterations, memory, parallelism };
  }

  return { type: KdfType.PBKDF2_SHA256, iterations };
}

// --- 明文形态 -------------------------------------------------------------

function parsePlainExport(raw: RawExport): ParsedVault {
  const folders = asArray(raw.folders).map(normalizeFolder);

  // 组织导出里没有 folders 只有 collections。我们不实现组织概念，
  // 把集合降级为文件夹——结构保住了，数据一条不丢。
  const collections = asArray(raw.collections).map(normalizeFolder);
  const allFolders = [...folders, ...collections];

  const knownFolderIds = new Set(allFolders.map((f) => f.id));
  const ciphers = asArray(raw.items).map((item) => normalizeCipher(item, knownFolderIds));

  return { ciphers, folders: allFolders, degradedCollections: collections.length };
}

function normalizeFolder(raw: unknown): FolderView {
  const source = asRecord(raw);
  return {
    id: asString(source["id"]) ?? crypto.randomUUID(),
    name: asString(source["name"]) ?? "未命名文件夹",
    revisionDate: asString(source["revisionDate"]) ?? new Date().toISOString(),
  };
}

function normalizeCipher(raw: unknown, knownFolderIds: ReadonlySet<string>): CipherView {
  const source = asRecord(raw);
  const now = new Date().toISOString();

  const type = isCipherType(asNumber(source["type"])) ? (asNumber(source["type"]) as CipherType) : CipherType.Login;

  // 组织条目：本地没有集合概念，把首个集合当作文件夹，保留归属关系。
  const collectionIds = asStringArray(source["collectionIds"]);
  const rawFolderId = asString(source["folderId"]);
  const folderId =
    rawFolderId ?? collectionIds.find((id) => knownFolderIds.has(id)) ?? undefined;

  const cipher: CipherView = {
    id: asString(source["id"]) ?? crypto.randomUUID(),
    type,
    name: asString(source["name"]) ?? "未命名条目",
    favorite: source["favorite"] === true,
    reprompt: asNumber(source["reprompt"]) === 1 ? CipherRepromptType.Password : CipherRepromptType.None,
    creationDate: asString(source["creationDate"]) ?? now,
    revisionDate: asString(source["revisionDate"]) ?? now,
  };

  assignIfPresent(cipher, "notes", asString(source["notes"]));
  assignIfPresent(cipher, "folderId", folderId);
  assignIfPresent(cipher, "organizationId", asString(source["organizationId"]));
  assignIfPresent(cipher, "deletedDate", asString(source["deletedDate"]));
  assignIfPresent(cipher, "archivedDate", asString(source["archivedDate"]));
  if (collectionIds.length > 0) {
    cipher.collectionIds = collectionIds;
  }

  const fields = asArray(source["fields"]).map(normalizeField);
  if (fields.length > 0) {
    cipher.fields = fields;
  }

  const history = asArray(source["passwordHistory"]).map((entry) => {
    const record = asRecord(entry);
    return {
      password: asString(record["password"]) ?? "",
      lastUsedDate: asString(record["lastUsedDate"]) ?? now,
    };
  });
  if (history.length > 0) {
    cipher.passwordHistory = history;
  }

  attachTypePayload(cipher, type, source);

  return cipher;
}

function attachTypePayload(
  cipher: CipherView,
  type: CipherType,
  source: Record<string, unknown>,
): void {
  switch (type) {
    case CipherType.Login: {
      const login = asRecord(source["login"]);
      const result: NonNullable<CipherView["login"]> = {};

      assignIfPresent(result, "username", asString(login["username"]));
      assignIfPresent(result, "password", asString(login["password"]));
      assignIfPresent(result, "totp", asString(login["totp"]));
      assignIfPresent(result, "passwordRevisionDate", asString(login["passwordRevisionDate"]));

      const uris = asArray(login["uris"])
        .map((entry) => {
          const record = asRecord(entry);
          const uri = asString(record["uri"]);
          if (uri == null) {
            return undefined;
          }
          const match = asNumber(record["match"]);
          // Vaultwarden 对未设置的 match 输出 null，此时留空即可（使用全局默认策略）。
          return match == null ? { uri } : { uri, match: match as never };
        })
        .filter((entry) => entry != null);
      if (uris.length > 0) {
        result.uris = uris;
      }

      const credentials = asArray(login["fido2Credentials"]).map((entry) => {
        const record = asRecord(entry);
        return {
          credentialId: asString(record["credentialId"]) ?? "",
          keyType: asString(record["keyType"]) ?? "",
          keyAlgorithm: asString(record["keyAlgorithm"]) ?? "",
          keyCurve: asString(record["keyCurve"]) ?? "",
          keyValue: asString(record["keyValue"]) ?? "",
          rpId: asString(record["rpId"]) ?? "",
          counter: asString(record["counter"]) ?? "0",
          discoverable: asString(record["discoverable"]) ?? "false",
          creationDate: asString(record["creationDate"]) ?? new Date().toISOString(),
          ...optional("userHandle", asString(record["userHandle"])),
          ...optional("userName", asString(record["userName"])),
          ...optional("rpName", asString(record["rpName"])),
          ...optional("userDisplayName", asString(record["userDisplayName"])),
        };
      });
      if (credentials.length > 0) {
        result.fido2Credentials = credentials;
      }

      cipher.login = result;
      return;
    }

    case CipherType.SecureNote:
      cipher.secureNote = { type: 0 };
      return;

    case CipherType.Card:
      cipher.card = pickStrings(source["card"], [
        "cardholderName",
        "brand",
        "number",
        "expMonth",
        "expYear",
        "code",
      ]);
      return;

    case CipherType.Identity:
      cipher.identity = pickStrings(source["identity"], [
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
      ]);
      return;

    case CipherType.SshKey:
      cipher.sshKey = pickStrings(source["sshKey"], ["privateKey", "publicKey", "keyFingerprint"]);
      return;

    case CipherType.BankAccount:
      cipher.bankAccount = pickStrings(source["bankAccount"], [
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
      ]);
      return;

    case CipherType.DriversLicense:
      cipher.driversLicense = pickStrings(source["driversLicense"], [
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
      ]);
      return;

    case CipherType.Passport:
      cipher.passport = pickStrings(source["passport"], [
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
      ]);
      return;
  }
}

function normalizeField(raw: unknown): NonNullable<CipherView["fields"]>[number] {
  const record = asRecord(raw);
  const type = asNumber(record["type"]) ?? 0;

  const field: NonNullable<CipherView["fields"]>[number] = {
    type: (type >= 0 && type <= 3 ? type : 0) as never,
  };
  assignIfPresent(field, "name", asString(record["name"]));
  assignIfPresent(field, "value", asString(record["value"]));

  const linkedId = asNumber(record["linkedId"]);
  if (linkedId != null) {
    field.linkedId = linkedId;
  }

  return field;
}

// --- 取值助手 -------------------------------------------------------------
//
// Vaultwarden 对缺失的可选字段输出 `null` 而非省略键。内部统一用 `undefined`
// 表示"没有"，因此这里把 null 一律归一化掉——否则 `null` 会流进加密层，
// 在导出时又变成一堆无意义的 null 字段。

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

function assignIfPresent<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function optional<K extends string>(key: K, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function pickStrings<K extends string>(
  source: unknown,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const record = asRecord(source);
  const result: Partial<Record<K, string>> = {};

  for (const key of keys) {
    const value = asString(record[key]);
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}
