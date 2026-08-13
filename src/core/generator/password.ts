import { randomInt } from "@/core/crypto";

/**
 * 密码生成。
 *
 * 字符选择全部走无偏随机（拒绝采样），不用 `Math.random()` 取模——
 * 那会引入偏置，对密码生成是实打实的强度损失。
 */

/** 容易混淆的字符（0/O、1/l/I 等），可选剔除。 */
const AMBIGUOUS_CHARACTERS = new Set("0O1lI|`'\"".split(""));

export const CHARACTER_SETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*",
} as const;

export interface PasswordOptions {
  length: number;
  useLowercase: boolean;
  useUppercase: boolean;
  useDigits: boolean;
  useSymbols: boolean;
  /** 每类字符的最少数量（不得超过 length）。 */
  minLowercase?: number;
  minUppercase?: number;
  minDigits?: number;
  minSymbols?: number;
  /** 剔除容易混淆的字符。 */
  avoidAmbiguous?: boolean;
}

export function defaultPasswordOptions(): PasswordOptions {
  return {
    length: 20,
    useLowercase: true,
    useUppercase: true,
    useDigits: true,
    useSymbols: true,
    minLowercase: 1,
    minUppercase: 1,
    minDigits: 1,
    minSymbols: 1,
    avoidAmbiguous: true,
  };
}

function charsetFor(options: PasswordOptions): string {
  const parts: string[] = [];
  if (options.useLowercase) {
    parts.push(CHARACTER_SETS.lowercase);
  }
  if (options.useUppercase) {
    parts.push(CHARACTER_SETS.uppercase);
  }
  if (options.useDigits) {
    parts.push(CHARACTER_SETS.digits);
  }
  if (options.useSymbols) {
    parts.push(CHARACTER_SETS.symbols);
  }
  return parts.join("");
}

export function generatePassword(options: PasswordOptions): string {
  validateOptions(options);

  const pool = charsetFor(options);
  if (pool === "") {
    throw new Error("至少需要启用一种字符集");
  }

  const filteredPool = options.avoidAmbiguous
    ? [...pool].filter((char) => !AMBIGUOUS_CHARACTERS.has(char)).join("")
    : pool;
  const effectivePool = filteredPool === "" ? pool : filteredPool;

  // 先按「最少数量」要求放置各类字符，其余位置从池里随机补足。
  const chars: string[] = [];
  pushMinimum(chars, CHARACTER_SETS.lowercase, options.minLowercase ?? 0, options);
  pushMinimum(chars, CHARACTER_SETS.uppercase, options.minUppercase ?? 0, options);
  pushMinimum(chars, CHARACTER_SETS.digits, options.minDigits ?? 0, options);
  pushMinimum(chars, CHARACTER_SETS.symbols, options.minSymbols ?? 0, options);

  while (chars.length < options.length) {
    chars.push(effectivePool[randomInt(effectivePool.length)]!);
  }

  // 洗牌，避免密码总是以固定字符集开头。
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join("");
}

/** 从指定集合中抽取 n 个字符（不重复），走无偏随机。 */
function pushMinimum(
  target: string[],
  charset: string,
  count: number,
  options: PasswordOptions,
): void {
  const enabled =
    (charset === CHARACTER_SETS.lowercase && options.useLowercase) ||
    (charset === CHARACTER_SETS.uppercase && options.useUppercase) ||
    (charset === CHARACTER_SETS.digits && options.useDigits) ||
    (charset === CHARACTER_SETS.symbols && options.useSymbols);

  if (!enabled) {
    return;
  }

  const pool = options.avoidAmbiguous
    ? [...charset].filter((char) => !AMBIGUOUS_CHARACTERS.has(char)).join("")
    : charset;
  const effective = pool === "" ? charset : pool;

  for (let i = 0; i < count; i++) {
    target.push(effective[randomInt(effective.length)]!);
  }
}

function validateOptions(options: PasswordOptions): void {
  if (!Number.isInteger(options.length) || options.length < 4 || options.length > 128) {
    throw new Error(`密码长度必须在 4 与 128 之间，收到 ${options.length}`);
  }

  const minimums =
    (options.minLowercase ?? 0) +
    (options.minUppercase ?? 0) +
    (options.minDigits ?? 0) +
    (options.minSymbols ?? 0);
  if (minimums > options.length) {
    throw new Error("各类字符的最少数量总和超过密码长度");
  }
}
