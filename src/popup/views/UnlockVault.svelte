<script lang="ts">
  import { sendMessage } from "@/platform/messaging";
  import { ErrorCode } from "@/platform/messaging/types";

  const { onUnlocked }: { onUnlocked: () => void } = $props();

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
    if (busy || password.length === 0 || retryAfterSeconds > 0) {
      return;
    }

    busy = true;
    error = "";
    try {
      const result = await sendMessage("vault:unlock", { masterPassword: password });

      if (result == null) {
        error = "背景服务未响应，请重试";
      } else if (result.ok) {
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

  $effect(() => () => clearInterval(countdownTimer));
</script>

<form onsubmit={submit}>
  <div class="lead">
    <span class="glyph">🔒</span>
    <h1>密码库已锁定</h1>
  </div>

  <div class="field">
    <label for="master">主密码</label>
    <!-- popup 是用户主动唤起的聚焦上下文，自动定位到密码框是这里的正确交互，
         不同于普通页面里 autofocus 会打断读屏用户的情形。 -->
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="master"
      type="password"
      bind:value={password}
      autocomplete="current-password"
      autofocus
    />
  </div>

  {#if error !== ""}
    <p class="alert">
      {error}
      {#if retryAfterSeconds > 0}（还需等待 {retryAfterSeconds} 秒）{/if}
    </p>
  {/if}

  <button class="btn" type="submit" disabled={busy || password.length === 0 || retryAfterSeconds > 0}>
    {busy ? "正在解锁…" : "解锁"}
  </button>

  <p class="hint">
    解锁需要完整跑一遍密钥派生，视 KDF 参数可能需要一两秒。
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
</style>
