/**
 * 本地存储键名的唯一定义处。
 *
 * 命名约定 `vwo:<域>:<名称>`，便于在 devtools 里一眼分辨归属，
 * 也避免与页面注入的其它扩展数据冲突。
 */
export const StorageKeys = {
  /** local：加密后的密码库主体（密文）。 */
  VaultData: "vwo:vault:data",
  /** local：密码库元信息——KDF 参数、salt、UserKey 包裹密文、版本号。 */
  VaultMeta: "vwo:vault:meta",
  /** local：用户设置（锁定超时、填充开关等，非敏感）。 */
  Settings: "vwo:settings",
  /** local：解锁失败节流状态。放 local 而非 session，重启浏览器不能绕过。 */
  UnlockThrottle: "vwo:vault:unlock-throttle",
  /** session：解锁后的 UserKey，浏览器会话结束即消失。 */
  SessionUserKey: "vwo:session:userkey",
  /** session：最近一次活动时间戳，用于超时锁定判定。 */
  SessionLastActivity: "vwo:session:last-activity",
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
