import {
  VaultTimeoutAction,
  VaultTimeoutType,
  shouldTimeoutByInactivity,
} from "@/core/state/settings";
import { VaultStatus } from "@/core/state/vault-status";
import {
  InvalidMasterPasswordError,
  InvalidPinError,
  ThrottledError,
  clearVault,
  createVault,
  getLastActivity,
  getLastUsedLogin,
  getMeta,
  getSettings,
  getStatus,
  lock,
  readVaultData,
  saveSettings,
  touchActivity,
  unlock,
  changeMasterPassword,
  clearPin,
  clearVaultData,
  hasPin,
  setPin,
  unlockWithPin,
  verifyMasterPassword,
} from "@/core/vault/vault.service";
import { api, runtime } from "@/platform/browser-api";
import { logger } from "@/platform/logger";
import { registerHandlers } from "@/platform/messaging";
import {
  ErrorCode,
  POPUP_PORT_NAME,
  type Result,
  type VaultSummary,
} from "@/platform/messaging/types";
import { browserVaultStorage as vaultStorage } from "@/platform/storage/browser-vault-storage";

import { collectActiveTabFields } from "./autofill-collection";
import {
  findMatchingLoginCiphers,
  refreshContextMenu,
  registerContextMenu,
  registerMenuRefreshTriggers,
} from "./context-menu";
import { fillActiveTab, fillTab } from "./autofill-fill";
import {
  addAttachment,
  getAttachmentBytes,
  removeAttachment,
} from "./attachment-handler";
import { getCipher } from "@/core/vault/vault-repository";
import { commitSave, registerSaveTriggers, reportSaveAttempt } from "./save-detection";
import { fetchFavicon } from "./favicon";
import { registerBadgeTriggers, updateMatchBadge } from "./badge";
import { pickShortcutTarget } from "./shortcut";

/**
 * 背景 service worker。
 *
 * MV3 下本文件的执行上下文随时会被浏览器回收，因此：
 *   - 不在模块作用域持有任何需要长期存活的状态（状态一律进 storage）
 *   - 所有事件监听器必须在**模块顶层同步注册**，否则 SW 冷启动时会漏事件
 *   - 定时任务用 chrome.alarms 而非 setInterval（后者随 SW 一起被杀）
 */

const TIMEOUT_ALARM = "vwo:vault-timeout-check";
const TIMEOUT_CHECK_PERIOD_MINUTES = 1;

// --- 状态呈现 -------------------------------------------------------------

async function refreshActionIcon(status: VaultStatus): Promise<void> {
  const locked = status !== VaultStatus.Unlocked;
  try {
    await api().action.setIcon({
      path: locked
        ? { 19: "images/icon19_locked.png", 38: "images/icon38_locked.png" }
        : { 19: "images/icon19.png", 38: "images/icon38.png" },
    });
  } catch (e) {
    logger.warn("更新工具栏图标失败:", e);
  }

  // 角标（匹配条目数）不归图标管：解锁态显示数字、锁定态由 updateMatchBadge 清空。
  void updateMatchBadge(vaultStorage);
}

async function currentStatusAndRefresh(): Promise<VaultStatus> {
  const status = await getStatus(vaultStorage);
  await refreshActionIcon(status);
  // 密码库状态影响右键菜单内容（锁定态只有"打开密码库"），状态一变就重建。
  void refreshContextMenu(vaultStorage);
  return status;
}

// --- 超时锁定 -------------------------------------------------------------

/**
 * 执行超时动作。`clear` 会销毁本地库，因此只在用户明确选择该动作时才走这条路。
 */
async function applyTimeoutAction(reason: string): Promise<void> {
  const settings = await getSettings(vaultStorage);

  if (settings.vaultTimeoutAction === VaultTimeoutAction.Clear) {
    logger.info(`超时触发（${reason}），按设置销毁本地密码库`);
    await clearVault(vaultStorage);
  } else {
    logger.info(`超时触发（${reason}），锁定密码库`);
    await lock(vaultStorage);
  }

  await currentStatusAndRefresh();
}

async function checkInactivityTimeout(): Promise<void> {
  if ((await getStatus(vaultStorage)) !== VaultStatus.Unlocked) {
    return;
  }

  const settings = await getSettings(vaultStorage);
  const lastActivity = await getLastActivity(vaultStorage);

  if (shouldTimeoutByInactivity(settings.vaultTimeout, lastActivity, Date.now())) {
    await applyTimeoutAction(`无操作超过 ${String(settings.vaultTimeout)} 分钟`);
  }
}

// --- 消息处理 -------------------------------------------------------------

function failure(error: unknown): Result<never> {
  if (error instanceof ThrottledError) {
    return {
      ok: false,
      code: ErrorCode.Throttled,
      message: error.message,
      retryAfterMs: error.retryAfterMs,
    };
  }
  if (error instanceof InvalidMasterPasswordError) {
    return { ok: false, code: ErrorCode.InvalidMasterPassword, message: error.message };
  }
  if (error instanceof InvalidPinError) {
    return { ok: false, code: ErrorCode.InvalidPin, message: error.message };
  }
  return {
    ok: false,
    code: ErrorCode.Unexpected,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function buildSummary(): Promise<VaultSummary> {
  const status = await getStatus(vaultStorage);
  const meta = await getMeta(vaultStorage);

  if (status !== VaultStatus.Unlocked) {
    return {
      status,
      cipherCount: 0,
      folderCount: 0,
      createdAt: meta?.createdAt,
      kdfType: meta?.kdf.type,
      kdfIterations: meta?.kdf.iterations,
    };
  }

  const data = await readVaultData(vaultStorage);
  return {
    status,
    cipherCount: data.ciphers.length,
    folderCount: data.folders.length,
    createdAt: meta?.createdAt,
    kdfType: meta?.kdf.type,
    kdfIterations: meta?.kdf.iterations,
  };
}

registerHandlers({
  ping: () => ({ pong: true as const, version: runtime.getManifest().version }),

  "vault:getStatus": async () => ({ status: await currentStatusAndRefresh() }),

  "vault:getSummary": async () => await buildSummary(),

  "vault:create": async ({ masterPassword, kdf }) => {
    try {
      await createVault(vaultStorage, masterPassword, kdf == null ? {} : { kdf });
      return { ok: true, value: { status: await currentStatusAndRefresh() } };
    } catch (e) {
      logger.error("创建密码库失败:", e);
      return failure(e);
    }
  },

  "vault:unlock": async ({ masterPassword }) => {
    try {
      await unlock(vaultStorage, masterPassword);
      return { ok: true, value: { status: await currentStatusAndRefresh() } };
    } catch (e) {
      return failure(e);
    }
  },

  "vault:lock": async () => {
    await lock(vaultStorage);
    return { status: await currentStatusAndRefresh() };
  },

  "vault:verifyPassword": async ({ masterPassword }) => ({
    valid: await verifyMasterPassword(vaultStorage, masterPassword),
  }),

  "vault:clear": async () => {
    await clearVault(vaultStorage);
    return { status: await currentStatusAndRefresh() };
  },

  "vault:clearData": async () => {
    await clearVaultData(vaultStorage);
    return { status: await currentStatusAndRefresh() };
  },

  "vault:touch": async () => {
    await touchActivity(vaultStorage);
    return { status: await getStatus(vaultStorage) };
  },

  "settings:get": async () => await getSettings(vaultStorage),

  "settings:save": async (patch) => {
    const settings = await saveSettings(vaultStorage, patch);
    await applyIdleDetection(settings.vaultTimeout);
    return settings;
  },

  "autofill:collectActiveTab": async () => await collectActiveTabFields(),

  "autofill:fillActiveTab": async ({ cipherId }) =>
    await fillActiveTab(vaultStorage, cipherId),

  "save:report": async ({ url, username, password }, sender) => {
    if (sender.tab?.id != null) {
      reportSaveAttempt(vaultStorage, sender.tab.id, { url, username, password });
    }
    return { status: "queued" };
  },

  "save:commit": async (request) => await commitSave(vaultStorage, request),

  "favicon:fetch": async ({ url }) => {
    const [tab] = await api().tabs.query({ active: true, currentWindow: true });
    return { ok: await fetchFavicon(url, tab?.id) };
  },

  "vault:hasPin": async () => ({ hasPin: await hasPin(vaultStorage) }),

  "vault:setPin": async ({ pin }) => {
    try {
      await setPin(vaultStorage, pin);
      return { ok: true, value: { ok: true as const } };
    } catch (e) {
      logger.error("设置 PIN 失败:", e);
      return failure(e);
    }
  },

  "vault:clearPin": async () => {
    try {
      await clearPin(vaultStorage);
      return { ok: true, value: { ok: true as const } };
    } catch (e) {
      logger.error("移除 PIN 失败:", e);
      return failure(e);
    }
  },

  "vault:unlockWithPin": async ({ pin }) => {
    try {
      await unlockWithPin(vaultStorage, pin);
      return { ok: true, value: { status: await currentStatusAndRefresh() } };
    } catch (e) {
      return failure(e);
    }
  },

  "vault:changePassword": async ({ currentPassword, newPassword }) => {
    try {
      await changeMasterPassword(vaultStorage, currentPassword, newPassword);
      return { ok: true, value: { ok: true as const } };
    } catch (e) {
      logger.error("修改主密码失败:", e);
      return failure(e);
    }
  },

  "attachment:add": async ({ cipherId, fileName, data }) => {
    const result = await addAttachment(vaultStorage, cipherId, fileName, data);
    return "id" in result
      ? { ok: true, value: { id: result.id } }
      : { ok: false, code: ErrorCode.Unexpected, message: result.error };
  },

  "attachment:get": async ({ attachmentId }) =>
    await getAttachmentBytes(vaultStorage, attachmentId),

  "shortcut:getAutofill": async () => {
    try {
      const commands = await api().commands.getAll();
      const autofill = commands.find((command) => command.name === "autofill_login");
      return { shortcut: autofill?.shortcut ?? "" };
    } catch {
      return { shortcut: "" };
    }
  },

  "overlay:getMatches": async ({ url }) => {
    if ((await getStatus(vaultStorage)) !== VaultStatus.Unlocked) {
      return { items: [] };
    }
    const matches = await findMatchingLoginCiphers(vaultStorage, url);
    return {
      items: matches.map((cipher) => ({
        cipherId: cipher.id,
        name: cipher.name,
        username: cipher.login?.username,
      })),
    };
  },

  "attachment:delete": async ({ cipherId, attachmentId }) => {
    const result = await removeAttachment(vaultStorage, cipherId, attachmentId);
    return result.ok
      ? { ok: true, value: { ok: true as const } }
      : { ok: false, code: ErrorCode.Unexpected, message: result.message ?? "删除附件失败" };
  },
});

// --- 生命周期与事件 -------------------------------------------------------

/** 仅在选择"系统空闲时锁定"时才注册空闲检测，避免无谓的系统调用。 */
async function applyIdleDetection(timeout: unknown): Promise<void> {
  if (timeout !== VaultTimeoutType.OnIdle) {
    return;
  }
  try {
    api().idle.setDetectionInterval(60);
  } catch (e) {
    logger.warn("设置空闲检测间隔失败:", e);
  }
}

api().runtime.onInstalled.addListener((details) => {
  logger.info("扩展已安装/更新:", details.reason);
  void currentStatusAndRefresh();
});

api().runtime.onStartup.addListener(() => {
  // 浏览器重启后 session 存储已自然清空，密码库必然处于锁定态，
  // 这里只需把图标同步过来。"浏览器重启时锁定"就是靠这个特性实现的。
  void currentStatusAndRefresh();
});

/**
 * 只在闹钟不存在时创建。
 *
 * `alarms.create` 用同名调用会**替换**已有闹钟并重置计时，而本文件在 SW 每次
 * 冷启动都会执行一遍——若 SW 唤醒得比周期还频繁，无条件创建会让闹钟永远等不到
 * 触发，自动锁定就此失效。
 */
void (async () => {
  if ((await api().alarms.get(TIMEOUT_ALARM)) == null) {
    api().alarms.create(TIMEOUT_ALARM, { periodInMinutes: TIMEOUT_CHECK_PERIOD_MINUTES });
  }
})();

api().alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TIMEOUT_ALARM) {
    void checkInactivityTimeout();
  }
});

api().idle.onStateChanged.addListener((state) => {
  void (async () => {
    const settings = await getSettings(vaultStorage);
    if (settings.vaultTimeout !== VaultTimeoutType.OnIdle) {
      return;
    }
    if (state === "idle" || state === "locked") {
      await applyTimeoutAction(`系统进入 ${state} 状态`);
    }
  })();
});

/**
 * popup 打开时建立长连接，关闭时断开——这是"立即锁定"唯一可靠的触发点，
 * MV3 没有提供 popup 关闭事件。
 */
api().runtime.onConnect.addListener((port) => {
  if (port.name !== POPUP_PORT_NAME) {
    return;
  }

  void touchActivity(vaultStorage);

  port.onDisconnect.addListener(() => {
    void (async () => {
      const settings = await getSettings(vaultStorage);
      if (settings.vaultTimeout === VaultTimeoutType.Immediately) {
        await applyTimeoutAction("弹窗关闭");
      } else {
        await touchActivity(vaultStorage);
      }
    })();
  });
});

api().commands.onCommand.addListener((command) => {
  if (command === "lock_vault") {
    void (async () => {
      await lock(vaultStorage);
      await currentStatusAndRefresh();
    })();
  }

  if (command === "autofill_login") {
    void (async () => {
      // Ctrl+Shift+L：填充「上次使用且匹配当前站点」的登录项；
      // 没有这样的记录时回退到当前站点匹配的第一条（收藏优先）。
      // 关键约束：自动触发的填充没有用户确认，条目必须匹配当前站点，
      // 否则等于把别的站的密码填进当前页——那正是钓鱼页面想要的结果。
      if ((await getStatus(vaultStorage)) !== VaultStatus.Unlocked) {
        return;
      }

      const [tab] = await api().tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null || tab.url == null) {
        return;
      }

      const lastUsedId = await getLastUsedLogin(vaultStorage);
      const lastUsed =
        lastUsedId == null ? undefined : await getCipher(vaultStorage, lastUsedId);
      const matches = await findMatchingLoginCiphers(vaultStorage, tab.url);
      const target = pickShortcutTarget(tab.url, lastUsed, matches);

      if (target != null) {
        await fillTab(vaultStorage, target.id, tab);
      }
    })();
  }
});

// SW 冷启动时同步一次状态与右键菜单。
void currentStatusAndRefresh();
registerContextMenu(vaultStorage);
registerMenuRefreshTriggers(vaultStorage);
registerBadgeTriggers(vaultStorage);
registerSaveTriggers(vaultStorage);
void refreshContextMenu(vaultStorage);
void updateMatchBadge(vaultStorage);

logger.info("背景 service worker 已启动");
