<script lang="ts">
  import { CipherType } from "@/core/vault/enums";
  import type { CipherView, FolderView } from "@/core/vault/models";
  import { hostWithPort } from "@/core/vault/uri-matching";
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
  import { browserVaultStorage as storage } from "@/platform/storage/browser-vault-storage";

  import AutofillDebug from "./AutofillDebug.svelte";
  import ItemDetail from "./ItemDetail.svelte";
  import ItemEdit from "./ItemEdit.svelte";
  import ItemList from "./ItemList.svelte";

  const { onChanged, collectRequest }: { onChanged: () => void; collectRequest: number } =
    $props();

  type Screen =
    | { name: "list" }
    | { name: "detail"; id: string }
    | { name: "edit"; cipher: CipherView }
    | { name: "collect" };

  let screen = $state<Screen>({ name: "list" });
  let ciphers = $state<CipherView[]>([]);
  let folders = $state<FolderView[]>([]);
  let activeUrl = $state<string | undefined>(undefined);
  let loading = $state(true);
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
      const snapshot = await loadVault(storage);
      ciphers = snapshot.ciphers;
      folders = snapshot.folders;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // 设置页发起「检测当前页面字段」时，外部把 collectRequest 加一，
  // 这里据此切到采集屏（collect 屏只存在于本组件内）。
  $effect(() => {
    if (collectRequest > 0) {
      screen = { name: "collect" };
    }
  });

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
  <AutofillDebug onBack={() => (screen = { name: "list" })} />
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
    onChanged={() => void refresh()}
  />
{:else}
  <ItemList
    {ciphers}
    {folders}
    {activeUrl}
    onOpen={(id) => (screen = { name: "detail", id })}
    onFolderAdded={() => void refresh()}
    onDataChanged={() => void refresh()}
    onEdit={(id) => {
      const target = ciphers.find((cipher) => cipher.id === id);
      if (target != null) {
        screen = { name: "edit", cipher: target };
      }
    }}
    onCreate={(type: CipherType) => {
      // 新增条目：名称自动填当前站点域名，登录条目自动带上当前网址。
      const draft = newCipherDraft(type);
      if (activeUrl != null && /^https?:/i.test(activeUrl)) {
        // 名称 = 主机名 + 端口（如有）：192.168.2.4:3000、gitea.880508.xyz:3000。
        const host = hostWithPort(activeUrl)?.replace(/^www\./, "");
        if (host != null) {
          draft.name = host;
        }
        if (type === CipherType.Login) {
          draft.login = { uris: [{ uri: activeUrl }] };
        }
        // 新增条目时静默获取站点 favicon 并缓存。
        void sendMessage("favicon:fetch", { url: activeUrl });
      }
      screen = { name: "edit", cipher: draft };
    }}
  />
{/if}
