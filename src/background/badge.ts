import type { VaultStorage } from "@/core/state/storage.port";
import { VaultStatus } from "@/core/state/vault-status";
import { getStatus } from "@/core/vault/vault.service";
import { api } from "@/platform/browser-api";

import { findMatchingLoginCiphers } from "./context-menu";
import { fetchFavicon } from "./favicon";

/**
 * 工具栏角标：当前站点匹配的登录条目数。
 *
 * 参考 Bitwarden 的 AutofillBadgeUpdaterService：
 *   - 解锁态：匹配数 > 0 时显示数字，> 9 显示 "9+"，0 或不可注入页面时清空
 *   - 锁定/未初始化：不显示（锁定态由图标本身表达，角标保持空白）
 */

const BADGE_COLOR = "#1d4ed8";

export async function updateMatchBadge(storage: VaultStorage): Promise<void> {
  try {
    const status = await getStatus(storage);

    if (status !== VaultStatus.Unlocked) {
      await api().action.setBadgeText({ text: "" });
      return;
    }

    const [tab] = await api().tabs.query({ active: true, currentWindow: true });

    if (tab?.url == null || !/^https?:/i.test(tab.url)) {
      await api().action.setBadgeText({ text: "" });
      return;
    }

    const matches = await findMatchingLoginCiphers(storage, tab.url);
    const count = matches.length;

    // 站点有匹配条目时顺带静默获取并更新 favicon 缓存（不阻塞角标）。
    if (count > 0) {
      void fetchFavicon(tab.url, tab.id);
    }

    if (count === 0) {
      await api().action.setBadgeText({ text: "" });
      return;
    }

    const text = count > 9 ? "9+" : String(count);
    await api().action.setBadgeText({ text });
    await api().action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch (e) {
    // 角标是纯装饰功能，任何失败都不该影响扩展主体。
  }
}

/** 活动标签页变化或页面加载完成时更新角标。 */
export function registerBadgeTriggers(storage: VaultStorage): void {
  api().tabs.onActivated.addListener(() => void updateMatchBadge(storage));
  api().tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
      void updateMatchBadge(storage);
    }
  });
}
