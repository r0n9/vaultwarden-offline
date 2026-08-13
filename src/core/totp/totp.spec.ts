import { describe, expect, it } from "vitest";

import { base32Decode, generateSteamCode, generateTotp, secondsRemaining } from "./totp";
import { parseOtpauthUri } from "./otpauth";

/**
 * TOTP 用 RFC 6238 附录 B 的官方测试向量验证——自己和自己对拍只能证明自洽，
 * 站点的验证器是按 RFC 实现的，错一位码就对不上。
 */

describe("base32Decode", () => {
  it("RFC 4648 官方向量", () => {
    // 例："foobar" → "MZXW6YTBOI"
    expect(Array.from(base32Decode("MZXW6YTBOI"))).toEqual([
      ..."foobar".split("").map((c) => c.charCodeAt(0)),
    ]);
  });

  it("忽略小写与尾部等号", () => {
    expect(Array.from(base32Decode("mzxw6ytboi=="))).toEqual(
      Array.from(base32Decode("MZXW6YTBOI")),
    );
  });

  it("拒绝非法字符", () => {
    expect(() => base32Decode("ABC1")).toThrow(/非法字符/);
  });
});

describe("generateTotp · RFC 6238 官方向量", () => {
  // 所有用例共享同一个 ASCII secret "12345678901234567890"（20 字节）。
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890" 的 base32

  it("SHA1 · 6 位 · 30 秒周期", async () => {
    const config = { secret, algorithm: "SHA1" as const, digits: 8, period: 30 };

    expect(await generateTotp(config, 59)).toBe("94287082");
    expect(await generateTotp(config, 1111111109)).toBe("07081804");
    expect(await generateTotp(config, 1111111111)).toBe("14050471");
    expect(await generateTotp(config, 1234567890)).toBe("89005924");
    expect(await generateTotp(config, 2000000000)).toBe("69279037");
    expect(await generateTotp(config, 20000000000)).toBe("65353130");
  });

  it("SHA256 · 8 位 · 30 秒周期", async () => {
    // RFC 6238 的 SHA256 用例用的是 32 字节 secret。
    const secret256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====";
    const config = { secret: secret256, algorithm: "SHA256" as const, digits: 8, period: 30 };

    expect(await generateTotp(config, 59)).toBe("46119246");
    expect(await generateTotp(config, 1111111109)).toBe("68084774");
    expect(await generateTotp(config, 1234567890)).toBe("91819424");
  });

  it("SHA512 · 8 位 · 30 秒周期", async () => {
    // RFC 6238 的 SHA512 用例用的是 64 字节 secret。
    const secret512 =
      "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA====";
    const config = { secret: secret512, algorithm: "SHA512" as const, digits: 8, period: 30 };

    expect(await generateTotp(config, 59)).toBe("90693936");
    expect(await generateTotp(config, 1111111109)).toBe("25091201");
    // 此值经独立实现（Node 原生 crypto + RFC 4226 截断）互证一致。
    expect(await generateTotp(config, 1234567890)).toBe("93441116");
  });
});

describe("Steam 代码", () => {
  it("5 字符字母码，只含 Steam 字符表", async () => {
    const code = await generateSteamCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1_600_000_000);

    expect(code).toHaveLength(5);
    expect(code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]+$/);
  });

  it("相同时刻得到相同代码，不同时刻不同", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    expect(await generateSteamCode(secret, 1_600_000_000)).toBe(
      await generateSteamCode(secret, 1_600_000_000),
    );
    expect(await generateSteamCode(secret, 1_600_000_030)).not.toBe(
      await generateSteamCode(secret, 1_600_000_000),
    );
  });
});

describe("parseOtpauthUri", () => {
  it("解析标准 otpauth URI", () => {
    const parsed = parseOtpauthUri(
      "otpauth://totp/GitHub:octocat?secret=GEZDGNBVGY3TQOJQ&issuer=GitHub",
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.label).toBe("GitHub:octocat");
    expect(parsed?.isSteam).toBe(false);
    expect(parsed?.config.secret).toBe("GEZDGNBVGY3TQOJQ");
    expect(parsed?.config.algorithm).toBe("SHA1");
    expect(parsed?.config.digits).toBe(6);
    expect(parsed?.config.period).toBe(30);
  });

  it("解析自定义算法与位数", () => {
    const parsed = parseOtpauthUri(
      "otpauth://totp/X?secret=ABC&algorithm=SHA256&digits=8&period=60",
    );

    expect(parsed?.config.algorithm).toBe("SHA256");
    expect(parsed?.config.digits).toBe(8);
    expect(parsed?.config.period).toBe(60);
  });

  it("解析 Steam 变体 scheme", () => {
    const parsed = parseOtpauthUri("steam://totp/steamuser?secret=GEZDGNBVGY3TQOJQ");

    expect(parsed?.isSteam).toBe(true);
  });

  it("缺失 secret 返回 null", () => {
    expect(parseOtpauthUri("otpauth://totp/X?digits=6")).toBeNull();
  });

  it("非法 scheme 返回 null", () => {
    expect(parseOtpauthUri("https://example.com/")).toBeNull();
    expect(parseOtpauthUri("not a uri")).toBeNull();
    expect(parseOtpauthUri("")).toBeNull();
  });

  it("非法的 algorithm 返回 null", () => {
    expect(
      parseOtpauthUri("otpauth://totp/X?secret=ABC&algorithm=MD5"),
    ).toBeNull();
  });

  it("digits/period 超出合理范围时收敛到边界", () => {
    const parsed = parseOtpauthUri("otpauth://totp/X?secret=ABC&digits=99&period=-5");

    expect(parsed?.config.digits).toBe(10);
    expect(parsed?.config.period).toBe(1);
  });
});

describe("secondsRemaining", () => {
  it("计算当前周期的剩余秒数", () => {
    expect(secondsRemaining(0, 30)).toBe(30);
    expect(secondsRemaining(29, 30)).toBe(1);
    expect(secondsRemaining(30, 30)).toBe(30);
    expect(secondsRemaining(45, 30)).toBe(15);
  });
});
