/**
 * 页面消息桥接 content script。
 *
 * 这是**唯一**允许直接调用 `chrome.*` 的地方：content script 被注入到宿主页面的
 * 隔离世界中，打包成自包含 IIFE，不引入平台抽象层以把注入体积压到最小
 * （每个页面每帧都会执行，体积直接影响页面加载性能）。
 *
 * Phase 0 只建立通道本身；自动填充逻辑在 Phase 5 接入。
 */

(() => {
  // 避免同一页面重复注入（SPA 路由或多次 executeScript 都会触发）。
  const FLAG = "__vwo_message_handler__";
  const w = window as unknown as Record<string, boolean>;
  if (w[FLAG]) {
    return;
  }
  w[FLAG] = true;

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) {
      return false;
    }

    const command = (message as { command?: unknown }).command;

    if (command === "content:ping") {
      sendResponse({ pong: true, url: window.location.href });
      return true;
    }

    return false;
  });
})();
