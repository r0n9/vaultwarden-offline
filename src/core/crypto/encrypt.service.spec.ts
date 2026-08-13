import { describe, expect, it } from "vitest";

import { toBase64 } from "./encoding";
import { EncString } from "./enc-string";
import { EncryptionType } from "./encryption-type";
import {
  MacVerificationError,
  decryptToBytes,
  decryptToString,
  encryptBytes,
  encryptString,
} from "./encrypt.service";
import { aesCbcEncrypt } from "./primitives";
import { randomBytes, randomIv } from "./random";
import { SymmetricCryptoKey } from "./symmetric-crypto-key";

function testKey(): SymmetricCryptoKey {
  return new SymmetricCryptoKey(randomBytes(64));
}

describe("对称加解密往返", () => {
  it("字符串往返", async () => {
    const key = testKey();
    const plaintext = "correct horse battery staple";

    const decrypted = await decryptToString(await encryptString(plaintext, key), key);

    expect(decrypted).toBe(plaintext);
  });

  it("多字节字符往返", async () => {
    const key = testKey();
    const plaintext = "密码库 🔐 Ünïcödé\n换行与\t制表";

    expect(await decryptToString(await encryptString(plaintext, key), key)).toBe(plaintext);
  });

  it("空字符串往返", async () => {
    const key = testKey();
    expect(await decryptToString(await encryptString("", key), key)).toBe("");
  });

  it("字节数组往返（含跨块长度）", async () => {
    const key = testKey();
    // 16 是 AES 块长，特意覆盖恰好整块与非整块两种填充情形。
    for (const length of [1, 15, 16, 17, 1024]) {
      const plaintext = randomBytes(length);
      const decrypted = await decryptToBytes(await encryptBytes(plaintext, key), key);
      expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    }
  });

  it("每次加密使用不同 IV，相同明文产出不同密文", async () => {
    const key = testKey();

    const first = await encryptString("same", key);
    const second = await encryptString("same", key);

    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
  });

  it("产出的密文类型恒为 type 2", async () => {
    const encrypted = await encryptString("x", testKey());
    expect(encrypted.encryptionType).toBe(EncryptionType.AesCbc256_HmacSha256_B64);
  });
});

describe("完整性校验", () => {
  it("篡改密文体会被 MAC 拦截", async () => {
    const key = testKey();
    const encrypted = await encryptString("secret", key);

    const tampered = encrypted.dataBytes;
    tampered[0] = (tampered[0] as number) ^ 0xff;
    const forged = EncString.fromBytes(
      EncryptionType.AesCbc256_HmacSha256_B64,
      encrypted.ivBytes,
      tampered,
      encrypted.macBytes,
    );

    await expect(decryptToString(forged, key)).rejects.toThrow(MacVerificationError);
  });

  it("篡改 IV 会被 MAC 拦截", async () => {
    const key = testKey();
    const encrypted = await encryptString("secret", key);

    const tamperedIv = encrypted.ivBytes;
    tamperedIv[0] = (tamperedIv[0] as number) ^ 0xff;
    const forged = EncString.fromBytes(
      EncryptionType.AesCbc256_HmacSha256_B64,
      tamperedIv,
      encrypted.dataBytes,
      encrypted.macBytes,
    );

    await expect(decryptToString(forged, key)).rejects.toThrow(MacVerificationError);
  });

  it("换一把密钥解密会被 MAC 拦截，而非抛出填充错误", async () => {
    const encrypted = await encryptString("secret", testKey());

    // 关键：错误必须在 MAC 阶段就终止，绝不能进入 AES 解密暴露填充预言。
    await expect(decryptToString(encrypted, testKey())).rejects.toThrow(MacVerificationError);
  });
});

describe("无认证密文（type 0）", () => {
  async function makeType0(key: SymmetricCryptoKey, plaintext: Uint8Array): Promise<EncString> {
    const iv = randomIv();
    const ciphertext = await aesCbcEncrypt(plaintext, iv, key.encryptionKey);
    return EncString.fromBytes(EncryptionType.AesCbc256_B64, iv, ciphertext);
  }

  it("默认拒绝解密", async () => {
    const key = testKey();
    const encrypted = await makeType0(key, new Uint8Array([1, 2, 3]));

    await expect(decryptToBytes(encrypted, key)).rejects.toThrow(/无完整性保护/);
  });

  it("显式放行后可解密，用于导入历史数据", async () => {
    const key = testKey();
    const plaintext = new Uint8Array([1, 2, 3]);
    const encrypted = await makeType0(key, plaintext);

    const decrypted = await decryptToBytes(encrypted, key, { allowUnauthenticated: true });

    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
  });

  it("永不产出无认证密文", async () => {
    const key32 = new SymmetricCryptoKey(randomBytes(32));
    await expect(encryptString("x", key32)).rejects.toThrow(/64 字节密钥/);
  });
});

describe("SymmetricCryptoKey", () => {
  it("32 字节密钥不具备认证能力", () => {
    const key = new SymmetricCryptoKey(randomBytes(32));

    expect(key.type).toBe(EncryptionType.AesCbc256_B64);
    expect(key.supportsAuthentication).toBe(false);
    expect(key.authenticationKey).toBeUndefined();
  });

  it("64 字节密钥拆分为前 32 加密 + 后 32 认证", () => {
    const raw = randomBytes(64);
    const key = new SymmetricCryptoKey(raw);

    expect(key.type).toBe(EncryptionType.AesCbc256_HmacSha256_B64);
    expect(Array.from(key.encryptionKey)).toEqual(Array.from(raw.slice(0, 32)));
    expect(Array.from(key.authenticationKey as Uint8Array)).toEqual(Array.from(raw.slice(32)));
  });

  it("拒绝其它长度", () => {
    expect(() => new SymmetricCryptoKey(randomBytes(16))).toThrow(/不支持的密钥长度/);
    expect(() => new SymmetricCryptoKey(randomBytes(48))).toThrow(/不支持的密钥长度/);
  });

  it("base64 往返", () => {
    const raw = randomBytes(64);
    const restored = SymmetricCryptoKey.fromBase64(toBase64(raw));

    expect(restored.toBase64()).toBe(toBase64(raw));
  });
});
