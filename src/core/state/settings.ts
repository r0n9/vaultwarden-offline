/**
 * 锁定超时设置。
 *
 * 数值型 = 无操作多少**分钟**后锁定；其余为特殊触发方式。
 */
export const VaultTimeoutType = {
  /** popup 关闭即锁定，最严格。 */
  Immediately: "immediately",
  /** 仅浏览器重启时锁定（session 存储自然清空）。 */
  OnRestart: "onRestart",
  /** 系统进入空闲状态时锁定。 */
  OnIdle: "onIdle",
  /** 永不自动锁定。 */
  Never: "never",
} as const;

export type VaultTimeoutType = (typeof VaultTimeoutType)[keyof typeof VaultTimeoutType];

export type VaultTimeout = number | VaultTimeoutType;

/**
 * 超时后的动作。
 *
 * lock  丢弃内存密钥，密文留在本地，输主密码可再次解锁
 * clear 直接销毁本地密码库 —— 数据不可恢复，仅适合已另存导出备份的用户
 */
export const VaultTimeoutAction = {
  Lock: "lock",
  Clear: "clear",
} as const;

export type VaultTimeoutAction = (typeof VaultTimeoutAction)[keyof typeof VaultTimeoutAction];

/** 外观：跟随系统 / 强制浅色 / 强制深色。 */
export const AppearanceTheme = {
  System: "system",
  Light: "light",
  Dark: "dark",
} as const;

export type AppearanceTheme = (typeof AppearanceTheme)[keyof typeof AppearanceTheme];

export const APPEARANCE_OPTIONS: ReadonlyArray<{ value: AppearanceTheme; label: string }> = [
  { value: AppearanceTheme.System, label: "跟随系统" },
  { value: AppearanceTheme.Light, label: "浅色" },
  { value: AppearanceTheme.Dark, label: "深色" },
];

export interface Settings {
  vaultTimeout: VaultTimeout;
  vaultTimeoutAction: VaultTimeoutAction;
  theme: AppearanceTheme;
}

export const DEFAULT_SETTINGS: Settings = {
  vaultTimeout: 15,
  vaultTimeoutAction: VaultTimeoutAction.Lock,
  theme: AppearanceTheme.System,
};

/** popup 下拉框可选项。 */
export const VAULT_TIMEOUT_OPTIONS: ReadonlyArray<{ value: VaultTimeout; label: string }> = [
  { value: VaultTimeoutType.Immediately, label: "立即（关闭弹窗即锁定）" },
  { value: 1, label: "1 分钟" },
  { value: 5, label: "5 分钟" },
  { value: 15, label: "15 分钟" },
  { value: 30, label: "30 分钟" },
  { value: 60, label: "1 小时" },
  { value: 240, label: "4 小时" },
  { value: VaultTimeoutType.OnIdle, label: "系统空闲时" },
  { value: VaultTimeoutType.OnRestart, label: "浏览器重启时" },
  { value: VaultTimeoutType.Never, label: "永不" },
];

export function isTimeoutMinutes(timeout: VaultTimeout): timeout is number {
  return typeof timeout === "number";
}

/**
 * 判断按"无操作时长"是否该锁定。
 *
 * 只处理分钟数这一种；`immediately` 由 popup 断开连接触发，`onIdle` 由 idle 事件
 * 触发，`onRestart` 靠 session 存储随浏览器退出自然清空，都不在这里判定。
 */
export function shouldTimeoutByInactivity(
  timeout: VaultTimeout,
  lastActivityAt: number | undefined,
  now: number,
): boolean {
  if (!isTimeoutMinutes(timeout)) {
    return false;
  }
  if (lastActivityAt == null) {
    // 已解锁却没有活动记录，说明状态不完整，保守起见判定为超时。
    return true;
  }
  return now - lastActivityAt >= timeout * 60_000;
}

export function normalizeSettings(raw: unknown): Settings {
  if (raw == null || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  const candidate = raw as Partial<Settings>;
  const timeout = candidate.vaultTimeout;
  const action = candidate.vaultTimeoutAction;

  return {
    vaultTimeout: isValidTimeout(timeout) ? timeout : DEFAULT_SETTINGS.vaultTimeout,
    vaultTimeoutAction:
      action === VaultTimeoutAction.Clear || action === VaultTimeoutAction.Lock
        ? action
        : DEFAULT_SETTINGS.vaultTimeoutAction,
    theme:
      candidate.theme === AppearanceTheme.Light || candidate.theme === AppearanceTheme.Dark
        ? candidate.theme
        : DEFAULT_SETTINGS.theme,
  };
}

function isValidTimeout(value: unknown): value is VaultTimeout {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 && value <= 60 * 24 * 7;
  }
  return Object.values(VaultTimeoutType).includes(value as VaultTimeoutType);
}
