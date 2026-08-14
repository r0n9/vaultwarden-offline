<script lang="ts">
  import { KdfType } from "@/core/crypto";
  import type { Settings } from "@/core/state/settings";
  import { validateMasterPassword } from "@/core/vault/vault.service";
  import type { FolderView } from "@/core/vault/models";
  import { sendMessage } from "@/platform/messaging";
  import type { VaultSummary } from "@/platform/messaging/types";

  import AppearanceSettings from "./settings/AppearanceSettings.svelte";
  import AutofillSettings from "./settings/AutofillSettings.svelte";
  import AutoLockSettings from "./settings/AutoLockSettings.svelte";
  import DataSettings from "./settings/DataSettings.svelte";
  import FolderSettings from "./settings/FolderSettings.svelte";
  import PinSettings from "./settings/PinSettings.svelte";
  import SelfTestSettings from "./settings/SelfTestSettings.svelte";
  import AutofillDebug from "./AutofillDebug.svelte";

  const {
    summary,
    folders,
    cipherCount,
    loadMs,
    onChanged,
  }: {
    summary: VaultSummary;
    folders: FolderView[];
    cipherCount: number;
    loadMs: number;
    onChanged: () => void;
  } = $props();

  /** 当前二级页面；null 表示设置首页。 */
  let screen = $state<string | null>(null);

  let settings = $state<Settings | null>(null);

  let notice = $state("");

  let passwordChangeMode = $state(false);
  let currentPassword = $state("");
  let newPassword = $state("");
  let newPasswordConfirm = $state("");
  let passwordChangeError = $state("");
  let passwordChangeBusy = $state(false);

  let clearDataMode = $state(false);
  let clearDataPassword = $state("");
  let clearDataError = $state("");
  let clearDataBusy = $state(false);

  let confirmingClear = $state(false);
  let destroyPassword = $state("");
  let destroyError = $state("");
  let destroyBusy = $state(false);

  $effect(() => {
    void (async () => {
      settings = (await sendMessage("settings:get")) ?? null;
    })();
  });

  const kdfLabel = $derived(
    summary.kdfType === KdfType.Argon2id
      ? "Argon2id"
      : `PBKDF2-SHA256 · ${(summary.kdfIterations ?? 0).toLocaleString()} 轮`,
  );

  const newPasswordError = $derived(validateMasterPassword(newPassword));
  const newPasswordMismatch = $derived(
    newPasswordConfirm.length > 0 && newPassword !== newPasswordConfirm,
  );

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

  async function lockNow() {
    await sendMessage("vault:lock");
    onChanged();
  }

  async function verifyAndClearData() {
    if (clearDataPassword === "" || clearDataBusy) {
      return;
    }
    clearDataBusy = true;
    clearDataError = "";
    try {
      const verification = await sendMessage("vault:verifyPassword", {
        masterPassword: clearDataPassword,
      });
      if (verification?.valid !== true) {
        clearDataError = "主密码不正确";
        return;
      }
      await sendMessage("vault:clearData");
      clearDataMode = false;
      clearDataPassword = "";
      notice = "密码库数据已清空（条目与文件夹），主密码保持不变。";
      onChanged();
    } finally {
      clearDataBusy = false;
    }
  }

  async function destroyVault() {
    if (destroyPassword === "" || destroyBusy) {
      return;
    }
    destroyBusy = true;
    destroyError = "";
    try {
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

  /** 设置首页的二级菜单项（分组）。 */
  const MENU_GROUPS = [
    {
      label: "常规",
      items: [
        { key: "appearance", title: "外观", desc: "跟随系统 / 浅色 / 深色" },
        { key: "autolock", title: "自动锁定", desc: "锁定时机与超时动作" },
        { key: "autofill", title: "自动填充", desc: "字段检测与快捷键" },
        { key: "pin", title: "解锁方式", desc: "PIN 快捷解锁" },
      ],
    },
    {
      label: "数据管理",
      items: [
        { key: "folders", title: "文件夹", desc: "管理条目分类" },
        { key: "data", title: "数据", desc: "导入 / 导出 / 回收站" },
        { key: "selftest", title: "加密自检", desc: "验证加密原语正确性" },
      ],
    },
  ] as const;
</script>

{#if screen === "appearance"}
  {#if settings != null}
    <AppearanceSettings
      {settings}
      onSaved={(next) => (settings = next)}
      onBack={() => (screen = null)}
    />
  {/if}
{:else if screen === "autolock"}
  {#if settings != null}
    <AutoLockSettings
      {settings}
      onSaved={(next) => (settings = next)}
      onBack={() => (screen = null)}
    />
  {/if}
{:else if screen === "autofill"}
  <AutofillSettings onCollect={() => (screen = "collect")} onBack={() => (screen = null)} />
{:else if screen === "collect"}
  <AutofillDebug onBack={() => (screen = "autofill")} />
{:else if screen === "pin"}
  <PinSettings onBack={() => (screen = null)} />
{:else if screen === "folders"}
  <FolderSettings {folders} onChanged={onChanged} onBack={() => (screen = null)} />
{:else if screen === "data"}
  <DataSettings onChanged={onChanged} onBack={() => (screen = null)} />
{:else if screen === "selftest"}
  <SelfTestSettings onBack={() => (screen = null)} />
{:else}
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

    {#each MENU_GROUPS as group (group.label)}
      <div class="menu-group">
        <span class="menu-group-label">{group.label}</span>
        <section class="panel menu">
          {#each group.items as item (item.key)}
            <button class="menu-row" onclick={() => (screen = item.key)}>
              <span class="menu-text">
                <span class="menu-title">{item.title}</span>
                <span class="menu-desc">{item.desc}</span>
              </span>
              <span class="menu-arrow">›</span>
            </button>
          {/each}
        </section>
      </div>
    {/each}

    <section class="panel danger">
      <h2>危险区</h2>

      {#if passwordChangeMode}
        <div class="field">
          <label for="cur-pw">当前主密码</label>
          <input id="cur-pw" type="password" bind:value={currentPassword} autocomplete="current-password" />
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

      {#if clearDataMode}
        <p class="alert">将删除全部条目与文件夹，密码库本身（主密码、PIN）保留。请输入主密码确认。</p>
        <div class="field">
          <label for="clear-data-pw">主密码</label>
          <input
            id="clear-data-pw"
            type="password"
            bind:value={clearDataPassword}
            autocomplete="current-password"
            onkeydown={(e) => {
              if (e.key === "Enter") {
                void verifyAndClearData();
              }
            }}
          />
        </div>
        {#if clearDataError !== ""}
          <p class="alert">{clearDataError}</p>
        {/if}
        <div class="row">
          <button
            class="btn btn-secondary"
            onclick={() => {
              clearDataMode = false;
              clearDataPassword = "";
              clearDataError = "";
            }}
          >
            取消
          </button>
          <button
            class="btn btn-danger"
            onclick={() => void verifyAndClearData()}
            disabled={clearDataBusy || clearDataPassword === ""}
          >
            {clearDataBusy ? "验证中…" : "确认清空"}
          </button>
        </div>
      {:else}
        <button class="btn btn-secondary" onclick={() => (clearDataMode = true)}>清空密码库数据</button>
      {/if}

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
          <button
            class="btn btn-danger"
            onclick={() => void destroyVault()}
            disabled={destroyBusy || destroyPassword === ""}
          >
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
{/if}

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

  /* 二级菜单分组 */
  .menu-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .menu-group-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 2px;
  }

  /* 二级菜单：每项一行（细分隔线区分），点击进入子页面 */
  .panel.menu {
    padding: 4px;
  }

  .menu-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 11px 8px;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.12s ease;
  }

  .menu-row:last-child {
    border-bottom: none;
  }

  .menu-row:hover {
    background: var(--bg-subtle);
  }

  .menu-row:first-child {
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
  }

  .menu-row:last-child {
    border-bottom-left-radius: 6px;
    border-bottom-right-radius: 6px;
  }

  .menu-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .menu-title {
    font-size: 13px;
    font-weight: 600;
  }

  .menu-desc {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .menu-arrow {
    color: var(--text-muted);
    font-size: 15px;
    flex: none;
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

  .row {
    display: flex;
    gap: 8px;
  }

  .invalid {
    color: var(--danger);
  }

  .panel.danger {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    background: color-mix(in srgb, var(--danger) 5%, var(--surface));
  }

  .panel.danger h2 {
    color: var(--danger);
  }
</style>
