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

  /** 应用外观：system 时移除标记（跟随系统媒体查询），否则强制对应主题。 */
  function applyTheme(theme: string | undefined): void {
    const root = document.documentElement;
    if (theme === "light" || theme === "dark") {
      root.dataset.theme = theme;
    } else {
      delete root.dataset.theme;
    }
  }

  async function refresh() {
    summary = (await sendMessage("vault:getSummary")) ?? null;

    // 外观设置可能已变化（设置页保存后），随刷新一并应用。
    const settings = await sendMessage("settings:get");
    applyTheme(settings?.theme);
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
    <span class="brand-text">
      <span class="title">{t("appName")}</span>
      <span class="version">v{version}</span>
    </span>
  </div>
  <div class="head-right">
    <a
      class="github"
      href="https://github.com/r0n9/vaultwarden-offline/releases"
      target="_blank"
      rel="noreferrer"
      title="GitHub Releases"
    >
      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
        />
      </svg>
    </a>
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
      <!-- 图标取自 Bitwarden（GPL-3.0）：文件夹 + 钥匙孔 -->
      <svg class="tab-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M21 2.99997C22.1046 2.99997 23 3.89998 23 5.0102V18.0767L22.9893 18.2818C22.8936 19.228 22.1455 19.9802 21.2041 20.0761L21 20.0869H19.1074V20.9949C19.1073 21.5499 18.6596 22 18.1074 22C17.5553 21.9998 17.1076 21.5498 17.1074 20.9949V20.0869H6.88867V20.9949C6.88854 21.5499 6.44088 22 5.88867 22C5.33658 21.9998 4.8888 21.5498 4.88867 20.9949V20.0869H3L2.7959 20.0761C1.7875 19.9732 1.00019 19.1174 1 18.0767V5.0102C1 3.9001 1.8956 3.00017 3 2.99997H21ZM3 18.0767H21V16.0665H19.7871C19.2349 16.0665 18.7873 15.6163 18.7871 15.0613C18.7871 14.5062 19.2348 14.0562 19.7871 14.0562H21V9.53321H19.7871C19.2349 9.53321 18.7873 9.08304 18.7871 8.5281C18.7871 7.97299 19.2348 7.52298 19.7871 7.52298H21V5.0102H3V18.0767Z" />
        <path fill-rule="evenodd" clip-rule="evenodd" d="M9.00027 7.0201C9.54954 7.0201 9.99894 7.47445 9.99898 8.02971V8.74649C10.3285 8.86762 10.6286 9.03909 10.8982 9.26115L11.497 8.90818C11.9764 8.63559 12.5857 8.79724 12.8654 9.28185C13.135 9.76646 12.9751 10.3825 12.4957 10.6651L11.9164 11.0082C11.9464 11.1799 11.9671 11.3619 11.9671 11.5436C11.9671 11.7251 11.9463 11.9065 11.9164 12.078L12.4957 12.4211C12.9751 12.7038 13.1449 13.3198 12.8654 13.8044C12.6756 14.1274 12.3459 14.3092 11.9964 14.3092C11.8267 14.3091 11.6567 14.2689 11.497 14.178L10.8982 13.8251C10.6286 14.0472 10.3285 14.2186 9.99898 14.3397V15.0565C9.99898 15.6118 9.54956 16.0661 9.00027 16.0661C8.45114 16.0659 8.00157 15.6117 8.00157 15.0565V14.32C7.69203 14.1989 7.40269 14.0164 7.15306 13.8044L6.50351 14.178C6.34377 14.2688 6.17388 14.3092 6.00416 14.3092C5.65474 14.3091 5.32486 14.1273 5.13517 13.8044C4.86588 13.3199 5.02562 12.7037 5.50481 12.4211L6.15435 12.0376C6.12445 11.8763 6.10465 11.715 6.10461 11.5436C6.10461 11.372 6.12441 11.2101 6.15435 11.0487L5.50481 10.6651C5.02563 10.3825 4.85582 9.76637 5.13517 9.28185C5.41476 8.79732 6.02417 8.62568 6.50351 8.90818L7.15306 9.28185C7.40262 9.06993 7.68216 8.88834 8.00157 8.76719V8.02971C8.0016 7.47457 8.45116 7.02029 9.00027 7.0201ZM9.03051 10.2032C8.30385 10.2033 7.7058 10.8092 7.7058 11.5438C7.70612 12.2782 8.30405 12.8829 9.03051 12.883C9.75701 12.883 10.3549 12.2782 10.3552 11.5438C10.3552 10.8092 9.7572 10.2032 9.03051 10.2032Z" />
      </svg>
      <span>密码库</span>
    </button>
    <button class:active={tab === "generator"} onclick={() => (tab = "generator")}>
      <!-- 图标取自 Bitwarden（GPL-3.0）：循环箭头 -->
      <svg class="tab-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 22C9.86667 22 7.94583 21.3917 6.2375 20.175C4.52917 18.9583 3.31667 17.3667 2.6 15.4C2.51667 15.15 2.54167 14.9167 2.675 14.7C2.80833 14.4833 3.00833 14.3333 3.275 14.25C3.54167 14.1667 3.79583 14.1958 4.0375 14.3375C4.27917 14.4792 4.45 14.675 4.55 14.925C5.15 16.4417 6.125 17.6667 7.475 18.6C8.825 19.5333 10.3333 20 12 20C13.4333 20 14.7667 19.6458 16 18.9375C17.2333 18.2292 18.2 17.25 18.9 16H17C16.7167 16 16.4792 15.9042 16.2875 15.7125C16.0958 15.5208 16 15.2833 16 15C16 14.7167 16.0958 14.4792 16.2875 14.2875C16.4792 14.0958 16.7167 14 17 14H21C21.2833 14 21.5208 14.0958 21.7125 14.2875C21.9042 14.4792 22 14.7167 22 15V19C22 19.2833 21.9042 19.5208 21.7125 19.7125C21.5208 19.9042 21.2833 20 21 20C20.7167 20 20.4792 19.9042 20.2875 19.7125C20.0958 19.5208 20 19.2833 20 19V18C19.05 19.2667 17.875 20.25 16.475 20.95C15.075 21.65 13.5833 22 12 22ZM12 4C10.5667 4 9.23333 4.35417 8 5.0625C6.76667 5.77083 5.8 6.75 5.1 8H7C7.28333 8 7.52083 8.09583 7.7125 8.2875C7.90417 8.47917 8 8.71667 8 9C8 9.28333 7.90417 9.52083 7.7125 9.7125C7.52083 9.90417 7.28333 10 7 10H3C2.71667 10 2.47917 9.90417 2.2875 9.7125C2.09583 9.52083 2 9.28333 2 9V5C2 4.71667 2.09583 4.47917 2.2875 4.2875C2.47917 4.09583 2.71667 4 3 4C3.28333 4 3.52083 4.09583 3.7125 4.2875C3.90417 4.47917 4 4.71667 4 5V6C4.95 4.73333 6.125 3.75 7.525 3.05C8.925 2.35 10.4167 2 12 2C14.1333 2 16.0542 2.60833 17.7625 3.825C19.4708 5.04167 20.6833 6.63333 21.4 8.6C21.4833 8.85 21.4583 9.08333 21.325 9.3C21.1917 9.51667 20.9917 9.66667 20.725 9.75C20.4583 9.83333 20.2042 9.80417 19.9625 9.6625C19.7208 9.52083 19.55 9.325 19.45 9.075C18.85 7.55833 17.875 6.33333 16.525 5.4C15.175 4.46667 13.6667 4 12 4ZM12 15C11.1667 15 10.4583 14.7083 9.875 14.125C9.29167 13.5417 9 12.8333 9 12C9 11.1667 9.29167 10.4583 9.875 9.875C10.4583 9.29167 11.1667 9 12 9C12.8333 9 13.5417 9.29167 14.125 9.875C14.7083 10.4583 15 11.1667 15 12C15 12.8333 14.7083 13.5417 14.125 14.125C13.5417 14.7083 12.8333 15 12 15Z" />
      </svg>
      <span>生成器</span>
    </button>
    <button class:active={tab === "settings"} onclick={() => (tab = "settings")}>
      <!-- 图标取自 Bitwarden（GPL-3.0）：齿轮 -->
      <svg class="tab-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 9C12.8333 9 13.5417 9.2917 14.125 9.875C14.7084 10.4583 15 11.1667 15 12C15 12.8333 14.7084 13.5417 14.125 14.125C13.5417 14.7083 12.8333 15 12 15C11.1667 15 10.4583 14.7083 9.87502 14.125C9.29172 13.5417 9.00003 12.8333 9.00003 12C9.00003 11.1667 9.29172 10.4583 9.87502 9.875C10.4583 9.29169 11.1667 9.00002 12 9Z" />
        <path fill-rule="evenodd" clip-rule="evenodd" d="M13.293 0.875C13.721 0.875085 14.0945 1.01761 14.4073 1.30078C14.6789 1.54648 14.8586 1.84348 14.9444 2.18945L14.9756 2.33984L14.9766 2.34473L15.251 4.44824C15.5793 4.57087 15.8801 4.71178 16.1514 4.87305C16.4209 5.03322 16.692 5.22008 16.9649 5.43262L18.9658 4.61816C19.3598 4.44667 19.7605 4.43173 20.1602 4.5752C20.5071 4.69966 20.7881 4.90748 21 5.19629L21.0869 5.3252L21.0879 5.32812L22.3916 7.56641L22.4668 7.70508C22.6264 8.03182 22.6656 8.37794 22.583 8.73828C22.4898 9.14566 22.2753 9.48344 21.9424 9.74707L21.9395 9.74902L20.208 11.0381C20.2407 11.2021 20.2611 11.3578 20.2647 11.5059C20.2684 11.6693 20.2705 11.8343 20.2705 12C20.2705 12.1592 20.2665 12.3209 20.2588 12.4854C20.252 12.635 20.2275 12.8011 20.1905 12.9834L21.8877 14.251L21.8906 14.2529C22.2233 14.5164 22.4399 14.8538 22.5371 15.2607C22.6353 15.6726 22.5722 16.0662 22.3506 16.4336L21.0293 18.6836C20.8095 19.0485 20.4963 19.3027 20.0948 19.4414C19.6908 19.5808 19.2875 19.5644 18.8926 19.3916L16.9639 18.5674C16.6897 18.7806 16.4104 18.9718 16.125 19.1387C15.8407 19.3051 15.5482 19.4416 15.25 19.5518L14.9756 21.6553V21.6602C14.9081 22.0711 14.7175 22.4186 14.4073 22.6992C14.0945 22.9824 13.721 23.1249 13.293 23.125H10.7071C10.279 23.1249 9.9055 22.9824 9.5928 22.6992C9.28261 22.4186 9.09191 22.0711 9.02444 21.6602L9.02346 21.6562L8.74905 19.5645C8.45186 19.46 8.1483 19.3211 7.83987 19.1455C7.53106 18.9694 7.25197 18.7795 7.00198 18.5791L5.04788 19.4033L5.0469 19.4023C4.65268 19.5743 4.25248 19.5928 3.85256 19.4531C3.4546 19.3143 3.14364 19.0605 2.92385 18.6963L2.92288 18.6943L1.60842 16.4336L1.53323 16.2949C1.37372 15.9682 1.33448 15.622 1.41702 15.2617C1.51025 14.8544 1.72485 14.5166 2.05764 14.2529L2.06057 14.251L3.74905 12.9912C3.7276 12.8408 3.71202 12.6897 3.70217 12.5381C3.69072 12.3617 3.6846 12.1858 3.6846 12.0107C3.6846 11.8434 3.69073 11.6735 3.70217 11.501C3.71228 11.3486 3.72781 11.184 3.75003 11.0078L2.06057 9.74902L2.05764 9.74707C1.72422 9.48294 1.51114 9.14213 1.4219 8.73047C1.33218 8.31626 1.39918 7.92237 1.62014 7.55566L2.92288 5.32812L2.92483 5.3252C3.14476 4.96857 3.45501 4.71744 3.85159 4.5752C4.25129 4.43161 4.65162 4.44744 5.04592 4.61914L6.99026 5.43262C7.25963 5.22524 7.54613 5.03502 7.84866 4.86133C8.14863 4.68912 8.44504 4.54801 8.73733 4.4375L9.02444 2.34375V2.33984C9.09191 1.92895 9.28261 1.5814 9.5928 1.30078C9.9055 1.01759 10.279 0.875131 10.7071 0.875H13.293ZM10.5889 5.84277L10.5781 5.92969L10.4932 5.94922C9.90923 6.08614 9.37086 6.29561 8.87795 6.57715C8.38422 6.85927 7.91179 7.22373 7.46096 7.6709L7.40237 7.72949L7.32522 7.69727L4.52639 6.54102L3.48928 8.31836L5.91897 10.1162L5.99319 10.1709L5.96292 10.2578C5.8687 10.5241 5.80246 10.8015 5.76467 11.0898C5.72656 11.3807 5.70707 11.6877 5.70706 12.0107C5.70706 12.3068 5.72655 12.5971 5.76467 12.8809C5.80259 13.1629 5.86551 13.4416 5.95315 13.7168L5.97952 13.8008L5.9092 13.8545L3.48831 15.6797L4.52639 17.458L7.3135 16.2852L7.39163 16.252L7.4512 16.3125C7.8865 16.756 8.35074 17.1185 8.84378 17.4004C9.33731 17.6822 9.88438 17.8989 10.4844 18.0508L10.5674 18.0723L10.5781 18.1572L10.9434 21.1377H13.0176L13.4219 18.1445L13.4336 18.0615L13.5147 18.04C14.1001 17.8883 14.634 17.6737 15.1162 17.3955C15.5991 17.1169 16.0664 16.7577 16.5176 16.3174L16.5762 16.2598L16.6524 16.291L19.4502 17.457L20.4883 15.6797L18.0469 13.8545L17.9756 13.8018L18.003 13.7158C18.0978 13.4231 18.1624 13.1368 18.1963 12.8574C18.2309 12.5747 18.2481 12.2888 18.2481 12C18.2481 11.7034 18.2308 11.4175 18.1963 11.1426C18.1624 10.8709 18.0978 10.5921 18.003 10.3066L17.9746 10.2217L18.0469 10.168L20.5108 8.31934L19.4727 6.54199L16.6416 7.72656L16.5615 7.75977L16.502 7.69629C16.1206 7.29199 15.6626 6.93321 15.127 6.62109C14.5913 6.30911 14.0506 6.08903 13.5059 5.95996L13.4209 5.94043L13.4112 5.85352L13.0557 2.8623H10.9619L10.5889 5.84277Z" />
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

  .brand-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }

  .title {
    font-weight: 700;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .brand-text .version {
    font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
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
    font-size: 11px;
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
