/**
 * 存储端口。
 *
 * 领域逻辑只依赖这个最小接口，不直接触碰 `chrome.storage` —— 这样保险库状态机
 * 可以在 Node 里用内存实现完整测试，不必启动浏览器。
 */

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string | string[]): Promise<void>;
}

export interface VaultStorage {
  /** 持久化，存密文与非敏感设置。 */
  local: KeyValueStore;
  /** 随浏览器会话存活，存解锁后的运行期密钥。 */
  session: KeyValueStore;
}

/** 测试用内存实现。 */
export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    // 走一遍 JSON 序列化，模拟真实存储"存进去的是副本"的语义，
    // 避免测试里因为共享对象引用而掩盖 bug。
    return raw == null ? undefined : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async remove(key: string | string[]): Promise<void> {
    for (const k of Array.isArray(key) ? key : [key]) {
      this.data.delete(k);
    }
  }

  get size(): number {
    return this.data.size;
  }

  keys(): string[] {
    return [...this.data.keys()];
  }
}

export function createMemoryStorage(): VaultStorage {
  return { local: new MemoryStore(), session: new MemoryStore() };
}
