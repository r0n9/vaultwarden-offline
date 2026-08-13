import { describe, expect, it } from "vitest";

import {
  CHARACTER_SETS,
  defaultPassphraseOptions,
  defaultPasswordOptions,
  defaultUsernameOptions,
  generatePassphrase,
  generatePassword,
  generateUsername,
} from "./index";

const SYMBOL_RE = new RegExp(`[${CHARACTER_SETS.symbols.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}]`);

function countMatching(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

describe("generatePassword", () => {
  it("长度精确", () => {
    for (const length of [4, 8, 20, 64]) {
      expect(generatePassword({ ...defaultPasswordOptions(), length })).toHaveLength(length);
    }
  });

  it("默认选项满足各类最少数量", () => {
    const password = generatePassword(defaultPasswordOptions());

    expect(countMatching(password, /[a-z]/)).toBeGreaterThanOrEqual(1);
    expect(countMatching(password, /[A-Z]/)).toBeGreaterThanOrEqual(1);
    expect(countMatching(password, /[0-9]/)).toBeGreaterThanOrEqual(1);
    expect(countMatching(password, SYMBOL_RE)).toBeGreaterThanOrEqual(1);
  });

  it("关闭某字符集后绝不出现该集字符", () => {
    const password = generatePassword({ ...defaultPasswordOptions(), useSymbols: false });

    expect(password).not.toMatch(SYMBOL_RE);
    expect(countMatching(password, /[a-z]/)).toBeGreaterThanOrEqual(1);
  });

  it("避免歧义字符", () => {
    const password = generatePassword({
      ...defaultPasswordOptions(),
      avoidAmbiguous: true,
    });

    expect(password).not.toMatch(/[0O1lI|`'"]/);
  });

  it("多次生成各不相同（随机性冒烟）", () => {
    const options = defaultPasswordOptions();
    const seen = new Set(Array.from({ length: 20 }, () => generatePassword(options)));

    expect(seen.size).toBe(20);
  });

  it("最少数量总和超过长度时报错", () => {
    expect(() =>
      generatePassword({ ...defaultPasswordOptions(), length: 4, minLowercase: 3, minUppercase: 3 }),
    ).toThrow(/超过密码长度/);
  });

  it("全部字符集关闭时报错", () => {
    expect(() =>
      generatePassword({
        ...defaultPasswordOptions(),
        useLowercase: false,
        useUppercase: false,
        useDigits: false,
        useSymbols: false,
      }),
    ).toThrow(/至少需要启用一种字符集/);
  });

  it("非法长度报错", () => {
    expect(() => generatePassword({ ...defaultPasswordOptions(), length: 3 })).toThrow(/4 与 128/);
  });
});

describe("generatePassphrase", () => {
  it("生成指定词数的短语", () => {
    const phrase = generatePassphrase(defaultPassphraseOptions());

    expect(phrase.split("-")).toHaveLength(5); // 4 词 + 数字后缀
  });

  it("每个词首字母大写", () => {
    const phrase = generatePassphrase({ ...defaultPassphraseOptions(), includeNumber: false });

    for (const word of phrase.split("-")) {
      expect(word).toMatch(/^[A-Z]/);
    }
  });

  it("不使用大写时保持原样", () => {
    const phrase = generatePassphrase({
      ...defaultPassphraseOptions(),
      capitalize: false,
      includeNumber: false,
    });

    expect(phrase).toMatch(/^[a-z]/);
  });

  it("自定义分隔符", () => {
    const phrase = generatePassphrase({
      ...defaultPassphraseOptions(),
      separator: "_",
      includeNumber: false,
    });

    expect(phrase).toMatch(/^[A-Z][a-z]+_[A-Z][a-z]+/);
  });

  it("同一次生成内单词不重复", () => {
    const phrase = generatePassphrase({ ...defaultPassphraseOptions(), wordCount: 6 });

    const words = phrase.split("-").slice(0, 6);
    expect(new Set(words).size).toBe(6);
  });

  it("数字后缀是两位数", () => {
    const phrase = generatePassphrase(defaultPassphraseOptions());
    const suffix = phrase.split("-").at(-1)!;

    expect(suffix).toMatch(/^\d{2}$/);
  });

  it("词数越界报错", () => {
    expect(() => generatePassphrase({ ...defaultPassphraseOptions(), wordCount: 1 })).toThrow(
      /2 与 16/,
    );
  });
});

describe("generateUsername", () => {
  it("生成 形容词+名词+数字 结构", () => {
    const username = generateUsername();

    expect(username).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{1,2}$/);
  });

  it("不带数字时纯单词", () => {
    const username = generateUsername({ includeNumber: false });

    expect(username).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
  });

  it("多次生成各不相同", () => {
    const seen = new Set(Array.from({ length: 20 }, () => generateUsername()));

    expect(seen.size).toBe(20);
  });

  it("默认选项生成结果合法", () => {
    expect(generateUsername(defaultUsernameOptions())).toMatch(/^[A-Za-z]+\d{1,2}$/);
  });
});
