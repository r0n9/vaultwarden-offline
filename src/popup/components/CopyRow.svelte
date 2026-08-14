<script lang="ts">
  import { copyToClipboard } from "../lib/clipboard";

  const {
    label,
    value,
    secret = false,
    multiline = false,
    href,
  }: {
    label: string;
    value: string;
    secret?: boolean;
    multiline?: boolean;
    /** 提供时在复制按钮旁显示「在新标签页打开」按钮；仅 http/https 生效。 */
    href?: string;
  } = $props();

  const isHttpHref = $derived(href != null && /^https?:/i.test(href));

  let revealed = $state(false);
  let copied = $state(false);

  const shown = $derived(secret && !revealed ? "•".repeat(Math.min(value.length, 16)) : value);

  async function copy() {
    if (await copyToClipboard(value)) {
      copied = true;
      setTimeout(() => (copied = false), 1200);
    }
  }
</script>

<div class="row">
  <span class="label">{label}</span>

  <div class="value-row">
    <span class="value" class:mono={secret} class:multiline>{shown}</span>

    <div class="buttons">
      {#if isHttpHref}
        <a
          class="link-btn"
          href={href}
          target="_blank"
          rel="noreferrer"
          title="在新标签页打开"
          aria-label="在新标签页打开"
        >
          <!-- 外部链接图标（内联 SVG） -->
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6.5 3H3v10h10V9.5M9 3h4v4M13 3l-6.5 6.5" />
          </svg>
        </a>
      {/if}
      {#if secret}
        <button
          type="button"
          onclick={() => (revealed = !revealed)}
          title={revealed ? "隐藏" : "显示"}
          aria-label={revealed ? "隐藏" : "显示"}
        >
          {revealed ? "🙈" : "👁"}
        </button>
      {/if}
      <button type="button" onclick={copy} title="复制" aria-label="复制">
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  </div>
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
  }

  .label {
    font-size: 11px;
    color: var(--text-muted);
  }

  .value-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .value {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    word-break: break-all;
  }

  .value.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .value.multiline {
    white-space: pre-wrap;
    max-height: 120px;
    overflow-y: auto;
  }

  .buttons {
    display: flex;
    gap: 2px;
    flex: none;
  }

  button,
  .link-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }

  button:hover,
  .link-btn:hover {
    background: var(--bg-subtle);
    color: var(--text);
  }
</style>
