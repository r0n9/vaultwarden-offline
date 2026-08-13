import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { KdfType, type KdfConfig } from "@/core/crypto";
import { createMemoryStorage, type VaultStorage } from "@/core/state/storage.port";
import { CipherType } from "@/core/vault/enums";
import { createVault, readVaultData } from "@/core/vault/vault.service";
import { loadVault } from "@/core/vault/vault-repository";

import { parseBitwardenCsv, serializeBitwardenCsv } from "./bitwarden-csv";
import { parseBitwardenJson } from "./bitwarden-json";
import { buildExport, readDecryptedVault } from "./export.service";
import { mergeIntoVault, parseImport, probeImport } from "./import.service";
import { ExportFormat, MergeStrategy, type ParsedVault } from "./types";

const FAST_KDF: KdfConfig = { type: KdfType.PBKDF2_SHA256, iterations: 5_000 };

let storage: VaultStorage;

beforeEach(async () => {
  storage = createMemoryStorage();
  await createVault(storage, "local-master-password", { kdf: FAST_KDF });
});

const SAMPLE: ParsedVault = {
  degradedCollections: 0,
  folders: [{ id: "f1", name: "工作", revisionDate: "2026-01-01T00:00:00.000Z" }],
  ciphers: [
    {
      id: "c1",
      type: CipherType.Login,
      name: "GitHub",
      notes: "备注里有\n换行和 , 逗号",
      favorite: true,
      reprompt: 0,
      folderId: "f1",
      login: {
        username: "octocat",
        password: 'p@ss"word',
        totp: "otpauth://totp/GitHub:octocat?secret=ABC",
        uris: [{ uri: "https://github.com" }],
      },
      fields: [{ name: "recovery", value: "code-123", type: 1 }],
      creationDate: "2026-01-01T00:00:00.000Z",
      revisionDate: "2026-02-01T00:00:00.000Z",
    },
    {
      id: "c2",
      type: CipherType.Card,
      name: "信用卡",
      favorite: false,
      reprompt: 0,
      card: { cardholderName: "张三", number: "4111111111111111", code: "123" },
      creationDate: "2026-01-01T00:00:00.000Z",
      revisionDate: "2026-01-01T00:00:00.000Z",
    },
  ],
};

/** 导出格式里文件夹只有 id 与 name，revisionDate 本就不参与往返。 */
function comparableFolders(vault: ParsedVault) {
  return vault.folders.map((folder) => ({ id: folder.id, name: folder.name }));
}

describe("JSON 明文往返", () => {
  it("导入→存储→导出→再导入后内容完全一致", async () => {
    await mergeIntoVault(storage, SAMPLE);

    const exported = await buildExport(storage, ExportFormat.Json);
    const reimported = await parseBitwardenJson(exported.content);

    expect(reimported.ciphers).toEqual(SAMPLE.ciphers);
    expect(comparableFolders(reimported)).toEqual(comparableFolders(SAMPLE));
  });

  it("落盘的是密文，明文不残留", async () => {
    await mergeIntoVault(storage, SAMPLE);

    const stored = JSON.stringify(await readVaultData(storage));

    expect(stored).not.toContain("octocat");
    expect(stored).not.toContain("p@ss");
    expect(stored).not.toContain("4111111111111111");
    expect(stored).not.toContain("GitHub");
  });

  it("导出文件形态与 Bitwarden 一致", async () => {
    await mergeIntoVault(storage, SAMPLE);

    const parsed = JSON.parse((await buildExport(storage, ExportFormat.Json)).content);

    expect(parsed.encrypted).toBe(false);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(Array.isArray(parsed.folders)).toBe(true);
    // 缺失的可选字段写成 null，与 Vaultwarden 的输出习惯一致。
    expect(parsed.items[1].notes).toBeNull();
    expect(parsed.items[1].folderId).toBeNull();
  });
});

describe("JSON 密码保护往返", () => {
  it("加密导出后能用同一口令导回", async () => {
    await mergeIntoVault(storage, SAMPLE);

    const exported = await buildExport(storage, ExportFormat.EncryptedJson, "file-password");
    const reimported = await parseBitwardenJson(exported.content, "file-password");

    expect(reimported.ciphers).toEqual(SAMPLE.ciphers);
  });

  it("加密导出的文件里没有明文", async () => {
    await mergeIntoVault(storage, SAMPLE);

    const exported = await buildExport(storage, ExportFormat.EncryptedJson, "file-password");

    expect(exported.content).not.toContain("octocat");
    expect(exported.content).not.toContain("GitHub");
  });

  it("缺口令时拒绝加密导出", async () => {
    await expect(buildExport(storage, ExportFormat.EncryptedJson)).rejects.toThrow(/文件口令/);
  });

  it("导出文件带齐 Bitwarden 要求的头部字段", async () => {
    const exported = await buildExport(storage, ExportFormat.EncryptedJson, "pw");
    const parsed = JSON.parse(exported.content);

    expect(parsed).toMatchObject({
      encrypted: true,
      passwordProtected: true,
      kdfType: KdfType.PBKDF2_SHA256,
      kdfIterations: 600_000,
    });
    expect(typeof parsed.salt).toBe("string");
    expect(typeof parsed.encKeyValidation_DO_NOT_EDIT).toBe("string");
    expect(typeof parsed.data).toBe("string");
  });
});

describe("CSV 往返", () => {
  it("登录条目的核心字段往返无损", async () => {
    const csv = serializeBitwardenCsv(SAMPLE);
    const parsed = parseBitwardenCsv(csv);

    const login = parsed.ciphers.find((cipher) => cipher.name === "GitHub");
    expect(login?.login?.username).toBe("octocat");
    expect(login?.login?.password).toBe('p@ss"word');
    expect(login?.notes).toBe("备注里有\n换行和 , 逗号");
    expect(login?.login?.uris).toEqual([{ uri: "https://github.com" }]);
    expect(login?.favorite).toBe(true);
  });

  it("文件夹按名称重建", async () => {
    const parsed = parseBitwardenCsv(serializeBitwardenCsv(SAMPLE));

    expect(parsed.folders.map((f) => f.name)).toEqual(["工作"]);
    const login = parsed.ciphers.find((cipher) => cipher.name === "GitHub");
    expect(login?.folderId).toBe(parsed.folders[0]?.id);
  });

  it("自定义字段以 名称: 值 编码并能解析回来", async () => {
    const parsed = parseBitwardenCsv(serializeBitwardenCsv(SAMPLE));
    const login = parsed.ciphers.find((cipher) => cipher.name === "GitHub");

    expect(login?.fields).toEqual([{ type: 0, name: "recovery", value: "code-123" }]);
  });

  it("CSV 是有损的：报告被丢弃的条目数", async () => {
    const withSshKey: ParsedVault = {
      ...SAMPLE,
      ciphers: [
        ...SAMPLE.ciphers,
        {
          id: "c3",
          type: CipherType.SshKey,
          name: "服务器密钥",
          favorite: false,
          reprompt: 0,
          sshKey: { privateKey: "KEY" },
          creationDate: "2026-01-01T00:00:00.000Z",
          revisionDate: "2026-01-01T00:00:00.000Z",
        },
      ],
    };

    await mergeIntoVault(storage, withSshKey);
    const exported = await buildExport(storage, ExportFormat.Csv);

    expect(exported.droppedCount).toBe(1);
    expect(exported.content).not.toContain("服务器密钥");
  });
});

describe("格式探测", () => {
  it("识别明文 JSON 并给出条目数", () => {
    const probe = probeImport(JSON.stringify({ encrypted: false, items: [{}, {}], folders: [{}] }));

    expect(probe.requiresPassword).toBe(false);
    expect(probe.cipherCount).toBe(2);
    expect(probe.folderCount).toBe(1);
  });

  it("识别密码保护 JSON 并标记需要口令", () => {
    const probe = probeImport(
      JSON.stringify({ encrypted: true, passwordProtected: true, data: "2.a|b|c" }),
    );

    expect(probe.requiresPassword).toBe(true);
  });

  it("按扩展名识别 CSV", () => {
    const probe = probeImport("name,login_password\nx,y\n", "export.csv");
    expect(probe.format).toBe("bitwarden-csv");
  });

  it("完全无法识别时报错", () => {
    expect(() => probeImport("这不是任何已知格式", "x.txt")).toThrow(/无法识别/);
  });
});

describe("合并策略", () => {
  it("skip-duplicates：同 id 跳过", async () => {
    await mergeIntoVault(storage, SAMPLE);
    const result = await mergeIntoVault(storage, SAMPLE, MergeStrategy.SkipDuplicates);

    expect(result.skipped).toBe(2);
    expect(result.added).toBe(0);
    expect((await readVaultData(storage)).ciphers).toHaveLength(2);
  });

  it("skip-duplicates：id 不同但类型+名称+用户名相同也跳过", async () => {
    await mergeIntoVault(storage, SAMPLE);

    const renamedIds: ParsedVault = {
      ...SAMPLE,
      folders: [],
      ciphers: SAMPLE.ciphers.map((cipher) => ({ ...cipher, id: crypto.randomUUID() })),
    };
    const result = await mergeIntoVault(storage, renamedIds, MergeStrategy.SkipDuplicates);

    expect(result.skipped).toBe(2);
    expect((await readVaultData(storage)).ciphers).toHaveLength(2);
  });

  it("overwrite：同 id 用新内容覆盖", async () => {
    await mergeIntoVault(storage, SAMPLE);

    const updated: ParsedVault = {
      ...SAMPLE,
      folders: [],
      ciphers: [{ ...SAMPLE.ciphers[0]!, name: "GitHub（改名）" }],
    };
    const result = await mergeIntoVault(storage, updated, MergeStrategy.Overwrite);

    expect(result.updated).toBe(1);
    const vault = await readDecryptedVault(storage);
    expect(vault.ciphers.find((c) => c.id === "c1")?.name).toBe("GitHub（改名）");
    expect(vault.ciphers).toHaveLength(2);
  });

  it("append-all：全部作为新条目并重新分配 id", async () => {
    await mergeIntoVault(storage, SAMPLE);
    const result = await mergeIntoVault(storage, SAMPLE, MergeStrategy.AppendAll);

    expect(result.added).toBe(2);
    const vault = await readDecryptedVault(storage);
    expect(vault.ciphers).toHaveLength(4);
    expect(new Set(vault.ciphers.map((c) => c.id)).size).toBe(4);
  });

  it("append-all 时条目跟着新文件夹走，归属不错乱", async () => {
    await mergeIntoVault(storage, SAMPLE);
    await mergeIntoVault(storage, SAMPLE, MergeStrategy.AppendAll);

    const vault = await readDecryptedVault(storage);
    const folderIds = new Set(vault.folders.map((f) => f.id));

    for (const cipher of vault.ciphers) {
      if (cipher.folderId != null) {
        expect(folderIds.has(cipher.folderId)).toBe(true);
      }
    }
    expect(vault.folders).toHaveLength(2);
  });
});

// --- 真实数据验证 ---------------------------------------------------------
//
// 夹具是真实密码库，已被 .gitignore 排除，因此这些用例在没有夹具的机器上
// 自动跳过——但绝不静默地"假装通过"，缺失时会打印提示。

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function findFixtures(pattern: RegExp): string[] {
  const found: string[] = [];

  for (const dir of [REPO_ROOT, resolve(REPO_ROOT, "test/fixtures/local")]) {
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (pattern.test(name)) {
        found.push(resolve(dir, name));
      }
    }
  }

  return found;
}

const plaintextFixtures = findFixtures(/^(bitwarden|vaultwarden)_export_.*\.json$/i).filter(
  (path) => {
    try {
      return JSON.parse(readFileSync(path, "utf8")).encrypted === false;
    } catch {
      return false;
    }
  },
);

describe.skipIf(plaintextFixtures.length === 0)("真实 Vaultwarden 明文导出", () => {
  const fixturePath = plaintextFixtures[0] as string;

  it("能完整解析", async () => {
    const vault = await parseBitwardenJson(readFileSync(fixturePath, "utf8"));

    expect(vault.ciphers.length).toBeGreaterThan(0);
    // 每个条目都应拿到 id、名称与时间戳，不能有解析漏网。
    for (const cipher of vault.ciphers) {
      expect(cipher.id).toBeTruthy();
      expect(typeof cipher.name).toBe("string");
      expect(cipher.creationDate).toBeTruthy();
    }
  });

  it("整库导入→加密落盘→导出→再导入，逐条完全一致", async () => {
    // 这是本项目最有分量的一条测试：真实规模、真实数据形态下的无损往返。
    // 用 Overwrite 而非默认策略——保真度校验要的是"一条不少"，
    // 内容判重是另一回事，由下面的用例单独覆盖。
    const original = await parseBitwardenJson(readFileSync(fixturePath, "utf8"));

    const merged = await mergeIntoVault(storage, original, MergeStrategy.Overwrite);
    expect(merged.added).toBe(original.ciphers.length);

    const exported = await buildExport(storage, ExportFormat.Json);
    const reimported = await parseBitwardenJson(exported.content);

    expect(reimported.ciphers).toHaveLength(original.ciphers.length);
    expect(reimported.ciphers).toEqual(original.ciphers);
    expect(comparableFolders(reimported)).toEqual(comparableFolders(original));
  });

  it("默认的跳过重复策略不会误删同名不同内容的条目", async () => {
    // 真实库里普遍存在"同一站点的登录页与密码重置页"这类同名同用户名条目，
    // 它们内容不同，必须原样保留。
    const original = await parseBitwardenJson(readFileSync(fixturePath, "utf8"));

    const merged = await mergeIntoVault(storage, original, MergeStrategy.SkipDuplicates);

    // 只有内容逐字段相同的条目才允许被跳过。
    const distinctContents = new Set(
      original.ciphers.map((cipher) => {
        const { id: _id, creationDate: _c, revisionDate: _r, ...content } = cipher;
        return JSON.stringify(content);
      }),
    );
    expect(merged.added).toBe(distinctContents.size);
    expect(merged.added + merged.skipped).toBe(original.ciphers.length);
  });

  it("真实数据加密后不残留任何明文口令", async () => {    const original = await parseBitwardenJson(readFileSync(fixturePath, "utf8"));
    await mergeIntoVault(storage, original);

    const stored = JSON.stringify(await readVaultData(storage));

    // 抽查前 40 条的密码与用户名，确认一个都没漏进明文。
    for (const cipher of original.ciphers.slice(0, 40)) {
      for (const secret of [cipher.login?.password, cipher.login?.username, cipher.name]) {
        if (secret != null && secret.length >= 6) {
          expect(stored).not.toContain(secret);
        }
      }
    }
  });

  it("加密导出同样能无损导回", async () => {
    const original = await parseBitwardenJson(readFileSync(fixturePath, "utf8"));
    await mergeIntoVault(storage, original, MergeStrategy.Overwrite);

    const exported = await buildExport(storage, ExportFormat.EncryptedJson, "backup-password");
    const reimported = await parseBitwardenJson(exported.content, "backup-password");

    expect(reimported.ciphers).toEqual(original.ciphers);
  });

  it("整库解密耗时可接受（每次打开弹窗都要走一遍）", async () => {
    const original = await parseBitwardenJson(readFileSync(fixturePath, "utf8"));
    await mergeIntoVault(storage, original, MergeStrategy.Overwrite);

    const started = performance.now();
    const snapshot = await loadVault(storage);
    const elapsed = performance.now() - started;

    // eslint-disable-next-line no-console
    console.info(`  [性能] 解密 ${snapshot.ciphers.length} 个条目耗时 ${elapsed.toFixed(0)}ms`);

    expect(snapshot.ciphers).toHaveLength(original.ciphers.length);
    // 阈值定得宽松，只用于拦住数量级的性能退化（例如密钥句柄缓存被误删）。
    expect(elapsed).toBeLessThan(5_000);
  });
});

/**
 * 与 Bitwarden **真正互通**的唯一证明：解开由 Bitwarden/Vaultwarden 自己产出的
 * 密码保护文件。我们自产自销的往返只能证明自洽。
 *
 * 放置方式：把网页端导出时选择「Password protected」得到的 JSON 放进
 * test/fixtures/local/，并在同目录放一个同名 .password 文本文件写入口令。
 */
const protectedFixtures = findFixtures(/\.json$/i).filter((path) => {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return raw.encrypted === true && raw.passwordProtected === true;
  } catch {
    return false;
  }
});

describe.skipIf(protectedFixtures.length === 0)("真实 Bitwarden 密码保护导出（互通性验证）", () => {
  it("能用官方文件的口令解开", async () => {
    for (const path of protectedFixtures) {
      const passwordFile = path.replace(/\.json$/i, ".password");
      if (!existsSync(passwordFile)) {
        throw new Error(`缺少口令文件 ${passwordFile}`);
      }

      const vault = await parseImport(
        readFileSync(path, "utf8"),
        readFileSync(passwordFile, "utf8").trim(),
        path,
      );

      expect(vault.ciphers.length).toBeGreaterThan(0);
    }
  });
});

if (plaintextFixtures.length === 0) {
  // eslint-disable-next-line no-console
  console.warn("[提示] 未找到明文导出夹具，真实数据往返用例已跳过。");
}
if (protectedFixtures.length === 0) {
  // eslint-disable-next-line no-console
  console.warn(
    "[提示] 未找到 Bitwarden 密码保护导出夹具，互通性验证已跳过——" +
      "自产自销的往返只能证明自洽，不能证明与 Bitwarden 互通。",
  );
}
