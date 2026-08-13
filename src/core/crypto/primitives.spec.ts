import { describe, expect, it } from "vitest";

import { fromHex, toHex, toUtf8Bytes } from "./encoding";
import { hkdfExpand, hmacSha256, pbkdf2, sha256 } from "./primitives";

/**
 * 底层原语用**官方测试向量**验证，而不是自己和自己对拍。
 * 自洽的实现可以整体偏离标准而测试全绿——那样导出的库谁也读不了。
 */

describe("sha256", () => {
  it("匹配 FIPS 180-4 的 'abc' 向量", async () => {
    const digest = await sha256(toUtf8Bytes("abc"));
    expect(toHex(digest)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("hmacSha256", () => {
  it("匹配 RFC 4231 测试用例 1", async () => {
    const key = new Uint8Array(20).fill(0x0b);
    const mac = await hmacSha256(toUtf8Bytes("Hi There"), key);
    expect(toHex(mac)).toBe("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  });
});

describe("hkdfExpand", () => {
  // RFC 5869 附录 A 的 SHA-256 用例。我们只实现 Expand 阶段，
  // 因此直接以 RFC 给出的 PRK 为输入，比对 OKM。
  it("匹配 RFC 5869 测试用例 1", async () => {
    const prk = fromHex("077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5");
    const info = fromHex("f0f1f2f3f4f5f6f7f8f9");

    const okm = await hkdfExpand(prk, info, 42);

    expect(toHex(okm)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
  });

  it("匹配 RFC 5869 测试用例 3（info 为空）", async () => {
    const prk = fromHex("19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04");

    const okm = await hkdfExpand(prk, new Uint8Array(0), 42);

    expect(toHex(okm)).toBe(
      "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
    );
  });

  it("输出长度不是哈希长度整数倍时正确截断", async () => {
    const prk = new Uint8Array(32).fill(0x42);
    expect((await hkdfExpand(prk, "enc", 32)).length).toBe(32);
    expect((await hkdfExpand(prk, "enc", 17)).length).toBe(17);
  });

  it("拒绝过短的 prk", async () => {
    await expect(hkdfExpand(new Uint8Array(16), "enc", 32)).rejects.toThrow(/至少需要/);
  });
});

describe("pbkdf2", () => {
  // PBKDF2-HMAC-SHA256 的通行测试向量。
  it("password/salt 迭代 1 轮", async () => {
    const derived = await pbkdf2("password", "salt", 1, 32, "SHA-256");
    expect(toHex(derived)).toBe(
      "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
    );
  });

  it("password/salt 迭代 2 轮", async () => {
    const derived = await pbkdf2("password", "salt", 2, 32, "SHA-256");
    expect(toHex(derived)).toBe(
      "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
    );
  });

  it("password/salt 迭代 4096 轮", async () => {
    const derived = await pbkdf2("password", "salt", 4096, 32, "SHA-256");
    expect(toHex(derived)).toBe(
      "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a",
    );
  });
});
