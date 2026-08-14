import { extractHostname } from "@/core/vault/uri-matching";
import { storage, tabs } from "@/platform/browser-api";
import { logger } from "@/platform/logger";

/**
 * 站点 favicon 获取与缓存。
 *
 * ⚠️ 这是本项目零网络承诺的**唯一例外**（用户已明确豁免）：
 *   1. 站点优先：借助当前标签页 content script 做**同源** fetch（同源无需 CORS），
 *      拿到站点真实的 favicon
 *   2. 失败回退：Google s2 favicon 服务（带 CORS，几乎 100% 可用；
 *      代价是域名会发送给 Google）
 *
 * 获取时机：新增条目时、站点匹配出现时（静默获取，不阻塞任何交互）。
 * 缓存：storage.local，键 `vwo:favicons:{domain}`，随每次获取更新。
 */

export const FAVICON_CACHE_PREFIX = "vwo:favicons:";

interface FaviconCacheEntry {
  dataUrl: string;
  updatedAt: number;
}

export async function getCachedFavicon(domain: string): Promise<string | undefined> {
  const entry = await storage.local.get<FaviconCacheEntry>(`${FAVICON_CACHE_PREFIX}${domain}`);
  return entry?.dataUrl;
}

/**
 * 静默获取站点 favicon 并更新缓存。
 *
 * @param url  站点地址
 * @param tabId 当前标签页（可空）：存在时优先让 content script 同源获取
 * @returns 是否成功取得
 */
export async function fetchFavicon(url: string, tabId?: number): Promise<boolean> {
  const domain = extractHostname(url);
  if (domain == null) {
    return false;
  }

  let dataUrl: string | undefined;

  // 1. 站点优先：content script 同源 fetch（当前标签页就是这个站点时无需 CORS）。
  if (tabId != null) {
    try {
      const result = await tabs.sendMessage<{ dataUrl?: string }>(tabId, {
        command: "favicon:fetch",
        payload: { origin: originOf(url) },
      });
      if (result?.dataUrl != null && result.dataUrl !== "") {
        dataUrl = result.dataUrl;
      }
    } catch (e) {
      logger.debug("favicon 同源获取失败，回退 Google:", e);
    }
  }

  // 2. 回退：Google s2 服务。
  if (dataUrl == null) {
    try {
      const response = await fetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`);
      if (response.ok) {
        const blob = await response.blob();
        dataUrl = await blobToDataUrl(blob);
      }
    } catch (e) {
      logger.debug("favicon Google 回退失败:", e);
    }
  }

  if (dataUrl != null) {
    const entry: FaviconCacheEntry = { dataUrl, updatedAt: Date.now() };
    await storage.local.set(`${FAVICON_CACHE_PREFIX}${domain}`, entry);
    return true;
  }

  return false;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图标失败"));
    reader.readAsDataURL(blob);
  });
}
