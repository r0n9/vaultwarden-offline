<script lang="ts">
  import { type KdfConfig, defaultArgon2Config, defaultKdfConfig } from "@/core/crypto";
  import { sendMessage } from "@/platform/messaging";

  import { openInTab } from "../lib/navigation";

  const { onCreated }: { onCreated: () => void } = $props();

  let password = $state("");
  let confirmation = $state("");
  let useArgon2 = $state(false);
  let busy = $state(false);
  let error = $state("");

  const mismatch = $derived(confirmation.length > 0 && password !== confirmation);
  const canSubmit = $derived(password.length >= 8 && password === confirmation && !busy);

  async function submit(event: Event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    busy = true;
    error = "";
    try {
      const kdf: KdfConfig = useArgon2 ? defaultArgon2Config() : defaultKdfConfig();
      const result = await sendMessage("vault:create", { masterPassword: password, kdf });

      if (result == null) {
        error = "背景服务未响应，请重试";
      } else if (result.ok) {
        password = "";
        confirmation = "";
        onCreated();
      } else {
        error = result.message;
      }
    } finally {
      busy = false;
    }
  }
</script>

<form onsubmit={submit}>
  <div class="intro">
    <h1>创建本地密码库</h1>
    <p class="hint">
      主密码只存在于你的记忆里——它不会被保存到任何地方，也无法找回。忘记即意味着数据永久丢失。
    </p>
  </div>

  <div class="import-cta">
    <p class="hint">已有 Bitwarden / Vaultwarden 的导出文件？</p>
    <button class="btn btn-secondary" type="button" onclick={() => openInTab("import")}>
      从导出文件导入
    </button>
  </div>

  <div class="field">
    <label for="pw">主密码</label>
    <input id="pw" type="password" bind:value={password} autocomplete="new-password" />
    <p class="hint">至少 8 位。建议使用一句只有你知道的长句子。</p>
  </div>

  <div class="field">
    <label for="pw2">确认主密码</label>
    <input id="pw2" type="password" bind:value={confirmation} autocomplete="new-password" />
    {#if mismatch}
      <p class="hint mismatch">两次输入不一致</p>
    {/if}
  </div>

  <label class="checkbox">
    <input type="checkbox" bind:checked={useArgon2} />
    <span>
      使用 Argon2id
      <span class="hint">抗显卡爆破更强，但解锁需加载 WASM，略慢</span>
    </span>
  </label>

  {#if error !== ""}
    <p class="alert">{error}</p>
  {/if}

  <button class="btn" type="submit" disabled={!canSubmit}>
    {busy ? "正在创建…" : "创建密码库"}
  </button>

  <p class="hint">
    默认 PBKDF2-SHA256 60 万轮，与 Bitwarden 一致。稍后可在设置中更换。
  </p>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .intro h1 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
  }

  .mismatch {
    color: var(--danger);
  }

  .import-cta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    cursor: pointer;
  }

  .checkbox input {
    margin: 2px 0 0;
    flex: none;
  }

  .checkbox span {
    display: flex;
    flex-direction: column;
  }
</style>
