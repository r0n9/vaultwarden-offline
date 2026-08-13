import { CipherRepromptType, CipherType, FieldType } from "@/core/vault/enums";
import type { CipherView, FolderView } from "@/core/vault/models";

import { parseCsvRecords, serializeCsv } from "./csv";
import type { ParsedVault } from "./types";

/**
 * Bitwarden CSV 格式。
 *
 * 列：folder, favorite, type, name, notes, fields, reprompt,
 *     login_uri, login_username, login_password, login_totp
 *
 * CSV 是有损格式——它只表达 login/note/card/identity 四类，且丢失 id、时间戳、
 * 密码历史与 passkey。**迁移请一律用 JSON**，CSV 只用于与不支持 JSON 的工具交换。
 */

export const CSV_COLUMNS = [
  "folder",
  "favorite",
  "type",
  "name",
  "notes",
  "fields",
  "reprompt",
  "login_uri",
  "login_username",
  "login_password",
  "login_totp",
] as const;

const TYPE_TO_CSV: Partial<Record<CipherType, string>> = {
  [CipherType.Login]: "login",
  [CipherType.SecureNote]: "note",
  [CipherType.Card]: "card",
  [CipherType.Identity]: "identity",
};

const CSV_TO_TYPE: Record<string, CipherType> = {
  login: CipherType.Login,
  note: CipherType.SecureNote,
  card: CipherType.Card,
  identity: CipherType.Identity,
};

export function looksLikeBitwardenCsv(text: string): boolean {
  const firstLine = text.slice(0, 500).split(/\r?\n/)[0] ?? "";
  return firstLine.includes("name") && (firstLine.includes("login_password") || firstLine.includes("type"));
}

export function parseBitwardenCsv(text: string): ParsedVault {
  const records = parseCsvRecords(text);
  const now = new Date().toISOString();

  // CSV 用文件夹**名称**引用，需在此重建文件夹并分配 id。
  const foldersByName = new Map<string, FolderView>();

  const ciphers = records.map((record) => {
    const type = CSV_TO_TYPE[(record["type"] ?? "login").trim().toLowerCase()] ?? CipherType.Login;

    const cipher: CipherView = {
      id: crypto.randomUUID(),
      type,
      name: record["name"] ?? "未命名条目",
      favorite: record["favorite"] === "1" || record["favorite"]?.toLowerCase() === "true",
      reprompt: record["reprompt"] === "1" ? CipherRepromptType.Password : CipherRepromptType.None,
      creationDate: now,
      revisionDate: now,
    };

    const notes = record["notes"];
    if (notes != null && notes !== "") {
      cipher.notes = notes;
    }

    const folderName = record["folder"]?.trim();
    if (folderName != null && folderName !== "") {
      let folder = foldersByName.get(folderName);
      if (folder == null) {
        folder = { id: crypto.randomUUID(), name: folderName, revisionDate: now };
        foldersByName.set(folderName, folder);
      }
      cipher.folderId = folder.id;
    }

    const fields = parseFields(record["fields"]);
    if (fields.length > 0) {
      cipher.fields = fields;
    }

    if (type === CipherType.Login) {
      const login: NonNullable<CipherView["login"]> = {};

      const username = record["login_username"];
      if (username != null && username !== "") {
        login.username = username;
      }
      const password = record["login_password"];
      if (password != null && password !== "") {
        login.password = password;
      }
      const totp = record["login_totp"];
      if (totp != null && totp !== "") {
        login.totp = totp;
      }

      const uris = (record["login_uri"] ?? "")
        .split(",")
        .map((uri) => uri.trim())
        .filter((uri) => uri !== "")
        .map((uri) => ({ uri }));
      if (uris.length > 0) {
        login.uris = uris;
      }

      cipher.login = login;
    } else if (type === CipherType.SecureNote) {
      cipher.secureNote = { type: 0 };
    }

    return cipher;
  });

  return { ciphers, folders: [...foldersByName.values()], degradedCollections: 0 };
}

/** 自定义字段在 CSV 里编码成每行一个 `名称: 值`。 */
function parseFields(raw: string | undefined): NonNullable<CipherView["fields"]> {
  if (raw == null || raw.trim() === "") {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const separator = line.indexOf(":");
      const field: NonNullable<CipherView["fields"]>[number] = { type: FieldType.Text };
      if (separator === -1) {
        field.name = line;
      } else {
        field.name = line.slice(0, separator).trim();
        field.value = line.slice(separator + 1).trim();
      }
      return field;
    });
}

export function serializeBitwardenCsv(vault: ParsedVault): string {
  const folderNames = new Map(vault.folders.map((folder) => [folder.id, folder.name]));

  const rows = vault.ciphers
    // CSV 无法表达其余类型，导出时跳过并由调用方提示用户。
    .filter((cipher) => TYPE_TO_CSV[cipher.type] != null)
    .map((cipher) => ({
      folder: cipher.folderId == null ? "" : (folderNames.get(cipher.folderId) ?? ""),
      favorite: cipher.favorite ? "1" : "",
      type: TYPE_TO_CSV[cipher.type] ?? "login",
      name: cipher.name,
      notes: cipher.notes ?? "",
      fields: (cipher.fields ?? [])
        .map((field) => `${field.name ?? ""}: ${field.value ?? ""}`)
        .join("\n"),
      reprompt: cipher.reprompt === CipherRepromptType.Password ? "1" : "0",
      login_uri: (cipher.login?.uris ?? []).map((entry) => entry.uri ?? "").join(","),
      login_username: cipher.login?.username ?? "",
      login_password: cipher.login?.password ?? "",
      login_totp: cipher.login?.totp ?? "",
    }));

  return serializeCsv(CSV_COLUMNS, rows);
}

/** CSV 导出会丢弃的条目数（非 login/note/card/identity 类型）。 */
export function countCsvUnsupported(vault: ParsedVault): number {
  return vault.ciphers.filter((cipher) => TYPE_TO_CSV[cipher.type] == null).length;
}
