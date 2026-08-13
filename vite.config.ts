import { resolve } from "node:path";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const root = import.meta.dirname;

/**
 * Popup(扩展页面) 构建配置。
 *
 * 其余入口(background service worker / content scripts)由 scripts/build.mjs
 * 以 Vite JS API 单独构建 —— 它们必须打成自包含的单文件，与本配置的产物形态不同。
 */
export default defineConfig({
  root: resolve(root, "src/popup"),
  // 扩展页面必须用相对路径：默认的 base "/" 会让 index.html 里的
  // <script src="/index.js"> 解析到扩展根目录，而产物实际在 popup/ 下。
  base: "./",
  // 静态资源由 scripts/build.mjs 统一拷贝，避免多次构建互相覆盖 dist。
  publicDir: false,
  plugins: [svelte()],
  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },
  build: {
    outDir: resolve(root, "dist/popup"),
    emptyOutDir: true,
    target: "chrome110",
    sourcemap: false,
    // 关闭 modulepreload polyfill：它会注入一段 `fetch(link.href)` 预加载代码，
    // 既违反零网络承诺，对本地扩展页面也毫无收益（没有网络延迟可省）。
    modulePreload: false,
    // 扩展包体不应含内联 base64 资源以外的隐式请求，阈值调低以便显式管理。
    assetsInlineLimit: 8192,
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
