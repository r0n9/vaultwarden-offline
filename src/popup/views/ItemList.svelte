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

  import {
    getCipher,
    newFolderDraft,
    saveCipher,
    saveFolder,
    softDeleteCipher,
    toggleFavorite as toggleFavoriteFn,
  } from "@/core/vault/vault-repository";
  import { sendMessage } from "@/platform/messaging";
  import { browserVaultStorage as storage } from "@/platform/storage/browser-vault-storage";

  import CipherIcon from "../components/CipherIcon.svelte";

  const {
    ciphers,
    folders,
    activeUrl,
    onOpen,
    onCreate,
    onFolderAdded,
    onDataChanged,
    onEdit,
  }: {
    ciphers: CipherView[];
    folders: FolderView[];
    activeUrl: string | undefined;
    onOpen: (id: string) => void;
    onCreate: (type: CipherType) => void;
    /** 新增目录成功后通知上层刷新（目录列表变化）。 */
    onFolderAdded: () => void;
    /** 数据变化（收藏/克隆/删除）后刷新条目列表。 */
    onDataChanged: () => void;
    /** 直接进入某条目的编辑页。 */
    onEdit: (id: string) => void;
  } = $props();

  let query = $state("");
  /** 当前展开「更多」菜单的条目 id。 */
  let moreMenuFor = $state<string | null>(null);
  /** 当前展开「复制」菜单的条目 id。 */
  let copyMenuFor = $state<string | null>(null);
  /** 复制成功提示的条目 id。 */
  let copiedId = $state<string | null>(null);
  let actionBusy = $state(false);

  /** 条目的可跳转网址（仅 http/https）。 */
  function cipherUrl(cipher: CipherView): string | undefined {
    return cipher.login?.uris?.find((entry) => entry.uri != null && /^https?:/i.test(entry.uri))?.uri;
  }

  async function copyValue(cipher: CipherView, which: "username" | "password") {
    copyMenuFor = null;
    const value = which === "password" ? cipher.login?.password : cipher.login?.username;
    if (value == null || value === "") {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      copiedId = cipher.id;
      setTimeout(() => (copiedId === cipher.id) && (copiedId = null), 1200);
    } catch {
      // 剪贴板不可用时静默。
    }
  }

  async function runAction(action: () => Promise<unknown> | void) {
    if (actionBusy) {
      return;
    }
    actionBusy = true;
    moreMenuFor = null;
    try {
      await action();
      onDataChanged();
    } finally {
      actionBusy = false;
    }
  }

  function toggleFavorite(cipher: CipherView) {
    return runAction(() => toggleFavoriteFn(storage, cipher.id));
  }

  function cloneCipher(cipher: CipherView) {
    return runAction(async () => {
      const original = await getCipher(storage, cipher.id);
      if (original == null) {
        return;
      }
      const now = new Date().toISOString();
      const clone: CipherView = {
        ...original,
        id: crypto.randomUUID(),
        name: `${original.name}（副本）`,
        favorite: false,
        deletedDate: undefined,
        creationDate: now,
        revisionDate: now,
      };
      await saveCipher(storage, clone);
    });
  }

  function deleteCipher(cipher: CipherView) {
    return runAction(() => softDeleteCipher(storage, cipher.id));
  }

  function autofillCipher(cipher: CipherView) {
    moreMenuFor = null;
    void sendMessage("autofill:fillActiveTab", { cipherId: cipher.id });
  }
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

  /** 自动填充建议：筛选后按域名层级精度排序——与站点 URI 完全相同的条目排最前。 */
  const filteredSiteMatches = $derived(
    sortCiphersForUrl(filterCiphers(siteMatches, filterArgs), activeUrl ?? ""),
  );

  /** 全部项目（回收站独立展示）。 */
  const allItems = $derived(sortCiphers(filterCiphers(ciphers, { trash: false, ...filterArgs })));

  /** 搜索时：单一搜索结果列表（应用筛选）。 */
  const searchResults = $derived(sortCiphers(filterCiphers(ciphers, { query, trash: trashOnly, ...filterArgs })));

  /** 回收站条目。 */
  const trashItems = $derived(filterCiphers(ciphers, { trash: true }));
</script>

{#snippet itemList(ciphersToShow: CipherView[], recommendFirst = false)}
  <ul class="items">
    {#each ciphersToShow as cipher, index (cipher.id)}
      {@const url = cipherUrl(cipher)}
      <li class="item-row" class:recommended={recommendFirst && index === 0}>
        <button class="item-main" onclick={() => onOpen(cipher.id)}>
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
        </button>

        <div class="item-actions">
          {#if url != null}
            <a
              class="action"
              href={url}
              target="_blank"
              rel="noreferrer"
              title="打开网站"
              aria-label="打开网站"
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6.5 3H3v10h10V9.5M9 3h4v4M13 3l-6.5 6.5" />
              </svg>
            </a>
          {/if}
          <div class="more-wrap">
            <button
              class="action"
              onclick={() => (copyMenuFor = copyMenuFor === cipher.id ? null : cipher.id)}
              title="复制"
              aria-label="复制"
            >
              {copiedId === cipher.id ? "✓" : "⧉"}
            </button>
            {#if copyMenuFor === cipher.id}
              <div class="more-menu">
                <button onclick={() => void copyValue(cipher, "username")}>复制用户名</button>
                <button onclick={() => void copyValue(cipher, "password")}>复制密码</button>
              </div>
            {/if}
          </div>
          <div class="more-wrap">
            <button
              class="action"
              onclick={() => (moreMenuFor = moreMenuFor === cipher.id ? null : cipher.id)}
              title="更多"
              aria-label="更多"
            >
              ⋮
            </button>
            {#if moreMenuFor === cipher.id}
              <div class="more-menu">
                <button onclick={() => autofillCipher(cipher)}>自动填充</button>
                <button onclick={() => void toggleFavorite(cipher)}>
                  {cipher.favorite ? "取消收藏" : "收藏"}
                </button>
                <button onclick={() => { moreMenuFor = null; onEdit(cipher.id); }}>编辑</button>
                <button onclick={() => void cloneCipher(cipher)}>克隆</button>
                <button class="danger" onclick={() => void deleteCipher(cipher)}>删除</button>
              </div>
            {/if}
          </div>
        </div>
      </li>
    {/each}
  </ul>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions：列表容器的 mousedown 仅用于
     关闭行内弹出菜单，元素本身不可交互、无可聚焦子内容，加 role 反而误导读屏 -->
<div
  class="list-view"
  onmousedown={(e) => {
    const target = e.target as HTMLElement | null;
    const inside = target?.closest?.(".more-menu, .action") != null;
    if (!inside) {
      moreMenuFor = null;
      copyMenuFor = null;
    }
  }}
>
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
        <h3 class="section">自动填充建议（{filteredSiteMatches.length}）</h3>
        {@render itemList(filteredSiteMatches, true)}
      {/if}

      <h3 class="section">全部项目（{allItems.length}）</h3>
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
    font-size: 12px;
    font-weight: 700;
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
    gap: 5px;
  }

  /* Bitwarden 风格条目行：卡片式（surface 底 + 圆角 + 细边框），行间留白 */
  .item-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    transition: border-color 0.12s ease, background-color 0.12s ease;
  }

  .item-row:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    background: var(--bg-subtle);
  }

  /* 推荐条目（自动填充建议第一条）：旋转流光边框提示 */
  @property --vwo-angle {
    syntax: "<angle>";
    initial-value: 0deg;
    inherits: false;
  }

  .item-row.recommended {
    border-color: transparent;
    background: conic-gradient(
      from var(--vwo-angle),
      var(--accent),
      transparent 30%,
      transparent 70%,
      var(--accent)
    );
    animation: vwo-spin 3s linear infinite;
  }

  /* 内部遮罩：盖住中心，只让边框一圈（1px）露出流光 */
  .item-row.recommended::after {
    content: "";
    position: absolute;
    inset: 1px;
    border-radius: 7px;
    background: var(--surface);
    z-index: 0;
    pointer-events: none;
  }

  .item-row.recommended > * {
    position: relative;
    z-index: 1;
  }

  @keyframes vwo-spin {
    to {
      --vwo-angle: 360deg;
    }
  }

  /* 尊重系统「减弱动态效果」设置 */
  @media (prefers-reduced-motion: reduce) {
    .item-row.recommended {
      animation: none;
      border-color: var(--accent);
      background: var(--surface);
    }
    .item-row.recommended::after {
      display: none;
    }
  }

  .item-main {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 4px;
    border: none;
    background: transparent;
    color: inherit;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  /* 操作按钮：默认隐藏，悬停/聚焦行时显示（Bitwarden 同款交互） */
  .item-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex: none;
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .item-row:hover .item-actions,
  .item-row:focus-within .item-actions,
  .item-actions:has(.more-menu) {
    opacity: 1;
  }

  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    text-decoration: none;
  }

  .action:hover {
    background: var(--bg-subtle);
    color: var(--text);
  }

  .more-wrap {
    position: relative;
  }

  .more-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 30;
    display: flex;
    flex-direction: column;
    min-width: 120px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  }

  .more-menu button {
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .more-menu button:hover {
    background: var(--bg-subtle);
  }

  .more-menu button.danger {
    color: var(--danger);
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .star {
    color: #eab308;
    font-size: 11px;
  }

  .subtitle {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty {
    margin: 12px 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
