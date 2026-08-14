import { beforeEach, describe, expect, it } from "vitest";

import { KdfType, type KdfConfig } from "@/core/crypto";
import { createMemoryStorage, type VaultStorage } from "@/core/state/storage.port";
import { CipherType } from "@/core/vault/enums";
import type { CipherView } from "@/core/vault/models";
import { createVault, lock } from "@/core/vault/vault.service";
import { loadVault, newCipherDraft, saveCipher } from "@/core/vault/vault-repository";

import { commitSave, determineSaveAction, handleSaveDetected } from "./save-detection";

const FAST_KDF: KdfConfig = { type: KdfType.PBKDF2_SHA256, iterations: 5_000 };

let storage: VaultStorage;

beforeEach(async () => {
  storage = createMemoryStorage();
  await createVault(storage, "master12", { kdf: FAST_KDF });
});

function login(username: string, uris: string[], password = "pw"): CipherView {
  const draft = newCipherDraft(CipherType.Login);
  draft.name = uris[0] ?? "site";
  draft.login = { username, password, uris: uris.map((uri) => ({ uri })) };
  return draft;
}

describe("determineSaveAction", () => {
  it("同站点同用户名且密码已变 → 更新", () => {
    const ciphers = [login("octocat", ["https://github.com"], "old-pass1")];

    const decision = determineSaveAction(
      ciphers,
      "https://github.com/settings",
      "octocat",
      "new-pass1",
    );

    expect(decision.action).toBe("update");
    expect(decision.cipherId).toBe(ciphers[0]?.id);
  });

  it("同站点同用户名且密码相同 → 不提示（没有可保存的变化）", () => {
    const ciphers = [login("octocat", ["https://github.com"], "same-pass1")];

    expect(determineSaveAction(ciphers, "https://github.com", "octocat", "same-pass1").action).toBe(
      "none",
    );
  });

  it("用户名大小写不同视为同一账号（对齐 Bitwarden）", () => {
    const ciphers = [login("Octocat", ["https://github.com"], "old-pass1")];

    const decision = determineSaveAction(ciphers, "https://github.com", "octocat", "new-pass1");

    expect(decision.action).toBe("update");
  });

  it("同站点但用户名不同 → 保存新条目（多账号场景）", () => {
    const ciphers = [login("octocat", ["https://github.com"])];

    expect(
      determineSaveAction(ciphers, "https://github.com", "someone-else", "pw").action,
    ).toBe("save");
  });

  it("不同站点即使用户名相同 → 保存新条目", () => {
    const ciphers = [login("octocat", ["https://github.com"])];

    expect(determineSaveAction(ciphers, "https://gitlab.com", "octocat", "pw").action).toBe("save");
  });

  it("站点匹配但条目在回收站 → 保存新条目", () => {
    const inTrash = login("octocat", ["https://github.com"]);
    inTrash.deletedDate = "2026-01-01T00:00:00.000Z";

    expect(determineSaveAction([inTrash], "https://github.com", "octocat", "pw").action).toBe(
      "save",
    );
  });

  it("同域不同子域按匹配策略判定", () => {
    const ciphers = [login("octocat", ["https://github.com"], "old-pass1")];

    // 默认 Domain 策略下，子域也算同一站点。
    expect(determineSaveAction(ciphers, "https://gist.github.com", "octocat", "new-pass1").action).toBe(
      "update",
    );
  });
});

describe("handleSaveDetected", () => {
  it("密码库锁定时不打扰用户", async () => {
    await saveCipher(storage, login("octocat", ["https://github.com"]));
    await lock(storage);

    const result = await handleSaveDetected(storage, "https://github.com", "octocat", "pw");

    expect(result.action).toBe("none");
  });

  it("已有同站点同用户名条目且密码已变 → 更新", async () => {
    const existing = await saveCipher(storage, login("octocat", ["https://github.com"], "old-pass1"));

    const result = await handleSaveDetected(storage, "https://github.com/x", "octocat", "new-pass1");

    expect(result).toEqual({ action: "update", cipherId: existing.id });
  });

  it("同用户名且密码未变 → 不提示", async () => {
    await saveCipher(storage, login("octocat", ["https://github.com"], "same-pass1"));

    const result = await handleSaveDetected(storage, "https://github.com", "octocat", "same-pass1");

    expect(result.action).toBe("none");
  });

  it("新站点 → 保存", async () => {
    const result = await handleSaveDetected(
      storage,
      "https://example.com/login",
      "newuser",
      "pw",
    );

    expect(result.action).toBe("save");
  });
});

describe("commitSave", () => {
  it("保存新条目：名称取站点域名、URI 记录当前地址", async () => {
    const result = await commitSave(storage, {
      mode: "save",
      url: "https://example.com/login",
      username: "alice",
      password: "s3cret",
    });

    expect(result.ok).toBe(true);

    const { ciphers } = await loadVault(storage);
    expect(ciphers).toHaveLength(1);

    const saved = ciphers[0]!;
    expect(saved.name).toBe("example.com");
    expect(saved.login?.username).toBe("alice");
    expect(saved.login?.password).toBe("s3cret");
    expect(saved.login?.uris).toEqual([{ uri: "https://example.com/login" }]);
  });

  it("名称带端口（如有）", async () => {
    await commitSave(storage, {
      mode: "save",
      url: "http://192.168.2.4:3000/login",
      username: "a",
      password: "p",
    });
    await commitSave(storage, {
      mode: "save",
      url: "https://gitea.880508.xyz:8443/",
      username: "b",
      password: "p",
    });
    await commitSave(storage, {
      mode: "save",
      url: "https://www.example.com:8080/",
      username: "c",
      password: "p",
    });

    const { ciphers } = await loadVault(storage);
    const names = ciphers.map((c) => c.name).sort();

    expect(names).toEqual(["192.168.2.4:3000", "example.com:8080", "gitea.880508.xyz:8443"]);
  });

  it("去掉 www 前缀", async () => {
    await commitSave(storage, {
      mode: "save",
      url: "https://www.example.com/login",
      username: "a",
      password: "p",
    });

    const { ciphers } = await loadVault(storage);
    expect(ciphers[0]?.name).toBe("example.com");
  });

  it("更新已有条目：保留用户名与 URI，只换密码", async () => {
    const existing = await saveCipher(
      storage,
      login("octocat", ["https://github.com"], "old-pass1"),
    );

    const result = await commitSave(storage, {
      mode: "update",
      url: "https://github.com",
      username: "octocat",
      password: "new-pass1",
      cipherId: existing.id,
    });

    expect(result.ok).toBe(true);

    const { ciphers } = await loadVault(storage);
    expect(ciphers).toHaveLength(1);
    expect(ciphers[0]?.login?.password).toBe("new-pass1");
    expect(ciphers[0]?.login?.username).toBe("octocat");
    expect(ciphers[0]?.login?.uris).toEqual([{ uri: "https://github.com" }]);
  });

  it("更新目标已不存在时退化为新建", async () => {
    const result = await commitSave(storage, {
      mode: "update",
      url: "https://example.com",
      username: "ghost",
      password: "p",
      cipherId: crypto.randomUUID(),
    });

    expect(result.ok).toBe(true);

    const { ciphers } = await loadVault(storage);
    expect(ciphers).toHaveLength(1);
    expect(ciphers[0]?.login?.username).toBe("ghost");
  });

  it("落盘的是密文", async () => {
    await commitSave(storage, {
      mode: "save",
      url: "https://example.com",
      username: "alice",
      password: "super-secret",
    });

    const stored = JSON.stringify(await storage.local.get("vwo:vault:data"));
    expect(stored).not.toContain("super-secret");
  });
});
