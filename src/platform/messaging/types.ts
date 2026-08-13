import type { KdfConfig } from "@/core/crypto";
import type { AutofillPageDetails } from "@/core/autofill/models";
import type { Settings } from "@/core/state/settings";
import type { VaultStatus } from "@/core/state/vault-status";

/**
 * 扩展内部消息契约。
 *
 * 每条消息在此登记 request/response 类型，`sendMessage` 与 `registerHandlers`
 * 据此做端到端类型检查——避免背景页和 popup 对同一条消息的字段理解产生分歧。
 */

/**
 * 可能失败的操作统一用它包裹。
 *
 * 消息通道不能传异常，直接吞掉又会让 UI 无法区分"密码错""被节流""库不存在"。
 * 因此把失败也建模成正常返回值。
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string; retryAfterMs?: number };

export const ErrorCode = {
  InvalidMasterPassword: "invalid-master-password",
  Throttled: "throttled",
  VaultLocked: "vault-locked",
  Unexpected: "unexpected",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 解锁态下的概览信息，供 popup 展示。 */
export interface VaultSummary {
  status: VaultStatus;
  cipherCount: number;
  folderCount: number;
  createdAt?: string;
  kdfType?: number;
  kdfIterations?: number;
}

export interface MessageContracts {
  ping: {
    request: undefined;
    response: { pong: true; version: string };
  };
  "vault:getStatus": {
    request: undefined;
    response: { status: VaultStatus };
  };
  "vault:getSummary": {
    request: undefined;
    response: VaultSummary;
  };
  "vault:create": {
    request: { masterPassword: string; kdf?: KdfConfig };
    response: Result<{ status: VaultStatus }>;
  };
  "vault:unlock": {
    request: { masterPassword: string };
    response: Result<{ status: VaultStatus }>;
  };
  "vault:lock": {
    request: undefined;
    response: { status: VaultStatus };
  };
  "vault:verifyPassword": {
    request: { masterPassword: string };
    response: { valid: boolean };
  };
  "vault:clear": {
    request: undefined;
    response: { status: VaultStatus };
  };
  "vault:touch": {
    request: undefined;
    response: { status: VaultStatus };
  };
  "settings:get": {
    request: undefined;
    response: Settings;
  };
  "settings:save": {
    request: Partial<Settings>;
    response: Settings;
  };
  "autofill:collectActiveTab": {
    request: undefined;
    response: AutofillCollectionResult;
  };
}

/** 一次跨帧字段采集的结果。 */
export interface AutofillCollectionResult {
  ok: boolean;
  /** 采集失败时的原因（如页面是 chrome:// 这类受保护地址）。 */
  message?: string;
  url?: string;
  frames: {
    frameId: number;
    details: AutofillPageDetails | null;
  }[];
}

export type MessageCommand = keyof MessageContracts;

export type MessageRequest<K extends MessageCommand> = MessageContracts[K]["request"];
export type MessageResponse<K extends MessageCommand> = MessageContracts[K]["response"];

/** 线上传输的消息信封。 */
export interface MessageEnvelope<K extends MessageCommand = MessageCommand> {
  command: K;
  payload: MessageRequest<K>;
}

export function isMessageEnvelope(value: unknown): value is MessageEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { command?: unknown }).command === "string"
  );
}

/** popup 与背景页之间的长连接名。断开即代表 popup 关闭。 */
export const POPUP_PORT_NAME = "vwo-popup";
