/**
 * 保存/更新凭据提示条。
 *
 * 常驻 content script：监听表单提交与密码输入，发现「用户名 + 密码」后向背景页
 * 询问该保存还是更新，然后注入一个顶部横幅让用户决定。
 *
 * 安全要点：
 *   - 提示条**绝不显示密码**，只显示用户名与站点名
 *   - 用户点「忽略」后，同一站点同一用户名在本会话内不再打扰
 *
 * 样式全部用 `element.style` 内联赋值——注入的 `<style>` 标签受页面 CSP 的
 * `style-src` 约束，而 style 属性的动态赋值不受限制。
 */

(() => {
  const FLAG = "__vwo_save_detector__";
  const w = window as unknown as Record<string, boolean>;
  if (w[FLAG]) {
    return;
  }
  w[FLAG] = true;

  /** 一次提交后 5 秒内的重复事件不再触发，避免双提交与快速重试的连击。 */
  const MIN_INTERVAL_MS = 5_000;
  let lastTriggerAt = 0;

  /** 「忽略」记忆：同站点同用户名在本次会话内不再提示。 */
  const DECLINED_PREFIX = "vwo:declined:";

  /** 提示条实例，同时只存在一个。 */
  let activeBar: { element: HTMLElement; dismiss: () => void } | null = null;

  function saveUrl(): string {
    return window.location.origin + window.location.pathname;
  }

  function hostname(): string {
    return window.location.hostname.replace(/^www\./, "");
  }

  /** 从表单里收集用户名与密码。密码框必须有值；用户名取密码框之前最近的文本输入框。 */
  function collectFromForm(form: HTMLFormElement): { username: string; password: string } {
    const passwordInputs = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="password"]'),
    ).filter((input) => input.value !== "");

    const passwordInput = passwordInputs[0];
    if (passwordInput == null) {
      return { username: "", password: "" };
    }

    const candidates = Array.from(form.querySelectorAll<HTMLInputElement>("input"));
    let username = "";
    for (const input of candidates) {
      if (input === passwordInput) {
        break;
      }
      if (
        (input.type === "text" || input.type === "email" || input.type === "tel") &&
        input.value !== ""
      ) {
        username = input.value;
      }
    }

    return { username, password: passwordInput.value };
  }

  /** SPA 提交不走表单，靠密码框的值变化兜底。 */
  function collectFromDocument(): { username: string; password: string } {
    const passwordInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
    ).filter((input) => input.value !== "");

    const passwordInput = passwordInputs[0];
    if (passwordInput == null) {
      return { username: "", password: "" };
    }

    // 就近向前找：当前密码框之前的最后一个有值的文本/邮箱框。
    const all = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
    const passwordIndex = all.indexOf(passwordInput);
    let username = "";
    for (let i = passwordIndex - 1; i >= 0; i--) {
      const input = all[i]!;
      if (input.type === "password" || input.type === "search") {
        continue;
      }
      if (
        (input.type === "text" || input.type === "email" || input.type === "tel") &&
        input.value !== ""
      ) {
        username = input.value;
        break;
      }
    }

    return { username, password: passwordInput.value };
  }

  async function maybePrompt(form?: HTMLFormElement): Promise<void> {
    if (activeBar != null || Date.now() - lastTriggerAt < MIN_INTERVAL_MS) {
      return;
    }

    const { username, password } =
      form != null ? collectFromForm(form) : collectFromDocument();

    if (username === "" || password === "") {
      return;
    }

    const url = saveUrl();
    const declineKey = `${DECLINED_PREFIX}${hostname()}:${username}`;
    if (sessionStorage.getItem(declineKey) != null) {
      return;
    }

    // 密码只发给背景页，不落任何页面存储。
    const response = await chrome.runtime.sendMessage({
      command: "save:detected",
      payload: { url, username, password },
    });

    if (response == null || response.action === "none") {
      return;
    }

    lastTriggerAt = Date.now();
    showBar({
      username,
      siteName: hostname(),
      mode: response.action,
      cipherId: response.cipherId,
      onSave: async (mode) => {
        const result = await chrome.runtime.sendMessage({
          command: "save:commit",
          payload: { mode, url, username, password, cipherId: response.cipherId },
        });
        return result?.ok === true;
      },
      onDecline: () => {
        sessionStorage.setItem(declineKey, "1");
      },
    });
  }

  // --- 事件监听 -------------------------------------------------------------

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : undefined;
      void maybePrompt(form);
    },
    true,
  );

  // SPA 登录不触发 submit 时，密码输入完成（失焦）也能兜底触发。
  document.addEventListener(
    "change",
    (event) => {
      const target = event.target as HTMLInputElement | null;
      if (target != null && target.type === "password" && target.value !== "") {
        void maybePrompt();
      }
    },
    true,
  );

  // --- 提示条 UI ------------------------------------------------------------

  interface BarOptions {
    username: string;
    siteName: string;
    mode: "save" | "update";
    cipherId?: string;
    onSave: (mode: "save" | "update") => Promise<boolean>;
    onDecline: () => void;
  }

  function showBar(options: BarOptions): void {
    const bar = document.createElement("div");
    bar.setAttribute("data-vwo-save-bar", "true");

    const style = bar.style;
    style.position = "fixed";
    style.top = "12px";
    style.left = "50%";
    style.transform = "translateX(-50%)";
    style.zIndex = "2147483647";
    style.maxWidth = "420px";
    style.width = "calc(100% - 32px)";
    style.background = "#0f172a";
    style.color = "#f1f5f9";
    style.borderRadius = "10px";
    style.boxShadow = "0 8px 24px rgba(0,0,0,.35)";
    style.padding = "12px 14px";
    style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
    style.fontSize = "13px";
    style.lineHeight = "1.5";
    style.boxSizing = "border-box";

    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.marginBottom = "2px";
    title.textContent =
      options.mode === "update"
        ? `更新 ${options.siteName} 的密码？`
        : `将密码保存到 ${options.siteName}？`;

    const sub = document.createElement("div");
    sub.style.color = "#94a3b8";
    sub.style.fontSize = "12px";
    sub.style.marginBottom = "10px";
    sub.textContent = options.mode === "update" ? `账号：${options.username}` : `用户名：${options.username}`;

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const saveButton = document.createElement("button");
    saveButton.textContent = options.mode === "update" ? "更新密码" : "保存密码";
    saveButton.style.flex = "1";
    saveButton.style.padding = "7px 0";
    saveButton.style.border = "none";
    saveButton.style.borderRadius = "6px";
    saveButton.style.background = "#2563eb";
    saveButton.style.color = "#ffffff";
    saveButton.style.fontSize = "13px";
    saveButton.style.fontWeight = "600";
    saveButton.style.cursor = "pointer";
    saveButton.style.fontFamily = "inherit";

    const declineButton = document.createElement("button");
    declineButton.textContent = "忽略";
    declineButton.style.padding = "7px 14px";
    declineButton.style.border = "1px solid #334155";
    declineButton.style.borderRadius = "6px";
    declineButton.style.background = "transparent";
    declineButton.style.color = "#94a3b8";
    declineButton.style.fontSize = "13px";
    declineButton.style.cursor = "pointer";
    declineButton.style.fontFamily = "inherit";

    actions.appendChild(saveButton);
    actions.appendChild(declineButton);
    bar.appendChild(title);
    bar.appendChild(sub);
    bar.appendChild(actions);

    const dismiss = () => bar.remove();

    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      saveButton.textContent = "保存中…";
      const ok = await options.onSave(options.mode);
      if (ok) {
        title.textContent = "已保存 ✓";
        sub.textContent = "可在插件的密码库中查看";
        actions.remove();
        setTimeout(dismiss, 1400);
      } else {
        saveButton.disabled = false;
        saveButton.textContent = options.mode === "update" ? "更新密码" : "保存密码";
        sub.textContent = "保存失败，请稍后重试";
        sub.style.color = "#f87171";
      }
    });

    declineButton.addEventListener("click", () => {
      options.onDecline();
      dismiss();
    });

    document.documentElement.appendChild(bar);
    activeBar = { element: bar, dismiss };
    bar.addEventListener("remove", () => {
      if (activeBar?.element === bar) {
        activeBar = null;
      }
    });
  }
})();
