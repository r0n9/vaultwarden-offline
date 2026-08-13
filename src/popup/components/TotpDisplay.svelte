<script lang="ts">
  import { parseOtpauthUri } from "@/core/totp/otpauth";
  import { generateSteamCode, generateTotp, secondsRemaining } from "@/core/totp/totp";

  const { totpValue }: { totpValue: string } = $props();

  let code = $state("");
  let remaining = $state(0);
  let error = $state("");
  let copied = $state(false);

  async function copy() {
    if (code === "") {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      // 剪贴板不可用时静默失败，复制按钮只是便捷功能。
    }
  }

  const parsed = $derived(parseOtpauthUri(totpValue) ?? {
    isSteam: false,
    label: "",
    config: {
      // 裸 secret（没有 otpauth:// 前缀）也按标准 TOTP 处理。
      secret: totpValue,
      algorithm: "SHA1" as const,
      digits: 6,
      period: 30,
    },
  });

  async function refresh() {
    const now = Math.floor(Date.now() / 1000);
    remaining = secondsRemaining(now, parsed.config.period);
    try {
      code = parsed.isSteam
        ? await generateSteamCode(parsed.config.secret, now)
        : await generateTotp(parsed.config, now);
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  });

  const progress = $derived(remaining / parsed.config.period);
</script>

<div class="totp">
  <div class="code-row">
    <span class="code" class:error={error !== ""}>{error !== "" ? "无效的验证器密钥" : code || "…"}</span>
    {#if code !== ""}
      <button
        type="button"
        class="copy"
        onclick={copy}
        title="复制验证码"
        aria-label="复制验证码"
      >
        {copied ? "✓" : "⧉"}
      </button>
    {/if}
  </div>

  {#if error === ""}
    <div class="meta">
      <span class="secs">{remaining}s</span>
      <div class="bar">
        <div class="fill" style:width="{progress * 100}%"></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .totp {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .code-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 15px;
    letter-spacing: 0.08em;
    font-variant-numeric: tabular-nums;
  }

  .code.error {
    color: var(--danger);
    font-size: 12px;
  }

  .copy {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .copy:hover {
    background: var(--bg-subtle);
    color: var(--text);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .secs {
    font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    min-width: 22px;
  }

  .bar {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--bg-subtle);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 1s linear;
  }
</style>
