/**
 * 剪贴板写入。
 *
 * 自动清除属于 P1：MV3 的 service worker 没有剪贴板 API，可靠的定时清除需要
 * offscreen document 配合，弹窗内的定时器在弹窗关闭时就死了——而复制完随手
 * 关掉弹窗恰恰是最常见的操作。与其做一个几乎不生效的假保护，不如先不做，
 * 留到 P1 用 offscreen document 正确实现。
 */
export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
