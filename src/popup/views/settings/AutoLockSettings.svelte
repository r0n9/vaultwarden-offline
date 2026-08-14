<script lang="ts">
  import {
    VAULT_TIMEOUT_OPTIONS,
    VaultTimeoutAction,
    type Settings,
    type VaultTimeout,
  } from "@/core/state/settings";
  import { sendMessage } from "@/platform/messaging";

  const {
    settings,
    onSaved,
    onBack,
  }: { settings: Settings; onSaved: (s: Settings) => void; onBack: () => void } = $props();

  async function updateTimeout(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    const value: VaultTimeout = /^\d+$/.test(raw) ? Number(raw) : (raw as VaultTimeout);
    const saved = (await sendMessage("settings:save", { vaultTimeout: value })) ?? settings;
    onSaved(saved);
  }

  async function updateAction(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as VaultTimeoutAction;
    const saved = (await sendMessage("settings:save", { vaultTimeoutAction: value })) ?? settings;
    onSaved(saved);
  }
</script>

<button class="back" onclick={onBack}>‹ 返回</button>
<h1>自动锁定</h1>

<div class="field">
  <label for="timeout">锁定时机</label>
  <select id="timeout" value={String(settings.vaultTimeout)} onchange={updateTimeout}>
    {#each VAULT_TIMEOUT_OPTIONS as option (option.value)}
      <option value={String(option.value)}>{option.label}</option>
    {/each}
  </select>
</div>

<div class="field">
  <label for="action">超时后</label>
  <select id="action" value={settings.vaultTimeoutAction} onchange={updateAction}>
    <option value={VaultTimeoutAction.Lock}>锁定（保留数据）</option>
    <option value={VaultTimeoutAction.Clear}>清空（销毁本地数据）</option>
  </select>
  {#if settings.vaultTimeoutAction === VaultTimeoutAction.Clear}
    <p class="hint warn">超时会永久删除本地密码库。请确认你已有导出备份。</p>
  {/if}
</div>

<style>
  .back {
    align-self: flex-start;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    padding: 0;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .warn {
    color: var(--danger);
  }
</style>
