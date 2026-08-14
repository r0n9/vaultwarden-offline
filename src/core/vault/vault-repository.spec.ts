import { beforeEach, describe, expect, it } from "vitest";

import { KdfType, type KdfConfig } from "@/core/crypto";
import { createMemoryStorage, type VaultStorage } from "@/core/state/storage.port";

import { CipherType } from "./enums";
import type { CipherView } from "./models";
import { readVaultData, createVault } from "./vault.service";
import {
  deleteFolder,
  emptyTrash,
  getCipher,
  loadVault,
  newCipherDraft,
  newFolderDraft,
  purgeCipher,
  restoreCipher,
  saveCipher,
  saveFolder,
  softDeleteCipher,
  toggleFavorite,
} from "./vault-repository";
import { filterCiphers, sortCiphers, sortCiphersForUrl } from "./vault-search";

const FAST_KDF: KdfConfig = { type: KdfType.PBKDF2_SHA256, iterations: 5_000 };

let storage: VaultStorage;

beforeEach(async () => {
  storage = createMemoryStorage();
  await createVault(storage, "master12", { kdf: FAST_KDF });
});

async function addLogin(name: string, password = "pw"): Promise<CipherView> {
  const draft = newCipherDraft(CipherType.Login);
  draft.name = name;
  draft.login = { username: `${name}@example.com`, password };
  return await saveCipher(storage, draft);
}

describe("条目增删改", () => {
  it("新增后能读回", async () => {
    const saved = await addLogin("GitHub");

    const loaded = await getCipher(storage, saved.id);

    expect(loaded?.name).toBe("GitHub");
    expect(loaded?.login?.password).toBe("pw");
  });

  it("落盘的是密文", async () => {
    await addLogin("GitHub", "super-secret");

    expect(JSON.stringify(await readVaultData(storage))).not.toContain("super-secret");
  });

  it("更新已有条目而不是追加", async () => {
    const saved = await addLogin("GitHub");

    await saveCipher(storage, { ...saved, name: "GitHub 改" });

    const all = await loadVault(storage);
    expect(all.ciphers).toHaveLength(1);
    expect(all.ciphers[0]?.name).toBe("GitHub 改");
  });

  it("更新会刷新修改时间", async () => {
    const saved = await addLogin("GitHub");

    const updated = await saveCipher(storage, { ...saved, name: "改名" });

    expect(new Date(updated.revisionDate).getTime()).toBeGreaterThanOrEqual(
      new Date(saved.creationDate).getTime(),
    );
  });
});

describe("密码历史", () => {
  it("改密码时自动保留旧值", async () => {
    // 改错了要能找回上一个值，这是密码管理器的基本期待。
    const saved = await addLogin("GitHub", "old-pass1");

    const updated = await saveCipher(storage, {
      ...saved,
      login: { ...saved.login, password: "new-pass1" },
    });

    expect(updated.passwordHistory?.[0]?.password).toBe("old-pass1");
    expect(updated.login?.password).toBe("new-pass1");
  });

  it("密码没变则不产生历史", async () => {
    const saved = await addLogin("GitHub", "same");

    const updated = await saveCipher(storage, { ...saved, name: "只改名字" });

    expect(updated.passwordHistory).toBeUndefined();
  });

  it("历史最多保留 5 条", async () => {
    let current = await addLogin("GitHub", "p0");

    for (let i = 1; i <= 8; i++) {
      current = await saveCipher(storage, {
        ...current,
        login: { ...current.login, password: `p${i}` },
      });
    }

    expect(current.passwordHistory).toHaveLength(5);
    // 最近的排在最前。
    expect(current.passwordHistory?.[0]?.password).toBe("p7");
  });
});

describe("回收站", () => {
  it("软删除后进回收站，数据仍在", async () => {
    const saved = await addLogin("GitHub");

    await softDeleteCipher(storage, saved.id);

    const loaded = await getCipher(storage, saved.id);
    expect(loaded?.deletedDate).toBeTypeOf("string");
    expect(loaded?.login?.password).toBe("pw");
  });

  it("恢复后回到正常列表", async () => {
    const saved = await addLogin("GitHub");
    await softDeleteCipher(storage, saved.id);

    await restoreCipher(storage, saved.id);

    expect((await getCipher(storage, saved.id))?.deletedDate).toBeUndefined();
  });

  it("永久删除不可恢复", async () => {
    const saved = await addLogin("GitHub");

    await purgeCipher(storage, saved.id);

    expect(await getCipher(storage, saved.id)).toBeUndefined();
  });

  it("清空回收站只删已删除的条目", async () => {
    const keep = await addLogin("保留");
    const drop = await addLogin("丢弃");
    await softDeleteCipher(storage, drop.id);

    const removed = await emptyTrash(storage);

    expect(removed).toBe(1);
    expect(await getCipher(storage, keep.id)).toBeDefined();
    expect(await getCipher(storage, drop.id)).toBeUndefined();
  });
});

describe("收藏", () => {
  it("可来回切换", async () => {
    const saved = await addLogin("GitHub");

    await toggleFavorite(storage, saved.id);
    expect((await getCipher(storage, saved.id))?.favorite).toBe(true);

    await toggleFavorite(storage, saved.id);
    expect((await getCipher(storage, saved.id))?.favorite).toBe(false);
  });
});

describe("文件夹", () => {
  it("新增与读取", async () => {
    await saveFolder(storage, newFolderDraft("工作"));

    const { folders } = await loadVault(storage);
    expect(folders.map((f) => f.name)).toEqual(["工作"]);
  });

  it("删除文件夹不会连带删除其中的条目", async () => {
    // 删掉一个分类不该销毁其中的密码——这是很容易做错、且后果不可逆的地方。
    const folder = await saveFolder(storage, newFolderDraft("工作"));
    const cipher = await addLogin("GitHub");
    await saveCipher(storage, { ...cipher, folderId: folder.id });

    const orphaned = await deleteFolder(storage, folder.id);

    expect(orphaned).toBe(1);
    const loaded = await getCipher(storage, cipher.id);
    expect(loaded).toBeDefined();
    expect(loaded?.folderId).toBeUndefined();
  });
});

describe("筛选与排序", () => {
  const base = {
    type: CipherType.Login,
    reprompt: 0,
    creationDate: "2026-01-01T00:00:00.000Z",
    revisionDate: "2026-01-01T00:00:00.000Z",
  } as const;

  const items: CipherView[] = [
    { ...base, id: "1", name: "Zeta", favorite: false, login: { username: "z@x.com" } },
    { ...base, id: "2", name: "Alpha", favorite: true },
    { ...base, id: "3", name: "已删", favorite: false, deletedDate: "2026-02-01T00:00:00.000Z" },
    { ...base, id: "4", name: "Beta", favorite: false, folderId: "f1" },
  ];

  it("默认排除回收站条目", () => {
    expect(filterCiphers(items, {}).map((c) => c.id)).toEqual(["1", "2", "4"]);
  });

  it("回收站视图只看已删除的", () => {
    expect(filterCiphers(items, { trash: true }).map((c) => c.id)).toEqual(["3"]);
  });

  it("按收藏筛选", () => {
    expect(filterCiphers(items, { favoritesOnly: true }).map((c) => c.id)).toEqual(["2"]);
  });

  it("按文件夹筛选，null 表示无文件夹", () => {
    expect(filterCiphers(items, { folderId: "f1" }).map((c) => c.id)).toEqual(["4"]);
    expect(filterCiphers(items, { folderId: null }).map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("搜索覆盖名称与用户名", () => {
    expect(filterCiphers(items, { query: "zeta" }).map((c) => c.id)).toEqual(["1"]);
    expect(filterCiphers(items, { query: "z@x" }).map((c) => c.id)).toEqual(["1"]);
  });

  it("搜索大小写不敏感", () => {
    expect(filterCiphers(items, { query: "ALPHA" }).map((c) => c.id)).toEqual(["2"]);
  });

  it("收藏置顶，其余按名称排序", () => {
    const sorted = sortCiphers(filterCiphers(items, {}));
    expect(sorted.map((c) => c.name)).toEqual(["Alpha", "Beta", "Zeta"]);
  });

  it("收藏优先于名称排序（收藏的条目即使名称靠后也排最前）", () => {
    // 回归：快捷键回退、右键菜单都靠这个顺序取第一条。
    const favoriteLast = { ...items[0]!, favorite: true, name: "Zebra" };
    const plainFirst = { ...items[1]!, favorite: false, name: "Alpha" };
    const plainMiddle = { ...items[3]!, favorite: false, name: "Beta" };

    const sorted = sortCiphers([plainFirst, favoriteLast, plainMiddle]);

    expect(sorted.map((c) => c.name)).toEqual(["Zebra", "Alpha", "Beta"]);
  });

  it("站点匹配排序：域名层级越精确排越前", () => {
    // 用户表述的「三级 > 二级 > 一级」：精确 host > 父域 > 仅注册域相同。
    const url = "https://mail.example.com";
    const exact = {
      ...items[0]!,
      name: "精确（mail.example.com）",
      login: { uris: [{ uri: "https://mail.example.com" }] },
    };
    const parent = {
      ...items[1]!,
      name: "父域（example.com）",
      login: { uris: [{ uri: "https://example.com" }] },
    };
    const baseOnly = {
      ...items[3]!,
      name: "仅注册域（example.org）",
      login: { uris: [{ uri: "https://example.org" }] },
    };

    const sorted = sortCiphersForUrl([parent, baseOnly, exact], url);

    expect(sorted.map((c) => c.name)).toEqual(["精确（mail.example.com）", "父域（example.com）", "仅注册域（example.org）"]);
  });

  it("站点匹配排序：精确匹配优先于收藏", () => {
    // 精度是主键，收藏只是同精度内的次键——否则收藏的父域条目
    // 会把精确匹配挤到第二位，用户最想要的那条反而沉下去。
    const url = "https://mail.example.com";
    const exact = {
      ...items[0]!,
      name: "精确",
      favorite: false,
      login: { uris: [{ uri: "https://mail.example.com" }] },
    };
    const favoritedParent = {
      ...items[1]!,
      name: "父域但收藏",
      favorite: true,
      login: { uris: [{ uri: "https://example.com" }] },
    };

    const sorted = sortCiphersForUrl([favoritedParent, exact], url);

    expect(sorted.map((c) => c.name)).toEqual(["精确", "父域但收藏"]);
  });

  it("站点匹配排序：子域条目排在仅注册域之前", () => {
    const url = "https://mail.example.com";
    const subdomain = {
      ...items[0]!,
      name: "子域（a.mail.example.com）",
      login: { uris: [{ uri: "https://a.mail.example.com" }] },
    };
    const baseOnly = {
      ...items[1]!,
      name: "仅注册域",
      login: { uris: [{ uri: "https://example.org" }] },
    };

    const sorted = sortCiphersForUrl([baseOnly, subdomain], url);

    expect(sorted.map((c) => c.name)).toEqual(["子域（a.mail.example.com）", "仅注册域"]);
  });

  it("站点匹配排序：同精度内按收藏与名称", () => {
    const url = "https://example.com";
    const favorited = {
      ...items[0]!,
      name: "Zebra",
      favorite: true,
      login: { uris: [{ uri: "https://example.com" }] },
    };
    const plain = {
      ...items[1]!,
      name: "Alpha",
      favorite: false,
      login: { uris: [{ uri: "https://example.com" }] },
    };

    const sorted = sortCiphersForUrl([plain, favorited], url);

    expect(sorted.map((c) => c.name)).toEqual(["Zebra", "Alpha"]);
  });
});
