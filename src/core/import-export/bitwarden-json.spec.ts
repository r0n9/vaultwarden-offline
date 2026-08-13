import { describe, expect, it } from "vitest";

import { CipherType } from "@/core/vault/enums";

import { isPasswordProtected, looksLikeBitwardenJson, parseBitwardenJson } from "./bitwarden-json";
import { ImportError, ImportPasswordError } from "./types";

/** 模仿 Vaultwarden 的输出：缺失的可选字段一律是 null 而非省略。 */
const VAULTWARDEN_STYLE = JSON.stringify({
  encrypted: false,
  folders: [{ id: "f1", name: "工作" }],
  items: [
    {
      id: "c1",
      organizationId: null,
      folderId: "f1",
      type: 1,
      reprompt: 0,
      name: "GitHub",
      notes: null,
      favorite: true,
      fields: null,
      login: {
        fido2Credentials: [],
        uris: [{ match: null, uri: "https://github.com" }],
        username: "octocat",
        password: "hunter2",
        totp: null,
      },
      collectionIds: null,
      passwordHistory: null,
      creationDate: "2026-01-01T00:00:00.000Z",
      revisionDate: "2026-02-01T00:00:00.000Z",
    },
  ],
});

describe("格式识别", () => {
  it("识别 Bitwarden JSON", () => {
    expect(looksLikeBitwardenJson(VAULTWARDEN_STYLE)).toBe(true);
  });

  it("不把 CSV 或乱码当成 JSON", () => {
    expect(looksLikeBitwardenJson("name,login_password\na,b")).toBe(false);
    expect(looksLikeBitwardenJson("{ not json")).toBe(false);
    expect(looksLikeBitwardenJson('{"unrelated":1}')).toBe(false);
  });

  it("识别密码保护标记", () => {
    expect(isPasswordProtected(VAULTWARDEN_STYLE)).toBe(false);
    expect(
      isPasswordProtected(JSON.stringify({ encrypted: true, passwordProtected: true, data: "x" })),
    ).toBe(true);
  });
});

describe("明文导出解析", () => {
  it("解析条目与文件夹", async () => {
    const vault = await parseBitwardenJson(VAULTWARDEN_STYLE);

    expect(vault.folders).toEqual([
      { id: "f1", name: "工作", revisionDate: expect.any(String) },
    ]);
    expect(vault.ciphers).toHaveLength(1);

    const cipher = vault.ciphers[0];
    expect(cipher?.name).toBe("GitHub");
    expect(cipher?.type).toBe(CipherType.Login);
    expect(cipher?.favorite).toBe(true);
    expect(cipher?.folderId).toBe("f1");
    expect(cipher?.login?.username).toBe("octocat");
    expect(cipher?.login?.password).toBe("hunter2");
  });

  it("把 null 归一化为字段缺失", async () => {
    // Vaultwarden 输出大量 null。若原样留着，它们会流进加密层，
    // 再导出时变成一堆无意义的 null 字段，且干扰往返比对。
    const cipher = (await parseBitwardenJson(VAULTWARDEN_STYLE)).ciphers[0];

    expect(cipher).not.toHaveProperty("notes");
    expect(cipher).not.toHaveProperty("organizationId");
    expect(cipher).not.toHaveProperty("collectionIds");
    expect(cipher).not.toHaveProperty("fields");
    expect(cipher).not.toHaveProperty("passwordHistory");
    expect(cipher?.login).not.toHaveProperty("totp");
    expect(cipher?.login).not.toHaveProperty("fido2Credentials");
  });

  it("uri 的 match 为 null 时留空，使用全局默认策略", async () => {
    const cipher = (await parseBitwardenJson(VAULTWARDEN_STYLE)).ciphers[0];

    expect(cipher?.login?.uris).toEqual([{ uri: "https://github.com" }]);
  });

  it("缺 id 时自动补 UUID", async () => {
    const text = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [{ type: 1, name: "无 id" }],
    });

    const cipher = (await parseBitwardenJson(text)).ciphers[0];

    expect(cipher?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(cipher?.creationDate).toEqual(expect.any(String));
  });

  it("未知类型回落为登录而不是丢弃条目", async () => {
    const text = JSON.stringify({
      encrypted: false,
      items: [{ type: 99, name: "怪东西" }],
    });

    const cipher = (await parseBitwardenJson(text)).ciphers[0];

    expect(cipher?.type).toBe(CipherType.Login);
    expect(cipher?.name).toBe("怪东西");
  });

  it("非法 JSON 给出明确错误", async () => {
    await expect(parseBitwardenJson("{ broken")).rejects.toThrow(/不是合法的 JSON/);
  });
});

describe("组织导出降级", () => {
  it("集合被降级为文件夹，条目归属得以保留", async () => {
    const text = JSON.stringify({
      encrypted: false,
      collections: [{ id: "col1", name: "共享集合" }],
      items: [{ id: "c1", type: 1, name: "共享条目", collectionIds: ["col1"] }],
    });

    const vault = await parseBitwardenJson(text);

    expect(vault.degradedCollections).toBe(1);
    expect(vault.folders).toHaveLength(1);
    expect(vault.folders[0]?.name).toBe("共享集合");
    // 归属关系转成了 folderId，同时保留原始 collectionIds 以便原样导回。
    expect(vault.ciphers[0]?.folderId).toBe("col1");
    expect(vault.ciphers[0]?.collectionIds).toEqual(["col1"]);
  });

  it("已有 folderId 时不被集合覆盖", async () => {
    const text = JSON.stringify({
      encrypted: false,
      folders: [{ id: "f1", name: "个人" }],
      collections: [{ id: "col1", name: "共享" }],
      items: [{ id: "c1", type: 1, name: "x", folderId: "f1", collectionIds: ["col1"] }],
    });

    expect((await parseBitwardenJson(text)).ciphers[0]?.folderId).toBe("f1");
  });
});

describe("账户密钥加密的导出", () => {
  it("拒绝并说明原因与出路", async () => {
    // 这种文件只有原账户能解，我们不该假装能处理——
    // 报错必须告诉用户该怎么做，而不是甩一句"格式错误"。
    const text = JSON.stringify({
      encrypted: true,
      encKeyValidation_DO_NOT_EDIT: "2.a|b|c",
      folders: [],
      items: [],
    });

    await expect(parseBitwardenJson(text)).rejects.toThrow(/账户密钥加密/);
    await expect(parseBitwardenJson(text)).rejects.toThrow(/重新导出/);
  });
});

describe("密码保护的导出", () => {
  /** 用 Bitwarden 的算法手工造一份密码保护文件，验证我们的解析路径。 */
  async function makeProtected(payload: unknown, password: string, iterations = 5_000) {
    const { deriveVaultExportKey, encryptString, randomBytes, toBase64, KdfType } = await import(
      "@/core/crypto"
    );

    const salt = toBase64(randomBytes(16));
    const kdf = { type: KdfType.PBKDF2_SHA256, iterations } as const;
    const key = await deriveVaultExportKey(password, salt, kdf);

    return JSON.stringify({
      encrypted: true,
      passwordProtected: true,
      salt,
      kdfType: KdfType.PBKDF2_SHA256,
      kdfIterations: iterations,
      encKeyValidation_DO_NOT_EDIT: (await encryptString(crypto.randomUUID(), key)).toString(),
      data: (await encryptString(JSON.stringify(payload), key)).toString(),
    });
  }

  it("口令正确时解出内容", async () => {
    const text = await makeProtected(JSON.parse(VAULTWARDEN_STYLE), "file-password");

    const vault = await parseBitwardenJson(text, "file-password");

    expect(vault.ciphers[0]?.name).toBe("GitHub");
    expect(vault.ciphers[0]?.login?.password).toBe("hunter2");
  });

  it("口令错误时抛 ImportPasswordError 而非泛化错误", async () => {
    // UI 要据此区分「口令错，请重输」和「文件坏了，别白费劲」。
    const text = await makeProtected(JSON.parse(VAULTWARDEN_STYLE), "right");

    await expect(parseBitwardenJson(text, "wrong")).rejects.toThrow(ImportPasswordError);
  });

  it("未提供口令时提示需要口令", async () => {
    const text = await makeProtected({ encrypted: false, items: [] }, "pw");

    await expect(parseBitwardenJson(text)).rejects.toThrow(/受口令保护/);
  });

  it("拒绝被调低到不安全的 KDF 参数", async () => {
    // 这是不可信输入：迭代次数被改成 1，派生密钥就形同虚设。
    // 注意不能用 makeProtected 造这份文件——我们自己的派生路径同样会拒绝该参数，
    // 所以直接手写文件内容，验证的是**解析入口**的把关。
    const text = JSON.stringify({
      encrypted: true,
      passwordProtected: true,
      salt: "c2FsdHNhbHRzYWx0",
      kdfType: 0,
      kdfIterations: 1,
      encKeyValidation_DO_NOT_EDIT: "2.aaa|bbb|ccc",
      data: "2.aaa|bbb|ccc",
    });

    await expect(parseBitwardenJson(text, "pw")).rejects.toThrow(/KDF 参数不可接受/);
  });

  it("缺 salt 或 data 时报结构错误", async () => {
    const text = JSON.stringify({
      encrypted: true,
      passwordProtected: true,
      kdfType: 0,
      kdfIterations: 600_000,
    });

    await expect(parseBitwardenJson(text, "pw")).rejects.toThrow(ImportError);
  });

  it("Argon2id 缺 memory/parallelism 时报错", async () => {
    const text = JSON.stringify({
      encrypted: true,
      passwordProtected: true,
      salt: "c2FsdA==",
      data: "2.a|b|c",
      kdfType: 1,
      kdfIterations: 3,
    });

    await expect(parseBitwardenJson(text, "pw")).rejects.toThrow(/kdfMemory/);
  });
});
