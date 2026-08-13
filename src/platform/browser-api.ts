/**
 * 浏览器 API 抽象层。
 *
 * 纪律（沿用 Bitwarden 的经验教训）：
 *   1. 业务代码**禁止**直接使用 `chrome.*` / `browser.*`，一律走本模块。
 *      唯一例外是注入到页面的 content script —— 它无法 import 本模块的完整依赖树。
 *   2. 监听器一律通过 `addListener()` 注册，它返回一个注销函数。
 *      Safari 不会自动回收 popup 上下文的监听器，手工注销是防内存泄漏的唯一手段。
 *   3. Safari 的 tabs.query 会跨窗口返回错误结果，查询当前窗口标签页必须走
 *      `getActiveTab()`，不要自己拼 query 条件。
 */

/** Firefox / Safari 暴露的是 `browser` 命名空间，Chromium 系是 `chrome`。 */
declare const browser: typeof chrome | undefined;

export type BrowserVendor = "chrome" | "firefox" | "safari" | "opera" | "edge" | "unknown";

function resolveApi(): typeof chrome {
  if (typeof browser !== "undefined" && browser?.runtime?.id != null) {
    return browser;
  }
  if (typeof chrome !== "undefined" && chrome?.runtime?.id != null) {
    return chrome;
  }
  throw new Error("[BrowserApi] 未检测到扩展运行时，本模块只能在扩展上下文中使用。");
}

let cachedApi: typeof chrome | undefined;

/** 归一化后的扩展 API 入口。 */
export function api(): typeof chrome {
  return (cachedApi ??= resolveApi());
}

let cachedVendor: BrowserVendor | undefined;

export function vendor(): BrowserVendor {
  if (cachedVendor != null) {
    return cachedVendor;
  }

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

  if (ua.includes("Firefox") || ua.includes("Gecko/")) {
    cachedVendor = "firefox";
  } else if (ua.includes("OPR/") || ua.includes("Opera")) {
    cachedVendor = "opera";
  } else if (ua.includes("Edg/")) {
    cachedVendor = "edge";
  } else if (ua.includes("Safari") && !ua.includes("Chrome") && !ua.includes("Chromium")) {
    cachedVendor = "safari";
  } else if (ua.includes("Chrome") || ua.includes("Chromium")) {
    cachedVendor = "chrome";
  } else {
    cachedVendor = "unknown";
  }

  return cachedVendor;
}

export const isSafari = (): boolean => vendor() === "safari";
export const isFirefox = (): boolean => vendor() === "firefox";

/** 当前是否运行在 service worker(背景页) 上下文。 */
export function isBackgroundContext(): boolean {
  return typeof window === "undefined" && typeof self !== "undefined";
}

// ---------------------------------------------------------------------------
// 监听器
// ---------------------------------------------------------------------------

type ChromeEvent<T extends (...args: never[]) => unknown> = {
  addListener(cb: T): void;
  removeListener(cb: T): void;
};

/**
 * 注册事件监听器，返回注销函数。
 *
 * 务必在组件销毁时调用返回值 —— Safari 的 popup 上下文不会自动清理，
 * 反复开关 popup 会累积监听器直至内存耗尽。
 */
export function addListener<T extends (...args: never[]) => unknown>(
  event: ChromeEvent<T>,
  callback: T,
): () => void {
  event.addListener(callback);
  return () => event.removeListener(callback);
}

// ---------------------------------------------------------------------------
// 存储
// ---------------------------------------------------------------------------

/**
 * `local`：持久化，存放**密文**。即便被读取也无法还原明文。
 * `session`：随浏览器会话存活，MV3 下 service worker 重启不丢，存放解锁后的
 *            运行期密钥。默认访问级别为 TRUSTED_CONTEXTS，content script 读不到。
 */
export const storage = {
  local: {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const result = await api().storage.local.get(key);
      return result[key] as T | undefined;
    },
    async getMany(keys: string[]): Promise<Record<string, unknown>> {
      return await api().storage.local.get(keys);
    },
    async set(key: string, value: unknown): Promise<void> {
      await api().storage.local.set({ [key]: value });
    },
    async remove(key: string | string[]): Promise<void> {
      await api().storage.local.remove(key);
    },
    async clear(): Promise<void> {
      await api().storage.local.clear();
    },
  },

  session: {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const result = await api().storage.session.get(key);
      return result[key] as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      await api().storage.session.set({ [key]: value });
    },
    async remove(key: string | string[]): Promise<void> {
      await api().storage.session.remove(key);
    },
    async clear(): Promise<void> {
      await api().storage.session.clear();
    },
  },
} as const;

// ---------------------------------------------------------------------------
// 运行时
// ---------------------------------------------------------------------------

export const runtime = {
  getManifest: (): chrome.runtime.Manifest => api().runtime.getManifest(),
  getURL: (path: string): string => api().runtime.getURL(path),
  get id(): string {
    return api().runtime.id;
  },

  /**
   * 向背景页发消息。
   *
   * MV3 下背景 service worker 随时可能被杀掉，"接收方不存在" 是常态而非异常，
   * 此处吞掉该错误并返回 undefined，由调用方决定重试策略。
   */
  async sendMessage<TResponse = unknown>(message: unknown): Promise<TResponse | undefined> {
    try {
      return (await api().runtime.sendMessage(message)) as TResponse;
    } catch (e) {
      if (isReceiverMissingError(e)) {
        return undefined;
      }
      throw e;
    }
  },
};

function isReceiverMissingError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection") ||
    message.includes("message port closed")
  );
}

// ---------------------------------------------------------------------------
// 标签页
// ---------------------------------------------------------------------------

export const tabs = {
  /**
   * 取当前活动标签页。
   *
   * Safari 的 `tabs.query({active:true, currentWindow:true})` 会错误地返回多个
   * 窗口的标签页，因此对 Safari 走 lastFocusedWindow 并只取第一个结果。
   */
  async getActive(): Promise<chrome.tabs.Tab | undefined> {
    if (isSafari()) {
      const result = await api().tabs.query({ active: true, lastFocusedWindow: true });
      return result[0] ?? (await api().tabs.query({ active: true }))[0];
    }
    const result = await api().tabs.query({ active: true, currentWindow: true });
    return result[0];
  },

  async sendMessage<TResponse = unknown>(
    tabId: number,
    message: unknown,
    options?: { frameId?: number },
  ): Promise<TResponse | undefined> {
    try {
      return (await api().tabs.sendMessage(tabId, message, options ?? {})) as TResponse;
    } catch (e) {
      if (isReceiverMissingError(e)) {
        return undefined;
      }
      throw e;
    }
  },
};

// ---------------------------------------------------------------------------
// 本地化
// ---------------------------------------------------------------------------

export function t(key: string, substitutions?: string | string[]): string {
  return api().i18n.getMessage(key, substitutions) || key;
}

export const BrowserApi = {
  api,
  vendor,
  isSafari,
  isFirefox,
  isBackgroundContext,
  addListener,
  storage,
  runtime,
  tabs,
  t,
} as const;
