<script lang="ts">
  import type { FolderView } from "@/core/vault/models";
  import {
    deleteFolder,
    newFolderDraft,
    saveFolder,
  } from "@/core/vault/vault-repository";
  import { browserVaultStorage as storage } from "@/platform/storage/browser-vault-storage";

  const { folders, onChanged, onBack }: {
    folders: FolderView[];
    onChanged: () => void;
    onBack: () => void;
  } = $props();

  let newFolderName = $state("");
  let busy = $state(false);
  let notice = $state("");

  async function addFolder() {
    const name = newFolderName.trim();
    if (name === "" || busy) {
      return;
    }
    busy = true;
    try {
      await saveFolder(storage, newFolderDraft(name));
      newFolderName = "";
      onChanged();
    } finally {
      busy = false;
    }
  }

  async function removeFolder(folder: FolderView) {
    busy = true;
    try {
      const orphaned = await deleteFolder(storage, folder.id);
      notice =
        orphaned > 0
          ? `已删除文件夹「${folder.name}」，其中 ${orphaned} 个条目已移至「无文件夹」`
          : `已删除文件夹「${folder.name}」`;
      onChanged();
    } finally {
      busy = false;
    }
  }
</script>

<div class="subpage">
  <div class="subpage-head">
    <button class="back" onclick={onBack} aria-label="返回">‹</button>
    <h1>文件夹</h1>
  </div>

  {#if notice !== ""}
    <p class="notice">{notice}</p>
  {/if}

  <section class="panel">
    {#if folders.length === 0}
      <p class="hint">还没有文件夹。</p>
    {:else}
      <ul class="folders">
        {#each folders as folder (folder.id)}
          <li>
            <span>{folder.name}</span>
            <button onclick={() => removeFolder(folder)} disabled={busy} aria-label="删除文件夹">×</button>
          </li>
        {/each}
      </ul>
      <p class="hint">删除文件夹不会删除其中的条目，它们会回到「无文件夹」。</p>
    {/if}

    <div class="add-folder">
      <input type="text" placeholder="新文件夹名称" bind:value={newFolderName} />
      <button class="btn btn-secondary" onclick={addFolder} disabled={busy}>添加</button>
    </div>
  </section>
</div>

<style>
  .folders {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .folders li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    padding: 7px 8px;
    border-radius: 6px;
  }

  .folders li:hover {
    background: var(--bg-subtle);
  }

  .folders button {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 0 4px;
  }

  .folders button:hover {
    color: var(--danger);
  }

  .add-folder {
    display: flex;
    gap: 6px;
  }

  .add-folder .btn {
    width: auto;
    flex: none;
  }
</style>
