<script lang="ts">
  import { CipherType } from "@/core/vault/enums";
  import type { CipherView, FolderView } from "@/core/vault/models";
  import { cipherMatchesUrl } from "@/core/vault/uri-matching";
  import {
    CIPHER_TYPE_LABELS,
    cipherSubtitle,
    filterCiphers,
    sortCiphers,
    sortCiphersForUrl,
  } from "@/core/vault/vault-search";

  import CipherIcon from "../components/CipherIcon.svelte";

  type Scope = "site" | "all" | "favorites" | "trash";

  const {
    ciphers,
    folders,
    activeUrl,
    onOpen,
    onCreate,
  }: {
    ciphers: CipherView[];
    folders: FolderView[];
    activeUrl: string | undefined;
    onOpen: (id: string) => void;
    onCreate: (type: CipherType) => void;
  } = $props();

  let query = $state("");
  // 有可用站点地址时默认停在「当前站点」——那是打开弹窗最常见的意图。
  // svelte-ignore state_referenced_locally
  let scope = $state<Scope>(activeUrl == null ? "all" : "site");
  let folderId = $state<string>("");
  let showTypeMenu = $state(false);

  const siteMatches = $derived(
    activeUrl == null
      ? []
      : ciphers.filter((cipher) => cipher.deletedDate == null && cipherMatchesUrl(cipher, activeUrl)),
  );

  const visible = $derived.by(() => {
    if (scope === "site") {
      const base = query.trim() === "" ? siteMatches : filterCiphers(siteMatches, { query });
      // 当前站点列表按域名层级精度排序：精确匹配 > 父域 > 仅注册域相同。
      return activeUrl == null ? sortCiphers(base) : sortCiphersForUrl(base, activeUrl);
    }

    return sortCiphers(
      filterCiphers(ciphers, {
        query,
        trash: scope === "trash",
        favoritesOnly: scope === "favorites",
        ...(folderId === "" ? {} : { folderId: folderId === "none" ? null : folderId }),
      }),
    );
  });

  const trashCount = $derived(ciphers.filter((cipher) => cipher.deletedDate != null).length);
</script>

<div class="list-view">
  <div class="top-row">
    <input
      class="search"
      type="text"
      placeholder="搜索名称、用户名、网址、备注…"
      bind:value={query}
    />
    <div class="new-wrap">
      {#if showTypeMenu}
        <div class="type-menu">
          {#each Object.entries(CIPHER_TYPE_LABELS) as [value, label] (value)}
            <button
              onclick={() => {
                showTypeMenu = false;
                onCreate(Number(value) as CipherType);
              }}
            >
              {label}
            </button>
          {/each}
        </div>
      {/if}
      <button class="new-btn" onclick={() => (showTypeMenu = !showTypeMenu)}>
        ＋ 新建
      </button>
    </div>
  </div>

  <div class="scopes">
    {#if activeUrl != null}
      <button class:active={scope === "site"} onclick={() => (scope = "site")}>
        当前站点 {siteMatches.length > 0 ? `(${siteMatches.length})` : ""}
      </button>
    {/if}
    <button class:active={scope === "all"} onclick={() => (scope = "all")}>全部</button>
    <button class:active={scope === "favorites"} onclick={() => (scope = "favorites")}>收藏</button>
    <button class:active={scope === "trash"} onclick={() => (scope = "trash")}>
      回收站 {trashCount > 0 ? `(${trashCount})` : ""}
    </button>
  </div>

  {#if scope !== "site" && folders.length > 0}
    <select class="folder-filter" bind:value={folderId}>
      <option value="">所有文件夹</option>
      <option value="none">无文件夹</option>
      {#each folders as folder (folder.id)}
        <option value={folder.id}>{folder.name}</option>
      {/each}
    </select>
  {/if}

  {#if visible.length === 0}
    <p class="empty">
      {#if scope === "site"}
        当前站点没有匹配的条目。
      {:else if query.trim() !== ""}
        没有匹配「{query}」的条目。
      {:else if scope === "trash"}
        回收站是空的。
      {:else if scope === "favorites"}
        还没有收藏任何条目。
      {:else}
        密码库是空的，点下方按钮新建第一个条目。
      {/if}
    </p>
  {:else}
    <ul class="items">
      {#each visible as cipher (cipher.id)}
        <li>
          <button class="item" onclick={() => onOpen(cipher.id)}>
            <CipherIcon {cipher} />
            <span class="text">
              <span class="name">
                {cipher.name || "（无名称）"}
                {#if cipher.favorite}<span class="star" title="已收藏">★</span>{/if}
              </span>
              <span class="subtitle">{cipherSubtitle(cipher) || CIPHER_TYPE_LABELS[cipher.type]}</span>
            </span>
            <span class="chevron">›</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

</div>

<style>
  /* 撑满内容区：条目列表在内部滚动，外层（main）不再出现滚动条 */
  .list-view {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    min-height: 0;
  }

  .top-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }

  .search {
    flex: 1;
    min-width: 0;
  }

  .new-wrap {
    position: relative;
    flex: none;
  }

  .new-btn {
    height: 100%;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .new-btn:hover {
    background: var(--accent-hover);
  }

  .type-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 20;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
    width: 220px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
  }

  .type-menu button {
    padding: 6px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }

  .type-menu button:hover {
    background: var(--bg-subtle);
    border-color: var(--border);
  }

  .scopes {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .scopes button {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
  }

  .scopes button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .folder-filter {
    font-size: 12px;
  }

  .empty {
    margin: 16px 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }

  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    /* 列表占满剩余高度并在内部滚动，避免双层滚动条 */
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 4px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .item:hover {
    background: var(--bg-subtle);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .star {
    color: #eab308;
    font-size: 11px;
  }

  .subtitle {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chevron {
    color: var(--text-muted);
    flex: none;
  }

</style>
