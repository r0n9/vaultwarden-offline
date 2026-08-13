/**
 * 字节与字符串编码工具。
 *
 * 密码库里所有二进制都以 Uint8Array 流转，只在序列化边界转成 base64。
 */

/** 一次 `String.fromCharCode(...)` 的最大展开长度，超过会爆调用栈。 */
const CHUNK_SIZE = 0x8000;

export function toUtf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function fromUtf8Bytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function fromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0) {
    throw new Error("十六进制字符串长度必须为偶数");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

/**
 * 恒定时间比较。
 *
 * MAC 校验**必须**用它而不是 `===` 或逐字节提前返回：后者的耗时与前缀匹配长度
 * 相关，攻击者可据此逐字节猜出正确 MAC，从而绕过完整性校验。
 *
 * 长度不等时直接返回 false —— 长度本身不是秘密。
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}

/**
 * 就地清零。
 *
 * 用于清除用完的密钥材料。注意：这在 JS 里只是尽力而为——引擎可能已经复制过该
 * 缓冲区，GC 也不保证及时回收。它降低密钥在内存中的驻留时间，但不是硬保证。
 */
export function zeroBytes(bytes: Uint8Array): void {
  bytes.fill(0);
}
