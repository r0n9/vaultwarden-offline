/**
 * WebCrypto 原语封装。
 *
 * 这一层只做"把 WebCrypto 那套 importKey/deriveBits 的繁琐调用包起来"，
 * 不掺任何 Bitwarden 语义——格式相关的逻辑在 encrypt.service.ts 与
 * key-derivation.ts 里。
 */

import { toUtf8Bytes } from "./encoding";

export type HashAlgorithm = "SHA-256" | "SHA-512";

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (c?.subtle == null) {
    throw new Error("当前环境不提供 WebCrypto（需要安全上下文）");
  }
  return c.subtle;
}

function asBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? toUtf8Bytes(value) : value;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", data as BufferSource));
}

const HMAC_SHA256 = { name: "HMAC", hash: { name: "SHA-256" } } as const;

/** 导入 HMAC 密钥句柄。句柄可安全复用，调用方应缓存而非反复导入。 */
export async function importHmacKey(key: Uint8Array): Promise<CryptoKey> {
  return await subtle().importKey("raw", key as BufferSource, HMAC_SHA256, false, ["sign"]);
}

/** 导入 AES-CBC 密钥句柄。 */
export async function importAesCbcKey(key: Uint8Array): Promise<CryptoKey> {
  return await subtle().importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function hmacSha256(value: Uint8Array, key: Uint8Array | CryptoKey): Promise<Uint8Array> {
  const importedKey = key instanceof Uint8Array ? await importHmacKey(key) : key;
  return new Uint8Array(await subtle().sign("HMAC", importedKey, value as BufferSource));
}

export async function hmacSha512(value: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const algorithm = { name: "HMAC", hash: { name: "SHA-512" } };
  const importedKey = await subtle().importKey("raw", key as BufferSource, algorithm, false, [
    "sign",
  ]);
  return new Uint8Array(await subtle().sign("HMAC", importedKey, value as BufferSource));
}

export async function pbkdf2(
  password: string | Uint8Array,
  salt: string | Uint8Array,
  iterations: number,
  outputByteLength = 32,
  hash: HashAlgorithm = "SHA-256",
): Promise<Uint8Array> {
  const importedKey = await subtle().importKey(
    "raw",
    asBytes(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await subtle().deriveBits(
    {
      name: "PBKDF2",
      salt: asBytes(salt) as BufferSource,
      iterations,
      hash: { name: hash },
    },
    importedKey,
    outputByteLength * 8,
  );

  return new Uint8Array(bits);
}

/**
 * HKDF 的 Expand 阶段（RFC 5869 §2.3）。
 *
 * 注意这里**只有 Expand 没有 Extract**：传入的 prk 已经是 KDF 的输出，
 * 本身就是均匀分布的密钥材料，无需再提取熵。Bitwarden 的密钥拉伸正是这么做的，
 * 想互通就必须照此实现——若误用完整 HKDF(extract+expand) 会得到完全不同的密钥。
 */
export async function hkdfExpand(
  prk: Uint8Array,
  info: string | Uint8Array,
  outputByteSize: number,
): Promise<Uint8Array> {
  const HASH_LENGTH = 32;

  if (outputByteSize > 255 * HASH_LENGTH) {
    throw new Error("HKDF 输出长度超过上限（255 × HashLen）");
  }
  if (prk.length < HASH_LENGTH) {
    throw new Error(`HKDF 的 prk 至少需要 ${HASH_LENGTH} 字节，收到 ${prk.length}`);
  }

  const infoBytes = asBytes(info);
  const blockCount = Math.ceil(outputByteSize / HASH_LENGTH);
  const okm = new Uint8Array(blockCount * HASH_LENGTH);

  // T(0) = 空串；T(i) = HMAC(prk, T(i-1) ‖ info ‖ i)
  // 显式标注类型：`new Uint8Array(0)` 会推断出更窄的 Uint8Array<ArrayBuffer>，
  // 与 hmacSha256 返回的 Uint8Array<ArrayBufferLike> 不兼容。
  let previousBlock: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < blockCount; i++) {
    const input = new Uint8Array(previousBlock.length + infoBytes.length + 1);
    input.set(previousBlock, 0);
    input.set(infoBytes, previousBlock.length);
    input[input.length - 1] = i + 1;

    previousBlock = await hmacSha256(input, prk);
    okm.set(previousBlock, i * HASH_LENGTH);
  }

  return okm.slice(0, outputByteSize);
}

/** AES-256-CBC 加密。WebCrypto 自动施加 PKCS#7 填充，与 Bitwarden 一致。 */
export async function aesCbcEncrypt(
  data: Uint8Array,
  iv: Uint8Array,
  encryptionKey: Uint8Array | CryptoKey,
): Promise<Uint8Array> {
  const key = encryptionKey instanceof Uint8Array ? await importAesCbcKey(encryptionKey) : encryptionKey;
  return new Uint8Array(
    await subtle().encrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, data as BufferSource),
  );
}

export async function aesCbcDecrypt(
  data: Uint8Array,
  iv: Uint8Array,
  encryptionKey: Uint8Array | CryptoKey,
): Promise<Uint8Array> {
  const key = encryptionKey instanceof Uint8Array ? await importAesCbcKey(encryptionKey) : encryptionKey;
  return new Uint8Array(
    await subtle().decrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, data as BufferSource),
  );
}
