<script lang="ts">
  import { CipherType } from "@/core/vault/enums";
  import type { CipherView, FolderView } from "@/core/vault/models";
  import { cipherMatchesUrl } from "@/core/vault/uri-matching";
  import {
    CIPHER_TYPE_LABELS,
    cipherSubtitle,
    filterCiphers,
    sortCiphers,
  } from "@/core/vault/vault-search";

  import { newFolderDraft, saveFolder } from "@/core/vault/vault-repository";
  import { browserVaultStorage as storage } from "@/platform/storage/browser-vault-storage";

  import CipherIcon from "../components/CipherIcon.svelte";

  const {
    ciphers,
    folders,
    activeUrl,
    onOpen,
    onCreate,
    onFolderAdded,
  }: {
    ciphers: CipherView[];
    folders: FolderView[];
    activeUrl: string | undefined;
    onOpen: (id: string) => void;
    onCreate: (type: CipherType) => void;
    /** 新增目录成功后通知上层刷新（目录列表变化）。 */
    onFolderAdded: () => void;
  } = $props();

  let query = $state("");
  /** 筛选面板默认收起（参考 Bitwarden），点漏斗展开。 */
  let showFilters = $state(false);
  let folderFilter = $state("");
  let typeFilter = $state("");
  let trashOnly = $state(false);
  let showNewMenu = $state(false);
  let addFolderMode = $state(false);
  let newFolderName = $state("");
  let folderBusy = $state(false);

  const hasFilters = $derived(folderFilter !== "" || typeFilter !== "" || trashOnly);
  const searching = $derived(query.trim() !== "");

  const filterArgs = $derived({
    ...(folderFilter === "" ? {} : { folderId: folderFilter === "none" ? null : folderFilter }),
    ...(typeFilter === "" ? {} : { type: Number(typeFilter) as CipherType }),
  });

  async function addFolder() {
    const name = newFolderName.trim();
    if (name === "" || folderBusy) {
      return;
    }
    folderBusy = true;
    try {
      await saveFolder(storage, newFolderDraft(name));
      newFolderName = "";
      addFolderMode = false;
      showNewMenu = false;
      onFolderAdded();
    } finally {
      folderBusy = false;
    }
  }

  /** 站点匹配条目（自动填充建议），收藏优先、名称次之。 */
  const siteMatches = $derived(
    activeUrl == null
      ? []
      : ciphers.filter((cipher) => cipher.deletedDate == null && cipherMatchesUrl(cipher, activeUrl)),
  );

  const filteredSiteMatches = $derived(filterCiphers(siteMatches, filterArgs));

  /** 全部项目（回收站独立展示）。 */
  const allItems = $derived(sortCiphers(filterCiphers(ciphers, { trash: false, ...filterArgs })));

  /** 搜索时：单一搜索结果列表（应用筛选）。 */
  const searchResults = $derived(sortCiphers(filterCiphers(ciphers, { query, trash: trashOnly, ...filterArgs })));

  /** 回收站条目。 */
  const trashItems = $derived(filterCiphers(ciphers, { trash: true }));
</script>

{#snippet itemList(ciphersToShow: CipherView[])}
  <ul class="items">
    {#each ciphersToShow as cipher (cipher.id)}
      <li>
        <button class="item" onclick={() => onOpen(cipher.id)}>
          <CipherIcon {cipher} />
          <span class="text">
            <span class="name">
              {cipher.name || "（无名称）"}
              {#if cipher.favorite}<span class="star" title="已收藏">★</span>{/if}
            </span>
            <span class="subtitle">
              {cipherSubtitle(cipher) || CIPHER_TYPE_LABELS[cipher.type]}
            </span>
          </span>
          <span class="chevron">›</span>
        </button>
      </li>
    {/each}
  </ul>
{/snippet}

<div class="list-view">
  <div class="top-row">
    <div class="search-wrap">
      <input
        class="search"
        type="text"
        placeholder="搜索名称、用户名、网址、备注…"
        bind:value={query}
      />
      {#if searching}
        <button class="clear" onclick={() => (query = "")} title="清除搜索" aria-label="清除搜索">
          ×
        </button>
      {/if}
    </div>

    <button
      class="filter-btn"
      class:active={showFilters}
      class:has-filter={hasFilters && !showFilters}
      onclick={() => (showFilters = !showFilters)}
      title="筛选"
      aria-label="筛选"
    >
      <!-- 漏斗图标（内联 SVG） -->
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
        <path d="M1.5 3h13M3.5 8h9M5.5 13h5" />
      </svg>
    </button>

    <div class="new-wrap">
      {#if showNewMenu}
        <div class="type-menu">
          {#if addFolderMode}
            <div class="folder-form">
              <input
                type="text"
                placeholder="目录名称"
                bind:value={newFolderName}
                onkeydown={(e) => {
                  if (e.key === "Enter") {
                    void addFolder();
                  } else if (e.key === "Escape") {
                    addFolderMode = false;
                    newFolderName = "";
                  }
                }}
              />
              <div class="folder-form-actions">
                <button
                  class="cancel"
                  onclick={() => {
                    addFolderMode = false;
                    newFolderName = "";
                  }}
                >
                  取消
                </button>
                <button class="confirm" onclick={() => void addFolder()} disabled={folderBusy || newFolderName.trim() === ""}>
                  {folderBusy ? "创建中…" : "创建"}
                </button>
              </div>
            </div>
          {:else}
            {#each Object.entries(CIPHER_TYPE_LABELS) as [value, label] (value)}
              <button
                onclick={() => {
                  showNewMenu = false;
                  onCreate(Number(value) as CipherType);
                }}
              >
                {label}
              </button>
            {/each}
            <div class="menu-divider"></div>
            <button class="add-folder-option" onclick={() => (addFolderMode = true)}>
              ＋ 新增目录
            </button>
          {/if}
        </div>
      {/if}
      <button class="new-btn" onclick={() => (showNewMenu = !showNewMenu)}>＋ 新增</button>
    </div>
  </div>

  {#if showFilters}
    <div class="filters">
      <div class="field">
        <label for="folder-filter">目录</label>
        <select id="folder-filter" bind:value={folderFilter}>
          <option value="">全部目录</option>
          <option value="none">无目录</option>
          {#each folders as folder (folder.id)}
            <option value={folder.id}>{folder.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="type-filter">类型</label>
        <select id="type-filter" bind:value={typeFilter}>
          <option value="">全部类型</option>
          {#each Object.entries(CIPHER_TYPE_LABELS) as [value, label] (value)}
            <option value={value}>{label}</option>
          {/each}
        </select>
      </div>
      <label class="trash-toggle">
        <input type="checkbox" bind:checked={trashOnly} />
        回收站
      </label>
    </div>
  {/if}

  <div class="scroll-area">
    {#if trashOnly}
      <h3 class="section">回收站</h3>
      {#if trashItems.length === 0}
        <p class="empty">回收站是空的。</p>
      {:else}
        {@render itemList(trashItems)}
      {/if}
    {:else if searching}
      <h3 class="section">搜索结果</h3>
      {#if searchResults.length === 0}
        <p class="empty">没有匹配「{query.trim()}」的条目。</p>
      {:else}
        {@render itemList(searchResults)}
      {/if}
    {:else}
      {#if filteredSiteMatches.length > 0}
        <h3 class="section">自动填充建议</h3>
        {@render itemList(filteredSiteMatches)}
      {/if}

      <h3 class="section">全部项目</h3>
      {#if allItems.length === 0}
        <p class="empty">
          {hasFilters ? "没有符合筛选条件的条目。" : "密码库是空的，点右上角「＋ 新增」创建第一条。"}
        </p>
      {:else}
        {@render itemList(allItems)}
      {/if}
    {/if}
  </div>
</div>

<style>
  .list-view {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    min-height: 0;
  }

  .top-row {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }

  .search-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .search {
    width: 100%;
    padding-right: 28px;
  }

  .clear {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
    padding: 0 2px;
  }

  .filter-btn {
    flex: none;
    width: 34px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-subtle);
    color: var(--text-muted);
    cursor: pointer;
    display: grid;
    place-items: center;
  }

  .filter-btn.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .filter-btn.has-filter:not(.active) {
    color: var(--accent);
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

  .menu-divider {
    grid-column: 1 / -1;
    height: 1px;
    background: var(--border);
    margin: 2px 0;
  }

  .add-folder-option {
    grid-column: 1 / -1;
    color: var(--accent) !important;
  }

  .folder-form {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .folder-form input {
    padding: 7px 9px;
    font-size: 12px;
  }

  .folder-form-actions {
    display: flex;
    gap: 6px;
  }

  .folder-form-actions button {
    flex: 1;
    padding: 6px 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }

  .folder-form-actions .confirm {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  .folder-form-actions button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .filters {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    flex-wrap: wrap;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
  }

  .filters .field {
    flex: 1;
    min-width: 120px;
  }

  .filters select {
    font-size: 12px;
  }

  .trash-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    padding-bottom: 8px;
  }

  .scroll-area {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .section {
    margin: 4px 0 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .items {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 4px;
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

  .empty {
    margin: 12px 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
