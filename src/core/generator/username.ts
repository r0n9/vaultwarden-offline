import { randomInt } from "@/core/crypto";

import { ADJECTIVES, WORDS } from "./words";

/**
 * 用户名生成。
 *
 * 单词型：形容词 + 名词 + 数字后缀（如 BrightTiger42），
 * 是注册时「想不出用户名」最常见的兜底。
 */

export interface UsernameOptions {
  /** 是否追加 1~99 的数字后缀。 */
  includeNumber: boolean;
}

export function defaultUsernameOptions(): UsernameOptions {
  return { includeNumber: true };
}

export function generateUsername(options: UsernameOptions = defaultUsernameOptions()): string {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
  const noun = WORDS[randomInt(WORDS.length)]!;
  const number = options.includeNumber ? String(randomInt(99) + 1) : "";

  return `${capitalize(adjective)}${capitalize(noun)}${number}`;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
