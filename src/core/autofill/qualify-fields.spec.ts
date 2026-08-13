import { describe, expect, it } from "vitest";

import { buildCardFillScript, buildIdentityFillScript } from "./fill-script";
import type { AutofillField, AutofillPageDetails } from "./models";
import { qualifyCardFields, qualifyIdentityFields, qualifyLoginFields } from "./qualify-fields";

let counter = 0;

function field(overrides: Partial<AutofillField> = {}): AutofillField {
  const n = counter++;
  return {
    opid: `__${n}`,
    elementNumber: n,
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

function page(fields: AutofillField[]): AutofillPageDetails {
  return {
    title: "",
    url: "https://example.com",
    documentUrl: "https://example.com",
    forms: {},
    fields,
    collectedTimestamp: 0,
  };
}

/** 每个用例独立编号，避免 opid 冲突。 */
function scene(build: () => AutofillField[]): AutofillPageDetails {
  counter = 0;
  return page(build());
}

describe("登录字段：三级判定策略", () => {
  it("第 1 级：autocomplete 优先于一切", () => {
    // 即便另一个字段的 name 更像用户名，站点自己声明的才算数。
    const details = scene(() => [
      field({ htmlName: "username" }),
      field({ htmlName: "obscure_field", autoCompleteType: "username" }),
      field({ type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("obscure_field");
  });

  it("第 2 级：关键词，按表中优先级取最高", () => {
    const details = scene(() => [
      field({ htmlName: "login" }),
      field({ htmlName: "username" }),
      field({ type: "password" }),
    ]);

    // USERNAME_FIELD_NAMES 里 "username" 排在 "login" 之前。
    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("username");
  });

  it("第 3 级：都认不出时退回密码框上方最近的文本框", () => {
    const details = scene(() => [
      field({ htmlName: "field_a" }),
      field({ htmlName: "field_b" }),
      field({ type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("field_b");
  });

  it("邮箱类关键词也算用户名", () => {
    const details = scene(() => [
      field({ htmlName: "e-mail", type: "email" }),
      field({ type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("e-mail");
  });

  it("从标签文字识别用户名", () => {
    const details = scene(() => [
      field({ htmlName: "f1", "label-tag": "username" }),
      field({ type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("f1");
  });
});

describe("登录字段：排除规则", () => {
  it("搜索框绝不会被当成用户名", () => {
    // 把凭据填进站内搜索框，等于直接送进对方的搜索日志。
    const details = scene(() => [
      field({ htmlName: "search" }),
      field({ type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField).toBeUndefined();
  });

  it("type=search 同样排除", () => {
    const details = scene(() => [field({ type: "search" }), field({ type: "password" })]);

    expect(qualifyLoginFields(details).usernameField).toBeUndefined();
  });

  it("captcha 与 forgot 字段被整体忽略", () => {
    const details = scene(() => [
      field({ htmlName: "captcha_input" }),
      field({ htmlName: "real_user" }),
      field({ type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("real_user");
  });

  it("密保提示框不会被当成密码框", () => {
    const details = scene(() => [
      field({ type: "password", htmlName: "password" }),
      field({ type: "password", htmlName: "password_hint" }),
    ]);

    expect(qualifyLoginFields(details).passwordFields.map((f) => f.htmlName)).toEqual(["password"]);
  });

  it("不可见与只读字段不参与判定", () => {
    const details = scene(() => [
      field({ htmlName: "username", viewable: false }),
      field({ htmlName: "backup_user" }),
      field({ type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("backup_user");
  });
});

describe("一次性验证码字段", () => {
  it("autocomplete=one-time-code 直接命中", () => {
    const details = scene(() => [
      field({ htmlName: "user" }),
      field({ type: "password" }),
      field({ htmlName: "x", autoCompleteType: "one-time-code" }),
    ]);

    expect(qualifyLoginFields(details).totpField?.htmlName).toBe("x");
  });

  it("明确的关键词命中", () => {
    const details = scene(() => [
      field({ htmlName: "user" }),
      field({ type: "password" }),
      field({ htmlName: "totp" }),
    ]);

    expect(qualifyLoginFields(details).totpField?.htmlName).toBe("totp");
  });

  it("含混的词只在字段足够短时才采信", () => {
    // "code" 也可能是优惠码；验证码框通常有很短的长度限制。
    const short = scene(() => [
      field({ type: "password" }),
      field({ htmlName: "code", maxLength: 6 }),
    ]);
    expect(qualifyLoginFields(short).totpField?.htmlName).toBe("code");

    const long = scene(() => [
      field({ type: "password" }),
      field({ htmlName: "code", maxLength: 50 }),
    ]);
    expect(qualifyLoginFields(long).totpField).toBeUndefined();
  });

  it("用户名框不会被同时当成验证码框", () => {
    const details = scene(() => [field({ htmlName: "username" }), field({ type: "password" })]);

    expect(qualifyLoginFields(details).totpField).toBeUndefined();
  });
});

describe("银行卡字段", () => {
  function checkoutPage() {
    return scene(() => [
      field({ htmlName: "cc-name", autoCompleteType: "cc-name" }),
      field({ htmlName: "cardnumber", autoCompleteType: "cc-number" }),
      field({ htmlName: "cc-exp-month", autoCompleteType: "cc-exp-month" }),
      field({ htmlName: "cc-exp-year", autoCompleteType: "cc-exp-year" }),
      field({ htmlName: "cvc", autoCompleteType: "cc-csc" }),
    ]);
  }

  it("按 autocomplete 识别全部字段", () => {
    const fields = qualifyCardFields(checkoutPage());

    expect(fields.cardholderName?.htmlName).toBe("cc-name");
    expect(fields.number?.htmlName).toBe("cardnumber");
    expect(fields.expMonth?.htmlName).toBe("cc-exp-month");
    expect(fields.expYear?.htmlName).toBe("cc-exp-year");
    expect(fields.code?.htmlName).toBe("cvc");
  });

  it("没有 autocomplete 时靠名称子串识别", () => {
    const details = scene(() => [
      field({ htmlName: "billing_card_number" }),
      field({ htmlName: "billing_cvv" }),
    ]);

    const fields = qualifyCardFields(details);
    expect(fields.number?.htmlName).toBe("billing_card_number");
    expect(fields.code?.htmlName).toBe("billing_cvv");
  });

  it("同一个字段不会被两种角色重复认领", () => {
    // CARD_HOLDER 词表里有个很宽泛的 "name"，若不排除已认领字段，
    // 卡号框可能被姓名规则抢走。
    const fields = qualifyCardFields(checkoutPage());

    const claimed = [fields.cardholderName, fields.number, fields.code, fields.expMonth];
    expect(new Set(claimed.map((f) => f?.opid)).size).toBe(claimed.length);
  });

  it("月年合并框只在没有独立月/年框时才认", () => {
    const combined = scene(() => [field({ htmlName: "cc-exp", placeholder: "MM/YY" })]);
    expect(qualifyCardFields(combined).expCombined?.htmlName).toBe("cc-exp");

    expect(qualifyCardFields(checkoutPage()).expCombined).toBeUndefined();
  });

  it("生成脚本：月份补零、年份按长度裁剪", () => {
    const details = scene(() => [
      field({ htmlName: "cc-exp-month", autoCompleteType: "cc-exp-month" }),
      field({ htmlName: "cc-exp-year", autoCompleteType: "cc-exp-year", maxLength: 2 }),
    ]);

    const script = buildCardFillScript(details, { expMonth: "3", expYear: "2029" });
    const values = script.actions
      .filter((action) => action[0] === "fill_by_opid")
      .map((action) => action[2]);

    expect(values).toEqual(["03", "29"]);
  });

  it("生成脚本：下拉框优先选它真的有的选项", () => {
    // 有的站点月份下拉用 "1"，有的用 "01"，填错值等于没填。
    const details = scene(() => [
      field({
        htmlName: "cc-exp-month",
        tagName: "select",
        selectInfo: { options: [["一月", "1"], ["二月", "2"], ["三月", "3"]] },
      }),
    ]);

    const script = buildCardFillScript(details, { expMonth: "03" });
    const value = script.actions.find((action) => action[0] === "fill_by_opid")?.[2];

    expect(value).toBe("3");
  });

  it("生成脚本：合并框按 placeholder 提示的格式拼装", () => {
    const slash = scene(() => [field({ htmlName: "cc-exp", placeholder: "MM/YY" })]);
    expect(
      buildCardFillScript(slash, { expMonth: "3", expYear: "2029" }).actions.find(
        (a) => a[0] === "fill_by_opid",
      )?.[2],
    ).toBe("03/29");

    const dashLong = scene(() => [field({ htmlName: "cc-exp", placeholder: "MM-YYYY" })]);
    expect(
      buildCardFillScript(dashLong, { expMonth: "3", expYear: "2029" }).actions.find(
        (a) => a[0] === "fill_by_opid",
      )?.[2],
    ).toBe("03-2029");
  });
});

describe("身份字段", () => {
  it("按 autocomplete 识别姓名与地址", () => {
    const details = scene(() => [
      field({ htmlName: "fn", autoCompleteType: "given-name" }),
      field({ htmlName: "ln", autoCompleteType: "family-name" }),
      field({ htmlName: "a1", autoCompleteType: "address-line1" }),
      field({ htmlName: "city", autoCompleteType: "address-level2" }),
      field({ htmlName: "zip", autoCompleteType: "postal-code" }),
    ]);

    const fields = qualifyIdentityFields(details);
    expect(fields.firstName?.htmlName).toBe("fn");
    expect(fields.lastName?.htmlName).toBe("ln");
    expect(fields.address1?.htmlName).toBe("a1");
    expect(fields.city?.htmlName).toBe("city");
    expect(fields.postalCode?.htmlName).toBe("zip");
  });

  it("地址行 2 不会被宽泛的 address 规则抢走", () => {
    // 具体的先认领、宽泛的后认领，否则 "address" 会吞掉 "address-line-2"。
    const details = scene(() => [
      field({ htmlName: "address_line_1" }),
      field({ htmlName: "address_line_2" }),
    ]);

    const fields = qualifyIdentityFields(details);
    expect(fields.address1?.htmlName).toBe("address_line_1");
    expect(fields.address2?.htmlName).toBe("address_line_2");
  });

  it("拆不出名/姓时才认整名字段", () => {
    const full = scene(() => [field({ htmlName: "full-name" })]);
    expect(qualifyIdentityFields(full).fullName?.htmlName).toBe("full-name");

    const split = scene(() => [
      field({ htmlName: "first-name" }),
      field({ htmlName: "last-name" }),
      field({ htmlName: "your-name" }),
    ]);
    expect(qualifyIdentityFields(split).fullName).toBeUndefined();
  });

  it("生成脚本：整名字段由名与姓拼接", () => {
    const details = scene(() => [field({ htmlName: "full-name" })]);

    const value = buildIdentityFillScript(details, {
      firstName: "三",
      lastName: "张",
    }).actions.find((action) => action[0] === "fill_by_opid")?.[2];

    expect(value).toBe("三 张");
  });

  it("同一字段不会被多个角色重复认领", () => {
    const details = scene(() => [
      field({ htmlName: "name" }),
      field({ htmlName: "email" }),
      field({ htmlName: "phone" }),
    ]);

    const fields = qualifyIdentityFields(details);
    const claimed = Object.values(fields).filter(Boolean);

    expect(new Set(claimed.map((f) => f.opid)).size).toBe(claimed.length);
  });

  it("搜索框不参与身份判定", () => {
    const details = scene(() => [field({ htmlName: "search" })]);

    expect(Object.values(qualifyIdentityFields(details)).filter(Boolean)).toHaveLength(0);
  });
});
