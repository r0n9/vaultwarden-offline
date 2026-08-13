import { describe, expect, it } from "vitest";

import {
  concatBytes,
  fromBase64,
  fromHex,
  fromUtf8Bytes,
  timingSafeEqual,
  toBase64,
  toHex,
  toUtf8Bytes,
} from "./encoding";

describe("编码往返", () => {
  it("UTF-8 往返保留多字节字符", () => {
    const original = "密码库 🔐 Ünïcödé";
    expect(fromUtf8Bytes(toUtf8Bytes(original))).toBe(original);
  });

  it("base64 往返", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("base64 处理超过单次展开上限的大数组", () => {
    // 0x8000 是分块阈值，取两倍多一点确保跨块。
    const bytes = new Uint8Array(0x8000 * 2 + 123);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }
    const restored = fromBase64(toBase64(bytes));
    expect(restored.length).toBe(bytes.length);
    expect(restored[0]).toBe(bytes[0]);
    expect(restored[bytes.length - 1]).toBe(bytes[bytes.length - 1]);
  });

  it("hex 往返", () => {
    expect(toHex(fromHex("00ff42"))).toBe("00ff42");
  });

  it("hex 拒绝奇数长度", () => {
    expect(() => fromHex("abc")).toThrow(/偶数/);
  });
});

describe("concatBytes", () => {
  it("按顺序拼接", () => {
    const result = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5]));
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
  });

  it("空输入得到空数组", () => {
    expect(concatBytes().length).toBe(0);
  });
});

describe("timingSafeEqual", () => {
  it("内容相同返回 true", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it("任一字节不同即返回 false", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    // 首字节不同也必须走完全程（此处只能验证结果，时间特性由实现保证）。
    expect(timingSafeEqual(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("长度不同返回 false", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
