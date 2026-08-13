// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { collectPageDetails } from "./collect-page-details";
import { alwaysViewableChecker } from "./dom-visibility";
import type { AutofillField } from "./models";

/**
 * 采集逻辑的结构化部分在 jsdom 下测试。
 *
 * 可见性判定不在此列——jsdom 不实现布局，`getBoundingClientRect` 恒为 0，
 * 真实判定在其中毫无意义。因此这里统一注入"一律可见"的判定器，
 * 专注验证"页面上有什么、标签文字取得对不对"。可见性由 test/pages/08 人工验收。
 */

function render(html: string): void {
  document.body.innerHTML = html;
}

function collect() {
  return collectPageDetails({ document, visibility: alwaysViewableChecker });
}

function byName(fields: AutofillField[], name: string): AutofillField | undefined {
  return fields.find((field) => field.htmlName === name);
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("字段筛选", () => {
  it("采集常规输入框、文本域与下拉框", () => {
    render(`
      <input type="text" name="user">
      <input type="password" name="pass">
      <input type="email" name="mail">
      <textarea name="note"></textarea>
      <select name="pick"><option value="1">一</option></select>
    `);

    expect(collect().fields.map((f) => f.htmlName)).toEqual([
      "user",
      "pass",
      "mail",
      "note",
      "pick",
    ]);
  });

  it("排除按钮、文件、颜色等无意义类型", () => {
    render(`
      <input type="text" name="keep">
      <input type="submit" name="drop_submit">
      <input type="button" name="drop_button">
      <input type="reset" name="drop_reset">
      <input type="file" name="drop_file">
      <input type="image" name="drop_image">
      <input type="color" name="drop_color">
      <input type="range" name="drop_range">
    `);

    expect(collect().fields.map((f) => f.htmlName)).toEqual(["keep"]);
  });

  it("排除搜索框与网址框", () => {
    // 把密码填进站内搜索框会直接把密码送进对方的搜索日志。
    render(`
      <input type="text" name="keep">
      <input type="search" name="site_search">
      <input type="url" name="homepage">
    `);

    expect(collect().fields.map((f) => f.htmlName)).toEqual(["keep"]);
  });

  it("排除 hidden 字段", () => {
    // 隐藏字段用户看不见，填进去的内容也无从校验，一律不采集（与 Bitwarden 一致）。
    render(`
      <input type="text" name="keep">
      <input type="hidden" name="csrf" value="token">
    `);

    expect(collect().fields.map((f) => f.htmlName)).toEqual(["keep"]);
  });

  it("尊重 data-bwignore", () => {
    render(`
      <input type="text" name="keep">
      <input type="text" name="ignored" data-bwignore>
    `);

    expect(collect().fields.map((f) => f.htmlName)).toEqual(["keep"]);
  });

  it("data-bwautofill 让 span 也参与采集", () => {
    render(`<span data-bwautofill id="fakeInput">显示值</span>`);

    const field = collect().fields[0];
    expect(field?.htmlID).toBe("fakeInput");
    expect(field?.tagName).toBe("span");
    expect(field?.value).toBe("显示值");
  });

  it("跳过提交按钮内部的元素", () => {
    render(`
      <button type="submit"><input type="text" name="inside_button"></button>
      <input type="text" name="outside">
    `);

    expect(collect().fields.map((f) => f.htmlName)).toEqual(["outside"]);
  });
});

describe("表单关联", () => {
  it("表单被采集并分配 opid", () => {
    render(`<form id="f1" name="login" action="/login" method="post"></form>`);

    const forms = Object.values(collect().forms);
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({
      opid: "__form__0",
      htmlID: "f1",
      htmlName: "login",
      htmlMethod: "post",
    });
  });

  it("字段记录所属表单的 opid", () => {
    render(`
      <form id="f1"><input type="text" name="in_form"></form>
      <input type="text" name="outside_form">
    `);

    const { fields } = collect();
    expect(byName(fields, "in_form")?.form).toBe("__form__0");
    expect(byName(fields, "outside_form")?.form).toBeNull();
  });

  it("相对 action 解析成绝对地址", () => {
    render(`<form action="/login"></form>`);

    expect(Object.values(collect().forms)[0]?.htmlAction).toMatch(/^https?:\/\/.+\/login$/);
  });

  it("多个表单各自独立编号", () => {
    render(`
      <form id="a"><input type="text" name="fa"></form>
      <form id="b"><input type="text" name="fb"></form>
    `);

    const { fields, forms } = collect();
    expect(Object.keys(forms)).toEqual(["__form__0", "__form__1"]);
    expect(byName(fields, "fa")?.form).toBe("__form__0");
    expect(byName(fields, "fb")?.form).toBe("__form__1");
  });
});

describe("标签提取", () => {
  it("label[for] 关联", () => {
    render(`<label for="u">用户名</label><input type="text" id="u" name="user">`);

    expect(collect().fields[0]?.["label-tag"]).toBe("用户名");
  });

  it("label 包裹字段", () => {
    render(`<label>密码 <input type="password" name="pass"></label>`);

    expect(collect().fields[0]?.["label-tag"]).toBe("密码");
  });

  it("aria-label 与 placeholder 各自成项", () => {
    render(`<input type="text" name="user" aria-label="登录账号" placeholder="请输入邮箱">`);

    const field = collect().fields[0];
    expect(field?.["label-aria"]).toBe("登录账号");
    expect(field?.placeholder).toBe("请输入邮箱");
  });

  it("表格排版取正上方单元格的文字", () => {
    render(`
      <table>
        <tr><td>账号</td><td>口令</td></tr>
        <tr><td><input type="text" name="acct"></td><td><input type="password" name="pw"></td></tr>
      </table>
    `);

    const { fields } = collect();
    expect(byName(fields, "acct")?.["label-top"]).toBe("账号");
    expect(byName(fields, "pw")?.["label-top"]).toBe("口令");
  });

  it("取左侧兄弟节点的文字", () => {
    render(`<div><span>登录名</span><input type="text" name="loginname"></div>`);

    expect(collect().fields[0]?.["label-left"]).toContain("登录名");
  });

  it("取右侧兄弟节点的文字", () => {
    render(`<div><input type="checkbox" name="agree"><span>我已阅读条款</span></div>`);

    expect(collect().fields[0]?.["label-right"]).toContain("我已阅读条款");
  });

  it("向左取文时不跨过另一个字段", () => {
    // 否则第二个框会把第一个框的标签也吸过来，判定就全乱了。
    render(`
      <div>
        <span>用户名</span><input type="text" name="user">
        <input type="password" name="pass">
      </div>
    `);

    expect(byName(collect().fields, "pass")?.["label-left"]).not.toContain("用户名");
  });

  it("定义列表排版取 dt 的文字", () => {
    render(`<dl><dt>账号</dt><dd><input type="text" name="acct"></dd></dl>`);

    expect(collect().fields[0]?.["label-tag"]).toBe("账号");
  });

  it("压缩标签文字里的多余空白", () => {
    render(`<label for="u">  用户\n\n  名  </label><input type="text" id="u" name="user">`);

    expect(collect().fields[0]?.["label-tag"]).toBe("用户 名");
  });
});

describe("字段属性", () => {
  it("记录 autocomplete，并兼容旧式属性名", () => {
    render(`
      <input type="text" name="a" autocomplete="username">
      <input type="text" name="b" x-autocompletetype="cc-number">
    `);

    const { fields } = collect();
    expect(byName(fields, "a")?.autoCompleteType).toBe("username");
    expect(byName(fields, "b")?.autoCompleteType).toBe("cc-number");
  });

  it("maxLength 上限截到 999", () => {
    render(`
      <input type="text" name="short" maxlength="8">
      <input type="text" name="huge" maxlength="99999">
      <input type="text" name="none">
    `);

    const { fields } = collect();
    expect(byName(fields, "short")?.maxLength).toBe(8);
    expect(byName(fields, "huge")?.maxLength).toBe(999);
    expect(byName(fields, "none")?.maxLength).toBe(999);
  });

  it("复选框的值用勾号表示", () => {
    render(`
      <input type="checkbox" name="on" checked>
      <input type="checkbox" name="off">
    `);

    const { fields } = collect();
    expect(byName(fields, "on")?.value).toBe("✓");
    expect(byName(fields, "on")?.checked).toBe(true);
    expect(byName(fields, "off")?.value).toBe("");
  });

  it("超长的值被截断以免撑爆消息通道", () => {
    // 走 span 这条路验证：hidden 已在查询阶段被排除，构造不出真实的超长 hidden。
    render(`<span data-bwautofill id="big">${"x".repeat(400)}</span>`);

    const value = collect().fields[0]?.value ?? "";
    expect(value.length).toBe(400);
  });

  it("记录禁用与只读状态", () => {
    // readonly 判错的后果是往只读框里填内容：DOM 属性叫 readOnly（驼峰），
    // 而 getAttribute("readonly") 对裸特性返回空串，两个坑都得躲开。
    render(`
      <input type="text" name="d" disabled>
      <input type="text" name="r" readonly>
      <input type="text" name="n">
    `);

    const { fields } = collect();
    expect(byName(fields, "d")?.disabled).toBe(true);
    expect(byName(fields, "r")?.readonly).toBe(true);
    expect(byName(fields, "n")?.disabled).toBe(false);
    expect(byName(fields, "n")?.readonly).toBe(false);
  });

  it("aria-* 布尔特性按字符串 'true' 判定", () => {
    render(`<input type="text" name="a" aria-hidden="true" aria-disabled="false">`);

    const field = collect().fields[0];
    expect(field?.["aria-hidden"]).toBe(true);
    expect(field?.["aria-disabled"]).toBe(false);
  });

  it("下拉框选项被规范化，便于后续匹配", () => {
    render(`
      <select name="brand">
        <option value="v">Visa 信用卡</option>
        <option value="m">Master-Card</option>
      </select>
    `);

    expect(collect().fields[0]?.selectInfo?.options).toEqual([
      ["visa信用卡", "v"],
      ["mastercard", "m"],
    ]);
  });

  it("汇总 data-* 属性", () => {
    render(`<input type="text" name="a" data-testid="login" data-role="user">`);

    const values = collect().fields[0]?.dataSetValues ?? "";
    expect(values).toContain("testid: login");
    expect(values).toContain("role: user");
  });
});

describe("顺序与标识", () => {
  it("elementNumber 按 DOM 顺序递增", () => {
    // 判定"用户名在密码框上方"这类相对位置关系要靠它。
    render(`
      <input type="text" name="first">
      <input type="password" name="second">
      <input type="text" name="third">
    `);

    expect(collect().fields.map((f) => f.elementNumber)).toEqual([0, 1, 2]);
  });

  it("opid 唯一且与序号对应", () => {
    render(`<input type="text" name="a"><input type="text" name="b">`);

    expect(collect().fields.map((f) => f.opid)).toEqual(["__0", "__1"]);
  });
});

describe("Shadow DOM", () => {
  it("穿透 shadow root 采集其中的字段", () => {
    // 普通 querySelectorAll 完全看不到这些元素，Web Components 站点全靠这条。
    render(`<div id="host"></div><input type="text" name="light">`);

    const shadow = document.getElementById("host")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<input type="text" name="shadow_user"><input type="password" name="shadow_pass">`;

    const names = collect().fields.map((f) => f.htmlName);
    expect(names).toContain("shadow_user");
    expect(names).toContain("shadow_pass");
    expect(names).toContain("light");
  });

  it("嵌套 shadow root 也能采集", () => {
    render(`<div id="outer"></div>`);

    const outer = document.getElementById("outer")!.attachShadow({ mode: "open" });
    outer.innerHTML = `<div id="inner"></div>`;
    const inner = outer.getElementById("inner")!.attachShadow({ mode: "open" });
    inner.innerHTML = `<input type="password" name="deep">`;

    expect(collect().fields.map((f) => f.htmlName)).toContain("deep");
  });

  it("shadow root 内的 label 仍能被关联", () => {
    render(`<div id="host"></div>`);

    const shadow = document.getElementById("host")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<label for="su">影子用户名</label><input type="text" id="su" name="su">`;

    expect(collect().fields[0]?.["label-tag"]).toBe("影子用户名");
  });
});

describe("页面元信息", () => {
  it("带上标题与地址", () => {
    document.title = "登录页";
    render(`<input type="text" name="a">`);

    const details = collect();
    expect(details.title).toBe("登录页");
    expect(details.url).toContain("http");
    expect(details.collectedTimestamp).toBeGreaterThan(0);
  });

  it("空页面得到空结果而不是报错", () => {
    render(`<p>这里没有表单</p>`);

    const details = collect();
    expect(details.fields).toEqual([]);
    expect(details.forms).toEqual({});
  });
});
