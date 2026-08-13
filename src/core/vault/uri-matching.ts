import { UriMatchStrategy } from "./enums";
import type { CipherView } from "./models";

/**
 * URI 匹配。
 *
 * 决定"当前站点该显示哪些条目"。策略语义与 Bitwarden 一致，
 * Phase 5 的自动填充会复用同一套判定。
 */

/**
 * 取「二级域+顶级域」。
 *
 * 正确处理 `example.co.uk` 这类两段式后缀需要完整的公共后缀列表（PSL），
 * 那是个上百 KB 的表。这里用一份常见两段后缀的精简表覆盖绝大多数情况——
 * 判断偏严会导致漏匹配（用户手动搜一下即可），偏松则会把 `a.co.uk` 与
 * `b.co.uk` 当成同一站点，那是安全问题，因此宁可偏严。
 */
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "com.br", "com.mx", "com.ar", "com.tr", "com.tw", "com.hk",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp",
  "co.kr", "or.kr", "co.nz", "co.za", "co.in", "co.il",
  "com.sg", "com.my", "com.ph", "com.vn", "com.pk",
]);

export function extractHostname(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed === "") {
    return undefined;
  }

  try {
    // 用户输入的 URI 常常不带协议，补一个再交给 URL 解析。
    const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(normalized).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

export function baseDomain(url: string): string | undefined {
  const hostname = extractHostname(url);
  if (hostname == null) {
    return undefined;
  }

  // IP 地址没有域名层级，整体作为标识。
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return hostname;
  }

  const parts = hostname.split(".");
  if (parts.length <= 2) {
    return hostname;
  }

  const lastTwo = parts.slice(-2).join(".");
  return TWO_PART_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

function hostWithPort(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed === "") {
    return undefined;
  }
  try {
    const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(normalized).host.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/** 单条 URI 与目标地址是否匹配。 */
export function uriMatches(
  cipherUri: string,
  targetUrl: string,
  strategy: UriMatchStrategy = UriMatchStrategy.Domain,
): boolean {
  if (cipherUri.trim() === "" || targetUrl.trim() === "") {
    return false;
  }

  switch (strategy) {
    case UriMatchStrategy.Never:
      return false;

    case UriMatchStrategy.Exact:
      return cipherUri === targetUrl;

    case UriMatchStrategy.StartsWith:
      return targetUrl.startsWith(cipherUri);

    case UriMatchStrategy.Host: {
      const a = hostWithPort(cipherUri);
      const b = hostWithPort(targetUrl);
      return a != null && a === b;
    }

    case UriMatchStrategy.RegularExpression:
      try {
        // 正则来自用户自己的条目，但仍要防一个坏正则把整个列表渲染打断。
        return new RegExp(cipherUri, "i").test(targetUrl);
      } catch {
        return false;
      }

    case UriMatchStrategy.Domain:
    default: {
      const a = baseDomain(cipherUri);
      const b = baseDomain(targetUrl);
      return a != null && a === b;
    }
  }
}

/** 条目是否匹配目标地址（任一 URI 命中即可）。 */
export function cipherMatchesUrl(
  cipher: CipherView,
  targetUrl: string,
  defaultStrategy: UriMatchStrategy = UriMatchStrategy.Domain,
): boolean {
  const uris = cipher.login?.uris;
  if (uris == null || uris.length === 0) {
    return false;
  }

  return uris.some((entry) => {
    if (entry.uri == null) {
      return false;
    }
    return uriMatches(entry.uri, targetUrl, entry.match ?? defaultStrategy);
  });
}
