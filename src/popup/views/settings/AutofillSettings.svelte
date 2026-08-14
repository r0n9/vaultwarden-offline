<script lang="ts">
  import { api, vendor } from "@/platform/browser-api";
  import { sendMessage } from "@/platform/messaging";

  const {
    onCollect,
    onBack,
  }: { onCollect: () => void; onBack: () => void } = $props();

  let autofillShortcut = $state("");

  $effect(() => {
    void (async () => {
      const shortcutResult = await sendMessage("shortcut:getAutofill");
      autofillShortcut = shortcutResult?.shortcut ?? "";
    })();
  });

  function openShortcutsPage() {
    const urls: Record<string, string> = {
      chrome: "chrome://extensions/shortcuts",
      edge: "edge://extensions/shortcuts",
      opera: "opera://extensions/shortcuts",
      firefox: "about:debugging#/runtime/this-firefox",
    };
    void api().tabs.create({ url: urls[vendor()] ?? "chrome://extensions/shortcuts" });
  }
</script>

<div class="subpage">
  <div class="subpage-head">
    <button class="back" onclick={onBack} aria-label="返回">‹</button>
    <h1>自动填充</h1>
  </div>

  <section class="panel">
    <button class="btn btn-secondary" onclick={onCollect}>检测当前页面字段</button>
    <p class="hint">在打开的站点页面上识别登录表单与字段结构。</p>
  </section>

  <section class="panel">
    <button class="shortcut-row" onclick={openShortcutsPage}>
      <span>
        <span class="shortcut-label">自动填充快捷键</span>
        <span class="shortcut-value">
          {autofillShortcut !== "" ? autofillShortcut : "未设置，点击配置"}
        </span>
      </span>
      <span class="shortcut-open">↗</span>
    </button>
    <p class="hint">
      若快捷键被其他扩展占用，Chrome 可能不会分配——点击上方前往快捷键管理页手动设置。
    </p>
  </section>
</div>

<style>
  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-subtle);
    color: var(--text);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .shortcut-row:hover {
    border-color: var(--accent);
  }

  .shortcut-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
  }

  .shortcut-value {
    display: block;
    font-size: 11px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .shortcut-open {
    color: var(--text-muted);
    font-size: 13px;
  }
</style>
