<script lang="ts">
  import { VaultStatus } from "@/core/state/vault-status";
  import { runtime, t } from "@/platform/browser-api";
  import { sendMessage } from "@/platform/messaging";
  import type { VaultSummary } from "@/platform/messaging/types";

  import CreateVault from "./views/CreateVault.svelte";
  import ExportVault from "./views/ExportVault.svelte";
  import ImportVault from "./views/ImportVault.svelte";
  import UnlockVault from "./views/UnlockVault.svelte";
  import VaultShell from "./views/VaultShell.svelte";
  import { connectToBackground } from "./lib/background-port";
  import { currentView, isStandalone } from "./lib/navigation";

  const view = currentView();
  const standalone = isStandalone();

  let summary = $state<VaultSummary | null>(null);
  let version = $state("");

  async function refresh() {
    summary = (await sendMessage("vault:getSummary")) ?? null;
  }

  $effect(() => {
    version = runtime.getManifest().version;
    if (standalone) {
      // 独立标签页要宽一些，380px 放不下导入向导。
      document.body.classList.add("standalone");
    } else {
      connectToBackground();
    }
    void refresh();
  });
</script>

<header>
  <div class="brand">
    <img class="mark" src={runtime.getURL("images/icon38.png")} alt="" />
    <span class="title">{t("appName")}</span>
  </div>
  <span class="badge" title="本扩展不发起任何网络请求">{t("offlineBadge")}</span>
</header>

<main>
  {#if summary == null}
    <p class="hint">载入中…</p>
  {:else if view === "import"}
    <!-- 导入在未建库时也能进行：它会顺带引导用户设定本地主密码。 -->
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
  {:else}
    <VaultShell {summary} onChanged={refresh} />
  {/if}
</main>

<footer>
  <span class="footer-left">
    <a
      class="github"
      href="https://github.com/r0n9/vaultwarden-offline"
      target="_blank"
      rel="noreferrer"
      title="GitHub 仓库"
    >
      <!-- GitHub octocat 图标（内联 SVG，无网络请求） -->
      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
        />
      </svg>
    </a>
    <span class="muted">v{version}</span>
  </span>
  <span class="muted">Phase 4 · 条目管理</span>
</footer>

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
    padding: 16px;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-top: 1px solid var(--border);
    background: var(--surface);
    font-size: 11px;
  }

  .footer-left {
    display: flex;
    align-items: center;
    gap: 8px;
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

  .muted {
    color: var(--text-muted);
  }
</style>
