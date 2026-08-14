import {
  type KdfConfig,
  SymmetricCryptoKey,
  EncString,
  defaultKdfConfig,
  deriveMasterKey,
  generateSalt,
  generateUserKey,
  toBase64,
  fromBase64,
  unwrapKey,
  wrapKey,
} from "@/core/crypto";

import { StorageKeys } from "../state/storage-keys";
import { type Settings, normalizeSettings } from "../state/settings";
import type { VaultStorage } from "../state/storage.port";
import { VaultStatus } from "../state/vault-status";

import { type VaultData, emptyVaultData } from "./models";

/**
 * 保险库状态机。
 *
 * ## 三态
 *   Uninitialized  本地没有 meta，还没有密码库
 *   Locked         有 meta 但 session 里没有 UserKey，密文读不了
 *   Unlocked       session 里有 UserKey
 *
 * 状态**不缓存在内存变量里**，每次都从存储现算 —— MV3 的 service worker 随时
 * 会被回收重启，任何内存状态都不可信。
 *
 * ## 为什么不存主密码哈希
 *
 * Bitwarden 会保存 `PBKDF2(masterKey, password, 1)` 作为认证哈希，那是给服务端
 * 校验用的。我们没有服务端，密码是否正确完全可以由"解开 UserKey 包裹密文时
 * MAC 校验是否通过"来判定 —— 既准确又少在磁盘上留一份可离线爆破的材料。
 */

export const VAULT_FORMAT_VERSION = 1;

export interface VaultMeta {
  version: number;
  kdf: KdfConfig;
  /** base64。离线场景没有邮箱可用作 salt，改用随机 16 字节。 */
  salt: string;
  /** UserKey 的包裹密文（EncString 序列化形态）。 */
  wrappedUserKey: string;
  createdAt: string;
  updatedAt: string;

  /**
   * PIN 解锁：PIN 同样包裹一份 UserKey（与主密码包裹的是同一把钥匙）。
   * 数据加密强度不变，PIN 只是另一种解锁方式——代价是 PIN 熵低，
   * 浏览器端无系统设备锁保护，属于「便利换风险」。
   */
  pinWrappedUserKey?: string;
  /** PIN 派生的专用 salt（base64，随机 16 字节），与主密码 salt 隔离。 */
  pinSalt?: string;
}

interface ThrottleState {
  failedAttempts: number;
  /** 时间戳；在此之前拒绝任何解锁尝试。 */
  lockedUntil?: number;
}

export class VaultLockedError extends Error {
  constructor() {
    super("密码库处于锁定状态");
    this.name = "VaultLockedError";
  }
}

export class InvalidMasterPasswordError extends Error {
  constructor() {
    super("主密码不正确");
    this.name = "InvalidMasterPasswordError";
  }
}

export class InvalidPinError extends Error {
  constructor() {
    super("PIN 不正确");
    this.name = "InvalidPinError";
  }
}

export class ThrottledError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`解锁尝试过于频繁，请在 ${Math.ceil(retryAfterMs / 1000)} 秒后重试`);
    this.name = "ThrottledError";
    this.retryAfterMs = retryAfterMs;
  }
}

// --- 状态查询 -------------------------------------------------------------

export async function getMeta(storage: VaultStorage): Promise<VaultMeta | undefined> {
  return await storage.local.get<VaultMeta>(StorageKeys.VaultMeta);
}

export async function getStatus(storage: VaultStorage): Promise<VaultStatus> {
  if ((await getMeta(storage)) == null) {
    return VaultStatus.Uninitialized;
  }
  const sessionKey = await storage.session.get<string>(StorageKeys.SessionUserKey);
  return sessionKey == null ? VaultStatus.Locked : VaultStatus.Unlocked;
}

/** 取运行期 UserKey；未解锁返回 undefined。 */
export async function getSessionUserKey(
  storage: VaultStorage,
): Promise<SymmetricCryptoKey | undefined> {
  const raw = await storage.session.get<string>(StorageKeys.SessionUserKey);
  return raw == null ? undefined : new SymmetricCryptoKey(fromBase64(raw));
}

/** 取运行期 UserKey，未解锁则抛错。供必须在解锁态执行的操作使用。 */
export async function requireUserKey(storage: VaultStorage): Promise<SymmetricCryptoKey> {
  const key = await getSessionUserKey(storage);
  if (key == null) {
    throw new VaultLockedError();
  }
  return key;
}

// --- 创建 -----------------------------------------------------------------

export interface CreateVaultOptions {
  kdf?: KdfConfig;
  /** 初始数据，用于"导入文件的同时建库"（Phase 3）。 */
  initialData?: VaultData;
}

/**
 * 新建本地密码库，完成后处于**已解锁**状态。
 *
 * 若本地已有密码库会直接拒绝 —— 覆盖是不可逆的数据销毁，必须由调用方先显式
 * 调用 {@link clearVault} 表明意图。
 */
export async function createVault(
  storage: VaultStorage,
  masterPassword: string,
  options: CreateVaultOptions = {},
): Promise<void> {
  if ((await getMeta(storage)) != null) {
    throw new Error("本地已存在密码库，如需重建请先清除");
  }
  assertPasswordPolicy(masterPassword);

  const kdf = options.kdf ?? defaultKdfConfig();
  const salt = generateSalt();
  const masterKey = await deriveMasterKey(masterPassword, salt, kdf);
  const userKey = generateUserKey();
  const wrappedUserKey = await wrapKey(userKey, masterKey);

  const now = new Date().toISOString();
  const meta: VaultMeta = {
    version: VAULT_FORMAT_VERSION,
    kdf,
    salt: toBase64(salt),
    wrappedUserKey: wrappedUserKey.toString(),
    createdAt: now,
    updatedAt: now,
  };

  // 先写数据再写 meta：meta 是"密码库是否存在"的判据，最后落地可以保证
  // 中途失败时不会留下一个指向空数据的 meta。
  await storage.local.set(StorageKeys.VaultData, options.initialData ?? emptyVaultData());
  await storage.local.set(StorageKeys.VaultMeta, meta);
  await storage.local.remove(StorageKeys.UnlockThrottle);

  await startSession(storage, userKey);
}

// --- 解锁 / 锁定 -----------------------------------------------------------

export async function unlock(
  storage: VaultStorage,
  masterPassword: string,
  now: number = Date.now(),
): Promise<SymmetricCryptoKey> {
  const meta = await getMeta(storage);
  if (meta == null) {
    throw new Error("本地没有密码库");
  }

  const throttle = await readThrottle(storage);
  if (throttle.lockedUntil != null && throttle.lockedUntil > now) {
    throw new ThrottledError(throttle.lockedUntil - now);
  }

  const masterKey = await deriveMasterKey(masterPassword, fromBase64(meta.salt), meta.kdf);

  let userKey: SymmetricCryptoKey;
  try {
    // 密码是否正确完全由这里的 MAC 校验决定：错误密码派生出错误的包裹密钥，
    // MAC 必然对不上。不需要另存一份口令哈希。
    userKey = await unwrapKey(EncString.parse(meta.wrappedUserKey), masterKey);
  } catch {
    await recordFailure(storage, throttle, now);
    throw new InvalidMasterPasswordError();
  }

  await storage.local.remove(StorageKeys.UnlockThrottle);
  await startSession(storage, userKey, now);
  return userKey;
}

/** 锁定：丢弃运行期密钥，密文原样保留。 */
export async function lock(storage: VaultStorage): Promise<void> {
  await storage.session.remove([StorageKeys.SessionUserKey, StorageKeys.SessionLastActivity]);
}

/**
 * 校验主密码但**不改变任何状态**。
 *
 * 用于条目级复验（reprompt）：查看敏感条目前再确认一次身份。
 * 此处不做失败节流——能走到这一步说明密码库已经解锁，攻击面与解锁前不同，
 * 真正的门槛在解锁那一关。
 */
export async function verifyMasterPassword(
  storage: VaultStorage,
  password: string,
): Promise<boolean> {
  const meta = await getMeta(storage);
  if (meta == null) {
    return false;
  }

  const masterKey = await deriveMasterKey(password, fromBase64(meta.salt), meta.kdf);
  try {
    await unwrapKey(EncString.parse(meta.wrappedUserKey), masterKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * 清空密码库数据：删除全部条目与文件夹，但**保留密码库本身**
 * （主密码、KDF、PIN 不变），解锁后得到空库。
 */
export async function clearVaultData(storage: VaultStorage): Promise<void> {
  await requireUserKey(storage);
  await writeVaultData(storage, emptyVaultData());
}

/** 销毁本地密码库。不可恢复。 */
export async function clearVault(storage: VaultStorage): Promise<void> {
  await lock(storage);
  await storage.local.remove([
    StorageKeys.VaultMeta,
    StorageKeys.VaultData,
    StorageKeys.UnlockThrottle,
    // 最近使用指向的条目已随库销毁，一并清掉，避免残留引用。
    StorageKeys.LastUsedLogin,
  ]);
}

async function startSession(
  storage: VaultStorage,
  userKey: SymmetricCryptoKey,
  now: number = Date.now(),
): Promise<void> {
  await storage.session.set(StorageKeys.SessionUserKey, userKey.toBase64());
  await storage.session.set(StorageKeys.SessionLastActivity, now);
}

/** 刷新活动时间戳，推迟超时锁定。 */
export async function touchActivity(
  storage: VaultStorage,
  now: number = Date.now(),
): Promise<void> {
  if ((await storage.session.get(StorageKeys.SessionUserKey)) == null) {
    return;
  }
  await storage.session.set(StorageKeys.SessionLastActivity, now);
}

export async function getLastActivity(storage: VaultStorage): Promise<number | undefined> {
  return await storage.session.get<number>(StorageKeys.SessionLastActivity);
}

// --- 修改主密码 -----------------------------------------------------------

/**
 * 改主密码只需重新包裹 UserKey，**不需要重新加密整库** ——
 * 这正是引入 UserKey 这一层间接的意义。
 */
export async function changeMasterPassword(
  storage: VaultStorage,
  currentPassword: string,
  newPassword: string,
  kdf?: KdfConfig,
): Promise<void> {
  assertPasswordPolicy(newPassword);

  const meta = await getMeta(storage);
  if (meta == null) {
    throw new Error("本地没有密码库");
  }

  const userKey = await unlock(storage, currentPassword);

  const nextKdf = kdf ?? meta.kdf;
  const nextSalt = generateSalt();
  const nextMasterKey = await deriveMasterKey(newPassword, nextSalt, nextKdf);

  await storage.local.set(StorageKeys.VaultMeta, {
    ...meta,
    kdf: nextKdf,
    salt: toBase64(nextSalt),
    wrappedUserKey: (await wrapKey(userKey, nextMasterKey)).toString(),
    updatedAt: new Date().toISOString(),
  } satisfies VaultMeta);
}

// --- 设置 -----------------------------------------------------------------

export async function getSettings(storage: VaultStorage): Promise<Settings> {
  return normalizeSettings(await storage.local.get(StorageKeys.Settings));
}

export async function saveSettings(
  storage: VaultStorage,
  settings: Partial<Settings>,
): Promise<Settings> {
  const merged = normalizeSettings({ ...(await getSettings(storage)), ...settings });
  await storage.local.set(StorageKeys.Settings, merged);
  return merged;
}

// --- PIN 解锁 ---------------------------------------------------------------

/** 设置或修改 PIN：用 PIN 派生密钥再包一份 UserKey。 */
export async function setPin(storage: VaultStorage, pin: string): Promise<void> {
  const error = validatePin(pin);
  if (error != null) {
    throw new Error(error);
  }

  const userKey = await requireUserKey(storage);
  const meta = await getMeta(storage);
  if (meta == null) {
    throw new Error("本地没有密码库");
  }

  // PIN 的 salt 独立于主密码 salt，两者互不影响。
  const pinSalt = generateSalt();
  const pinKey = await deriveMasterKey(pin, pinSalt, meta.kdf);
  const wrapped = await wrapKey(userKey, pinKey);

  await storage.local.set(StorageKeys.VaultMeta, {
    ...meta,
    pinWrappedUserKey: wrapped.toString(),
    pinSalt: toBase64(pinSalt),
    updatedAt: new Date().toISOString(),
  } satisfies VaultMeta);
}

/** 移除 PIN，恢复仅主密码解锁。 */
export async function clearPin(storage: VaultStorage): Promise<void> {
  const meta = await getMeta(storage);
  if (meta == null) {
    return;
  }
  const { pinWrappedUserKey: _pin, pinSalt: _salt, ...rest } = meta;
  await storage.local.set(StorageKeys.VaultMeta, rest satisfies VaultMeta);
}

export async function hasPin(storage: VaultStorage): Promise<boolean> {
  const meta = await getMeta(storage);
  return meta?.pinWrappedUserKey != null && meta?.pinSalt != null;
}

/** 用 PIN 解锁，拿到与主密码解锁完全相同的 UserKey。 */
export async function unlockWithPin(
  storage: VaultStorage,
  pin: string,
  now: number = Date.now(),
): Promise<SymmetricCryptoKey> {
  const meta = await getMeta(storage);
  if (meta == null) {
    throw new Error("本地没有密码库");
  }
  if (meta.pinWrappedUserKey == null || meta.pinSalt == null) {
    throw new Error("未设置 PIN");
  }

  // 与主密码解锁共用同一套节流（无论哪种方式失败都计数）。
  const throttle = await readThrottle(storage);
  if (throttle.lockedUntil != null && throttle.lockedUntil > now) {
    throw new ThrottledError(throttle.lockedUntil - now);
  }

  const pinKey = await deriveMasterKey(pin, fromBase64(meta.pinSalt), meta.kdf);

  let userKey: SymmetricCryptoKey;
  try {
    userKey = await unwrapKey(EncString.parse(meta.pinWrappedUserKey), pinKey);
  } catch {
    await recordFailure(storage, throttle, now);
    throw new InvalidPinError();
  }

  await storage.local.remove(StorageKeys.UnlockThrottle);
  await startSession(storage, userKey, now);
  return userKey;
}

// --- 最近使用 -------------------------------------------------------------

/** 取最近一次填充过的登录条目 id。 */
export async function getLastUsedLogin(storage: VaultStorage): Promise<string | undefined> {
  return await storage.local.get<string>(StorageKeys.LastUsedLogin);
}

/** 记录最近一次填充的登录条目 id。 */
export async function setLastUsedLogin(
  storage: VaultStorage,
  cipherId: string,
): Promise<void> {
  await storage.local.set(StorageKeys.LastUsedLogin, cipherId);
}

// --- 数据读写 -------------------------------------------------------------

export async function readVaultData(storage: VaultStorage): Promise<VaultData> {
  return (await storage.local.get<VaultData>(StorageKeys.VaultData)) ?? emptyVaultData();
}

export async function writeVaultData(storage: VaultStorage, data: VaultData): Promise<void> {
  await storage.local.set(StorageKeys.VaultData, data);
}

// --- 解锁节流 -------------------------------------------------------------

/**
 * 连续失败后逐步延长等待。
 *
 * 前两次不惩罚（手滑很常见），之后按 5s 起指数增长，上限 5 分钟。
 *
 * 需要说明它的边界：能物理接触到本地存储的攻击者可以绕过 UI 直接离线爆破，
 * 真正的强度来自 KDF 的计算成本。本机制针对的是"设备被临时借用/短暂离开"
 * 这类现实场景。
 */
const THROTTLE_FREE_ATTEMPTS = 2;
const THROTTLE_BASE_MS = 5_000;
const THROTTLE_MAX_MS = 300_000;

async function readThrottle(storage: VaultStorage): Promise<ThrottleState> {
  return (
    (await storage.local.get<ThrottleState>(StorageKeys.UnlockThrottle)) ?? { failedAttempts: 0 }
  );
}

async function recordFailure(
  storage: VaultStorage,
  previous: ThrottleState,
  now: number,
): Promise<void> {
  const failedAttempts = previous.failedAttempts + 1;
  const penalizedCount = failedAttempts - THROTTLE_FREE_ATTEMPTS;

  const next: ThrottleState = { failedAttempts };
  if (penalizedCount > 0) {
    const delay = Math.min(THROTTLE_BASE_MS * 2 ** (penalizedCount - 1), THROTTLE_MAX_MS);
    next.lockedUntil = now + delay;
  }

  await storage.local.set(StorageKeys.UnlockThrottle, next);
}

export async function getThrottleState(storage: VaultStorage): Promise<ThrottleState> {
  return await readThrottle(storage);
}

/**
 * 本地主密码策略：至少 8 位，且必须同时包含字母与数字。
 *
 * 返回错误消息；合法时返回 null。创建与修改主密码共用，
 * UI 的实时提示也复用此函数，保证两处口径一致。
 */
export function validateMasterPassword(password: string): string | null {
  if (password.length === 0) {
    return "主密码不能为空";
  }
  if (password.length < 8) {
    return `至少 8 位，当前 ${password.length} 位`;
  }
  if (!/[a-zA-Z]/.test(password)) {
    return "需同时包含字母和数字";
  }
  if (!/\d/.test(password)) {
    return "需同时包含字母和数字";
  }
  return null;
}

/**
 * PIN 规则：4-12 位，仅限数字与字母。
 *
 * 返回错误消息；合法返回 null。设置/修改 PIN 时校验。
 */
export function validatePin(pin: string): string | null {
  if (pin.length === 0) {
    return "PIN 不能为空";
  }
  if (pin.length < 4) {
    return `至少 4 位，当前 ${pin.length} 位`;
  }
  if (pin.length > 12) {
    return "最多 12 位";
  }
  if (!/^[a-zA-Z0-9]+$/.test(pin)) {
    return "仅限数字和字母";
  }
  return null;
}

function assertPasswordPolicy(password: string): void {
  const error = validateMasterPassword(password);
  if (error != null) {
    throw new Error(error);
  }
}
