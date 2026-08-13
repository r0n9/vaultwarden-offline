/**
 * 构建编排。
 *
 * 三类入口的产物形态不同，必须分开构建：
 *   - popup      扩展页面，正常 ESM + 代码分割，走 vite.config.ts
 *   - background service worker，必须是**自包含单文件**（SW 无法加载分割出的 chunk）
 *   - content    注入宿主页面，必须是 IIFE 单文件（MV3 content script 不支持 ESM）
 *
 * 用法：
 *   node scripts/build.mjs            # Chrome / Edge / Opera (MV3)
 *   TARGET=firefox node scripts/build.mjs
 */

import { existsSync } from "node:fs";
import { cp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { build } from "vite";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(ROOT, "dist");
const TARGET = process.env.TARGET ?? "chrome";

/** 需要独立打包的 content script（文件名去掉扩展名）。 */
const CONTENT_SCRIPTS = ["content-message-handler", "autofill-collector"];

const sharedResolve = {
  alias: { "@": resolve(ROOT, "src") },
};

async function clean() {
  await rm(DIST, { recursive: true, force: true });
}

async function ensureIcons() {
  if (existsSync(resolve(ROOT, "public/images/icon128.png"))) {
    return;
  }
  await import("./gen-icons.mjs");
}

async function buildPopup() {
  await build({ configFile: resolve(ROOT, "vite.config.ts") });
}

async function buildBackground() {
  await build({
    configFile: false,
    root: ROOT,
    // 关掉 publicDir：静态资源由 copyStaticAssets 统一拷贝一次。
    // 不关的话 Vite 会把整个 public/ 再拷进本次构建的 outDir。
    publicDir: false,
    resolve: sharedResolve,
    build: {
      outDir: DIST,
      emptyOutDir: false,
      target: "chrome110",
      sourcemap: false,
      lib: {
        entry: resolve(ROOT, "src/background/index.ts"),
        formats: ["iife"],
        name: "VaultwardenOfflineBackground",
        fileName: () => "background.js",
      },
    },
  });
}

async function buildContentScripts() {
  for (const name of CONTENT_SCRIPTS) {
    await build({
      configFile: false,
      root: ROOT,
      publicDir: false,
      resolve: sharedResolve,
      build: {
        outDir: resolve(DIST, "content"),
        emptyOutDir: false,
        target: "chrome110",
        sourcemap: false,
        lib: {
          entry: resolve(ROOT, `src/content/${name}.ts`),
          formats: ["iife"],
          name: `VaultwardenOffline_${name.replace(/-/g, "_")}`,
          fileName: () => `${name}.js`,
        },
      },
    });
  }
}

async function copyStaticAssets() {
  await cp(resolve(ROOT, "public"), DIST, {
    recursive: true,
    // macOS 会在目录里散落 .DS_Store，没必要打进扩展包。
    filter: (source) => !source.endsWith(".DS_Store"),
  });
}

/**
 * 写入 manifest：版本号以 package.json 为唯一事实来源，
 * Firefox 的差异在此收敛，避免维护两份 manifest 造成漂移。
 */
async function writeManifest() {
  const pkg = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(resolve(DIST, "manifest.json"), "utf8"));

  manifest.version = pkg.version;

  if (TARGET === "firefox") {
    // Firefox MV3 用事件页而非 service worker。
    delete manifest.background.service_worker;
    manifest.background.scripts = ["background.js"];
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings = {
      gecko: {
        id: "vaultwarden-offline@local",
        strict_min_version: "115.0",
      },
    };
  }

  await writeFile(resolve(DIST, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function verifyOffline() {
  await import("./check-no-network.mjs");
}

async function report() {
  const files = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.push({ path: relative(DIST, full), size: (await stat(full)).size });
      }
    }
  }
  await walk(DIST);

  const total = files.reduce((sum, f) => sum + f.size, 0);
  const js = files
    .filter((f) => f.path.endsWith(".js"))
    .sort((a, b) => b.size - a.size)
    .slice(0, 6);

  console.log(`\n构建目标: ${TARGET}`);
  console.log(`产物: ${files.length} 个文件, 合计 ${(total / 1024).toFixed(1)} KB`);
  for (const f of js) {
    console.log(`  ${f.path.padEnd(40)} ${(f.size / 1024).toFixed(1)} KB`);
  }
  console.log(`\n加载方式: Chrome → chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择 ${DIST}`);
}

await clean();
await ensureIcons();
await buildPopup();
await buildBackground();
await buildContentScripts();
await copyStaticAssets();
await writeManifest();
await verifyOffline();
await report();
