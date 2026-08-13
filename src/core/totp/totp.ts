import { hmacSha256, hmacSha512 } from "@/core/crypto";

/**
 * 时间基一次性密码（TOTP），RFC 6238。
 *
 * 纯本地计算，无任何网络请求。正确性由 RFC 6238 附录 B 的官方测试向量锁定。
 */

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpConfig {
  /** base32 编码的共享密钥。 */
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  /** 周期秒数，默认 30。 */
  period: number;
}

/** Steam 的字符表：去掉了容易混淆的 0/1/A/E/I/L/O/S/U/Z。 */
const STEAM_ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";

/** 取 32 位动态二进制码中的低 31 位（RFC 4226 的动态截断）。 */
function dynamicTruncate(mac: Uint8Array, digits: number): number {
  const offset = mac[mac.length - 1]! & 0x0f;
  const value =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);

  return value % 10 ** digits;
}

/** base32 解码（RFC 4648），不区分大小写、忽略空白。 */
export function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = input.toUpperCase().replace(/[\s=]/g, "");

  const bits: number[] = [];
  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index === -1) {
      throw new Error(`密钥包含非法字符 "${char}"（应为 base32）`);
    }
    bits.push(index);
  }

  const bytes = new Uint8Array(Math.floor((bits.length * 5) / 8));
  let buffer = 0;
  let bufferBits = 0;
  let byteIndex = 0;

  for (const value of bits) {
    buffer = (buffer << 5) | value;
    bufferBits += 5;
    if (bufferBits >= 8) {
      bytes[byteIndex++] = (buffer >>> (bufferBits - 8)) & 0xff;
      bufferBits -= 8;
    }
  }

  return bytes;
}

async function hmacFor(
  algorithm: TotpAlgorithm,
  message: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  if (algorithm === "SHA256") {
    return await hmacSha256(message, key);
  }
  if (algorithm === "SHA512") {
    return await hmacSha512(message, key);
  }
  return await hmacSha1(message, key);
}

/** SHA-1 的 HMAC 在本项目其它地方用不到，此处按需实现。 */
async function hmacSha1(message: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const imported = await subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: { name: "SHA-1" } },
    false,
    ["sign"],
  );
  return new Uint8Array(await subtle.sign("HMAC", imported, message as BufferSource));
}

/**
 * 生成指定时刻的 TOTP 码。
 *
 * @param counter 以秒为单位的时间（通常为当前 Unix 时间）。
 */
export async function generateTotp(config: TotpConfig, counterSeconds: number): Promise<string> {
  const secretBytes = base32Decode(config.secret);

  // T = floor(时间 / 周期)，按 RFC 6238 用 8 字节大端整数。
  const counter = Math.floor(counterSeconds / config.period);
  const message = new Uint8Array(8);
  const view = new DataView(message.buffer);
  view.setBigUint64(0, BigInt(counter));

  const mac = await hmacFor(config.algorithm, message, secretBytes);
  const value = dynamicTruncate(mac, config.digits);

  return String(value).padStart(config.digits, "0");
}

/** Steam 风格：5 字符字母码。 */
export async function generateSteamCode(secret: string, counterSeconds: number): Promise<string> {
  const secretBytes = base32Decode(secret);
  const counter = Math.floor(counterSeconds / 30);
  const message = new Uint8Array(8);
  const view = new DataView(message.buffer);
  view.setBigUint64(0, BigInt(counter));

  const mac = await hmacFor("SHA1", message, secretBytes);
  const offset = mac[mac.length - 1]! & 0x0f;
  const value =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);

  let code = "";
  let remaining = value;
  for (let i = 0; i < 5; i++) {
    code += STEAM_ALPHABET[remaining % STEAM_ALPHABET.length]!;
    remaining = Math.floor(remaining / STEAM_ALPHABET.length);
  }
  return code;
}

/** 当前周期的剩余秒数（倒计时用）。 */
export function secondsRemaining(counterSeconds: number, period: number): number {
  return period - (counterSeconds % period);
}
