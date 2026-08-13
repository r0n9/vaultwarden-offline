import { describe, expect, it } from "vitest";

import { buildLoginFillScript } from "./fill-script";
import type { AutofillField, AutofillPageDetails } from "./models";
import { qualifyLoginFields } from "./qualify-fields";

function field(overrides: Partial<AutofillField> & { opid: string }): AutofillField {
  return {
    elementNumber: Number.parseInt(overrides.opid.replace("__", ""), 10),
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
    title: "登录",
    url: "https://example.com/login",
    documentUrl: "https://example.com/login",
    forms: {},
    fields,
    collectedTimestamp: 0,
  };
}

describe("登录字段判定", () => {
  it("识别密码框与其上方最近的文本框", () => {
    const details = page([
      field({ opid: "__0", htmlName: "user" }),
      field({ opid: "__1", htmlName: "pass", type: "password" }),
    ]);

    const { usernameField, passwordFields } = qualifyLoginFields(details);

    expect(usernameField?.htmlName).toBe("user");
    expect(passwordFields.map((f) => f.htmlName)).toEqual(["pass"]);
  });

  it("多个候选时取离密码框最近的那个", () => {
    const details = page([
      field({ opid: "__0", htmlName: "search_far" }),
      field({ opid: "__1", htmlName: "user_near" }),
      field({ opid: "__2", htmlName: "pass", type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("user_near");
  });

  it("同表单内的候选优先于表单外更近的字段", () => {
    // 页面顶部的全局搜索框常常在 DOM 上离密码框更近，但它不在登录表单里。
    const details = page([
      field({ opid: "__0", htmlName: "in_form_user", form: "__form__0" }),
      field({ opid: "__1", htmlName: "outside_user", form: null }),
      field({ opid: "__2", htmlName: "pass", type: "password", form: "__form__0" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("in_form_user");
  });

  it("忽略不可见字段", () => {
    // 填进用户看不见的框是钓鱼页面最想要的结果。
    const details = page([
      field({ opid: "__0", htmlName: "hidden_user", viewable: false }),
      field({ opid: "__1", htmlName: "real_user" }),
      field({ opid: "__2", htmlName: "pass", type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("real_user");
  });

  it("忽略禁用与只读字段", () => {
    const details = page([
      field({ opid: "__0", htmlName: "disabled_user", disabled: true }),
      field({ opid: "__1", htmlName: "readonly_user", readonly: true }),
      field({ opid: "__2", htmlName: "real_user" }),
      field({ opid: "__3", htmlName: "pass", type: "password" }),
    ]);

    expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("real_user");
  });

  it("email 与 tel 类型也可作为用户名", () => {
    for (const type of ["email", "tel", "number"]) {
      const details = page([
        field({ opid: "__0", htmlName: "u", type }),
        field({ opid: "__1", htmlName: "p", type: "password" }),
      ]);
      expect(qualifyLoginFields(details).usernameField?.htmlName).toBe("u");
    }
  });

  it("密码框之后的字段不会被当作用户名", () => {
    const details = page([
      field({ opid: "__0", htmlName: "pass", type: "password" }),
      field({ opid: "__1", htmlName: "after" }),
    ]);

    expect(qualifyLoginFields(details).usernameField).toBeUndefined();
  });

  it("没有密码框时只认用户名（分步登录的第一步）", () => {
    const details = page([field({ opid: "__0", htmlName: "email", type: "email" })]);

    const result = qualifyLoginFields(details);
    expect(result.usernameField?.htmlName).toBe("email");
    expect(result.passwordFields).toEqual([]);
  });

  it("注册表单的两个密码框都会被识别", () => {
    const details = page([
      field({ opid: "__0", htmlName: "user" }),
      field({ opid: "__1", htmlName: "pass", type: "password" }),
      field({ opid: "__2", htmlName: "confirm", type: "password" }),
    ]);

    expect(qualifyLoginFields(details).passwordFields.map((f) => f.htmlName)).toEqual([
      "pass",
      "confirm",
    ]);
  });

  it("空页面得到空结果", () => {
    const result = qualifyLoginFields(page([]));
    expect(result.usernameField).toBeUndefined();
    expect(result.passwordFields).toEqual([]);
  });
});

describe("填充脚本生成", () => {
  const details = page([
    field({ opid: "__0", htmlName: "user" }),
    field({ opid: "__1", htmlName: "pass", type: "password" }),
  ]);

  it("按 点击 → 聚焦 → 写值 的顺序编排", () => {
    // 不少站点只在收到交互事件后才认这个值，直接赋值会被判为未填写。
    const script = buildLoginFillScript(details, { username: "u", password: "p" });

    expect(script.actions.slice(0, 3)).toEqual([
      ["click_on_opid", "__0"],
      ["focus_by_opid", "__0"],
      ["fill_by_opid", "__0", "u"],
    ]);
    expect(script.filledFieldCount).toBe(2);
  });

  it("只有密码时不碰用户名框", () => {
    const script = buildLoginFillScript(details, { password: "p" });

    expect(script.actions.every((action) => action[1] === "__1")).toBe(true);
    expect(script.filledFieldCount).toBe(1);
  });

  it("凭据为空时不产出任何动作", () => {
    expect(buildLoginFillScript(details, {}).actions).toEqual([]);
    expect(buildLoginFillScript(details, { username: "", password: "" }).actions).toEqual([]);
  });

  it("注册表单的两个密码框都会被写入", () => {
    const registration = page([
      field({ opid: "__0", htmlName: "user" }),
      field({ opid: "__1", htmlName: "pass", type: "password" }),
      field({ opid: "__2", htmlName: "confirm", type: "password" }),
    ]);

    const script = buildLoginFillScript(registration, { username: "u", password: "p" });
    const fills = script.actions.filter((action) => action[0] === "fill_by_opid");

    expect(fills.map((action) => action[1])).toEqual(["__0", "__1", "__2"]);
  });

  it("收尾把焦点交还用户名框", () => {
    const script = buildLoginFillScript(details, { username: "u", password: "p" });

    expect(script.actions[script.actions.length - 1]).toEqual(["focus_by_opid", "__0"]);
  });
});
