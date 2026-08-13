import { describe, expect, it } from "vitest";

import { toHex, toUtf8Bytes } from "./encoding";
import { EncryptionType } from "./encryption-type";
import { KdfType } from "./kdf";
import {
  deriveMasterKey,
  deriveVaultExportKey,
  generateSalt,
  generateUserKey,
  hashMasterPassword,
  stretchKey,
  unwrapKey,
  wrapKey,
} from "./key-derivation";
import { hkdfExpand } from "./primitives";
import { randomBytes } from "./random";
import { SymmetricCryptoKey } from "./symmetric-crypto-key";

const PBKDF2_FAST = { type: KdfType.PBKDF2_SHA256, iterations: 5_000 } as const;

describe("stretchKey", () => {
  it("32 字节拉伸为 64 字节的加密+认证密钥", async () => {
    const stretched = await stretchKey(new SymmetricCryptoKey(randomBytes(32)));

    expect(stretched.key.length).toBe(64);
    expect(stretched.type).toBe(EncryptionType.AesCbc256_HmacSha256_B64);
    expect(stretched.supportsAuthentication).toBe(true);
  });

  it("等价于 HKDF-Expand(key,'enc',32) ‖ HKDF-Expand(key,'mac',32)", async () => {
    // 这是与 Bitwarden 互通的核心约定，单独钉死：
    // 前 32 字节必须是 info="enc" 的输出，后 32 字节是 info="mac" 的输出。
    const master = new SymmetricCryptoKey(randomBytes(32));

    const stretched = await stretchKey(master);
    const expectedEnc = await hkdfExpand(master.encryptionKey, "enc", 32);
    const expectedMac = await hkdfExpand(master.encryptionKey, "mac", 32);

    expect(toHex(stretched.encryptionKey)).toBe(toHex(expectedEnc));
    expect(toHex(stretched.authenticationKey as Uint8Array)).toBe(toHex(expectedMac));
  });

  it("确定性：同一输入永远得到同一输出", async () => {
    const master = new SymmetricCryptoKey(randomBytes(32));

    expect(toHex((await stretchKey(master)).key)).toBe(toHex((await stretchKey(master)).key));
  });

  it("拒绝拉伸 64 字节密钥", async () => {
    await expect(stretchKey(new SymmetricCryptoKey(randomBytes(64)))).rejects.toThrow(
      /只有 32 字节密钥需要拉伸/,
    );
  });
});

describe("deriveMasterKey", () => {
  it("产出 32 字节主密钥", async () => {
    const masterKey = await deriveMasterKey("pw", "salt", PBKDF2_FAST);

    expect(masterKey.key.length).toBe(32);
    expect(masterKey.supportsAuthentication).toBe(false);
  });

  it("密码或 salt 任一变化都会改变结果", async () => {
    const base = await deriveMasterKey("pw", "salt", PBKDF2_FAST);
    const otherPassword = await deriveMasterKey("pw2", "salt", PBKDF2_FAST);
    const otherSalt = await deriveMasterKey("pw", "salt2", PBKDF2_FAST);

    expect(toHex(base.key)).not.toBe(toHex(otherPassword.key));
    expect(toHex(base.key)).not.toBe(toHex(otherSalt.key));
  });

  it("接受字节形式的 salt（离线库使用随机 salt）", async () => {
    const salt = generateSalt();
    expect(salt.length).toBe(16);

    const masterKey = await deriveMasterKey("pw", salt, PBKDF2_FAST);
    expect(masterKey.key.length).toBe(32);
  });
});

describe("UserKey 包裹与解开", () => {
  it("用 32 字节主密钥包裹后可原样取回（内部自动拉伸）", async () => {
    const masterKey = await deriveMasterKey("pw", "salt", PBKDF2_FAST);
    const userKey = generateUserKey();

    const wrapped = await wrapKey(userKey, masterKey);
    const unwrapped = await unwrapKey(wrapped, masterKey);

    expect(unwrapped.toBase64()).toBe(userKey.toBase64());
    expect(unwrapped.key.length).toBe(64);
  });

  it("用 64 字节密钥包裹时不再拉伸", async () => {
    const wrappingKey = new SymmetricCryptoKey(randomBytes(64));
    const userKey = generateUserKey();

    const unwrapped = await unwrapKey(await wrapKey(userKey, wrappingKey), wrappingKey);

    expect(unwrapped.toBase64()).toBe(userKey.toBase64());
  });

  it("错误主密码解不开，且以 MAC 校验失败告终", async () => {
    const userKey = generateUserKey();
    const wrapped = await wrapKey(userKey, await deriveMasterKey("right", "salt", PBKDF2_FAST));

    const wrongKey = await deriveMasterKey("wrong", "salt", PBKDF2_FAST);

    await expect(unwrapKey(wrapped, wrongKey)).rejects.toThrow(/MAC 不匹配/);
  });

  it("包裹密文是标准 type 2 EncString", async () => {
    const wrapped = await wrapKey(generateUserKey(), await deriveMasterKey("pw", "s", PBKDF2_FAST));

    expect(wrapped.encryptionType).toBe(EncryptionType.AesCbc256_HmacSha256_B64);
    expect(wrapped.toString()).toMatch(/^2\.[^|]+\|[^|]+\|[^|]+$/);
  });
});

describe("generateUserKey", () => {
  it("产出 64 字节且每次不同", () => {
    const first = generateUserKey();
    const second = generateUserKey();

    expect(first.key.length).toBe(64);
    expect(first.toBase64()).not.toBe(second.toBase64());
  });
});

describe("hashMasterPassword", () => {
  it("确定性且与主密钥绑定", async () => {
    const masterKey = await deriveMasterKey("pw", "salt", PBKDF2_FAST);

    const first = await hashMasterPassword("pw", masterKey);
    const second = await hashMasterPassword("pw", masterKey);

    expect(first).toBe(second);
    expect(await hashMasterPassword("other", masterKey)).not.toBe(first);
  });

  it("输出 base64 编码的 32 字节", async () => {
    const masterKey = await deriveMasterKey("pw", "salt", PBKDF2_FAST);
    const hash = await hashMasterPassword("pw", masterKey);

    expect(Buffer.from(hash, "base64").length).toBe(32);
  });
});

describe("deriveVaultExportKey", () => {
  it("等价于 stretchKey(deriveMasterKey(...))", async () => {
    // 导出文件的密钥推导路径必须与 Bitwarden 一致，否则导出的文件它读不了。
    const password = "export-password";
    const salt = "cmFuZG9tc2FsdA==";

    const exportKey = await deriveVaultExportKey(password, salt, PBKDF2_FAST);
    const expected = await stretchKey(await deriveMasterKey(password, salt, PBKDF2_FAST));

    expect(exportKey.toBase64()).toBe(expected.toBase64());
    expect(exportKey.key.length).toBe(64);
  });
});

describe("跨模块一致性", () => {
  it("UTF-8 口令中的多字节字符不影响派生稳定性", async () => {
    const password = "口令🔐";

    const first = await deriveMasterKey(password, toUtf8Bytes("salt"), PBKDF2_FAST);
    const second = await deriveMasterKey(password, "salt", PBKDF2_FAST);

    expect(toHex(first.key)).toBe(toHex(second.key));
  });
});
