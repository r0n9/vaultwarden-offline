import { buildLoginFillScript } from "@/core/autofill/fill-script";
import type { AutofillPageDetails } from "@/core/autofill/models";
import type { VaultStorage } from "@/core/state/storage.port";
import { cipherMatchesUrl } from "@/core/vault/uri-matching";
import { getCipher } from "@/core/vault/vault-repository";
import { api } from "@/platform/browser-api";
import { logger } from "@/platform/logger";
import type { AutofillFillResult } from "@/platform/messaging/types";

import { collectFrames, resolveFillableTab } from "./autofill-collection";

/**
 * 把某个条目填进当前页面。
 *
 * 明文密码只在**背景页 → 页面**这一跳里出现，不经过 popup —— popup 只传条目 id。
 * 这不是洁癖：少一段传输就少一处可能被日志、崩溃转储或调试工具捕获的地方。
 */

const FILLER_FILE = "content/autofill-filler.js";

export async function fillActiveTab(
  storage: VaultStorage,
  cipherId: string,
): Promise<AutofillFillResult> {
  const tab = await resolveFillableTab();
  if ("error" in tab) {
    return { ok: false, message: tab.error, filled: 0 };
  }

  const cipher = await getCipher(storage, cipherId);
  if (cipher == null) {
    return { ok: false, message: "条目不存在", filled: 0 };
  }

  const credentials = {
    username: cipher.login?.username,
    password: cipher.login?.password,
  };

  if ((credentials.username ?? "") === "" && (credentials.password ?? "") === "") {
    return { ok: false, message: "该条目没有可填充的用户名或密码", filled: 0 };
  }

  // 条目与当前站点不匹配时照填不误——是用户主动选的这一条——但要如实告知，
  // "把某站密码填进另一个站"正是钓鱼页面想要的结果。
  const urlMatches = cipherMatchesUrl(cipher, tab.url);

  const frames = await collectFrames(tab.id);
  let filled = 0;
  let targetedFrames = 0;

  for (const frame of frames) {
    if (frame.details == null) {
      continue;
    }

    const script = buildLoginFillScript(frame.details as AutofillPageDetails, credentials);
    if (script.actions.length === 0) {
      continue;
    }

    try {
      await api().scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frame.frameId] },
        files: [FILLER_FILE],
      });

      const [result] = await api().scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frame.frameId] },
        // 该函数会被序列化送进页面，不能引用外部作用域。
        func: (payload: unknown) => {
          const fill = (
            globalThis as {
              __vwoFillPageFields?: (script: unknown) => Promise<{ filled: number }>;
            }
          ).__vwoFillPageFields;
          return typeof fill === "function" ? fill(payload) : { filled: 0 };
        },
        args: [script],
      });

      const frameFilled = (result?.result as { filled?: number } | undefined)?.filled ?? 0;
      filled += frameFilled;
      if (frameFilled > 0) {
        targetedFrames += 1;
      }
    } catch (e) {
      logger.warn(`向框架 ${frame.frameId} 填充失败:`, e);
    }
  }

  if (filled === 0) {
    return {
      ok: false,
      message: "当前页面没有找到可填充的登录字段",
      filled: 0,
      urlMatches,
    };
  }

  return { ok: true, filled, frames: targetedFrames, urlMatches };
}
