/**
 * 加密核心的公开入口。
 *
 * 其余模块一律从 `@/core/crypto` 导入，不要深入子文件 —— 便于日后替换实现
 * （例如引入 XChaCha20-Poly1305）时收敛改动面。
 */

export {
  concatBytes,
  fromBase64,
  fromHex,
  fromUtf8Bytes,
  timingSafeEqual,
  toBase64,
  toHex,
  toUtf8Bytes,
  zeroBytes,
} from "./encoding";

export { randomBytes, randomInt, randomIv } from "./random";

export { EncryptionType, encryptionTypeName, isSupportedForDecryption } from "./encryption-type";

export { EncString } from "./enc-string";

export { SymmetricCryptoKey } from "./symmetric-crypto-key";

export {
  MacVerificationError,
  UnsupportedEncryptionTypeError,
  decryptToBytes,
  decryptToString,
  encryptBytes,
  encryptString,
  type DecryptOptions,
} from "./encrypt.service";

export {
  KdfLimits,
  KdfType,
  defaultArgon2Config,
  defaultKdfConfig,
  deriveKdfMaterial,
  validateKdfConfig,
  type Argon2Config,
  type KdfConfig,
  type Pbkdf2Config,
} from "./kdf";

export {
  deriveMasterKey,
  deriveVaultExportKey,
  generateSalt,
  generateUserKey,
  hashMasterPassword,
  stretchKey,
  unwrapKey,
  wrapKey,
} from "./key-derivation";

export { hkdfExpand, hmacSha256, hmacSha512, pbkdf2, sha256 } from "./primitives";

export { runCryptoSelfTest, type SelfTestResult } from "./self-test";
