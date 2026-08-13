import { requireUserKey, readVaultData, writeVaultData } from "@/core/vault/vault.service";
import { decryptCipher, encryptCipher, encryptFolder } from "@/core/vault/cipher-encryption";
import type { VaultStorage } from "@/core/state/storage.port";
import type { CipherView, FolderView } from "@/core/vault/models";

import { looksLikeBitwardenCsv, parseBitwardenCsv } from "./bitwarden-csv";
import { isPasswordProtected, looksLikeBitwardenJson, parseBitwardenJson } from "./bitwarden-json";
import {
  ImportError,
  ImportFormat,
  type ImportProbe,
  MergeStrategy,
  type MergeResult,
  type ParsedVault,
} from "./types";

/**
 * 导入编排。
 *
 * 分两步：先 {@link probeImport} 探测格式（据此决定要不要向用户索取文件口令），
 * 再 {@link parseImport} 真正解析，最后 {@link mergeIntoVault} 落库。
 */

export function probeImport(text: string, fileName = ""): ImportProbe {
  if (looksLikeBitwardenJson(text)) {
    if (isPasswordProtected(text)) {
      return { format: ImportFormat.BitwardenJson, requiresPassword: true };
    }

    // 明文文件可以直接数出条目数，让用户在导入前就看到规模。
    try {
      const raw = JSON.parse(text) as { items?: unknown[]; folders?: unknown[]; collections?: unknown[] };
      return {
        format: ImportFormat.BitwardenJson,
        requiresPassword: false,
        cipherCount: Array.isArray(raw.items) ? raw.items.length : 0,
        folderCount:
          (Array.isArray(raw.folders) ? raw.folders.length : 0) +
          (Array.isArray(raw.collections) ? raw.collections.length : 0),
      };
    } catch {
      return { format: ImportFormat.BitwardenJson, requiresPassword: false };
    }
  }

  if (fileName.toLowerCase().endsWith(".csv") || looksLikeBitwardenCsv(text)) {
    return { format: ImportFormat.BitwardenCsv, requiresPassword: false };
  }

  throw new ImportError("无法识别的文件格式。支持 Bitwarden / Vaultwarden 的 JSON 与 CSV 导出。");
}

export async function parseImport(
  text: string,
  password?: string,
  fileName = "",
): Promise<ParsedVault> {
  const probe = probeImport(text, fileName);

  return probe.format === ImportFormat.BitwardenJson
    ? await parseBitwardenJson(text, password)
    : parseBitwardenCsv(text);
}

/**
 * 把解析结果合并进已解锁的密码库。
 *
 * 三种策略的取舍：
 *   skip-duplicates 先按 id、再按「类型+名称+用户名」判重，适合重复导入同一份文件
 *   overwrite       同 id 覆盖，适合从源端重新同步
 *   append-all      全部重新分配 id 加入，适合合并两份互不相干的库
 */
export async function mergeIntoVault(
  storage: VaultStorage,
  parsed: ParsedVault,
  strategy: MergeStrategy = MergeStrategy.SkipDuplicates,
): Promise<MergeResult> {
  const userKey = await requireUserKey(storage);
  const existing = await readVaultData(storage);

  const result: MergeResult = { added: 0, updated: 0, skipped: 0, foldersAdded: 0 };

  // --- 文件夹 ---
  const existingFolderIds = new Set(existing.folders.map((folder) => folder.id));
  // append-all 会重编 id，因此需要一张旧 id → 新 id 的映射来修正条目归属。
  const folderIdRemap = new Map<string, string>();

  for (const folder of parsed.folders) {
    const target: FolderView =
      strategy === MergeStrategy.AppendAll || existingFolderIds.has(folder.id)
        ? { ...folder, id: crypto.randomUUID() }
        : folder;

    if (target.id !== folder.id) {
      folderIdRemap.set(folder.id, target.id);
    }

    // 同 id 的文件夹在非 append 策略下视为已存在，不重复添加。
    if (strategy !== MergeStrategy.AppendAll && existingFolderIds.has(folder.id)) {
      continue;
    }

    existing.folders.push(await encryptFolder(target, userKey));
    existingFolderIds.add(target.id);
    result.foldersAdded += 1;
  }

  // --- 条目 ---
  const existingById = new Map(existing.ciphers.map((cipher, index) => [cipher.id, index]));

  // 仅在需要按内容判重时才解密现有条目——这一步在大库上不便宜。
  const existingSignatures =
    strategy === MergeStrategy.SkipDuplicates
      ? new Set(
          await Promise.all(
            existing.ciphers.map(async (cipher) =>
              signatureOf(await decryptCipher(cipher, userKey)),
            ),
          ),
        )
      : undefined;

  for (const incoming of parsed.ciphers) {
    const cipher: CipherView = { ...incoming };

    const remapped = cipher.folderId == null ? undefined : folderIdRemap.get(cipher.folderId);
    if (remapped != null) {
      cipher.folderId = remapped;
    }

    if (strategy === MergeStrategy.AppendAll) {
      cipher.id = crypto.randomUUID();
      existing.ciphers.push(await encryptCipher(cipher, userKey));
      result.added += 1;
      continue;
    }

    const existingIndex = existingById.get(cipher.id);

    if (existingIndex != null) {
      if (strategy === MergeStrategy.Overwrite) {
        existing.ciphers[existingIndex] = await encryptCipher(cipher, userKey);
        result.updated += 1;
      } else {
        result.skipped += 1;
      }
      continue;
    }

    if (existingSignatures?.has(signatureOf(cipher)) === true) {
      result.skipped += 1;
      continue;
    }

    existing.ciphers.push(await encryptCipher(cipher, userKey));
    existingById.set(cipher.id, existing.ciphers.length - 1);
    existingSignatures?.add(signatureOf(cipher));
    result.added += 1;
  }

  await writeVaultData(storage, existing);
  return result;
}

/**
 * 内容判重签名。
 *
 * 取「剔除 id 与时间戳之后的全部内容」，而不是「名称+用户名」这类摘要式的键。
 *
 * 摘要式签名曾在一份 615 条的真实库上丢掉 29 条：同一站点的登录页与密码重置页
 * 往往同名同用户名，只有 URI 和密码不同，却被判成了重复。
 *
 * 定这条规则的原则是——**在密码管理器里，误增一条远好过误删一条**。宁可让用户
 * 看到几条重复自己删，也不能悄悄吞掉数据。id 相同的情形另有精确匹配兜底，
 * 内容判重只是给 CSV 这类没有 id 的来源做的补充。
 */
function signatureOf(cipher: CipherView): string {
  const { id: _id, creationDate: _creation, revisionDate: _revision, ...content } = cipher;
  return stableStringify(content);
}

/** 规范化序列化：键的先后顺序不应让同一内容算成两条。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
