<script lang="ts">
  import { VaultStatus } from "@/core/state/vault-status";
  import type { FolderView } from "@/core/vault/models";
  import { loadVault } from "@/core/vault/vault-repository";
  import { runtime, t } from "@/platform/browser-api";
  import { sendMessage } from "@/platform/messaging";
  import type { VaultSummary } from "@/platform/messaging/types";
  import { browserVaultStorage as storage } from "@/platform/storage/browser-vault-storage";

  import CreateVault from "./views/CreateVault.svelte";
  import ExportVault from "./views/ExportVault.svelte";
  import GeneratorView from "./views/GeneratorView.svelte";
  import ImportVault from "./views/ImportVault.svelte";
  import UnlockVault from "./views/UnlockVault.svelte";
  import VaultSettings from "./views/VaultSettings.svelte";
  import VaultShell from "./views/VaultShell.svelte";
  import { connectToBackground } from "./lib/background-port";
  import { currentView, isStandalone } from "./lib/navigation";

  /** 解锁态底部 tab，参考 Bitwarden 的 Vault / Generator / Settings 布局。 */
  type Tab = "vault" | "generator" | "settings";

  const view = currentView();
  const standalone = isStandalone();

  let summary = $state<VaultSummary | null>(null);
  let version = $state("");
  let tab = $state<Tab>("vault");

  // Settings tab 的数据在 App 层维护（VaultShell 与 VaultSettings 各自持有）。
  let settingsFolders = $state<FolderView[]>([]);
  let settingsLoadMs = $state(0);
  let settingsLoading = $state(false);

  // 「检测当前页面字段」在 Settings tab 里，跳转到 Vault tab 的采集屏。
  let collectRequest = $state(0);

  async function refresh() {
    summary = (await sendMessage("vault:getSummary")) ?? null;
  }

  $effect(() => {
    version = runtime.getManifest().version;
    if (standalone) {
      document.body.classList.add("standalone");
    } else {
      connectToBackground();
    }
    void refresh();
  });

  // 切到 Settings tab 时刷新文件夹数据（解密全部条目约几十毫秒）。
  $effect(() => {
    if (tab !== "settings" || summary?.status !== VaultStatus.Unlocked) {
      return;
    }
    settingsLoading = true;
    void (async () => {
      try {
        const started = performance.now();
        const snapshot = await loadVault(storage);
        settingsLoadMs = performance.now() - started;
        settingsFolders = snapshot.folders;
      } finally {
        settingsLoading = false;
      }
    })();
  });

  function openCollect() {
    tab = "vault";
    collectRequest += 1;
  }
</script>

<header>
  <div class="brand">
    <img class="mark" src={runtime.getURL("images/icon38.png")} alt="" />
    <span class="title">{t("appName")}</span>
  </div>
  <div class="head-right">
    <a
      class="github"
      href="https://github.com/r0n9/vaultwarden-offline"
      target="_blank"
      rel="noreferrer"
      title="GitHub 仓库"
    >
      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
        />
      </svg>
    </a>
    <span class="version">v{version}</span>
    <span class="badge" title="本扩展不发起任何网络请求">{t("offlineBadge")}</span>
  </div>
</header>

<main>
  {#if summary == null}
    <p class="hint">载入中…</p>
  {:else if view === "import"}
    {#if summary.status === VaultStatus.Locked}
      <UnlockVault onUnlocked={refresh} />
    {:else}
      <ImportVault status={summary.status} onDone={refresh} />
    {/if}
  {:else if view === "export"}
    {#if summary.status === VaultStatus.Unlocked}
      <ExportVault />
    {:else if summary.status === VaultStatus.Locked}
      <UnlockVault onUnlocked={refresh} />
    {:else}
      <p class="hint">还没有密码库可导出。</p>
    {/if}
  {:else if summary.status === VaultStatus.Uninitialized}
    <CreateVault onCreated={refresh} />
  {:else if summary.status === VaultStatus.Locked}
    <UnlockVault onUnlocked={refresh} />
  {:else if tab === "vault"}
    <VaultShell onChanged={refresh} {collectRequest} />
  {:else if tab === "generator"}
    <GeneratorView />
  {:else}
    {#if settingsLoading}
      <p class="hint">载入中…</p>
    {:else}
      <VaultSettings
        {summary}
        folders={settingsFolders}
        cipherCount={summary.cipherCount}
        loadMs={settingsLoadMs}
        onChanged={() => void refresh()}
        onOpenCollect={openCollect}
      />
    {/if}
  {/if}
</main>

{#if summary?.status === VaultStatus.Unlocked}
  <nav class="tabs">
    <button class:active={tab === "vault"} onclick={() => (tab = "vault")}>
      <!-- 盾牌 + 钥匙孔：与扩展图标呼应 -->
      <svg class="tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 1.4 13.6 3.7v4.1c0 3.1-2.2 5.5-5.6 6.7C4.6 13.3 2.4 10.9 2.4 7.8V3.7Z" />
        <circle cx="8" cy="7.1" r="1.6" />
        <path d="M8 8.7v1.9" />
      </svg>
      <span>密码库</span>
    </button>
    <button class:active={tab === "generator"} onclick={() => (tab = "generator")}>
      <!-- 闪电：生成 -->
      <svg class="tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9.4 1.2 3.6 8.8h3.8l-1.4 6 5.9-7.4H8.1Z" />
      </svg>
      <span>生成器</span>
    </button>
    <button class:active={tab === "settings"} onclick={() => (tab = "settings")}>
      <!-- 齿轮：设置（外圈 + 中心孔 + 十字辐条） -->
      <svg class="tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="5.2" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="M8 1.2v3.6M8 11.2v3.6M1.2 8h3.6M11.2 8h3.6" />
      </svg>
      <span>设置</span>
    </button>
  </nav>
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .mark {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    flex: none;
  }

  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }

  .github {
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
    text-decoration: none;
  }

  .github:hover {
    color: var(--accent);
  }

  .version {
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .badge {
    flex: none;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-subtle);
    color: var(--success);
    font-size: 11px;
    font-weight: 600;
  }

  main {
    flex: 1;
    /* min-height: 0 允许 flex 子项收缩，内容超高时在 main 内部滚动，
       底部 tab 栏保持在视口底部。 */
    min-height: 0;
    overflow-y: auto;
    /* 左右留白收窄到 10px，上下保持 16px */
    padding: 16px 10px;
  }

  .tabs {
    display: flex;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  /* 参考 Bitwarden：图标在上、文字在下，垂直排列；选中态主题色 + 顶部指示条 */
  .tabs button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 8px 0 7px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 10px;
    font-family: inherit;
    cursor: pointer;
    border-top: 2px solid transparent;
  }

  .tabs button.active {
    color: var(--accent);
    border-top-color: var(--accent);
    font-weight: 600;
  }

  .tabs button:not(.active):hover {
    color: var(--text);
  }

  .tab-icon {
    width: 19px;
    height: 19px;
  }

</style>
