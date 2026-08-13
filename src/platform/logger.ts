/**
 * 分级日志。
 *
 * 生产构建下 debug/info 会被 esbuild 依据 `import.meta.env.PROD` 静态消除，
 * 避免密码库操作细节泄漏到控制台。
 */

const PREFIX = "[vwo]";

function isDev(): boolean {
  return import.meta.env?.DEV === true;
}

export const logger = {
  debug(...args: unknown[]): void {
    if (isDev()) {
      // eslint-disable-next-line no-console
      console.debug(PREFIX, ...args);
    }
  },
  info(...args: unknown[]): void {
    if (isDev()) {
      // eslint-disable-next-line no-console
      console.info(PREFIX, ...args);
    }
  },
  warn(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.warn(PREFIX, ...args);
  },
  error(...args: unknown[]): void {
    // eslint-disable-next-line no-console
    console.error(PREFIX, ...args);
  },
} as const;
