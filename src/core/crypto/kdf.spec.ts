import { argon2id } from "hash-wasm";
import { describe, expect, it } from "vitest";

import { argon2idDerive } from "./argon2";
import { toHex, toUtf8Bytes } from "./encoding";
import {
  KdfType,
  defaultArgon2Config,
  defaultKdfConfig,
  deriveKdfMaterial,
  validateKdfConfig,
} from "./kdf";
import { sha256 } from "./primitives";

describe("validateKdfConfig", () => {
  it("接受合法的 PBKDF2 参数", () => {
    expect(() =>
      validateKdfConfig({ type: KdfType.PBKDF2_SHA256, iterations: 600_000 }),
    ).not.toThrow();
  });

  it("拒绝越界的 PBKDF2 迭代次数", () => {
    // 导入他人文件时这是不可信输入：迭代次数被压到 1 会让派生密钥形同虚设。
    expect(() => validateKdfConfig({ type: KdfType.PBKDF2_SHA256, iterations: 1 })).toThrow(
      /迭代次数/,
    );
    expect(() => validateKdfConfig({ type: KdfType.PBKDF2_SHA256, iterations: 9_000_000 })).toThrow(
      /迭代次数/,
    );
  });

  it("拒绝非整数迭代次数", () => {
    expect(() => validateKdfConfig({ type: KdfType.PBKDF2_SHA256, iterations: 1.5 })).toThrow();
  });

  it("接受合法的 Argon2 参数", () => {
    expect(() => validateKdfConfig(defaultArgon2Config())).not.toThrow();
  });

  it("拒绝会撑爆内存的 Argon2 参数", () => {
    expect(() =>
      validateKdfConfig({ type: KdfType.Argon2id, iterations: 3, memory: 4096, parallelism: 4 }),
    ).toThrow(/内存/);
  });

  it("拒绝越界的 Argon2 并行度", () => {
    expect(() =>
      validateKdfConfig({ type: KdfType.Argon2id, iterations: 3, memory: 32, parallelism: 99 }),
    ).toThrow(/并行度/);
  });
});

describe("默认配置", () => {
  it("本地新库默认走 PBKDF2 60 万轮", () => {
    const config = defaultKdfConfig();

    expect(config.type).toBe(KdfType.PBKDF2_SHA256);
    expect(config.iterations).toBe(600_000);
  });

  it("默认配置本身合法", () => {
    expect(() => validateKdfConfig(defaultKdfConfig())).not.toThrow();
    expect(() => validateKdfConfig(defaultArgon2Config())).not.toThrow();
  });
});

describe("deriveKdfMaterial", () => {
  it("PBKDF2 产出 32 字节", async () => {
    const material = await deriveKdfMaterial("pw", "salt", {
      type: KdfType.PBKDF2_SHA256,
      iterations: 5_000,
    });

    expect(material.length).toBe(32);
  });

  it("派生前先校验参数，非法参数直接拒绝", async () => {
    await expect(
      deriveKdfMaterial("pw", "salt", { type: KdfType.PBKDF2_SHA256, iterations: 1 }),
    ).rejects.toThrow(/迭代次数/);
  });

  it("Argon2id 产出 32 字节且具确定性", async () => {
    const config = { type: KdfType.Argon2id, iterations: 2, memory: 16, parallelism: 1 } as const;

    const first = await deriveKdfMaterial("pw", "salt", config);
    const second = await deriveKdfMaterial("pw", "salt", config);

    expect(first.length).toBe(32);
    expect(toHex(first)).toBe(toHex(second));
  });
});

describe("Argon2 的 salt 处理", () => {
  /**
   * 互通关键：Bitwarden 传给 Argon2 的是 SHA-256(salt) 而非原始 salt。
   * 这里把该约定钉死——若哪天误改成直传原始 salt，本用例会立刻变红。
   *
   * 注意：该约定源自 Bitwarden 的 Rust SDK，尚未用真实导出文件端到端验证，
   * 待 Phase 3 用 Argon2 加密的导出文件确认。
   */
  it("等价于对原始 salt 先做 SHA-256 再喂给 Argon2", async () => {
    const password = "pw";
    const salt = "user@example.com";

    const ours = await argon2idDerive({
      password,
      salt,
      iterations: 2,
      memoryMiB: 16,
      parallelism: 1,
    });

    const reference = await argon2id({
      password,
      salt: await sha256(toUtf8Bytes(salt)),
      iterations: 2,
      memorySize: 16 * 1024,
      parallelism: 1,
      hashLength: 32,
      outputType: "binary",
    });

    expect(toHex(ours)).toBe(toHex(reference));
  });

  it("不同 salt 得到不同结果", async () => {
    const params = { password: "pw", iterations: 2, memoryMiB: 16, parallelism: 1 };

    const first = await argon2idDerive({ ...params, salt: "a" });
    const second = await argon2idDerive({ ...params, salt: "b" });

    expect(toHex(first)).not.toBe(toHex(second));
  });
});
