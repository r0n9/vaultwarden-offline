import { api, runtime } from "@/platform/browser-api";
import { logger } from "@/platform/logger";

import {
  isMessageEnvelope,
  type MessageCommand,
  type MessageEnvelope,
  type MessageRequest,
  type MessageResponse,
} from "./types";

/** 从任意上下文向背景页发送一条有类型的消息。 */
export async function sendMessage<K extends MessageCommand>(
  command: K,
  ...[payload]: MessageRequest<K> extends undefined ? [] : [MessageRequest<K>]
): Promise<MessageResponse<K> | undefined> {
  const envelope: MessageEnvelope<K> = {
    command,
    payload: payload as MessageRequest<K>,
  };
  return await runtime.sendMessage<MessageResponse<K>>(envelope);
}

export type MessageHandlers = {
  [K in MessageCommand]?: (
    payload: MessageRequest<K>,
    sender: chrome.runtime.MessageSender,
  ) => Promise<MessageResponse<K>> | MessageResponse<K>;
};

/**
 * 在背景页注册消息处理器，返回注销函数。
 *
 * 注意 `sendResponse` 的异步契约：监听器必须**同步返回 true** 才能保持
 * 消息通道开启等待异步结果。返回 Promise 在 Chrome 上不生效。
 */
export function registerHandlers(handlers: MessageHandlers): () => void {
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean => {
    if (!isMessageEnvelope(message)) {
      return false;
    }

    const handler = handlers[message.command] as
      | ((payload: unknown, sender: chrome.runtime.MessageSender) => Promise<unknown> | unknown)
      | undefined;

    if (handler == null) {
      return false;
    }

    void (async () => {
      try {
        sendResponse(await handler(message.payload, sender));
      } catch (e) {
        logger.error(`处理消息 ${message.command} 失败:`, e);
        sendResponse(undefined);
      }
    })();

    return true;
  };

  api().runtime.onMessage.addListener(listener);
  return () => api().runtime.onMessage.removeListener(listener);
}

export * from "./types";
