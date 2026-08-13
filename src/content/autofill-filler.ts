import type { FillScript } from "@/core/autofill/fill-script";
import { executeFillScript, type FillResult } from "@/core/autofill/insert-fill";

/**
 * 填充执行脚本。
 *
 * 与采集脚本一样按需注入，只在各帧挂一个全局函数，真正的调用由背景页的
 * 第二次 executeScript 触发。
 */

declare global {
  // eslint-disable-next-line no-var
  var __vwoFillPageFields: ((script: FillScript) => Promise<FillResult>) | undefined;
}

globalThis.__vwoFillPageFields = (script: FillScript) => executeFillScript(script);

export {};
