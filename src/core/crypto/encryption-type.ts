/**
 * 密文类型标识，与 Bitwarden 的 `EncryptionType` 数值严格一致 —— 它就是
 * EncString 里点号前的那个数字，改动即意味着与 Vaultwarden 不再互通。
 */
export const EncryptionType = {
  /** AES-256-CBC，无 MAC。仅用于解密历史数据，本项目从不产出。 */
  AesCbc256_B64: 0,
  /** AES-256-CBC + HMAC-SHA256（encrypt-then-MAC）。当前唯一产出类型。 */
  AesCbc256_HmacSha256_B64: 2,

  // 以下为非对称与新格式，本项目暂不实现，保留数值以便识别与报错。
  Rsa2048_OaepSha256_B64: 3,
  Rsa2048_OaepSha1_B64: 4,
  Rsa2048_OaepSha256_HmacSha256_B64: 5,
  Rsa2048_OaepSha1_HmacSha256_B64: 6,
  /** COSE 封装的 XChaCha20-Poly1305，Bitwarden 的下一代格式。 */
  CoseEncrypt0: 7,
} as const;

export type EncryptionType = (typeof EncryptionType)[keyof typeof EncryptionType];

/**
 * 各类型序列化后以 `|` 分隔的段数。
 *
 * 示例：
 *   `0.iv|data`
 *   `2.iv|data|mac`
 *   `3.data`
 */
export const EXPECTED_PART_COUNT: Record<number, number> = {
  [EncryptionType.AesCbc256_B64]: 2,
  [EncryptionType.AesCbc256_HmacSha256_B64]: 3,
  [EncryptionType.Rsa2048_OaepSha256_B64]: 1,
  [EncryptionType.Rsa2048_OaepSha1_B64]: 1,
  [EncryptionType.Rsa2048_OaepSha256_HmacSha256_B64]: 2,
  [EncryptionType.Rsa2048_OaepSha1_HmacSha256_B64]: 2,
  [EncryptionType.CoseEncrypt0]: 1,
};

export function encryptionTypeName(type: number): string {
  const entry = Object.entries(EncryptionType).find(([, value]) => value === type);
  return entry?.[0] ?? `未知类型(${type})`;
}

/** 本项目当前支持解密的类型。 */
export function isSupportedForDecryption(type: number): boolean {
  return type === EncryptionType.AesCbc256_B64 || type === EncryptionType.AesCbc256_HmacSha256_B64;
}
