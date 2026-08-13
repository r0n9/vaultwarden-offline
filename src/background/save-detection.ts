import type { VaultStorage } from "@/core/state/storage.port";
import { VaultStatus } from "@/core/state/vault-status";
import { decryptCipher } from "@/core/vault/cipher-encryption";
import { CipherType } from "@/core/vault/enums";
import type { CipherView } from "@/core/vault/models";
import { cipherMatchesUrl } from "@/core/vault/uri-matching";
import { getCipher, saveCipher } from "@/core/vault/vault-repository";
import { getStatus, readVaultData, requireUserKey } from "@/core/vault/vault.service";
import type { SaveDetectionResult, SaveCommitRequest, SaveCommitResult } from "@/platform/messaging/types";

/**
 * 保存/更新凭据。
 *
 * 页面侧只报告「在这个 URL 上填了用户名 + 密码」，这里是唯一的决策点：
 *   同站点且用户名相同 → 更新现有条目
 *   否则                 → 保存为新条目
 *
 * 密码只在「页面 → 背景页」一跳出现，落库即加密；提示条本身**绝不含密码**。
 */

/** 判定是否命中已有的同站点同用户名条目。 */
export function determineSaveAction(
  ciphers: CipherView[],
  url: string,
  username: string,
): { action: "save" | "update"; cipherId?: string } {
  const match = ciphers.find(
    (cipher) =>
      cipher.type === CipherType.Login &&
      cipher.deletedDate == null &&
      cipher.login?.username === username &&
      cipherMatchesUrl(cipher, url),
  );

  return match == null ? { action: "save" } : { action: "update", cipherId: match.id };
}

export async function handleSaveDetected(
  storage: VaultStorage,
  url: string,
  username: string,
): Promise<SaveDetectionResult> {
  if ((await getStatus(storage)) !== VaultStatus.Unlocked) {
    // 密码库没解锁时不打扰用户——提示条出现在页面上却没有地方可存，只会添乱。
    return { action: "none" };
  }

  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);
  const ciphers = await Promise.all(data.ciphers.map((cipher) => decryptCipher(cipher, userKey)));

  const decision = determineSaveAction(ciphers, url, username);
  if (decision.action === "update") {
    return { action: "update", cipherId: decision.cipherId };
  }

  return { action: "save" };
}

export async function commitSave(
  storage: VaultStorage,
  request: SaveCommitRequest,
): Promise<SaveCommitResult> {
  try {
    await requireUserKey(storage);

    if (request.mode === "update" && request.cipherId != null) {
      const existing = await getCipher(storage, request.cipherId);
      if (existing != null) {
        await saveCipher(storage, {
          ...existing,
          login: { ...existing.login, password: request.password },
        });
        return { ok: true };
      }
      // 目标条目已被删除，退化为新建。
    }

    const hostname = safeHostname(request.url);
    const view: CipherView = {
      id: crypto.randomUUID(),
      type: CipherType.Login,
      name: hostname,
      favorite: false,
      reprompt: 0,
      login: {
        username: request.username,
        password: request.password,
        uris: [{ uri: request.url }],
      },
      creationDate: new Date().toISOString(),
      revisionDate: new Date().toISOString(),
    };

    await saveCipher(storage, view);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 条目名称用站点域名，去掉 www 前缀。 */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "未命名站点";
  }
}
