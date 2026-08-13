import { api } from "@/platform/browser-api";
import { POPUP_PORT_NAME } from "@/platform/messaging/types";

/**
 * 与背景页保持一条长连接。
 *
 * 它本身不传数据，存在的意义是让背景页能感知 popup 何时关闭——
 * MV3 没有提供 popup 关闭事件，端口断开是唯一可靠的信号，
 * "关闭弹窗即锁定"这个选项完全依赖它。
 */
export function connectToBackground(): void {
  try {
    const port = api().runtime.connect({ name: POPUP_PORT_NAME });

    // 背景 service worker 可能已被回收（休眠 30 秒后），此时端口会**立即断开**
    // 并设置 runtime.lastError。若不读取它，Chrome 会在控制台报
    // "Unchecked runtime.lastError: Could not establish connection"。
    // 读取 getter 即消费，这里只吞错误、不做任何处理——连接失败时
    // 超时锁定退化为按分钟计时，其余功能不受影响。
    port.onDisconnect.addListener(() => {
      void api().runtime.lastError;
    });
  } catch {
    // SW 冷启动时 connect 也可能同步抛错，同样忽略。
  }
}
