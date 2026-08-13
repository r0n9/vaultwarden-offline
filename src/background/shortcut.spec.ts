import { describe, expect, it } from "vitest";

import { CipherType } from "@/core/vault/enums";
import type { CipherView } from "@/core/vault/models";

import { pickShortcutTarget } from "./shortcut";

function login(id: string, uris: string[]): CipherView {
  return {
    id,
    type: CipherType.Login,
    name: id,
    favorite: false,
    reprompt: 0,
    login: { uris: uris.map((uri) => ({ uri })) },
    creationDate: "2026-01-01T00:00:00.000Z",
    revisionDate: "2026-01-01T00:00:00.000Z",
  };
}

const GITHUB = "https://github.com";

describe("pickShortcutTarget", () => {
  it("上次使用的条目匹配当前站点时用它", () => {
    const lastUsed = login("last", [GITHUB]);
    const matches = [login("match1", [GITHUB])];

    expect(pickShortcutTarget(GITHUB, lastUsed, matches)?.id).toBe("last");
  });

  it("上次使用的条目不匹配当前站点时，绝不使用它", () => {
    // 回归：曾把别的站的密码填进当前页。
    const lastUsed = login("last", ["https://gitlab.com"]);
    const matches = [login("match1", [GITHUB])];

    expect(pickShortcutTarget(GITHUB, lastUsed, matches)?.id).toBe("match1");
  });

  it("无上次使用记录时用匹配列表第一条", () => {
    const matches = [login("match1", [GITHUB]), login("match2", [GITHUB])];

    expect(pickShortcutTarget(GITHUB, undefined, matches)?.id).toBe("match1");
  });

  it("当前站点没有任何匹配条目时不填充（返回 undefined）", () => {
    // 宁可没反应，也不能把别的站的凭据填进来。
    const lastUsed = login("last", ["https://gitlab.com"]);

    expect(pickShortcutTarget(GITHUB, lastUsed, [])).toBeUndefined();
    expect(pickShortcutTarget(GITHUB, undefined, [])).toBeUndefined();
  });

  it("上次使用的条目已从库里删除时不填充它", () => {
    const matches = [login("match1", [GITHUB])];

    expect(pickShortcutTarget(GITHUB, undefined, matches)?.id).toBe("match1");
  });
});
