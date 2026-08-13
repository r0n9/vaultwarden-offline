import { collectPageDetails } from "@/core/autofill/collect-page-details";
import { domVisibilityChecker } from "@/core/autofill/dom-visibility";

/**
 * 页面字段采集脚本。
 *
 * 与 content-message-handler 不同，本脚本**不在 manifest 里声明**，而是需要时才由
 * 背景页用 `chrome.scripting.executeScript` 注入。采集逻辑有好几百行，
 * 让它在每个页面每个 iframe 无条件执行，是白白拖慢所有网页的加载。
 *
 * 注入后只挂一个全局函数，真正的调用由第二次 executeScript 触发——
 * 这样能一次拿到所有 iframe 的结果，且不必走消息通道做跨帧聚合。
 */

declare global {
  // eslint-disable-next-line no-var
  var __vwoCollectPageDetails: (() => unknown) | undefined;
}

globalThis.__vwoCollectPageDetails = () =>
  collectPageDetails({ visibility: domVisibilityChecker });

export {};
