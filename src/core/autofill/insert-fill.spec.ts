// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { collectPageDetails } from "./collect-page-details";
import { alwaysViewableChecker } from "./dom-visibility";
import { buildLoginFillScript } from "./fill-script";
import { executeFillScript } from "./insert-fill";

function render(html: string): void {
  document.body.innerHTML = html;
}

/** 走完整链路：采集 → 生成脚本 → 执行填充。 */
async function fill(credentials: { username?: string; password?: string }) {
  const details = collectPageDetails({ document, visibility: alwaysViewableChecker });
  return await executeFillScript(buildLoginFillScript(details, credentials), document);
}

function input(name: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("端到端填充", () => {
  it("把用户名与密码写进对应字段", async () => {
    render(`
      <form>
        <input type="text" name="user">
        <input type="password" name="pass">
      </form>
    `);

    const result = await fill({ username: "octocat", password: "s3cret" });

    expect(input("user").value).toBe("octocat");
    expect(input("pass").value).toBe("s3cret");
    expect(result.filled).toBe(2);
  });

  it("跨表单的多个密码框都会被填", async () => {
    render(`
      <form>
        <input type="text" name="user">
        <input type="password" name="pass">
        <input type="password" name="confirm">
      </form>
    `);

    await fill({ username: "u", password: "p" });

    expect(input("pass").value).toBe("p");
    expect(input("confirm").value).toBe("p");
  });

  it("不碰只读与禁用字段", async () => {
    render(`
      <form>
        <input type="text" name="user" readonly>
        <input type="password" name="pass" disabled>
      </form>
    `);

    const result = await fill({ username: "u", password: "p" });

    expect(input("user").value).toBe("");
    expect(input("pass").value).toBe("");
    expect(result.filled).toBe(0);
  });

  it("Shadow DOM 里的字段同样能填", async () => {
    render(`<div id="host"></div>`);
    const shadow = document.getElementById("host")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<input type="text" name="su"><input type="password" name="sp">`;

    await fill({ username: "u", password: "p" });

    expect(shadow.querySelector<HTMLInputElement>('[name="su"]')!.value).toBe("u");
    expect(shadow.querySelector<HTMLInputElement>('[name="sp"]')!.value).toBe("p");
  });

  it("页面没有登录字段时什么也不做", async () => {
    render(`<p>这里没有表单</p>`);

    expect((await fill({ username: "u", password: "p" })).filled).toBe(0);
  });
});

describe("事件派发", () => {
  it("填充后派发 input 与 change 事件", async () => {
    // 站点普遍靠这两个事件感知输入；不派发就会出现"框里有字却提示未填写"。
    render(`<form><input type="text" name="user"><input type="password" name="pass"></form>`);

    const events: string[] = [];
    for (const type of ["input", "change"]) {
      input("pass").addEventListener(type, () => events.push(type));
    }

    await fill({ username: "u", password: "p" });

    expect(events).toContain("input");
    expect(events).toContain("change");
  });

  it("事件冒泡到表单，便于站点在表单层监听", async () => {
    render(`<form id="f"><input type="password" name="pass"></form>`);

    let bubbled = 0;
    document.getElementById("f")!.addEventListener("input", () => (bubbled += 1));

    await fill({ password: "p" });

    expect(bubbled).toBeGreaterThan(0);
  });
});

describe("绕过框架的值追踪器", () => {
  /**
   * React 会在**元素实例**上重写 value 描述符来追踪"值变没变过"：
   * get 委托给原生 getter，set 先记录再委托。
   *
   * 若直接 `element.value = x`，追踪器的记录同步更新，React 认为什么都没变，
   * onChange 不触发——用户看到框里有字，点提交却被告知"请填写此项"。
   *
   * 正确做法是调用**原型上**的原生 setter，绕开实例上那层覆盖，
   * 让追踪器的记录变成陈旧值，React 随后才能识别出变化。
   */
  function installReactValueTracker(element: HTMLInputElement): { current: () => string } {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    const nativeGet = descriptor.get!;
    const nativeSet = descriptor.set!;

    let tracked = nativeGet.call(element) as string;

    Object.defineProperty(element, "value", {
      configurable: true,
      get() {
        return nativeGet.call(this);
      },
      set(value: string) {
        tracked = String(value);
        nativeSet.call(this, value);
      },
    });

    return { current: () => tracked };
  }

  it("值写进了 DOM，但追踪器的记录仍是旧值", async () => {
    render(`<form><input type="password" name="pass"></form>`);

    const element = input("pass");
    const tracker = installReactValueTracker(element);

    await fill({ password: "s3cret" });

    // 值确实进了 DOM——用户看得见，表单提交也拿得到。
    expect(element.value).toBe("s3cret");
    // 而追踪器还停留在旧值，这正是 React 判定"值变了"的依据。
    expect(tracker.current()).toBe("");
  });

  it("若走实例 setter，追踪器会被同步更新（这正是要避免的情形）", () => {
    // 反证：直接赋值会让追踪器与实际值一致，React 因此认为无事发生。
    render(`<input type="password" name="pass">`);

    const element = input("pass");
    const tracker = installReactValueTracker(element);

    element.value = "typed";

    expect(tracker.current()).toBe("typed");
  });
});

describe("复选框", () => {
  it("勾选类值会把复选框选上", async () => {
    render(`<input type="checkbox" name="agree">`);

    const details = collectPageDetails({ document, visibility: alwaysViewableChecker });
    const checkbox = details.fields.find((f) => f.htmlName === "agree")!;

    await executeFillScript(
      { actions: [["fill_by_opid", checkbox.opid, "✓"]], filledFieldCount: 1 },
      document,
    );

    expect(input("agree").checked).toBe(true);
  });

  it("非勾选类值不会误触复选框", async () => {
    render(`<input type="checkbox" name="agree">`);

    const details = collectPageDetails({ document, visibility: alwaysViewableChecker });
    const checkbox = details.fields.find((f) => f.htmlName === "agree")!;

    const result = await executeFillScript(
      { actions: [["fill_by_opid", checkbox.opid, "some-password"]], filledFieldCount: 1 },
      document,
    );

    expect(input("agree").checked).toBe(false);
    expect(result.skipped).toBe(1);
  });
});

describe("opid 解析", () => {
  it("opid 对应不到元素时安全跳过", async () => {
    render(`<input type="text" name="user">`);

    const result = await executeFillScript(
      { actions: [["fill_by_opid", "__99", "值"]], filledFieldCount: 1 },
      document,
    );

    expect(result.filled).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("采集与填充共用同一查询，下标口径一致", async () => {
    // 两边若各自实现查询，筛选条件的细微差异会让 opid 错位，
    // 后果是把密码填进错误的框。
    render(`
      <input type="search" name="ignored_search">
      <input type="text" name="user">
      <input type="hidden" name="ignored_hidden">
      <input type="password" name="pass">
    `);

    await fill({ username: "u", password: "p" });

    expect(input("user").value).toBe("u");
    expect(input("pass").value).toBe("p");
    expect(input("ignored_search").value).toBe("");
  });
});
