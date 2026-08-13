import { fromBase64, toBase64 } from "./encoding";
import { EncryptionType } from "./encryption-type";
import { importAesCbcKey, importHmacKey } from "./primitives";

/**
 * 对称密钥。
 *
 * Bitwarden 用**密钥长度**隐式区分算法，没有额外的类型标记：
 *   32 字节 → AES-256-CBC，无认证（历史格式）
 *   64 字节 → 前 32B 加密密钥 ‖ 后 32B HMAC 密钥
 *
 * UserKey 与拉伸后的主密钥都是 64 字节；KDF 直接输出的主密钥是 32 字节，
 * 必须先经 `stretchKey` 拉伸才能用于认证加密。
 */
export class SymmetricCryptoKey {
  readonly type: EncryptionType;
  /** 完整密钥字节（32 或 64）。序列化时用它。 */
  readonly key: Uint8Array;
  /** AES 加密密钥，始终 32 字节。 */
  readonly encryptionKey: Uint8Array;
  /** HMAC 认证密钥，仅 64 字节密钥才有。 */
  readonly authenticationKey: Uint8Array | undefined;

  /**
   * 导入后的 WebCrypto 密钥句柄，惰性创建并复用。
   *
   * `subtle.importKey` 并不便宜，而解密一个条目要碰十几个字段、每个字段又要
   * AES 与 HMAC 各一次。一个 600 条的库若每次都重新导入，光 importKey 就上万次。
   * 同一把密钥的句柄是可以安全复用的，缓存在实例上即可。
   */
  private cachedAesKey?: Promise<CryptoKey>;
  private cachedHmacKey?: Promise<CryptoKey>;

  constructor(key: Uint8Array) {
    if (key.length === 32) {
      this.type = EncryptionType.AesCbc256_B64;
      this.key = key;
      this.encryptionKey = key;
      this.authenticationKey = undefined;
    } else if (key.length === 64) {
      this.type = EncryptionType.AesCbc256_HmacSha256_B64;
      this.key = key;
      this.encryptionKey = key.slice(0, 32);
      this.authenticationKey = key.slice(32);
    } else {
      throw new Error(`不支持的密钥长度 ${key.length}，只接受 32 或 64 字节`);
    }
  }

  /** 是否具备完整性校验能力（即能产出/校验 type 2 密文）。 */
  get supportsAuthentication(): boolean {
    return this.authenticationKey != null;
  }

  async aesKey(): Promise<CryptoKey> {
    return await (this.cachedAesKey ??= importAesCbcKey(this.encryptionKey));
  }

  async hmacKey(): Promise<CryptoKey> {
    if (this.authenticationKey == null) {
      throw new Error("该密钥不含认证密钥");
    }
    return await (this.cachedHmacKey ??= importHmacKey(this.authenticationKey));
  }

  toBase64(): string {
    return toBase64(this.key);
  }

  static fromBase64(value: string): SymmetricCryptoKey {
    return new SymmetricCryptoKey(fromBase64(value));
  }
}
