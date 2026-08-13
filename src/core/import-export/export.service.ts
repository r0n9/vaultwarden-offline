import {
  defaultKdfConfig,
  deriveVaultExportKey,
  encryptString,
  randomBytes,
  toBase64,
} from "@/core/crypto";
import type { VaultStorage } from "@/core/state/storage.port";
import { decryptCipher, decryptFolder } from "@/core/vault/cipher-encryption";
import { readVaultData, requireUserKey } from "@/core/vault/vault.service";

import { countCsvUnsupported, serializeBitwardenCsv } from "./bitwarden-csv";
import { ExportFormat, type ParsedVault } from "./types";

/**
 * 导出。
 *
 * 产出的文件与 Bitwarden 官方格式逐字段一致，可直接导回 Vaultwarden——
 * 这是本项目「数据不被锁死」承诺的兑现处。
 */

export interface ExportResult {
  fileName: string;
  content: string;
  mimeType: string;
  cipherCount: number;
  /** CSV 无法表达而被丢弃的条目数。 */
  droppedCount: number;
}

/** 把整库解密成明文视图。导出与预览都基于它。 */
export async function readDecryptedVault(storage: VaultStorage): Promise<ParsedVault> {
  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);

  const [ciphers, folders] = await Promise.all([
    Promise.all(data.ciphers.map((cipher) => decryptCipher(cipher, userKey))),
    Promise.all(data.folders.map((folder) => decryptFolder(folder, userKey))),
  ]);

  return { ciphers, folders, degradedCollections: 0 };
}

export async function buildExport(
  storage: VaultStorage,
  format: ExportFormat,
  password?: string,
): Promise<ExportResult> {
  const vault = await readDecryptedVault(storage);
  const stamp = timestamp();

  if (format === ExportFormat.Csv) {
    return {
      fileName: `vaultwarden_offline_export_${stamp}.csv`,
      content: serializeBitwardenCsv(vault),
      mimeType: "text/csv",
      cipherCount: vault.ciphers.length,
      droppedCount: countCsvUnsupported(vault),
    };
  }

  const plain = buildPlainJson(vault);

  if (format === ExportFormat.Json) {
    return {
      fileName: `vaultwarden_offline_export_${stamp}.json`,
      content: JSON.stringify(plain, null, 2),
      mimeType: "application/json",
      cipherCount: vault.ciphers.length,
      droppedCount: 0,
    };
  }

  if (password == null || password === "") {
    throw new Error("加密导出需要设置文件口令");
  }

  return {
    fileName: `vaultwarden_offline_export_${stamp}.json`,
    content: JSON.stringify(await buildPasswordProtected(plain, password), null, 2),
    mimeType: "application/json",
    cipherCount: vault.ciphers.length,
    droppedCount: 0,
  };
}

interface PlainJsonExport {
  encrypted: false;
  folders: unknown[];
  items: unknown[];
}

function buildPlainJson(vault: ParsedVault): PlainJsonExport {
  return {
    encrypted: false,
    folders: vault.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
    })),
    items: vault.ciphers.map((cipher) => {
      // 显式列字段而非直接展开，保证输出键序稳定、且不会把内部字段泄漏进文件。
      const item: Record<string, unknown> = {
        id: cipher.id,
        organizationId: cipher.organizationId ?? null,
        folderId: cipher.folderId ?? null,
        type: cipher.type,
        reprompt: cipher.reprompt,
        name: cipher.name,
        notes: cipher.notes ?? null,
        favorite: cipher.favorite,
      };

      if (cipher.fields != null) {
        item["fields"] = cipher.fields;
      }
      if (cipher.login != null) {
        item["login"] = cipher.login;
      }
      if (cipher.secureNote != null) {
        item["secureNote"] = cipher.secureNote;
      }
      if (cipher.card != null) {
        item["card"] = cipher.card;
      }
      if (cipher.identity != null) {
        item["identity"] = cipher.identity;
      }
      if (cipher.sshKey != null) {
        item["sshKey"] = cipher.sshKey;
      }
      if (cipher.bankAccount != null) {
        item["bankAccount"] = cipher.bankAccount;
      }
      if (cipher.driversLicense != null) {
        item["driversLicense"] = cipher.driversLicense;
      }
      if (cipher.passport != null) {
        item["passport"] = cipher.passport;
      }
      if (cipher.passwordHistory != null) {
        item["passwordHistory"] = cipher.passwordHistory;
      }
      if (cipher.collectionIds != null) {
        item["collectionIds"] = cipher.collectionIds;
      }
      if (cipher.deletedDate != null) {
        item["deletedDate"] = cipher.deletedDate;
      }
      if (cipher.archivedDate != null) {
        item["archivedDate"] = cipher.archivedDate;
      }

      item["creationDate"] = cipher.creationDate;
      item["revisionDate"] = cipher.revisionDate;

      return item;
    }),
  };
}

interface PasswordProtectedExport {
  encrypted: true;
  passwordProtected: true;
  salt: string;
  kdfType: number;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
  encKeyValidation_DO_NOT_EDIT: string;
  data: string;
}

async function buildPasswordProtected(
  plain: PlainJsonExport,
  password: string,
): Promise<PasswordProtectedExport> {
  // salt 以 base64 字符串形式写进文件，而 KDF 吃的是这个**字符串本身**的 UTF-8
  // 字节（不是解码后的 16 字节）。这是 Bitwarden 的既定行为，必须照做才能互通。
  const salt = toBase64(randomBytes(16));
  const kdf = defaultKdfConfig();
  const key = await deriveVaultExportKey(password, salt, kdf);

  // 校验字段：加密一个随机 UUID。导入方解得开它即说明口令正确，
  // 从而能把「口令错」与「文件损坏」区分开。
  const validation = await encryptString(crypto.randomUUID(), key);
  const data = await encryptString(JSON.stringify(plain), key);

  return {
    encrypted: true,
    passwordProtected: true,
    salt,
    kdfType: kdf.type,
    kdfIterations: kdf.iterations,
    encKeyValidation_DO_NOT_EDIT: validation.toString(),
    data: data.toString(),
  };
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}
