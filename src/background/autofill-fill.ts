import {
  buildCardFillScript,
  buildIdentityFillScript,
  buildLoginFillScript,
  type FillScript,
} from "@/core/autofill/fill-script";
import type { AutofillPageDetails } from "@/core/autofill/models";
import type { VaultStorage } from "@/core/state/storage.port";
import { CipherType } from "@/core/vault/enums";
import type { CipherView } from "@/core/vault/models";
import { cipherMatchesUrl } from "@/core/vault/uri-matching";
import { getCipher } from "@/core/vault/vault-repository";
import { setLastUsedLogin } from "@/core/vault/vault.service";
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
  return await fillTab(storage, cipherId, tab);
}

/** 向指定标签页填充。右键菜单等场景的目标标签页不一定是活动页。 */
export async function fillTab(
  storage: VaultStorage,
  cipherId: string,
  tab: { id?: number; url?: string },
): Promise<AutofillFillResult> {
  if (tab.id == null) {
    return { ok: false, message: "找不到目标标签页", filled: 0 };
  }

  const cipher = await getCipher(storage, cipherId);
  if (cipher == null) {
    return { ok: false, message: "条目不存在", filled: 0 };
  }

  if (!isFillableType(cipher.type)) {
    return {
      ok: false,
      message: "该条目类型暂不支持自动填充（目前支持登录、银行卡、身份）",
      filled: 0,
    };
  }

  // 条目与当前站点不匹配时照填不误——是用户主动选的这一条——但要如实告知，
  // "把某站密码填进另一个站"正是钓鱼页面想要的结果。
  const urlMatches = tab.url == null ? undefined : cipherMatchesUrl(cipher, tab.url);

  const frames = await collectFrames(tab.id);
  let filled = 0;
  let targetedFrames = 0;

  for (const frame of frames) {
    if (frame.details == null) {
      continue;
    }

    const script = buildScriptForCipher(cipher, frame.details as AutofillPageDetails);
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
      message: "当前页面没有找到与该条目匹配的可填充字段",
      filled: 0,
      urlMatches,
    };
  }

  // 填充成功即记为「上次使用」——快捷键 Ctrl+Shift+L 要靠它找到目标条目。
  if (filled > 0) {
    await setLastUsedLogin(storage, cipherId);
  }

  return { ok: true, filled, frames: targetedFrames, urlMatches };
}

function isFillableType(type: number): boolean {
  return (
    type === CipherType.Login || type === CipherType.Card || type === CipherType.Identity
  );
}

/** 按条目类型分派到对应的脚本生成器。 */
function buildScriptForCipher(cipher: CipherView, details: AutofillPageDetails): FillScript {
  switch (cipher.type) {
    case CipherType.Card:
      return buildCardFillScript(details, cipher.card ?? {});

    case CipherType.Identity:
      return buildIdentityFillScript(details, cipher.identity ?? {});

    default:
      return buildLoginFillScript(details, {
        username: cipher.login?.username,
        password: cipher.login?.password,
      });
  }
}
