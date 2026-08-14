<script lang="ts">
  import { sendMessage } from "@/platform/messaging";
  import { ErrorCode } from "@/platform/messaging/types";

  const { onUnlocked }: { onUnlocked: () => void } = $props();

  /** 已设置 PIN 时可在「PIN / 主密码」之间切换。 */
  let mode = $state<"password" | "pin">("password");
  let hasPinConfigured = $state(false);

  let pin = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state("");
  let retryAfterSeconds = $state(0);

  let countdownTimer: ReturnType<typeof setInterval> | undefined;

  function startCountdown(ms: number) {
    retryAfterSeconds = Math.ceil(ms / 1000);
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      retryAfterSeconds -= 1;
      if (retryAfterSeconds <= 0) {
        clearInterval(countdownTimer);
        error = "";
      }
    }, 1000);
  }

  async function submit(event: Event) {
    event.preventDefault();
    const value = mode === "pin" ? pin : password;
    if (busy || value.length === 0 || retryAfterSeconds > 0) {
      return;
    }

    busy = true;
    error = "";
    try {
      const result =
        mode === "pin"
          ? await sendMessage("vault:unlockWithPin", { pin: value })
          : await sendMessage("vault:unlock", { masterPassword: value });

      if (result == null) {
        error = "背景服务未响应，请重试";
      } else if (result.ok) {
        pin = "";
        password = "";
        onUnlocked();
      } else {
        error = result.message;
        if (result.code === ErrorCode.Throttled && result.retryAfterMs != null) {
          startCountdown(result.retryAfterMs);
        }
      }
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void (async () => {
      const result = await sendMessage("vault:hasPin");
      hasPinConfigured = result?.hasPin === true;
      // 有 PIN 时默认走 PIN 解锁（更快的路径）。
      if (hasPinConfigured) {
        mode = "pin";
      }
    })();

    return () => clearInterval(countdownTimer);
  });
</script>

<form onsubmit={submit}>
  <div class="lead">
    <span class="glyph">🔒</span>
    <h1>密码库已锁定</h1>
  </div>

  {#if hasPinConfigured}
    <div class="mode-switch">
      <button
        type="button"
        class:active={mode === "pin"}
        onclick={() => {
          mode = "pin";
          error = "";
        }}
      >
        PIN
      </button>
      <button
        type="button"
        class:active={mode === "password"}
        onclick={() => {
          mode = "password";
          error = "";
        }}
      >
        主密码
      </button>
    </div>
  {/if}

  <div class="field">
    <!-- svelte-ignore a11y_autofocus -->
    {#if mode === "pin"}
      <label for="pin-input">PIN</label>
      <input
        id="pin-input"
        type="password"
        bind:value={pin}
        autocomplete="current-password"
        autofocus
      />
    {:else}
      <label for="master">主密码</label>
      <input
        id="master"
        type="password"
        bind:value={password}
        autocomplete="current-password"
        autofocus
      />
    {/if}
  </div>

  {#if error !== ""}
    <p class="alert">
      {error}
      {#if retryAfterSeconds > 0}（还需等待 {retryAfterSeconds} 秒）{/if}
    </p>
  {/if}

  <button
    class="btn"
    type="submit"
    disabled={busy || (mode === "pin" ? pin.length === 0 : password.length === 0) || retryAfterSeconds > 0}
  >
    {busy ? "正在解锁…" : "解锁"}
  </button>

  <p class="hint">
    {mode === "pin" ? "PIN 是主密码的快捷解锁方式，数据加密强度不变。" : "解锁需要完整跑一遍密钥派生，视 KDF 参数可能需要一两秒。"}
  </p>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .lead {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .glyph {
    font-size: 26px;
    line-height: 1;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .mode-switch {
    display: flex;
    gap: 4px;
  }

  .mode-switch button {
    flex: 1;
    padding: 6px 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }

  .mode-switch button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
</style>
