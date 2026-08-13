/** 密码库的三态。这是整个插件的核心状态机，锁定语义由 Phase 2 实现。 */
export const VaultStatus = {
  /** 尚未导入任何数据，本地没有密码库。 */
  Uninitialized: "uninitialized",
  /** 已有密文库，但 UserKey 不在内存中，数据不可读。 */
  Locked: "locked",
  /** UserKey 已在 session 中，数据可读写。 */
  Unlocked: "unlocked",
} as const;

export type VaultStatus = (typeof VaultStatus)[keyof typeof VaultStatus];
