import type { AutofillPageDetails } from "@/core/autofill/models";
import { api } from "@/platform/browser-api";
import { logger } from "@/platform/logger";
import type { AutofillCollectionResult } from "@/platform/messaging/types";

/**
 * 跨帧字段采集。
 *
 * 分两次注入：
 *   1. 注入采集脚本文件，它只在各帧挂一个全局函数
 *   2. 注入一个极小的函数去调用它，`executeScript` 会把**每个帧**的返回值都带回来
 *
 * 这样既避免了让几百行采集代码常驻每个页面，也不必为跨 iframe 聚合去搭消息通道。
 */

const COLLECTOR_FILE = "content/autofill-collector.js";

export interface CollectedFrame {
  frameId: number;
  details: AutofillPageDetails | null;
}

/** 当前标签页是否允许注入脚本。 */
export async function resolveFillableTab(): Promise<
  { id: number; url: string } | { error: string }
> {
  const [tab] = await api().tabs.query({ active: true, currentWindow: true });

  if (tab?.id == null) {
    return { error: "找不到当前标签页" };
  }

  // chrome:// 、扩展页面、应用商店等地址不允许注入脚本。
  if (tab.url == null || !/^https?:|^file:/i.test(tab.url)) {
    return { error: `当前页面（${tab.url ?? "未知地址"}）不允许注入脚本，请在普通网页上试。` };
  }

  return { id: tab.id, url: tab.url };
}

/** 在指定标签页的所有框架中采集字段。 */
export async function collectFrames(tabId: number): Promise<CollectedFrame[]> {
  await api().scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [COLLECTOR_FILE],
  });

  const results = await api().scripting.executeScript({
    target: { tabId, allFrames: true },
    // 该函数会被序列化后送进页面执行，因此不能引用外部作用域的任何东西。
    func: () => {
      const collect = (globalThis as { __vwoCollectPageDetails?: () => unknown })
        .__vwoCollectPageDetails;
      return typeof collect === "function" ? collect() : null;
    },
  });

  return results.map((entry) => ({
    frameId: entry.frameId,
    details: entry.result as AutofillPageDetails | null,
  }));
}

export async function collectActiveTabFields(): Promise<AutofillCollectionResult> {
  const tab = await resolveFillableTab();
  if ("error" in tab) {
    return { ok: false, message: tab.error, frames: [] };
  }

  try {
    return { ok: true, url: tab.url, frames: await collectFrames(tab.id) };
  } catch (e) {
    logger.error("采集页面字段失败:", e);
    return { ok: false, message: e instanceof Error ? e.message : String(e), frames: [] };
  }
}
