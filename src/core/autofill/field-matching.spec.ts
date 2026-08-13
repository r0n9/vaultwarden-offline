import { describe, expect, it } from "vitest";

import {
  attributesContain,
  autoCompleteIncludes,
  matchKeywordIndex,
  matchesAnyKeyword,
  propertyMatchesKeyword,
} from "./field-matching";
import type { AutofillField } from "./models";

function field(overrides: Partial<AutofillField> = {}): AutofillField {
  return {
    opid: "__0",
    elementNumber: 0,
    viewable: true,
    htmlID: null,
    htmlName: null,
    htmlClass: null,
    tabindex: null,
    title: null,
    tagName: "input",
    type: "text",
    maxLength: 999,
    ...overrides,
  };
}

describe("propertyMatchesKeyword", () => {
  it("按完整相等匹配，而非子串", () => {
    // 子串匹配会让 "login" 命中 "logindicator"，误判代价很高。
    expect(propertyMatchesKeyword(field({ htmlName: "login" }), "htmlName", "login")).toBe(true);
    expect(propertyMatchesKeyword(field({ htmlName: "logindicator" }), "htmlName", "login")).toBe(
      false,
    );
  });

  it("忽略大小写与首尾空白", () => {
    expect(propertyMatchesKeyword(field({ htmlName: "  LogIn  " }), "htmlName", "login")).toBe(true);
  });

  it("剥离值中的换行", () => {
    // 标签文字从 DOM 取来常带换行。
    expect(propertyMatchesKeyword(field({ "label-tag": "user\nname" }), "label-tag", "username")).toBe(
      true,
    );
  });

  it("regex= 前缀按正则匹配", () => {
    const target = field({ htmlName: "user_login_2" });
    expect(propertyMatchesKeyword(target, "htmlName", "regex=^user_")).toBe(true);
    expect(propertyMatchesKeyword(target, "htmlName", "regex=^admin_")).toBe(false);
  });

  it("非法正则不抛异常", () => {
    expect(propertyMatchesKeyword(field({ htmlName: "x" }), "htmlName", "regex=([")).toBe(false);
  });

  it("csv= 前缀匹配任一值", () => {
    const target = field({ htmlName: "userid" });
    expect(propertyMatchesKeyword(target, "htmlName", "csv=login,userid,account")).toBe(true);
    expect(propertyMatchesKeyword(target, "htmlName", "csv=login,account")).toBe(false);
  });

  it("空值不匹配", () => {
    expect(propertyMatchesKeyword(field({ htmlName: "" }), "htmlName", "login")).toBe(false);
    expect(propertyMatchesKeyword(field(), "htmlName", "login")).toBe(false);
  });
});

describe("matchKeywordIndex", () => {
  it("返回命中词条的下标，即优先级", () => {
    const keywords = ["username", "login", "user"];

    expect(matchKeywordIndex(field({ htmlName: "username" }), keywords)).toBe(0);
    expect(matchKeywordIndex(field({ htmlName: "login" }), keywords)).toBe(1);
    expect(matchKeywordIndex(field({ htmlName: "nothing" }), keywords)).toBe(-1);
  });

  it("跨多个属性来源匹配", () => {
    const keywords = ["username"];

    for (const property of ["htmlID", "htmlName", "label-tag", "label-aria", "placeholder"]) {
      expect(matchKeywordIndex(field({ [property]: "username" }), keywords)).toBe(0);
    }
  });

  it("id= 前缀只比对 id", () => {
    const keywords = ["id=user"];

    expect(matchKeywordIndex(field({ htmlID: "user" }), keywords)).toBe(0);
    // 同样的值出现在 name 上则不该命中。
    expect(matchKeywordIndex(field({ htmlName: "user" }), keywords)).toBe(-1);
  });

  it("label= 前缀比对全部标签来源", () => {
    const keywords = ["label=账号"];

    expect(matchKeywordIndex(field({ "label-tag": "账号" }), keywords)).toBe(0);
    expect(matchKeywordIndex(field({ "label-left": "账号" }), keywords)).toBe(0);
    expect(matchKeywordIndex(field({ htmlName: "账号" }), keywords)).toBe(-1);
  });

  it("matchesAnyKeyword 是命中与否的简写", () => {
    expect(matchesAnyKeyword(field({ htmlName: "login" }), ["login"])).toBe(true);
    expect(matchesAnyKeyword(field({ htmlName: "x" }), ["login"])).toBe(false);
  });
});

describe("attributesContain", () => {
  it("按子串匹配，用于命名发散的卡片与身份字段", () => {
    expect(attributesContain(field({ htmlName: "billing_cc_number_input" }), "cc-number")).toBe(true);
  });

  it("抹平空格、连字符与下划线", () => {
    // 站点写法五花八门，不归一化会漏掉大半。
    for (const name of ["address_line_1", "address-line-1", "addressLine1", "address line 1"]) {
      expect(attributesContain(field({ htmlName: name }), "address-line-1")).toBe(true);
    }
  });

  it("覆盖 autocomplete 与 data-stripe 等属性", () => {
    expect(attributesContain(field({ autoCompleteType: "cc-csc" }), "cc-csc")).toBe(true);
    expect(attributesContain(field({ "data-stripe": "postalCode" }), "postal-code")).toBe(true);
  });

  it("空片段不匹配任何字段", () => {
    expect(attributesContain(field({ htmlName: "anything" }), "")).toBe(false);
  });

  it("匹配必须落在词边界上", () => {
    // 回归：l-name 曾命中 full-name（lname ⊂ fullname）。
    expect(attributesContain(field({ htmlName: "full-name" }), "l-name")).toBe(false);
    // 同是"姓氏"，无分隔写法才能被缩写词条命中——且必须是完整词。
    expect(attributesContain(field({ htmlName: "billing_lname" }), "l-name")).toBe(true);
    expect(attributesContain(field({ htmlName: "billing_my_lname2" }), "l-name")).toBe(true);
    // 夹在词中间的命中不算（"lname" 在这里是别的词的一部分）。
    expect(attributesContain(field({ htmlName: "lname_extra" }), "l-name")).toBe(true);
    expect(attributesContain(field({ htmlName: "blname" }), "l-name")).toBe(false);
  });

  it("过短的词条只在整值相等时命中", () => {
    // 回归：cc 曾命中 cc-exp / cc-month / cc-name。
    expect(attributesContain(field({ htmlName: "cc-exp-month" }), "cc")).toBe(false);
    expect(attributesContain(field({ htmlName: "cc" }), "cc")).toBe(true);
  });
});

describe("autoCompleteIncludes", () => {
  it("识别单一词元", () => {
    expect(autoCompleteIncludes(field({ autoCompleteType: "username" }), "username")).toBe(true);
  });

  it("识别复合值中的词元", () => {
    // autocomplete 允许 "section-billing shipping cc-number" 这样的复合写法。
    const target = field({ autoCompleteType: "section-billing shipping cc-number" });

    expect(autoCompleteIncludes(target, "cc-number")).toBe(true);
    expect(autoCompleteIncludes(target, "shipping")).toBe(true);
    expect(autoCompleteIncludes(target, "cc-name")).toBe(false);
  });

  it("不做子串匹配", () => {
    // "cc-exp" 不应命中 "cc-exp-month"，否则月份框会被当成合并有效期框。
    expect(autoCompleteIncludes(field({ autoCompleteType: "cc-exp-month" }), "cc-exp")).toBe(false);
  });

  it("缺失时返回 false", () => {
    expect(autoCompleteIncludes(field(), "username")).toBe(false);
  });
});
