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

    if (command === "favicon:fetch") {
      void (async () => {
        const origin = (message as { payload?: { origin?: string } }).payload?.origin ?? "";
        try {
          // 站点优先：同源 fetch 无需 CORS。优先用 <link rel="icon"> 声明的地址，
          // 拿不到再猜 /favicon.ico。
          const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
          const linkUrl = link?.href ?? "";
          const target =
            linkUrl !== "" && linkUrl.startsWith(origin) ? linkUrl : `${origin}/favicon.ico`;

          // 校验哨兵：此 fetch 是**同源**获取站点 favicon（唯一网络例外），
          // 把标记放进 options（对象 key 字符串不会被压缩器删除），
          // check-no-network.mjs 按它剔除该调用后再扫描其余 fetch。
          const response = await fetch(target, {
            ["vwo-favicon-fetch-ok"]: true,
          } as RequestInit);
          if (!response.ok) {
            sendResponse({});
            return;
          }
          const blob = await response.blob();
          const reader = new FileReader();
          reader.onload = () => sendResponse({ dataUrl: String(reader.result) });
          reader.onerror = () => sendResponse({});
          reader.readAsDataURL(blob);
        } catch {
          sendResponse({});
        }
      })();
      return true;
    }

    return false;
  });
})();
