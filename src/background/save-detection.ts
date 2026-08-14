import type { VaultStorage } from "@/core/state/storage.port";
import { VaultStatus } from "@/core/state/vault-status";
import { decryptCipher } from "@/core/vault/cipher-encryption";
import { CipherType } from "@/core/vault/enums";
import type { CipherView } from "@/core/vault/models";
import { cipherMatchesUrl, hostWithPort } from "@/core/vault/uri-matching";
import { getCipher, saveCipher } from "@/core/vault/vault-repository";
import { getStatus, readVaultData, requireUserKey } from "@/core/vault/vault.service";
import { api } from "@/platform/browser-api";
import type { SaveDetectionResult, SaveCommitRequest, SaveCommitResult } from "@/platform/messaging/types";

/**
 * 保存/更新凭据。
 *
 * 触发模型对齐 Bitwarden（overlay-notifications）：页面侧只**上报**「在这个 URL 上填了
 * 用户名 + 密码」，判定推迟到「导航完成」或「SPA 兜底定时器」触发（见
 * registerSaveTriggers / reportSaveAttempt）。这里是唯一的决策点：
 *   同站点、同用户名（大小写不敏感）且密码已变 → 更新现有条目
 *   同站点、同用户名且密码未变            → 不提示（没有可保存的变化）
 *   否则                                    → 保存为新条目
 *
 * 密码只在「页面 → 背景页」一跳出现，落库即加密；提示条本身**绝不含密码**。
 */

/**
 * 判定动作。
 *
 * - 用户名按 Bitwarden 同款规则做 toLowerCase 归一化（Octocat 与 octocat 视为同一账号）
 * - 同账号但密码相同：没有变化可保存，返回 none 不打扰（对齐 Bitwarden 的
 *   triggerAddLoginNotification / triggerChangedPasswordNotification 组合行为）
 */
export function determineSaveAction(
  ciphers: CipherView[],
  url: string,
  username: string,
  password: string,
): { action: "save" | "update" | "none"; cipherId?: string } {
  const normalizedUsername = username.toLowerCase();
  const match = ciphers.find(
    (cipher) =>
      cipher.type === CipherType.Login &&
      cipher.deletedDate == null &&
      cipher.login?.username != null &&
      cipher.login.username.toLowerCase() === normalizedUsername &&
      cipherMatchesUrl(cipher, url),
  );

  if (match == null) {
    return { action: "save" };
  }
  if (match.login?.password === password) {
    return { action: "none" };
  }
  return { action: "update", cipherId: match.id };
}

export async function handleSaveDetected(
  storage: VaultStorage,
  url: string,
  username: string,
  password: string,
): Promise<SaveDetectionResult> {
  if ((await getStatus(storage)) !== VaultStatus.Unlocked) {
    // 密码库没解锁时不打扰用户——提示条出现在页面上却没有地方可存，只会添乱。
    return { action: "none" };
  }

  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);
  const ciphers = await Promise.all(data.ciphers.map((cipher) => decryptCipher(cipher, userKey)));

  return determineSaveAction(ciphers, url, username, password);
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

/** 条目名称用站点主机名（含端口，如 192.168.2.4:3000），去掉 www 前缀。 */
function safeHostname(url: string): string {
  try {
    return hostWithPort(url)?.replace(/^www\./, "") ?? "未命名站点";
  } catch {
    return "未命名站点";
  }
}

// --- 触发机制（对齐 Bitwarden overlay-notifications） -------------------------
//
// content script 只**上报**表单凭据，判定由两件事触发，先到先得（谁先取到
// 暂存数据谁执行，另一个变 no-op）：
//   1. 页面导航完成（tabs.onUpdated complete）——提交后跳转的新页面
//   2. SPA 兜底定时器（1.5s）——提交/填写后没有导航的页面
// 判定结果通过 save:decided 推送给 content 显示提示条。
//
// 暂存放在 background 内存（tab 级）：MV3 下 SW 休眠会丢数据，
// 但「上报 → 导航/判定」通常发生在几秒内，与 Bitwarden 同款取舍。

interface PendingSave {
  url: string;
  username: string;
  password: string;
  at: number;
}

/** 每 tab 一份待判定凭据。 */
const pendingSaves = new Map<number, PendingSave>();
/** SPA 兜底定时器（每 tab 一个）。 */
const fallbackTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** content script 上报表单凭据（不判定）。 */
export function reportSaveAttempt(
  storage: VaultStorage,
  tabId: number,
  data: { url: string; username: string; password: string },
): void {
  pendingSaves.set(tabId, { ...data, at: Date.now() });

  // 1.5s 兜底：SPA 提交不产生导航时也能判定（Bitwarden 同款 1500ms）。
  const previous = fallbackTimers.get(tabId);
  if (previous != null) {
    clearTimeout(previous);
  }
  fallbackTimers.set(
    tabId,
    setTimeout(() => void processPendingSave(storage, tabId), 1_500),
  );
}

/** 页面导航完成时调用——提交后跳转的新页面在这里判定并推送提示条。 */
export function registerSaveTriggers(storage: VaultStorage): void {
  api().tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
      void processPendingSave(storage, tabId);
    }
  });
}

async function processPendingSave(storage: VaultStorage, tabId: number): Promise<void> {
  const pending = pendingSaves.get(tabId);
  if (pending == null) {
    return;
  }
  pendingSaves.delete(tabId);
  const timer = fallbackTimers.get(tabId);
  if (timer != null) {
    clearTimeout(timer);
    fallbackTimers.delete(tabId);
  }

  const decision = await handleSaveDetected(
    storage,
    pending.url,
    pending.username,
    pending.password,
  );
  if (decision.action === "none") {
    return;
  }

  // 推送给 content 显示提示条。页面可能已在导航中被销毁（sendMessage 封装已吞掉该错误）。
  await api().tabs.sendMessage(tabId, {
    command: "save:decided",
    payload: {
      action: decision.action,
      cipherId: decision.cipherId,
      url: pending.url,
      username: pending.username,
      password: pending.password,
    },
  });
}
