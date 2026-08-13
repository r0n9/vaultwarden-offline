import type { CipherView } from "@/core/vault/models";
import { cipherMatchesUrl } from "@/core/vault/uri-matching";

/**
 * 决定快捷键 Ctrl+Shift+L 该填哪条。
 *
 * 规则：上次使用的条目**必须匹配当前站点**才用它——自动触发的填充没有用户
 * 确认，把别的站的密码填进当前页，正是钓鱼页面想要的结果。
 * 不匹配（或没有记录）时回退到当前站点匹配列表的第一条（收藏优先）。
 */
export function pickShortcutTarget(
  url: string,
  lastUsed: CipherView | undefined,
  siteMatches: CipherView[],
): CipherView | undefined {
  if (lastUsed != null && cipherMatchesUrl(lastUsed, url)) {
    return lastUsed;
  }
  return siteMatches[0];
}
