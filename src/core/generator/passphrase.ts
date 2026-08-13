import { randomInt } from "@/core/crypto";

import { WORDS } from "./words";

/**
 * 密码短语生成。
 *
 * 由若干单词拼成——好记且每个词贡献约 10 位熵。安全性取决于词数和词表大小，
 * 与「用多复杂的符号」无关。
 */

export interface PassphraseOptions {
  /** 单词个数，默认 4。 */
  wordCount: number;
  /** 分隔符，默认 "-"。 */
  separator: string;
  /** 每个词首字母大写，默认 true。 */
  capitalize: boolean;
  /** 追加两位数字，默认 true——对抗纯词表的字典攻击。 */
  includeNumber: boolean;
}

export function defaultPassphraseOptions(): PassphraseOptions {
  return {
    wordCount: 4,
    separator: "-",
    capitalize: true,
    includeNumber: true,
  };
}

export function generatePassphrase(options: PassphraseOptions): string {
  if (!Number.isInteger(options.wordCount) || options.wordCount < 2 || options.wordCount > 16) {
    throw new Error(`词数必须在 2 与 16 之间，收到 ${options.wordCount}`);
  }

  // 同一次生成内不重复选词，避免 "apple-apple-apple" 这类凑数的短语。
  const pool = [...WORDS];
  const words: string[] = [];

  for (let i = 0; i < options.wordCount; i++) {
    const index = randomInt(pool.length);
    const word = pool.splice(index, 1)[0]!;
    words.push(options.capitalize ? capitalize(word) : word);
  }

  const numberSuffix = options.includeNumber ? String(randomInt(100)).padStart(2, "0") : "";

  return [...words, numberSuffix].filter(Boolean).join(options.separator);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
