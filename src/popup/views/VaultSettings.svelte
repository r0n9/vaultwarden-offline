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
  import { validateMasterPassword, validatePin } from "@/core/vault/vault.service";
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
    onChanged,
    onOpenCollect,
  }: {
    summary: VaultSummary;
    folders: FolderView[];
    cipherCount: number;
    loadMs: number;
    onChanged: () => void;
    onOpenCollect: () => void;
  } = $props();

  let settings = $state<Settings | null>(null);

  let passwordChangeMode = $state(false);
  let currentPassword = $state("");
  let newPassword = $state("");
  let newPasswordConfirm = $state("");
  let passwordChangeError = $state("");
  let passwordChangeBusy = $state(false);

  let exportVerifyMode = $state(false);
  let exportPassword = $state("");
  let exportError = $state("");
  let exportBusy = $state(false);

  let pinEnabled = $state(false);
  let pinMode = $state<"idle" | "edit" | "remove">("idle");
  let pinValue = $state("");
  let pinConfirm = $state("");
  let pinError = $state("");
  let pinBusy = $state(false);

  let newFolderName = $state("");
  let confirmingClear = $state(false);
  let destroyPassword = $state("");
  let destroyError = $state("");
  let destroyBusy = $state(false);
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
      const pinResult = await sendMessage("vault:hasPin");
      pinEnabled = pinResult?.hasPin === true;
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

  const pinInvalid = $derived(validatePin(pinValue));
  const pinMismatch = $derived(pinConfirm.length > 0 && pinValue !== pinConfirm);

  const newPasswordError = $derived(validateMasterPassword(newPassword));
  const newPasswordMismatch = $derived(newPasswordConfirm.length > 0 && newPassword !== newPasswordConfirm);

  async function submitPasswordChange() {
    if (passwordChangeBusy || newPasswordError != null || newPasswordMismatch) {
      return;
    }
    passwordChangeBusy = true;
    passwordChangeError = "";
    try {
      const result = await sendMessage("vault:changePassword", {
        currentPassword,
        newPassword,
      });
      if (result?.ok === true) {
        passwordChangeMode = false;
        currentPassword = "";
        newPassword = "";
        newPasswordConfirm = "";
        notice = "主密码已更新。";
      } else {
        passwordChangeError = result?.message ?? "修改失败";
      }
    } finally {
      passwordChangeBusy = false;
    }
  }

  async function verifyAndOpenExport() {
    if (exportPassword === "" || exportBusy) {
      return;
    }
    exportBusy = true;
    exportError = "";
    try {
      // 导出文件包含全部密码，先验证主密码——防「密码库已解锁、人却离开了座位」。
      const verification = await sendMessage("vault:verifyPassword", {
        masterPassword: exportPassword,
      });

      if (verification?.valid !== true) {
        exportError = "主密码不正确";
        return;
      }

      openInTab("export");
      exportVerifyMode = false;
      exportPassword = "";
    } finally {
      exportBusy = false;
    }
  }

  async function savePin() {
    if (pinError !== "" || pinBusy) {
      return;
    }
    if (pinInvalid != null || pinMismatch) {
      return;
    }
    pinBusy = true;
    pinError = "";
    try {
      const result = await sendMessage("vault:setPin", { pin: pinValue });
      if (result?.ok === true) {
        pinEnabled = true;
        pinMode = "idle";
        pinValue = "";
        pinConfirm = "";
      } else {
        pinError = result?.message ?? "设置失败";
      }
    } finally {
      pinBusy = false;
    }
  }

  async function removePin() {
    pinBusy = true;
    pinError = "";
    try {
      const result = await sendMessage("vault:clearPin");
      if (result?.ok === true) {
        pinEnabled = false;
        pinMode = "idle";
      } else {
        pinError = result?.message ?? "移除失败";
      }
    } finally {
      pinBusy = false;
    }
  }

  async function destroyVault() {
    if (destroyPassword === "" || destroyBusy) {
      return;
    }
    destroyBusy = true;
    destroyError = "";
    try {
      // 销毁是不可逆操作，先验证主密码（防的是「密码库已解锁、人却离开了座位」）。
      const verification = await sendMessage("vault:verifyPassword", {
        masterPassword: destroyPassword,
      });

      if (verification?.valid !== true) {
        destroyError = "主密码不正确";
        return;
      }

      await sendMessage("vault:clear");
      confirmingClear = false;
      destroyPassword = "";
      onChanged();
    } finally {
      destroyBusy = false;
    }
  }
</script>

<div class="settings">
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

  <section class="panel">
    <h2>自动填充</h2>
    <button class="btn btn-secondary" onclick={onOpenCollect}>检测当前页面字段</button>
    <p class="hint">在打开的站点页面上识别登录表单与字段结构。</p>
  </section>

  <section class="panel">
    <h2>解锁方式</h2>
    {#if pinMode === "idle"}
      <p class="pin-status">
        PIN 解锁：{pinEnabled ? "已启用" : "未设置"}
      </p>
      <p class="hint">
        PIN 是主密码的快捷解锁方式（4-12 位数字或字母）。数据加密强度不变，
        但浏览器端无系统设备锁保护，PIN 熵低属于便利换风险，请自行权衡。
      </p>
      <div class="row">
        <button class="btn btn-secondary" onclick={() => (pinMode = "edit")}>
          {pinEnabled ? "修改 PIN" : "设置 PIN"}
        </button>
        {#if pinEnabled}
          <button class="btn btn-secondary" onclick={() => (pinMode = "remove")}>移除 PIN</button>
        {/if}
      </div>
    {:else if pinMode === "edit"}
      <div class="field">
        <label for="pin-new">PIN</label>
        <input
          id="pin-new"
          type="password"
          bind:value={pinValue}
          autocomplete="new-password"
        />
        {#if pinValue.length > 0 && pinInvalid != null}
          <p class="hint invalid">{pinInvalid}</p>
        {/if}
      </div>
      <div class="field">
        <label for="pin-confirm">确认 PIN</label>
        <input
          id="pin-confirm"
          type="password"
          bind:value={pinConfirm}
          autocomplete="new-password"
        />
        {#if pinMismatch}
          <p class="hint invalid">两次输入不一致</p>
        {/if}
      </div>
      {#if pinError !== ""}
        <p class="alert">{pinError}</p>
      {/if}
      <div class="row">
        <button
          class="btn btn-secondary"
          onclick={() => {
            pinMode = "idle";
            pinValue = "";
            pinConfirm = "";
            pinError = "";
          }}
        >
          取消
        </button>
        <button
          class="btn"
          onclick={() => void savePin()}
          disabled={pinBusy || pinInvalid != null || pinMismatch || pinValue === ""}
        >
          {pinBusy ? "保存中…" : "保存"}
        </button>
      </div>
    {:else}
      <p class="alert">移除 PIN 后将只能使用主密码解锁。确定移除？</p>
      <div class="row">
        <button class="btn btn-secondary" onclick={() => (pinMode = "idle")}>取消</button>
        <button class="btn btn-danger" onclick={() => void removePin()} disabled={pinBusy}>
          {pinBusy ? "移除中…" : "确认移除"}
        </button>
      </div>
    {/if}
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
    {#if exportVerifyMode}
      <div class="field">
        <label for="export-pw">验证主密码</label>
        <input
          id="export-pw"
          type="password"
          bind:value={exportPassword}
          autocomplete="current-password"
          onkeydown={(e) => {
            if (e.key === "Enter") {
              void verifyAndOpenExport();
            }
          }}
        />
      </div>
      {#if exportError !== ""}
        <p class="alert">{exportError}</p>
      {/if}
      <div class="row">
        <button
          class="btn btn-secondary"
          onclick={() => {
            exportVerifyMode = false;
            exportPassword = "";
            exportError = "";
          }}
        >
          取消
        </button>
        <button
          class="btn"
          onclick={() => void verifyAndOpenExport()}
          disabled={exportBusy || exportPassword === ""}
        >
          {exportBusy ? "验证中…" : "验证并导出"}
        </button>
      </div>
    {:else}
      <div class="row">
        <button class="btn btn-secondary" onclick={() => openInTab("import")}>导入</button>
        <button class="btn btn-secondary" onclick={() => (exportVerifyMode = true)}>导出</button>
      </div>
    {/if}
    <button class="btn btn-secondary" onclick={clearTrash} disabled={busy}>清空回收站</button>
  </section>

  <details class="self-test">
    <summary>加密自检</summary>
    <CryptoSelfTest />
  </details>

  <section class="panel danger">
    <h2>危险区</h2>

    {#if passwordChangeMode}
      <div class="field">
        <label for="cur-pw">当前主密码</label>
        <input
          id="cur-pw"
          type="password"
          bind:value={currentPassword}
          autocomplete="current-password"
        />
      </div>
      <div class="field">
        <label for="new-pw">新主密码</label>
        <input id="new-pw" type="password" bind:value={newPassword} autocomplete="new-password" />
        {#if newPassword.length > 0 && newPasswordError != null}
          <p class="hint invalid">{newPasswordError}</p>
        {/if}
      </div>
      <div class="field">
        <label for="new-pw2">确认新主密码</label>
        <input
          id="new-pw2"
          type="password"
          bind:value={newPasswordConfirm}
          autocomplete="new-password"
        />
        {#if newPasswordMismatch}
          <p class="hint invalid">两次输入不一致</p>
        {/if}
      </div>
      {#if passwordChangeError !== ""}
        <p class="alert">{passwordChangeError}</p>
      {/if}
      <div class="row">
        <button
          class="btn btn-secondary"
          onclick={() => {
            passwordChangeMode = false;
            currentPassword = "";
            newPassword = "";
            newPasswordConfirm = "";
            passwordChangeError = "";
          }}
        >
          取消
        </button>
        <button
          class="btn"
          onclick={() => void submitPasswordChange()}
          disabled={passwordChangeBusy || currentPassword === "" || newPasswordError != null || newPasswordMismatch}
        >
          {passwordChangeBusy ? "修改中…" : "确认修改"}
        </button>
      </div>
    {:else}
      <button class="btn btn-secondary" onclick={() => (passwordChangeMode = true)}>
        修改主密码
      </button>
    {/if}

    <button class="btn btn-secondary" onclick={lockNow}>立即锁定</button>

    {#if confirmingClear}
      <p class="alert">销毁后无法恢复。请输入主密码确认操作。</p>
      <div class="field">
        <label for="destroy-pw">主密码</label>
        <input
          id="destroy-pw"
          type="password"
          bind:value={destroyPassword}
          autocomplete="current-password"
          onkeydown={(e) => {
            if (e.key === "Enter") {
              void destroyVault();
            }
          }}
        />
      </div>
      {#if destroyError !== ""}
        <p class="alert">{destroyError}</p>
      {/if}
      <div class="row">
        <button
          class="btn btn-secondary"
          onclick={() => {
            confirmingClear = false;
            destroyPassword = "";
            destroyError = "";
          }}
        >
          取消
        </button>
        <button class="btn btn-danger" onclick={() => void destroyVault()} disabled={destroyBusy || destroyPassword === ""}>
          {destroyBusy ? "验证中…" : "确认销毁"}
        </button>
      </div>
    {:else}
      <button class="btn btn-danger" onclick={() => (confirmingClear = true)}>
        销毁本地密码库
      </button>
    {/if}
  </section>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  .invalid {
    color: var(--danger);
  }

  .pin-status {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }

  .panel.danger {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    background: color-mix(in srgb, var(--danger) 5%, var(--surface));
  }

  .panel.danger h2 {
    color: var(--danger);
  }

  details.self-test {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    padding: 10px 12px;
  }

  summary {
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
  }
</style>
