import { api, runtime } from "@/platform/browser-api";

/**
 * 视图路由。
 *
 * 导入导出必须在**独立标签页**里做，不能在 popup 里：
 *   - 从 popup 触发文件选择框会导致 popup 关闭，选完文件回来上下文已经没了
 *   - 380px 宽也放不下导入向导
 *
 * 因此 popup 只负责把用户送去标签页，真正的界面在 `?view=import` 下渲染。
 */

export type View = "home" | "import" | "export";

export function currentView(): View {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "import" || view === "export" ? view : "home";
}

/** 是否运行在独立标签页（而非工具栏弹窗）中。 */
export function isStandalone(): boolean {
  return currentView() !== "home";
}

export function openInTab(view: Exclude<View, "home">): void {
  void api().tabs.create({ url: runtime.getURL(`popup/index.html?view=${view}`) });
  // 弹窗此时可以关掉了，用户注意力已经转移到新标签页。
  window.close();
}

/**
 * 触发文件下载。
 *
 * 不用 `chrome.downloads` —— 那个权限没有申请，且零网络校验脚本把它列为禁用项
 * （它能把任意 URL 拉到本地，与"绝不出网"的承诺相冲突）。
 * blob + a[download] 完全在本地完成，不涉及任何请求。
 */
export function downloadText(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // 立刻回收会让下载拿不到数据，留一点余量再释放。
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
