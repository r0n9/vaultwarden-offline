import { describe, expect, it } from "vitest";

import { UriMatchStrategy } from "./enums";
import { baseDomain, cipherMatchesUrl, extractHostname, uriMatches } from "./uri-matching";
import type { CipherView } from "./models";

describe("extractHostname", () => {
  it("解析常规 URL", () => {
    expect(extractHostname("https://github.com/user/repo")).toBe("github.com");
  });

  it("补全缺失的协议", () => {
    // 用户手输的 URI 常常只写域名。
    expect(extractHostname("github.com")).toBe("github.com");
    expect(extractHostname("www.example.com/path")).toBe("www.example.com");
  });

  it("统一转小写", () => {
    expect(extractHostname("HTTPS://GitHub.COM")).toBe("github.com");
  });

  it("垃圾输入返回 undefined", () => {
    expect(extractHostname("")).toBeUndefined();
    expect(extractHostname("   ")).toBeUndefined();
  });
});

describe("baseDomain", () => {
  it("取二级域+顶级域", () => {
    expect(baseDomain("https://mail.google.com")).toBe("google.com");
    expect(baseDomain("https://a.b.c.example.com")).toBe("example.com");
  });

  it("处理两段式后缀", () => {
    // 若不特殊处理，a.co.uk 与 b.co.uk 会被当成同一站点——那是安全问题。
    expect(baseDomain("https://shop.example.co.uk")).toBe("example.co.uk");
    expect(baseDomain("https://www.example.com.cn")).toBe("example.com.cn");
  });

  it("不同公司的同后缀域名不会混淆", () => {
    expect(baseDomain("https://alice.co.uk")).not.toBe(baseDomain("https://bob.co.uk"));
  });

  it("未收录后缀但属注册局组合时按三段处理", () => {
    // 回归：example.com.ua 曾被归一化成 com.ua，导致 alice.com.ua 与
    // bob.com.ua 被当成同一站点——把不同站点合并是安全问题。
    expect(baseDomain("https://shop.example.com.ua")).toBe("example.com.ua");
    expect(baseDomain("https://alice.com.ua")).not.toBe(baseDomain("https://bob.com.ua"));
    expect(baseDomain("https://shop.example.co.id")).toBe("example.co.id");
    expect(baseDomain("https://example.org.pl")).toBe("example.org.pl");
    expect(baseDomain("https://mail.example.edu.cn")).toBe("example.edu.cn");
  });

  it("非注册局段的多段域名按两段处理", () => {
    // a.foo.xyz 中 foo 不是注册局段，注册域就是 foo.xyz。
    expect(baseDomain("https://a.foo.xyz")).toBe("foo.xyz");
    expect(baseDomain("https://a.example.dev")).toBe("example.dev");
  });

  it("IP 地址整体作为标识", () => {
    expect(baseDomain("http://192.168.1.1:8080/admin")).toBe("192.168.1.1");
  });

  it("单段域名原样返回", () => {
    expect(baseDomain("http://localhost:3000")).toBe("localhost");
  });
});

describe("uriMatches", () => {
  const target = "https://mail.google.com/mail/u/0";

  it("Domain：同一基础域即匹配", () => {
    expect(uriMatches("https://google.com", target, UriMatchStrategy.Domain)).toBe(true);
    expect(uriMatches("https://accounts.google.com", target, UriMatchStrategy.Domain)).toBe(true);
    expect(uriMatches("https://google.cn", target, UriMatchStrategy.Domain)).toBe(false);
  });

  it("Host：主机名与端口都要一致", () => {
    expect(uriMatches("https://mail.google.com", target, UriMatchStrategy.Host)).toBe(true);
    expect(uriMatches("https://google.com", target, UriMatchStrategy.Host)).toBe(false);
    expect(uriMatches("https://a.com:8080", "https://a.com:9090", UriMatchStrategy.Host)).toBe(false);
  });

  it("StartsWith：前缀匹配", () => {
    expect(uriMatches("https://mail.google.com/mail", target, UriMatchStrategy.StartsWith)).toBe(true);
    expect(uriMatches("https://mail.google.com/other", target, UriMatchStrategy.StartsWith)).toBe(false);
  });

  it("Exact：完全一致", () => {
    expect(uriMatches(target, target, UriMatchStrategy.Exact)).toBe(true);
    expect(uriMatches(`${target}/`, target, UriMatchStrategy.Exact)).toBe(false);
  });

  it("Never：永不匹配", () => {
    expect(uriMatches(target, target, UriMatchStrategy.Never)).toBe(false);
  });

  it("RegularExpression：按正则判定", () => {
    expect(uriMatches("^https://mail\\.google\\.com", target, UriMatchStrategy.RegularExpression)).toBe(true);
    expect(uriMatches("^https://evil", target, UriMatchStrategy.RegularExpression)).toBe(false);
  });

  it("非法正则不抛异常，只判定为不匹配", () => {
    // 一个坏正则不该把整个列表渲染打断。
    expect(uriMatches("([", target, UriMatchStrategy.RegularExpression)).toBe(false);
  });

  it("空串永不匹配", () => {
    expect(uriMatches("", target)).toBe(false);
    expect(uriMatches(target, "")).toBe(false);
  });
});

describe("cipherMatchesUrl", () => {
  function loginWith(uris: { uri: string; match?: UriMatchStrategy }[]): CipherView {
    return {
      id: "1",
      type: 1,
      name: "测试",
      favorite: false,
      reprompt: 0,
      login: { uris },
      creationDate: "2026-01-01T00:00:00.000Z",
      revisionDate: "2026-01-01T00:00:00.000Z",
    };
  }

  it("任一 URI 命中即算匹配", () => {
    const cipher = loginWith([{ uri: "https://other.com" }, { uri: "https://github.com" }]);

    expect(cipherMatchesUrl(cipher, "https://github.com/foo")).toBe(true);
  });

  it("单条 URI 自带的策略优先于全局默认", () => {
    const cipher = loginWith([{ uri: "https://github.com", match: UriMatchStrategy.Never }]);

    expect(cipherMatchesUrl(cipher, "https://github.com/foo")).toBe(false);
  });

  it("没有 URI 的条目不参与站点匹配", () => {
    const cipher = loginWith([]);
    expect(cipherMatchesUrl(cipher, "https://github.com")).toBe(false);
  });
});
