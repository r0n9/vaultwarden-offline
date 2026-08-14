import { CipherType } from "./enums";
import type { CipherView } from "./models";
import { baseDomain, extractHostname, hostWithPort } from "./uri-matching";

/**
 * 搜索、排序与展示辅助。
 *
 * 全部在内存里做——库规模是几百到几千条，本地过滤足够快，
 * 引入索引结构反而增加"索引与数据不同步"的出错面。
 */

export const CIPHER_TYPE_LABELS: Record<CipherType, string> = {
  [CipherType.Login]: "登录",
  [CipherType.SecureNote]: "安全笔记",
  [CipherType.Card]: "银行卡",
  [CipherType.Identity]: "身份",
  [CipherType.SshKey]: "SSH 密钥",
  [CipherType.BankAccount]: "银行账户",
  [CipherType.DriversLicense]: "驾照",
  [CipherType.Passport]: "护照",
};

/** 列表里显示在名称下方的次要文字。 */
export function cipherSubtitle(cipher: CipherView): string {
  switch (cipher.type) {
    case CipherType.Login:
      return cipher.login?.username ?? "";
    case CipherType.Card: {
      const number = cipher.card?.number;
      // 只露末四位，列表这种一眼扫过的地方不该出现完整卡号。
      return number == null ? (cipher.card?.brand ?? "") : `•••• ${number.slice(-4)}`;
    }
    case CipherType.Identity:
      return [cipher.identity?.firstName, cipher.identity?.lastName].filter(Boolean).join(" ");
    case CipherType.SshKey:
      return cipher.sshKey?.keyFingerprint ?? "";
    case CipherType.BankAccount:
      return cipher.bankAccount?.bankName ?? "";
    case CipherType.DriversLicense:
      return cipher.driversLicense?.licenseNumber ?? "";
    case CipherType.Passport:
      return cipher.passport?.passportNumber ?? "";
    default:
      return "";
  }
}

/** 条目图标用的首字符。 */
export function cipherInitial(cipher: CipherView): string {
  const source = cipher.name.trim();
  return source === "" ? "?" : source[0]!.toUpperCase();
}

/**
 * 由名称稳定地派生一个色相。
 *
 * 站点图标一律本地生成，绝不请求 icons.bitwarden.net 之类的远程服务——
 * 那会把「用户在哪些站点有账号」这一极敏感信息泄露给第三方，
 * 与本项目的零网络承诺直接冲突。
 */
export function cipherHue(cipher: CipherView): number {
  let hash = 0;
  for (const char of cipher.name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}

export interface VaultFilter {
  query?: string;
  folderId?: string | null;
  type?: CipherType;
  favoritesOnly?: boolean;
  /** true 只看回收站，false 只看正常条目。 */
  trash?: boolean;
}

function searchableText(cipher: CipherView): string {
  return [
    cipher.name,
    cipher.notes ?? "",
    cipher.login?.username ?? "",
    ...(cipher.login?.uris ?? []).map((entry) => entry.uri ?? ""),
    cipher.card?.brand ?? "",
    cipher.identity?.email ?? "",
    ...(cipher.fields ?? []).map((field) => field.name ?? ""),
  ]
    .join(" ")
    .toLowerCase();
}

export function filterCiphers(ciphers: CipherView[], filter: VaultFilter): CipherView[] {
  const query = filter.query?.trim().toLowerCase() ?? "";
  const wantTrash = filter.trash === true;

  return ciphers.filter((cipher) => {
    // 回收站与正常列表互斥：删掉的条目不该混在日常浏览里。
    if ((cipher.deletedDate != null) !== wantTrash) {
      return false;
    }
    if (filter.favoritesOnly === true && !cipher.favorite) {
      return false;
    }
    if (filter.type != null && cipher.type !== filter.type) {
      return false;
    }
    if (filter.folderId !== undefined) {
      const current = cipher.folderId ?? null;
      if (current !== filter.folderId) {
        return false;
      }
    }
    if (query !== "" && !searchableText(cipher).includes(query)) {
      return false;
    }
    return true;
  });
}

/** 按名称排序，收藏优先。 */
export function sortCiphers(ciphers: CipherView[]): CipherView[] {
  return [...ciphers].sort((a, b) => {
    if (a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

/**
 * 针对当前站点的匹配排序：域名层级越精确排越前，同级再按收藏、名称。
 *
 * 以站点 `mail.example.com` 为例，条目 URI 的精度从高到低：
 *   4  host 完全相等          `mail.example.com`      ← 用户此刻就在这个地址
 *   3  条目的 host 是父域      `example.com`           ← 二级，宽一级
 *   2  条目的 host 是子域      `a.mail.example.com`    ← 更具体，但不是当前地址
 *   1  仅注册域相同            `example.org` 与 example.com 同域…（按 baseDomain）
 *
 * 用户表述的「三级 > 二级 > 一级」对应这里的 4 > 3 > 1：
 * 先给用户最可能想要的那条，而不是让名称排序把精确匹配挤到后面。
 */
export function sortCiphersForUrl(ciphers: CipherView[], url: string): CipherView[] {
  const targetHost = extractHostname(url);
  const targetBase = targetHost == null ? undefined : baseDomain(url);
  const targetHostWithPort = hostWithPort(url);

  return [...ciphers].sort((a, b) => {
    const precisionA = matchPrecision(a, targetHost, targetBase, targetHostWithPort);
    const precisionB = matchPrecision(b, targetHost, targetBase, targetHostWithPort);

    if (precisionA !== precisionB) {
      return precisionB - precisionA;
    }
    if (a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

/** 取条目所有 URI 中最高的匹配精度。 */
function matchPrecision(
  cipher: CipherView,
  targetHost: string | undefined,
  targetBase: string | undefined,
  targetHostWithPort: string | undefined,
): number {
  if (targetHost == null || targetBase == null) {
    return 0;
  }

  let best = 0;
  for (const entry of cipher.login?.uris ?? []) {
    if (entry.uri == null) {
      continue;
    }

    const uriHost = extractHostname(entry.uri);
    if (uriHost == null) {
      continue;
    }

    let score = 0;
    const uriHostWithPort = hostWithPort(entry.uri);
    if (uriHostWithPort != null && uriHostWithPort === targetHostWithPort) {
      // 主机 + 端口完全相同（都带相同端口，或都不带端口）。
      score = 5;
    } else if (uriHost === targetHost) {
      // 主机相同但端口不同/一方带端口：example.com:3000 之于 example.com。
      score = 4;
    } else if (targetHost.endsWith(`.${uriHost}`)) {
      // 条目是父域：example.com 之于 mail.example.com。
      score = 3;
    } else if (uriHost.endsWith(`.${targetHost}`)) {
      // 条目是子域：a.mail.example.com 之于 mail.example.com。
      score = 2;
    } else if (baseDomain(entry.uri) === targetBase) {
      // 仅注册域相同（不同子域，如 gist.github.com 之于 github.com）。
      score = 1;
    }

    best = Math.max(best, score);
  }

  return best;
}
