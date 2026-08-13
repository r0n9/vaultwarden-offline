<script lang="ts">
  import { buildExport } from "@/core/import-export/export.service";
  import { ExportFormat } from "@/core/import-export/types";
  import { browserVaultStorage } from "@/platform/storage/browser-vault-storage";

  import { downloadText } from "../lib/navigation";

  let format = $state<ExportFormat>(ExportFormat.EncryptedJson);
  let password = $state("");
  let confirmation = $state("");
  let busy = $state(false);
  let error = $state("");
  let done = $state("");

  const needsPassword = $derived(format === ExportFormat.EncryptedJson);
  const canExport = $derived(
    !busy && (!needsPassword || (password.length >= 8 && password === confirmation)),
  );

  async function doExport() {
    if (!canExport) {
      return;
    }

    busy = true;
    error = "";
    done = "";
    try {
      const result = await buildExport(
        browserVaultStorage,
        format,
        needsPassword ? password : undefined,
      );

      downloadText(result.fileName, result.content, result.mimeType);

      done =
        result.droppedCount > 0
          ? `已导出 ${result.cipherCount - result.droppedCount} 条；${result.droppedCount} 条因 CSV 不支持其类型被跳过。`
          : `已导出 ${result.cipherCount} 条到 ${result.fileName}`;
      password = "";
      confirmation = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <h1>导出数据</h1>
  <p class="hint">
    导出文件与 Bitwarden 官方格式一致，可直接导回 Vaultwarden——你的数据不被锁在这个插件里。
  </p>

  <div class="field">
    <label for="format">格式</label>
    <select id="format" bind:value={format}>
      <option value={ExportFormat.EncryptedJson}>JSON · 口令加密（推荐）</option>
      <option value={ExportFormat.Json}>JSON · 明文</option>
      <option value={ExportFormat.Csv}>CSV · 明文</option>
    </select>
  </div>

  {#if needsPassword}
    <div class="field">
      <label for="pw">文件口令</label>
      <input id="pw" type="password" bind:value={password} autocomplete="new-password" />
      <p class="hint">至少 8 位。导回时需要它，与本地主密码相互独立。</p>
    </div>
    <div class="field">
      <label for="pw2">确认口令</label>
      <input id="pw2" type="password" bind:value={confirmation} autocomplete="new-password" />
      {#if confirmation !== "" && password !== confirmation}
        <p class="hint danger">两次输入不一致</p>
      {/if}
    </div>
  {:else}
    <p class="alert">
      明文导出会把**所有密码以可读文本**写入文件。仅在立刻导入其它密码管理器时使用，
      用完请安全删除。
    </p>
  {/if}

  {#if format === ExportFormat.Csv}
    <p class="hint">
      CSV 是有损格式：只支持登录 / 笔记 / 卡片 / 身份四类，且会丢失 id、时间戳、
      密码历史与 passkey。迁移请优先用 JSON。
    </p>
  {/if}

  <button class="btn" onclick={doExport} disabled={!canExport}>
    {busy ? "正在导出…" : "导出文件"}
  </button>

  {#if error !== ""}
    <p class="alert">{error}</p>
  {/if}
  {#if done !== ""}
    <p class="done">{done}</p>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .danger {
    color: var(--danger);
  }

  .done {
    padding: 8px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--success);
    font-size: 12px;
    margin: 0;
  }
</style>
