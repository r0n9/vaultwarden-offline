import { concatBytes, fromUtf8Bytes, timingSafeEqual, toUtf8Bytes } from "./encoding";
import { EncString } from "./enc-string";
import { EncryptionType, encryptionTypeName } from "./encryption-type";
import { aesCbcDecrypt, aesCbcEncrypt, hmacSha256 } from "./primitives";
import { randomIv } from "./random";
import type { SymmetricCryptoKey } from "./symmetric-crypto-key";

/**
 * 对称加解密，格式与 Bitwarden 完全一致。
 *
 * 加密：
 *   iv  = 随机 16 字节
 *   ct  = AES-256-CBC(encKey, iv, PKCS#7(plaintext))
 *   mac = HMAC-SHA256(macKey, iv ‖ ct)      ← 注意是 iv 与密文拼接，不含明文
 *   输出 `2.{b64 iv}|{b64 ct}|{b64 mac}`
 *
 * 这是 encrypt-then-MAC 结构：解密前先验 MAC，验不过直接拒绝，
 * 绝不把未经认证的密文喂给 AES —— 否则会暴露 CBC 填充预言攻击面。
 */

export class MacVerificationError extends Error {
  constructor() {
    super("密文完整性校验失败：MAC 不匹配（数据被篡改，或使用了错误的密钥）");
    this.name = "MacVerificationError";
  }
}

export class UnsupportedEncryptionTypeError extends Error {
  constructor(type: number) {
    super(`不支持的密文类型: ${encryptionTypeName(type)}`);
    this.name = "UnsupportedEncryptionTypeError";
  }
}

export async function encryptBytes(
  plainValue: Uint8Array,
  key: SymmetricCryptoKey,
): Promise<EncString> {
  if (!key.supportsAuthentication) {
    // 不产出无 MAC 的密文。32 字节密钥必须先经 stretchKey 拉伸。
    throw new Error("加密需要带认证密钥的 64 字节密钥，请先调用 stretchKey");
  }

  const iv = randomIv();
  const ciphertext = await aesCbcEncrypt(plainValue, iv, await key.aesKey());
  const mac = await hmacSha256(concatBytes(iv, ciphertext), await key.hmacKey());

  return EncString.fromBytes(EncryptionType.AesCbc256_HmacSha256_B64, iv, ciphertext, mac);
}

export async function encryptString(
  plainValue: string,
  key: SymmetricCryptoKey,
): Promise<EncString> {
  return await encryptBytes(toUtf8Bytes(plainValue), key);
}

export interface DecryptOptions {
  /**
   * 允许解密无 MAC 的 type 0 密文。
   *
   * 默认关闭：这类密文没有完整性保护，可被离线篡改。仅在导入历史数据时
   * 临时开启，导入完成后应立即以 type 2 重新加密落盘。
   */
  allowUnauthenticated?: boolean;
}

export async function decryptToBytes(
  encString: EncString,
  key: SymmetricCryptoKey,
  options: DecryptOptions = {},
): Promise<Uint8Array> {
  switch (encString.encryptionType) {
    case EncryptionType.AesCbc256_HmacSha256_B64: {
      if (!key.supportsAuthentication) {
        throw new Error("解密 type 2 密文需要带认证密钥的 64 字节密钥");
      }
      const mac = encString.macBytes;
      if (mac == null) {
        throw new MacVerificationError();
      }

      const iv = encString.ivBytes;
      const data = encString.dataBytes;

      const expectedMac = await hmacSha256(concatBytes(iv, data), await key.hmacKey());
      if (!timingSafeEqual(expectedMac, mac)) {
        throw new MacVerificationError();
      }

      return await aesCbcDecrypt(data, iv, await key.aesKey());
    }

    case EncryptionType.AesCbc256_B64: {
      if (options.allowUnauthenticated !== true) {
        throw new Error(
          "拒绝解密无 MAC 的 type 0 密文（无完整性保护）。确需导入历史数据请显式传入 allowUnauthenticated",
        );
      }
      return await aesCbcDecrypt(encString.dataBytes, encString.ivBytes, key.encryptionKey);
    }

    default:
      throw new UnsupportedEncryptionTypeError(encString.encryptionType);
  }
}

export async function decryptToString(
  encString: EncString,
  key: SymmetricCryptoKey,
  options: DecryptOptions = {},
): Promise<string> {
  return fromUtf8Bytes(await decryptToBytes(encString, key, options));
}
