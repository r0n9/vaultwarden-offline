/**
 * 内联菜单浮层。
 *
 * 输入框聚焦时在字段旁显示 ⚡ 按钮，点击展开当前站点匹配的登录条目，
 * 点击条目即填充（复用背景页的填充链路）。
 *
 * 简化实现（非 Bitwarden 的 sandbox iframe 方案）：按钮与菜单是注入页面的
 * 普通 DOM，全内联样式（绕开页面 CSP 对 <style> 的限制）。菜单只显示
 * 名称与用户名，**绝不含密码**；填充由背景页完成。
 *
 * 与 save-detector 一样是常驻 content script（manifest 声明，document_start）。
 */

(() => {
  const FLAG = "__vwo_autofill_overlay__";
  const w = window as unknown as Record<string, boolean>;
  if (w[FLAG]) {
    return;
  }
  w[FLAG] = true;

  /** 浮层按钮尺寸（产品图标为 38px 源图，等比缩放到按钮内）。 */
  const BUTTON_SIZE = 30;

  let activeButton: { el: HTMLElement; field: HTMLElement } | null = null;
  let activeMenu: { el: HTMLElement; field: HTMLElement } | null = null;
  let menuOpen = false;

  /** 聚焦字段是否可能承载登录凭据（用户名/密码/验证码）。 */
  function isLoginCandidate(target: EventTarget | null): target is HTMLInputElement {
    if (!(target instanceof HTMLInputElement)) {
      return false;
    }
    const type = target.type.toLowerCase();
    if (type === "password") {
      return true;
    }
    if (!["text", "email", "tel", "number"].includes(type)) {
      return false;
    }
    const autoComplete = target.autocomplete?.toLowerCase() ?? "";
    if (autoComplete.includes("username") || autoComplete.includes("email") || autoComplete.includes("one-time-code")) {
      return true;
    }
    // 关键词兜底：name/id 含常见登录语义。
    const identity = `${target.id} ${target.name}`.toLowerCase();
    return /(user|login|email|account|member)/.test(identity);
  }

  function hideAll(): void {
    activeButton?.el.remove();
    activeButton = null;
    activeMenu?.el.remove();
    activeMenu = null;
    menuOpen = false;
  }

  /** 在字段旁放置 ⚡ 按钮（fixed 定位，字段右下）。 */
  function showButton(field: HTMLElement): void {
    hideAll();

    const rect = field.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const button = document.createElement("div");
    button.setAttribute("data-vwo-overlay-btn", "true");
    const style = button.style;
    style.position = "fixed";
    style.zIndex = "2147483646";
    style.width = `${BUTTON_SIZE}px`;
    style.height = `${BUTTON_SIZE}px`;
    style.cursor = "pointer";
    style.boxShadow = "0 2px 10px rgba(0,0,0,.35)";
    style.borderRadius = "8px";
    style.userSelect = "none";
    style.left = `${Math.max(rect.right - BUTTON_SIZE - 4, 0)}px`;
    style.top = `${rect.top + 2}px`;

    // 产品图标（盾牌 + 钥匙孔），取自扩展资源。
    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("images/icon38.png");
    icon.alt = "";
    icon.style.display = "block";
    icon.style.width = `${BUTTON_SIZE}px`;
    icon.style.height = `${BUTTON_SIZE}px`;
    icon.style.borderRadius = "8px";
    button.appendChild(icon);

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void openMenu(field, button);
    });
    button.addEventListener("mousedown", (event) => event.stopPropagation());

    document.documentElement.appendChild(button);
    activeButton = { el: button, field };
  }

  async function openMenu(field: HTMLElement, anchor: HTMLElement): Promise<void> {
    if (menuOpen) {
      hideAll();
      return;
    }

    let items: { cipherId: string; name: string; username?: string }[] = [];
    try {
      const response = await chrome.runtime.sendMessage({
        command: "overlay:getMatches",
        payload: { url: window.location.href },
      });
      items = response?.items ?? [];
    } catch {
      // 背景页不可达（SW 休眠）：按钮已点击，直接静默失败。
    }

    if (items.length === 0) {
      hideAll();
      return;
    }

    // 按钮切换为展开态。
    anchor.style.transform = "rotate(45deg)";
    menuOpen = true;

    const menu = document.createElement("div");
    menu.setAttribute("data-vwo-overlay-menu", "true");
    const style = menu.style;
    style.position = "fixed";
    style.zIndex = "2147483647";
    style.minWidth = "220px";
    style.maxWidth = "280px";
    style.maxHeight = "260px";
    style.overflowY = "auto";
    style.background = "#0f172a";
    style.borderRadius = "8px";
    style.boxShadow = "0 8px 24px rgba(0,0,0,.35)";
    style.padding = "4px";
    style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    const anchorRect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    style.left = `${Math.max(anchorRect.left - 180, 4)}px`;
    style.top =
      spaceBelow > 280
        ? `${anchorRect.bottom + 4}px`
        : `${Math.max(anchorRect.top - 280, 4)}px`;

    const title = document.createElement("div");
    title.textContent = "自动填充";
    title.style.fontSize = "10px";
    title.style.color = "#94a3b8";
    title.style.padding = "4px 8px 6px";
    title.style.fontWeight = "600";
    menu.appendChild(title);

    for (const item of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.width = "100%";
      row.style.padding = "7px 8px";
      row.style.border = "none";
      row.style.borderRadius = "6px";
      row.style.background = "transparent";
      row.style.color = "#f1f5f9";
      row.style.fontSize = "12px";
      row.style.fontFamily = "inherit";
      row.style.cursor = "pointer";
      row.style.textAlign = "left";
      row.addEventListener("mouseenter", () => {
        row.style.background = "#1e293b";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
      });

      const dot = document.createElement("span");
      dot.textContent = (item.name.trim()[0] ?? "?").toUpperCase();
      dot.style.flex = "none";
      dot.style.width = "22px";
      dot.style.height = "22px";
      dot.style.display = "grid";
      dot.style.placeItems = "center";
      dot.style.borderRadius = "50%";
      dot.style.background = "#1e293b";
      dot.style.color = "#94a3b8";
      dot.style.fontSize = "11px";
      dot.style.fontWeight = "600";

      const text = document.createElement("span");
      text.style.flex = "1";
      text.style.minWidth = "0";
      text.style.overflow = "hidden";
      text.style.textOverflow = "ellipsis";
      text.style.whiteSpace = "nowrap";
      const name = document.createElement("span");
      name.textContent = item.name;
      name.style.display = "block";
      text.appendChild(name);
      if (item.username != null && item.username !== "") {
        const username = document.createElement("span");
        username.textContent = item.username;
        username.style.display = "block";
        username.style.fontSize = "10px";
        username.style.color = "#94a3b8";
        text.appendChild(username);
      }

      row.appendChild(dot);
      row.appendChild(text);
      row.addEventListener("click", () => {
        void chrome.runtime.sendMessage({
          command: "autofill:fillActiveTab",
          payload: { cipherId: item.cipherId },
        });
        hideAll();
      });
      menu.appendChild(row);
    }

    const footer = document.createElement("div");
    footer.textContent = "由扩展自动填充";
    footer.style.fontSize = "10px";
    footer.style.color = "#475569";
    footer.style.padding = "6px 8px 2px";
    menu.appendChild(footer);

    document.documentElement.appendChild(menu);
    activeMenu = { el: menu, field };
  }

  // --- 事件 ---------------------------------------------------------------

  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (isLoginCandidate(target)) {
        showButton(target);
      } else {
        hideAll();
      }
    },
    true,
  );

  // 点击浮层之外关闭（捕获阶段，先于页面脚本处理）。
  document.addEventListener(
    "mousedown",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target == null) {
        return;
      }
      const inOverlay =
        target.closest?.("[data-vwo-overlay-btn]") != null ||
        target.closest?.("[data-vwo-overlay-menu]") != null;
      if (!inOverlay) {
        hideAll();
      }
    },
    true,
  );

  window.addEventListener("scroll", hideAll, true);
  window.addEventListener("resize", hideAll);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideAll();
    }
  });
})();
