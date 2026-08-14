<script lang="ts">
  import { emptyTrash } from "@/core/vault/vault-repository";
  import { sendMessage } from "@/platform/messaging";
  import { browserVaultStorage as storage } from "@/platform/storage/browser-vault-storage";
  import { openInTab } from "../../lib/navigation";

  const { onChanged, onBack }: { onChanged: () => void; onBack: () => void } = $props();

  let exportVerifyMode = $state(false);
  let exportPassword = $state("");
  let exportError = $state("");
  let exportBusy = $state(false);
  let busy = $state(false);
  let notice = $state("");

  async function verifyAndOpenExport() {
    if (exportPassword === "" || exportBusy) {
      return;
    }
    exportBusy = true;
    exportError = "";
    try {
      const verification = await sendMessage("vault:verifyPassword", {
        masterPassword: exportPassword,
      });
      if (verification?.valid !== true) {
        exportError = "主密码不正确";
        return;
      }
      openInTab("export");
      exportVerifyMode = false;
      exportPassword = "";
    } finally {
      exportBusy = false;
    }
  }

  async function clearTrash() {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const removed = await emptyTrash(storage);
      notice = removed > 0 ? `已永久删除 ${removed} 个条目` : "回收站本来就是空的";
      onChanged();
    } finally {
      busy = false;
    }
  }
</script>

<div class="subpage">
  <div class="subpage-head">
    <button class="back" onclick={onBack} aria-label="返回">‹</button>
    <h1>数据</h1>
  </div>

  {#if notice !== ""}
    <p class="notice">{notice}</p>
  {/if}

  <section class="panel">
    {#if exportVerifyMode}
      <div class="field">
        <label for="export-pw">验证主密码</label>
        <input
          id="export-pw"
          type="password"
          bind:value={exportPassword}
          autocomplete="current-password"
          onkeydown={(e) => {
            if (e.key === "Enter") {
              void verifyAndOpenExport();
            }
          }}
        />
      </div>
      {#if exportError !== ""}
        <p class="alert">{exportError}</p>
      {/if}
      <div class="row">
        <button
          class="btn btn-secondary"
          onclick={() => {
            exportVerifyMode = false;
            exportPassword = "";
            exportError = "";
          }}
        >
          取消
        </button>
        <button
          class="btn"
          onclick={() => void verifyAndOpenExport()}
          disabled={exportBusy || exportPassword === ""}
        >
          {exportBusy ? "验证中…" : "验证并导出"}
        </button>
      </div>
    {:else}
      <div class="row">
        <button class="btn btn-secondary" onclick={() => openInTab("import")}>导入</button>
        <button class="btn btn-secondary" onclick={() => (exportVerifyMode = true)}>导出</button>
      </div>
      <p class="hint">导出文件包含全部密码，导出前需要验证主密码。</p>
    {/if}
  </section>

  <section class="panel danger">
    <button class="btn btn-secondary" onclick={clearTrash} disabled={busy}>清空回收站</button>
    <p class="hint invalid">将永久删除回收站里的条目，且不会经过主密码验证。</p>
  </section>
</div>
