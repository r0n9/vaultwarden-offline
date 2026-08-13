/**
 * 零网络静态校验。
 *
 * 扫描的是 **dist 打包产物** 而非 src —— 这样连第三方依赖偷偷带进来的网络调用
 * 也会被拦下，是比审查源码更强的保证。
 *
 * manifest 里的 `connect-src 'none'` 已在运行时封死扩展页面的出网能力，
 * 但 content script 运行在宿主页面的 CSP 之下、不受此约束，因此需要本检查兜底。
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "../dist");

/** 命中即判定构建失败。 */
const FORBIDDEN = [
  { name: "fetch()", pattern: /(?<![\w.$])fetch\s*\(/g },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/g },
  { name: "WebSocket", pattern: /\bWebSocket\b/g },
  { name: "EventSource", pattern: /\bEventSource\b/g },
  { name: "navigator.sendBeacon", pattern: /\bsendBeacon\b/g },
  { name: "importScripts()", pattern: /\bimportScripts\s*\(/g },
  { name: "chrome.downloads", pattern: /\bchrome\.downloads\b/g },
];

/** 命中仅提示，用于人工复核（正则匹配等场景里出现 URL 字面量是合法的）。 */
const URL_LITERAL = /\bhttps?:\/\/[^\s"'`)]+/g;
const URL_ALLOWLIST = [
  "http://www.w3.org/", // SVG / XML 命名空间，非网络请求
  "https://www.w3.org/",
  // Svelte 运行时抛错时在消息里附带的文档链接，纯字符串，从不被请求。
  "https://svelte.dev/e/",
  // src/core/vault/uri-matching.ts 里给无协议 URI 补全前缀用的模板字面量
  // （`https://${trimmed}`），只喂给 URL 构造函数做解析，不发起请求。
  "https://${",
];

async function collectJsFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(full)));
    } else if (entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

const files = await collectJsFiles(DIST);

if (files.length === 0) {
  console.error("✗ dist 下没有找到任何 JS 产物，请先执行构建。");
  process.exit(1);
}

const violations = [];
const warnings = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const shortName = relative(DIST, file);

  for (const { name, pattern } of FORBIDDEN) {
    const matches = source.match(pattern);
    if (matches != null) {
      violations.push({ file: shortName, name, count: matches.length });
    }
  }

  for (const url of source.match(URL_LITERAL) ?? []) {
    if (!URL_ALLOWLIST.some((prefix) => url.startsWith(prefix))) {
      warnings.push({ file: shortName, url });
    }
  }
}

for (const { file, url } of warnings) {
  console.warn(`  ⚠ ${file}: 出现远程 URL 字面量 ${url}`);
}

if (violations.length > 0) {
  console.error("\n✗ 零网络校验未通过：");
  for (const { file, name, count } of violations) {
    console.error(`  ${file}: ${name} ×${count}`);
  }
  console.error("\n本项目承诺不发起任何网络请求。如确有必要，请在本脚本中显式豁免并说明理由。");
  process.exit(1);
}

console.log(`✓ 零网络校验通过（扫描 ${files.length} 个 JS 产物${
  warnings.length > 0 ? `，${warnings.length} 处 URL 字面量待复核` : ""
}）`);
