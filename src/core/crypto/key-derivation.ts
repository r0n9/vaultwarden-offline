import { toBase64 } from "./encoding";
import type { EncString } from "./enc-string";
import { decryptToBytes, encryptBytes } from "./encrypt.service";
import { type KdfConfig, deriveKdfMaterial } from "./kdf";
import { hkdfExpand, pbkdf2 } from "./primitives";
import { randomBytes } from "./random";
import { SymmetricCryptoKey } from "./symmetric-crypto-key";

/**
 * 密钥层级。
 *
 *   主密码 ──KDF(salt)──▶ MasterKey(32B)
 *                            │
 *                    HKDF-Expand("enc"/"mac")
 *                            ▼
 *                     StretchedKey(64B) ──解开包裹密文──▶ UserKey(64B)
 *                                                            │
 *                                            AES-CBC+HMAC 逐字段加解密
 *                                                            ▼
 *                                                        条目明文
 *
 * MasterKey 只用于包裹/解开 UserKey，绝不直接加密业务数据 —— 这样改主密码
 * 只需重新包裹一次 UserKey，无需重新加密整库。
 */

/** 从主密码派生主密钥。salt 在 Bitwarden 里是小写去空格的邮箱，离线场景用随机 salt。 */
export async function deriveMasterKey(
  password: string,
  salt: string | Uint8Array,
  config: KdfConfig,
): Promise<SymmetricCryptoKey> {
  return new SymmetricCryptoKey(await deriveKdfMaterial(password, salt, config));
}

/**
 * 把 32 字节密钥拉伸为 64 字节的「加密+认证」密钥。
 *
 * 只做 HKDF 的 Expand 阶段，PRK 就是传入的密钥本身。info 分别为 ASCII 的
 * "enc" 与 "mac"，两次输出拼接。这与 Bitwarden 的 `stretchKey` 逐字节一致。
 */
export async function stretchKey(key: SymmetricCryptoKey): Promise<SymmetricCryptoKey> {
  if (key.key.length !== 32) {
    throw new Error(`只有 32 字节密钥需要拉伸，收到 ${key.key.length} 字节`);
  }

  const encryptionKey = await hkdfExpand(key.encryptionKey, "enc", 32);
  const authenticationKey = await hkdfExpand(key.encryptionKey, "mac", 32);

  const stretched = new Uint8Array(64);
  stretched.set(encryptionKey, 0);
  stretched.set(authenticationKey, 32);

  return new SymmetricCryptoKey(stretched);
}

/** 生成全新的 UserKey（64 字节随机）。 */
export function generateUserKey(): SymmetricCryptoKey {
  return new SymmetricCryptoKey(randomBytes(64));
}

/** 生成本地密码库的随机 salt。离线场景没有邮箱可用作 salt。 */
export function generateSalt(): Uint8Array {
  return randomBytes(16);
}

/**
 * 用包裹密钥保护另一把密钥。
 *
 * 若包裹密钥只有 32 字节（KDF 直出的主密钥），先自动拉伸 —— 与 Bitwarden 的
 * `buildProtectedSymmetricKey` 行为一致。
 */
export async function wrapKey(
  keyToWrap: SymmetricCryptoKey,
  wrappingKey: SymmetricCryptoKey,
): Promise<EncString> {
  const effectiveKey = wrappingKey.supportsAuthentication
    ? wrappingKey
    : await stretchKey(wrappingKey);
  return await encryptBytes(keyToWrap.key, effectiveKey);
}

export async function unwrapKey(
  wrapped: EncString,
  wrappingKey: SymmetricCryptoKey,
): Promise<SymmetricCryptoKey> {
  const effectiveKey = wrappingKey.supportsAuthentication
    ? wrappingKey
    : await stretchKey(wrappingKey);
  return new SymmetricCryptoKey(await decryptToBytes(wrapped, effectiveKey));
}

/**
 * 导出文件的加密密钥。
 *
 * Bitwarden 的密码保护导出用的是 `stretchKey(KDF(password, salt))`，
 * salt 与 KDF 参数都明文写在导出文件头部。
 */
export async function deriveVaultExportKey(
  password: string,
  salt: string,
  config: KdfConfig,
): Promise<SymmetricCryptoKey> {
  return await stretchKey(await deriveMasterKey(password, salt, config));
}

/**
 * 主密码校验哈希。
 *
 * Bitwarden 用 `PBKDF2(masterKey, password, 1 轮)` 作为发给服务端的认证哈希。
 * 离线场景没有服务端，我们保留它仅作**快速失败**用途：解锁时先比对这个哈希，
 * 密码错就立刻报错，不必等 AES 解密失败。
 *
 * 它不是安全边界 —— 真正的保证来自 UserKey 包裹密文的 MAC 校验。
 */
export async function hashMasterPassword(
  password: string,
  masterKey: SymmetricCryptoKey,
  iterations = 1,
): Promise<string> {
  return toBase64(await pbkdf2(masterKey.key, password, iterations, 32, "SHA-256"));
}
