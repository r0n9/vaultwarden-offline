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
  <span class="muted">v{version}</span>
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

  .muted {
    color: var(--text-muted);
  }
</style>
