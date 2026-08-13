<script lang="ts">
  import type { CipherType } from "@/core/vault/enums";
  import type { CipherView, FolderView } from "@/core/vault/models";
  import {
    loadVault,
    newCipherDraft,
    purgeCipher,
    restoreCipher,
    saveCipher,
    softDeleteCipher,
    toggleFavorite,
  } from "@/core/vault/vault-repository";
  import { tabs } from "@/platform/browser-api";
  import { sendMessage } from "@/platform/messaging";
  import type { VaultSummary } from "@/platform/messaging/types";
  import { browserVaultStorage as storage } from "@/platform/storage/browser-vault-storage";

  import AutofillDebug from "./AutofillDebug.svelte";
  import ItemDetail from "./ItemDetail.svelte";
  import ItemEdit from "./ItemEdit.svelte";
  import ItemList from "./ItemList.svelte";
  import VaultSettings from "./VaultSettings.svelte";

  const { summary, onChanged }: { summary: VaultSummary; onChanged: () => void } = $props();

  type Screen =
    | { name: "list" }
    | { name: "detail"; id: string }
    | { name: "edit"; cipher: CipherView }
    | { name: "settings" }
    | { name: "collect" };

  let screen = $state<Screen>({ name: "list" });
  let ciphers = $state<CipherView[]>([]);
  let folders = $state<FolderView[]>([]);
  let activeUrl = $state<string | undefined>(undefined);
  let loading = $state(true);
  let loadMs = $state(0);
  let error = $state("");

  const selected = $derived.by(() => {
    // 先取到局部变量再判别，否则 TS 无法在闭包里收窄联合类型。
    const current = screen;
    return current.name === "detail"
      ? ciphers.find((cipher) => cipher.id === current.id)
      : undefined;
  });

  async function refresh() {
    loading = true;
    error = "";
    try {
      const started = performance.now();
      const snapshot = await loadVault(storage);
      loadMs = performance.now() - started;
      ciphers = snapshot.ciphers;
      folders = snapshot.folders;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void (async () => {
      // 当前标签页地址用于"当前站点"筛选。取不到（如 chrome:// 页面）就退回全部列表。
      const tab = await tabs.getActive();
      activeUrl = tab?.url != null && /^https?:/i.test(tab.url) ? tab.url : undefined;
      await refresh();
    })();
  });

  async function mutate(action: () => Promise<unknown>, back = false) {
    try {
      await action();
      await refresh();
      await sendMessage("vault:touch");
      onChanged();
      if (back) {
        screen = { name: "list" };
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

{#if error !== ""}
  <p class="alert">{error}</p>
{/if}

{#if loading}
  <p class="hint">正在解密条目…</p>
{:else if screen.name === "collect"}
  <AutofillDebug onBack={() => (screen = { name: "settings" })} />
{:else if screen.name === "settings"}
  <VaultSettings
    {summary}
    {folders}
    cipherCount={ciphers.length}
    {loadMs}
    onBack={() => (screen = { name: "list" })}
    onChanged={() => void mutate(async () => {})}
    onOpenCollect={() => (screen = { name: "collect" })}
  />
{:else if screen.name === "edit"}
  <ItemEdit
    cipher={screen.cipher}
    {folders}
    onCancel={() => (screen = { name: "list" })}
    onSave={(next) => void mutate(async () => await saveCipher(storage, next), true)}
  />
{:else if screen.name === "detail" && selected != null}
  <ItemDetail
    cipher={selected}
    {folders}
    onBack={() => (screen = { name: "list" })}
    onEdit={() => (screen = { name: "edit", cipher: selected })}
    onDelete={() => void mutate(async () => await softDeleteCipher(storage, selected.id), true)}
    onRestore={() => void mutate(async () => await restoreCipher(storage, selected.id), true)}
    onPurge={() => void mutate(async () => await purgeCipher(storage, selected.id), true)}
    onToggleFavorite={() => void mutate(async () => await toggleFavorite(storage, selected.id))}
  />
{:else}
  <ItemList
    {ciphers}
    {folders}
    {activeUrl}
    onOpen={(id) => (screen = { name: "detail", id })}
    onCreate={(type: CipherType) => (screen = { name: "edit", cipher: newCipherDraft(type) })}
  />
  <button class="settings-link" onclick={() => (screen = { name: "settings" })}>设置与数据</button>
{/if}

<style>
  .settings-link {
    margin-top: 10px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    align-self: center;
    width: 100%;
    text-align: center;
  }

  .settings-link:hover {
    color: var(--accent);
  }
</style>
