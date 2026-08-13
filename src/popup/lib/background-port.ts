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
    api().runtime.connect({ name: POPUP_PORT_NAME });
  } catch {
    // 背景页可能正在冷启动；此时连接失败不影响其余功能，超时锁定会退化为
    // 按分钟计时，不必打扰用户。
  }
}
