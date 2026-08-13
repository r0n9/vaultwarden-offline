import { describe, expect, it } from "vitest";

import { EncString } from "./enc-string";
import { EncryptionType } from "./encryption-type";

describe("EncString 解析", () => {
  const iv = "MDEyMzQ1Njc4OWFiY2RlZg==";
  const data = "ZGF0YQ==";
  const mac = "bWFj";

  it("解析 type 2（带 MAC）", () => {
    const parsed = EncString.parse(`2.${iv}|${data}|${mac}`);

    expect(parsed.encryptionType).toBe(EncryptionType.AesCbc256_HmacSha256_B64);
    expect(parsed.iv).toBe(iv);
    expect(parsed.data).toBe(data);
    expect(parsed.mac).toBe(mac);
  });

  it("解析 type 0（无 MAC）", () => {
    const parsed = EncString.parse(`0.${iv}|${data}`);

    expect(parsed.encryptionType).toBe(EncryptionType.AesCbc256_B64);
    expect(parsed.mac).toBeUndefined();
  });

  it("解析无类型前缀的远古格式，按 type 0 处理", () => {
    const parsed = EncString.parse(`${iv}|${data}`);

    expect(parsed.encryptionType).toBe(EncryptionType.AesCbc256_B64);
    expect(parsed.iv).toBe(iv);
    expect(parsed.data).toBe(data);
  });

  it("段数不符时判定为非法", () => {
    // type 2 要求 3 段，这里只给了 2 段。
    expect(EncString.tryParse(`2.${iv}|${data}`)).toBeNull();
    // type 0 要求 2 段，这里给了 3 段。
    expect(EncString.tryParse(`0.${iv}|${data}|${mac}`)).toBeNull();
  });

  it("空值与垃圾输入返回 null", () => {
    expect(EncString.tryParse(null)).toBeNull();
    expect(EncString.tryParse(undefined)).toBeNull();
    expect(EncString.tryParse("")).toBeNull();
    expect(EncString.tryParse("not-an-enc-string")).toBeNull();
    expect(EncString.tryParse("x.abc|def|ghi")).toBeNull();
  });

  it("parse 对非法输入抛异常且不泄漏完整密文", () => {
    const long = `9.${"A".repeat(200)}`;
    expect(() => EncString.parse(long)).toThrow(/不是合法的密文字符串/);
    expect(() => EncString.parse(long)).toThrow(/…/);
  });
});

describe("EncString 序列化", () => {
  it("往返后字符串完全一致", () => {
    const original = "2.MDEyMzQ1Njc4OWFiY2RlZg==|ZGF0YQ==|bWFj";
    expect(EncString.parse(original).toString()).toBe(original);
  });

  it("fromBytes 产出规范形态", () => {
    const encString = EncString.fromBytes(
      EncryptionType.AesCbc256_HmacSha256_B64,
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
    );

    expect(encString.toString()).toBe("2.AQID|BAUG|BwgJ");
    expect(Array.from(encString.ivBytes)).toEqual([1, 2, 3]);
    expect(Array.from(encString.dataBytes)).toEqual([4, 5, 6]);
    expect(Array.from(encString.macBytes as Uint8Array)).toEqual([7, 8, 9]);
  });

  it("JSON 序列化为裸字符串，便于直接落盘", () => {
    const encString = EncString.parse("2.MDEyMzQ1Njc4OWFiY2RlZg==|ZGF0YQ==|bWFj");
    expect(JSON.stringify({ name: encString })).toBe(
      '{"name":"2.MDEyMzQ1Njc4OWFiY2RlZg==|ZGF0YQ==|bWFj"}',
    );
  });
});
