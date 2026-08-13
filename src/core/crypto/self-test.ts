import { EncString } from "./enc-string";
import { EncryptionType } from "./encryption-type";
import { fromHex, toHex, toUtf8Bytes } from "./encoding";
import { decryptToString, encryptString } from "./encrypt.service";
import { KdfType, deriveKdfMaterial } from "./kdf";
import { generateUserKey, deriveMasterKey, unwrapKey, wrapKey } from "./key-derivation";
import { hkdfExpand, hmacSha256, pbkdf2, sha256 } from "./primitives";
import { randomBytes } from "./random";
import { SymmetricCryptoKey } from "./symmetric-crypto-key";

/**
 * 浏览器内加密自检。
 *
 * 单元测试跑在 Node 的 WebCrypto 上，而插件跑在浏览器的 WebCrypto 上——两者
 * 理论上都遵循同一规范，但"理论上"不足以托付一个密码库。本自检把同样的
 * 官方测试向量放到真实运行环境里再跑一遍。
 *
 * 它同时验证了 Argon2 的 WASM 能在扩展页面的 CSP（'wasm-unsafe-eval'）下正常实例化。
 */

export interface SelfTestResult {
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

type Check = { name: string; run: () => Promise<string> };

/** 各检查项返回一个人类可读的结论；抛异常即视为失败。 */
const CHECKS: Check[] = [
  {
    name: "SHA-256 官方向量",
    run: async () => {
      const digest = toHex(await sha256(toUtf8Bytes("abc")));
      assertEqual(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
      return "FIPS 180-4";
    },
  },
  {
    name: "HMAC-SHA256 官方向量",
    run: async () => {
      const mac = toHex(await hmacSha256(toUtf8Bytes("Hi There"), new Uint8Array(20).fill(0x0b)));
      assertEqual(mac, "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
      return "RFC 4231";
    },
  },
  {
    name: "HKDF-Expand 官方向量",
    run: async () => {
      const okm = await hkdfExpand(
        fromHex("077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5"),
        fromHex("f0f1f2f3f4f5f6f7f8f9"),
        42,
      );
      assertEqual(
        toHex(okm),
        "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
      );
      return "RFC 5869";
    },
  },
  {
    name: "PBKDF2-SHA256 官方向量",
    run: async () => {
      const derived = toHex(await pbkdf2("password", "salt", 1, 32, "SHA-256"));
      assertEqual(derived, "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
      return "通行向量";
    },
  },
  {
    name: "AES-256-CBC + HMAC 往返",
    run: async () => {
      const key = new SymmetricCryptoKey(randomBytes(64));
      const plaintext = "密码库 🔐 round-trip";

      const encrypted = await encryptString(plaintext, key);
      if (encrypted.encryptionType !== EncryptionType.AesCbc256_HmacSha256_B64) {
        throw new Error(`密文类型应为 2，实为 ${encrypted.encryptionType}`);
      }
      assertEqual(await decryptToString(encrypted, key), plaintext);
      return "type 2 密文";
    },
  },
  {
    name: "篡改检测（MAC）",
    run: async () => {
      const key = new SymmetricCryptoKey(randomBytes(64));
      const encrypted = await encryptString("secret", key);

      const tampered = encrypted.dataBytes;
      tampered[0] = (tampered[0] as number) ^ 0xff;
      const forged = EncString.fromBytes(
        EncryptionType.AesCbc256_HmacSha256_B64,
        encrypted.ivBytes,
        tampered,
        encrypted.macBytes,
      );

      try {
        await decryptToString(forged, key);
      } catch {
        return "篡改已被拒绝";
      }
      throw new Error("篡改的密文竟然解密成功了");
    },
  },
  {
    name: "UserKey 包裹 / 解开",
    run: async () => {
      const masterKey = await deriveMasterKey("master-password", randomBytes(16), {
        type: KdfType.PBKDF2_SHA256,
        iterations: 5_000,
      });
      const userKey = generateUserKey();

      const unwrapped = await unwrapKey(await wrapKey(userKey, masterKey), masterKey);
      assertEqual(unwrapped.toBase64(), userKey.toBase64());
      return "64 字节 UserKey";
    },
  },
  {
    name: "Argon2id (WASM)",
    run: async () => {
      // 参数取小值：这里验证的是 WASM 能否在扩展 CSP 下实例化并给出确定性结果，
      // 不是强度。真实密码库用的是完整参数。
      const config = { type: KdfType.Argon2id, iterations: 2, memory: 16, parallelism: 1 } as const;

      const first = await deriveKdfMaterial("pw", "salt", config);
      const second = await deriveKdfMaterial("pw", "salt", config);

      assertEqual(toHex(first), toHex(second));
      if (first.length !== 32) {
        throw new Error(`应输出 32 字节，实为 ${first.length}`);
      }
      return "WASM 加载正常";
    },
  },
];

export async function runCryptoSelfTest(): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];

  for (const check of CHECKS) {
    const start = performance.now();
    try {
      const detail = await check.run();
      results.push({
        name: check.name,
        passed: true,
        detail,
        durationMs: performance.now() - start,
      });
    } catch (e) {
      results.push({
        name: check.name,
        passed: false,
        detail: e instanceof Error ? e.message : String(e),
        durationMs: performance.now() - start,
      });
    }
  }

  return results;
}

function assertEqual(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`期望 ${expected.slice(0, 16)}… 实得 ${actual.slice(0, 16)}…`);
  }
}
