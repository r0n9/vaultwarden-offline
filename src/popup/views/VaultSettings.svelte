<script lang="ts">
  import { KdfType } from "@/core/crypto";
  import {
    VAULT_TIMEOUT_OPTIONS,
    VaultTimeoutAction,
    type Settings,
    type VaultTimeout,
  } from "@/core/state/settings";
  import type { FolderView } from "@/core/vault/models";
  import {
    deleteFolder,
    emptyTrash,
    newFolderDraft,
    saveFolder,
  } from "@/core/vault/vault-repository";
  import { sendMessage } from "@/platform/messaging";
  import type { VaultSummary } from "@/platform/messaging/types";
  import { browserVaultStorage as storage } from "@/platform/storage/browser-vault-storage";

  import CryptoSelfTest from "../components/CryptoSelfTest.svelte";
  import { openInTab } from "../lib/navigation";

  const {
    summary,
    folders,
    cipherCount,
    loadMs,
    onBack,
    onChanged,
  }: {
    summary: VaultSummary;
    folders: FolderView[];
    cipherCount: number;
    loadMs: number;
    onBack: () => void;
    onChanged: () => void;
  } = $props();

  let settings = $state<Settings | null>(null);
  let newFolderName = $state("");
  let confirmingClear = $state(false);
  let notice = $state("");
  let busy = $state(false);

  const kdfLabel = $derived(
    summary.kdfType === KdfType.Argon2id
      ? "Argon2id"
      : `PBKDF2-SHA256 · ${(summary.kdfIterations ?? 0).toLocaleString()} 轮`,
  );

  $effect(() => {
    void (async () => {
      settings = (await sendMessage("settings:get")) ?? null;
    })();
  });

  async function updateTimeout(event: Event) {
    const raw = (event.currentTarget as HTMLSelectElement).value;
    // 数值型超时（分钟）与字符串型触发方式共用一个下拉框，这里还原类型。
    const value: VaultTimeout = /^\d+$/.test(raw) ? Number(raw) : (raw as VaultTimeout);
    settings = (await sendMessage("settings:save", { vaultTimeout: value })) ?? settings;
  }

  async function updateAction(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as VaultTimeoutAction;
    settings = (await sendMessage("settings:save", { vaultTimeoutAction: value })) ?? settings;
  }

  async function addFolder() {
    const name = newFolderName.trim();
    if (name === "" || busy) {
      return;
    }
    busy = true;
    try {
      await saveFolder(storage, newFolderDraft(name));
      newFolderName = "";
      onChanged();
    } finally {
      busy = false;
    }
  }

  async function removeFolder(folder: FolderView) {
    busy = true;
    try {
      const orphaned = await deleteFolder(storage, folder.id);
      notice =
        orphaned > 0
          ? `已删除文件夹「${folder.name}」，其中 ${orphaned} 个条目已移至「无文件夹」`
          : `已删除文件夹「${folder.name}」`;
      onChanged();
    } finally {
      busy = false;
    }
  }

  async function clearTrash() {
    busy = true;
    try {
      const removed = await emptyTrash(storage);
      notice = removed > 0 ? `已永久删除 ${removed} 个条目` : "回收站本来就是空的";
      onChanged();
    } finally {
      busy = false;
    }
  }

  async function lockNow() {
    await sendMessage("vault:lock");
    onChanged();
  }

  async function destroyVault() {
    await sendMessage("vault:clear");
    confirmingClear = false;
    onChanged();
  }
</script>

<div class="settings">
  <button class="back" onclick={onBack}>‹ 返回</button>

  {#if notice !== ""}
    <p class="notice">{notice}</p>
  {/if}

  <section class="panel">
    <h2>密码库</h2>
    <dl>
      <dt>条目</dt>
      <dd>{cipherCount}</dd>
      <dt>文件夹</dt>
      <dd>{folders.length}</dd>
      <dt>密钥派生</dt>
      <dd>{kdfLabel}</dd>
      <dt>解密耗时</dt>
      <dd>{loadMs.toFixed(0)} ms</dd>
      <dt>创建于</dt>
      <dd>{summary.createdAt == null ? "—" : new Date(summary.createdAt).toLocaleDateString()}</dd>
    </dl>
  </section>

  <section class="panel">
    <h2>文件夹</h2>
    {#if folders.length === 0}
      <p class="hint">还没有文件夹。</p>
    {:else}
      <ul class="folders">
        {#each folders as folder (folder.id)}
          <li>
            <span>{folder.name}</span>
            <button onclick={() => removeFolder(folder)} disabled={busy} aria-label="删除文件夹">
              ×
            </button>
          </li>
        {/each}
      </ul>
      <p class="hint">删除文件夹不会删除其中的条目，它们会回到「无文件夹」。</p>
    {/if}
    <div class="add-folder">
      <input type="text" placeholder="新文件夹名称" bind:value={newFolderName} />
      <button class="btn btn-secondary" onclick={addFolder} disabled={busy}>添加</button>
    </div>
  </section>

  <section class="panel">
    <h2>数据</h2>
    <div class="row">
      <button class="btn btn-secondary" onclick={() => openInTab("import")}>导入</button>
      <button class="btn btn-secondary" onclick={() => openInTab("export")}>导出</button>
    </div>
    <button class="btn btn-secondary" onclick={clearTrash} disabled={busy}>清空回收站</button>
  </section>

  <section class="panel">
    <h2>自动锁定</h2>
    {#if settings == null}
      <p class="hint">读取中…</p>
    {:else}
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
    {/if}
  </section>

  <div class="actions">
    <button class="btn btn-secondary" onclick={lockNow}>立即锁定</button>

    {#if confirmingClear}
      <p class="alert">销毁后无法恢复，确定继续？</p>
      <div class="row">
        <button class="btn btn-secondary" onclick={() => (confirmingClear = false)}>取消</button>
        <button class="btn btn-danger" onclick={destroyVault}>确认销毁</button>
      </div>
    {:else}
      <button class="btn btn-danger" onclick={() => (confirmingClear = true)}>
        销毁本地密码库
      </button>
    {/if}
  </div>

  <details>
    <summary>加密自检</summary>
    <CryptoSelfTest />
  </details>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

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

  .notice {
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-subtle);
    font-size: 12px;
    margin: 0;
  }

  h2 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .panel {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    margin: 0;
    font-size: 12px;
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    text-align: right;
  }

  .folders {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .folders li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
  }

  .folders button {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 0 4px;
  }

  .folders button:hover {
    color: var(--danger);
  }

  .add-folder {
    display: flex;
    gap: 6px;
  }

  .add-folder .btn {
    width: auto;
    flex: none;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .warn {
    color: var(--danger);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  details {
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }

  summary {
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
  }
</style>
