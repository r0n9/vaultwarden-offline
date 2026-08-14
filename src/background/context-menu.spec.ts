import { beforeEach, describe, expect, it } from "vitest";

import { KdfType, type KdfConfig } from "@/core/crypto";
import { createMemoryStorage, type VaultStorage } from "@/core/state/storage.port";
import { CipherType } from "@/core/vault/enums";
import { createVault } from "@/core/vault/vault.service";
import { newCipherDraft, saveCipher } from "@/core/vault/vault-repository";

import {
  countMatchingLoginCiphers,
  findAllMatchingLoginCiphers,
  findMatchingLoginCiphers,
} from "./context-menu";

const FAST_KDF: KdfConfig = { type: KdfType.PBKDF2_SHA256, iterations: 5_000 };

let storage: VaultStorage;

beforeEach(async () => {
  storage = createMemoryStorage();
  await createVault(storage, "master12", { kdf: FAST_KDF });
});

async function addLogin(name: string, uri: string): Promise<void> {
  const draft = newCipherDraft(CipherType.Login);
  draft.name = name;
  draft.login = { username: "user", password: "pw", uris: [{ uri }] };
  await saveCipher(storage, draft);
}

describe("匹配函数拆分", () => {
  it("菜单最多取 8 条，角标计数返回全部", async () => {
    for (let i = 0; i < 12; i++) {
      await addLogin(`Site ${i}`, "https://example.com");
    }

    const menu = await findMatchingLoginCiphers(storage, "https://example.com");
    const all = await findAllMatchingLoginCiphers(storage, "https://example.com");
    const count = await countMatchingLoginCiphers(storage, "https://example.com");

    // 这是当初 badge 永远显示 8 的根因：菜单函数被 8 条截断。
    expect(menu).toHaveLength(8);
    expect(all).toHaveLength(12);
    expect(count).toBe(12);
  });

  it("角标计数与匹配精度一致（不止主域名）", async () => {
    await addLogin("Host", "https://example.com");
    await addLogin("Sub", "https://sub.example.com");
    await addLogin("Parent", "https://example.org");
    await addLogin("Other", "https://other.example.org");

    expect(await countMatchingLoginCiphers(storage, "https://sub.example.com/path")).toBe(2);
  });

  it("不匹配或非法地址返回 0", async () => {
    await addLogin("Site", "https://example.com");

    expect(await countMatchingLoginCiphers(storage, "https://unrelated.com")).toBe(0);
    expect(await countMatchingLoginCiphers(storage, undefined)).toBe(0);
    expect(await countMatchingLoginCiphers(storage, "chrome://extensions")).toBe(0);
  });

  it("回收站里的条目不参与匹配", async () => {
    const draft = newCipherDraft(CipherType.Login);
    draft.name = "Trashed";
    draft.login = { username: "user", password: "pw", uris: [{ uri: "https://example.com" }] };
    draft.deletedDate = new Date().toISOString();
    await saveCipher(storage, draft);

    expect(await countMatchingLoginCiphers(storage, "https://example.com")).toBe(0);
  });
});
