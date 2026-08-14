import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KdfType, type KdfConfig } from "@/core/crypto";
import { createMemoryStorage, type VaultStorage } from "@/core/state/storage.port";
import { CipherType } from "@/core/vault/enums";
import { createVault } from "@/core/vault/vault.service";
import { newCipherDraft, saveCipher } from "@/core/vault/vault-repository";

import { registerSaveTriggers, reportSaveAttempt } from "./save-detection";

const FAST_KDF: KdfConfig = { type: KdfType.PBKDF2_SHA256, iterations: 5_000 };

let storage: VaultStorage;
let sentMessages: { command: string; payload: unknown }[];
let onUpdatedListener: ((tabId: number, changeInfo: { status?: string }) => void) | null;

beforeEach(async () => {
  vi.useFakeTimers();
  sentMessages = [];
  onUpdatedListener = null;

  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { id: "test-extension" },
    tabs: {
      onUpdated: {
        addListener: vi.fn((listener: (tabId: number, info: { status?: string }) => void) => {
          onUpdatedListener = listener;
        }),
      },
      sendMessage: vi.fn(
        async (_tabId: number, message: { command: string; payload: unknown }) => {
          sentMessages.push(message);
        },
      ),
    },
  };

  storage = createMemoryStorage();
  await createVault(storage, "master12", { kdf: FAST_KDF });
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { chrome?: unknown }).chrome;
});

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("保存触发链路（对齐 Bitwarden 上报暂存 + 导航/兜底判定）", () => {
  it("SPA 提交无导航：上报后 1.5 秒兜底判定并推送提示条", async () => {
    reportSaveAttempt(storage, 7, {
      url: "https://example.com/login",
      username: "alice",
      password: "new-pass1",
    });

    await flush();
    expect(sentMessages).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_500);

    expect(sentMessages).toHaveLength(1);
    const sent = sentMessages[0]!;
    expect(sent.command).toBe("save:decided");
    expect(sent.payload).toMatchObject({
      action: "save",
      url: "https://example.com/login",
      username: "alice",
      password: "new-pass1",
    });
  });

  it("导航完成触发判定（tabs.onUpdated complete）", async () => {
    registerSaveTriggers(storage);
    reportSaveAttempt(storage, 7, {
      url: "https://example.com/login",
      username: "alice",
      password: "new-pass1",
    });

    await flush();
    onUpdatedListener?.(7, { status: "complete" });
    await flush();

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.command).toBe("save:decided");
  });

  it("同用户名密码未变 → none，不推送", async () => {
    await saveCipher(
      storage,
      (() => {
        const draft = newCipherDraft(CipherType.Login);
        draft.name = "example.com";
        draft.login = {
          username: "alice",
          password: "same-pass1",
          uris: [{ uri: "https://example.com/login" }],
        };
        return draft;
      })(),
    );

    reportSaveAttempt(storage, 7, {
      url: "https://example.com/login",
      username: "alice",
      password: "same-pass1",
    });

    await vi.advanceTimersByTimeAsync(1_500);

    expect(sentMessages).toHaveLength(0);
  });

  it("判定执行后暂存清除：后续导航不再重复推送", async () => {
    reportSaveAttempt(storage, 7, {
      url: "https://example.com/login",
      username: "alice",
      password: "new-pass1",
    });

    await vi.advanceTimersByTimeAsync(1_500);
    expect(sentMessages).toHaveLength(1);

    onUpdatedListener?.(7, { status: "complete" });
    await flush();
    expect(sentMessages).toHaveLength(1);
  });

  it("重复上报重置兜底定时器", async () => {
    reportSaveAttempt(storage, 7, {
      url: "https://example.com/login",
      username: "alice",
      password: "old-pass1",
    });
    await vi.advanceTimersByTimeAsync(800);

    reportSaveAttempt(storage, 7, {
      url: "https://example.com/login",
      username: "alice",
      password: "new-pass1",
    });
    await vi.advanceTimersByTimeAsync(800);
    expect(sentMessages).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(700);
    expect(sentMessages).toHaveLength(1);
    expect((sentMessages[0]?.payload as { password: string }).password).toBe("new-pass1");
  });
});
