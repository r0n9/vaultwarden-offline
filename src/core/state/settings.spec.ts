import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  VaultTimeoutType,
  normalizeSettings,
  shouldTimeoutByInactivity,
} from "./settings";

describe("shouldTimeoutByInactivity", () => {
  const now = 10_000_000;

  it("未达到分钟数不锁定", () => {
    expect(shouldTimeoutByInactivity(15, now - 14 * 60_000, now)).toBe(false);
  });

  it("达到分钟数即锁定", () => {
    expect(shouldTimeoutByInactivity(15, now - 15 * 60_000, now)).toBe(true);
    expect(shouldTimeoutByInactivity(15, now - 60 * 60_000, now)).toBe(true);
  });

  it("非分钟型触发方式不由本函数判定", () => {
    // never / onRestart / onIdle / immediately 各有自己的触发点，
    // 若这里误判为 true，用户选"永不"却仍被锁，是很糟糕的体验 bug。
    for (const timeout of Object.values(VaultTimeoutType)) {
      expect(shouldTimeoutByInactivity(timeout, now - 999 * 60_000, now)).toBe(false);
    }
  });

  it("已解锁却无活动记录时保守判定为超时", () => {
    expect(shouldTimeoutByInactivity(15, undefined, now)).toBe(true);
  });
});

describe("normalizeSettings", () => {
  it("空输入得到默认值", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
  });

  it("保留合法值", () => {
    expect(normalizeSettings({ vaultTimeout: 30, vaultTimeoutAction: "clear" })).toEqual({
      vaultTimeout: 30,
      vaultTimeoutAction: "clear",
    });
  });

  it("保留合法的字符串型触发方式", () => {
    expect(normalizeSettings({ vaultTimeout: VaultTimeoutType.OnIdle }).vaultTimeout).toBe(
      VaultTimeoutType.OnIdle,
    );
  });

  it("剔除非法超时值", () => {
    expect(normalizeSettings({ vaultTimeout: 0 }).vaultTimeout).toBe(DEFAULT_SETTINGS.vaultTimeout);
    expect(normalizeSettings({ vaultTimeout: -1 }).vaultTimeout).toBe(DEFAULT_SETTINGS.vaultTimeout);
    expect(normalizeSettings({ vaultTimeout: Number.NaN }).vaultTimeout).toBe(
      DEFAULT_SETTINGS.vaultTimeout,
    );
    expect(normalizeSettings({ vaultTimeout: "forever" }).vaultTimeout).toBe(
      DEFAULT_SETTINGS.vaultTimeout,
    );
  });

  it("剔除非法动作", () => {
    expect(normalizeSettings({ vaultTimeoutAction: "delete-everything" }).vaultTimeoutAction).toBe(
      "lock",
    );
  });
});
