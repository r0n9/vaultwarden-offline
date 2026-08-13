import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  test: {
    // Node 22 自带 WebCrypto 全局对象，加密层无需浏览器环境即可测。
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
