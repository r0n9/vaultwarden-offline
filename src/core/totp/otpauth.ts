import type { TotpAlgorithm, TotpConfig } from "./totp";

/**
 * otpauth:// URI 解析。
 *
 * 标准形态：otpauth://totp/{label}?secret=...&issuer=...&algorithm=...&digits=...&period=...
 * Steam 用的是变体 scheme `steam://`，secret 同样是 base32。
 */

export interface ParsedOtpauth {
  /** 是否 Steam 风格（steam://）。 */
  isSteam: boolean;
  /** 显示用标签（通常是 发行方:账号）。 */
  label: string;
  config: TotpConfig;
}

export function parseOtpauthUri(uri: string): ParsedOtpauth | null {
  if (uri == null || uri === "") {
    return null;
  }

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }

  const isSteam = url.protocol === "steam:";

  // 允许 otpauth://totp/ 或 otpauth://hotp/（热型只取 secret 字段按 TOTP 用）。
  if (!isSteam && url.protocol !== "otpauth:") {
    return null;
  }

  const secret = url.searchParams.get("secret");
  if (secret == null || secret === "") {
    return null;
  }

  const algorithm = normalizeAlgorithm(url.searchParams.get("algorithm"));
  if (algorithm == null) {
    return null;
  }

  const digits = clampInt(url.searchParams.get("digits"), 6, 4, 10);
  const period = clampInt(url.searchParams.get("period"), 30, 1, 300);

  // label 是 pathname 去掉首斜杠后的部分，可能带 URL 编码。
  const label = decodeLabel(url.pathname);

  return {
    isSteam,
    label,
    config: { secret, algorithm, digits, period },
  };
}

function normalizeAlgorithm(raw: string | null): TotpAlgorithm | null {
  if (raw == null) {
    return "SHA1";
  }
  const upper = raw.toUpperCase();
  if (upper === "SHA256") {
    return "SHA256";
  }
  if (upper === "SHA512") {
    return "SHA512";
  }
  return upper === "SHA1" ? "SHA1" : null;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function decodeLabel(pathname: string): string {
  const raw = pathname.replace(/^\//, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
