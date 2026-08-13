<script lang="ts">
  import { defaultKdfConfig } from "@/core/crypto";
  import {
    ImportPasswordError,
    MergeStrategy,
    type ImportProbe,
    type MergeResult,
    type ParsedVault,
  } from "@/core/import-export/types";
  import { mergeIntoVault, parseImport, probeImport } from "@/core/import-export/import.service";
  import { VaultStatus } from "@/core/state/vault-status";
  import { createVault } from "@/core/vault/vault.service";
  import { sendMessage } from "@/platform/messaging";
  import { browserVaultStorage } from "@/platform/storage/browser-vault-storage";

  const { status, onDone }: { status: VaultStatus; onDone: () => void } = $props();

  /** 未建库时，导入同时要求用户设定本地主密码。 */
  const bootstrap = $derived(status === VaultStatus.Uninitialized);

  let fileName = $state("");
  let fileText = $state("");
  let probe = $state<ImportProbe | null>(null);
  let filePassword = $state("");
  let parsed = $state<ParsedVault | null>(null);

  let masterPassword = $state("");
  let masterConfirm = $state("");
  let strategy = $state<MergeStrategy>(MergeStrategy.SkipDuplicates);

  let busy = $state(false);
  let error = $state("");
  let result = $state<MergeResult | null>(null);

  async function onFileSelected(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    reset();
    if (file == null) {
      return;
    }

    fileName = file.name;
    try {
      fileText = await file.text();
      probe = probeImport(fileText, file.name);
      if (!probe.requiresPassword) {
        await doParse();
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function reset() {
    fileText = "";
    probe = null;
    parsed = null;
    filePassword = "";
    error = "";
    result = null;
  }

  async function doParse() {
    busy = true;
    error = "";
    try {
      parsed = await parseImport(fileText, filePassword, fileName);
    } catch (e) {
      parsed = null;
      error =
        e instanceof ImportPasswordError
          ? "文件口令不正确，请重新输入"
          : e instanceof Error
            ? e.message
            : String(e);
    } finally {
      busy = false;
    }
  }

  const canImport = $derived(
    parsed != null &&
      !busy &&
      (!bootstrap || (masterPassword.length >= 8 && masterPassword === masterConfirm)),
  );

  async function doImport() {
    if (parsed == null || !canImport) {
      return;
    }

    busy = true;
    error = "";
    try {
      if (bootstrap) {
        // 先建一个空库（此时即为已解锁），再把解析结果并进去。
        await createVault(browserVaultStorage, masterPassword, { kdf: defaultKdfConfig() });
      }

      result = await mergeIntoVault(browserVaultStorage, parsed, strategy);
      masterPassword = "";
      masterConfirm = "";

      // 让背景页刷新图标与状态。
      await sendMessage("vault:getStatus");
      onDone();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <h1>导入数据</h1>
  <p class="hint">
    支持 Bitwarden / Vaultwarden 的 JSON（明文或密码保护）与 CSV 导出文件。
  </p>

  <div class="field">
    <label for="file">导出文件</label>
    <input id="file" type="file" accept=".json,.csv,application/json,text/csv" onchange={onFileSelected} />
    {#if fileName !== ""}
      <p class="hint">已选择：{fileName}</p>
    {/if}
  </div>

  {#if probe?.requiresPassword === true && parsed == null}
    <div class="field">
      <label for="filepw">文件口令</label>
      <input id="filepw" type="password" bind:value={filePassword} autocomplete="off" />
      <p class="hint">导出该文件时设置的口令，不是你的 Bitwarden 主密码。</p>
    </div>
    <button class="btn" onclick={doParse} disabled={busy || filePassword.length === 0}>
      {busy ? "正在解密…" : "解密文件"}
    </button>
  {/if}

  {#if parsed != null}
    <div class="preview">
      <strong>{parsed.ciphers.length}</strong> 个条目 ·
      <strong>{parsed.folders.length}</strong> 个文件夹
      {#if parsed.degradedCollections > 0}
        <p class="hint">
          其中 {parsed.degradedCollections} 个组织集合已降级为文件夹，条目归属关系保留。
        </p>
      {/if}
    </div>

    {#if bootstrap}
      <div class="field">
        <label for="mpw">设置本地主密码</label>
        <input id="mpw" type="password" bind:value={masterPassword} autocomplete="new-password" />
        <p class="hint">至少 8 位。它只用于加密本地数据，与导出文件的口令无关，且无法找回。</p>
      </div>
      <div class="field">
        <label for="mpw2">确认主密码</label>
        <input id="mpw2" type="password" bind:value={masterConfirm} autocomplete="new-password" />
        {#if masterConfirm !== "" && masterPassword !== masterConfirm}
          <p class="hint danger">两次输入不一致</p>
        {/if}
      </div>
    {:else}
      <div class="field">
        <label for="strategy">与现有数据的合并方式</label>
        <select id="strategy" bind:value={strategy}>
          <option value={MergeStrategy.SkipDuplicates}>跳过重复（内容完全相同才算重复）</option>
          <option value={MergeStrategy.Overwrite}>覆盖同 id 条目</option>
          <option value={MergeStrategy.AppendAll}>全部作为新条目加入</option>
        </select>
      </div>
    {/if}

    <button class="btn" onclick={doImport} disabled={!canImport}>
      {busy ? "正在导入…" : bootstrap ? "创建密码库并导入" : "导入"}
    </button>
  {/if}

  {#if error !== ""}
    <p class="alert">{error}</p>
  {/if}

  {#if result != null}
    <div class="result">
      <p><strong>导入完成</strong></p>
      <ul>
        <li>新增 {result.added} 条</li>
        {#if result.updated > 0}<li>更新 {result.updated} 条</li>{/if}
        {#if result.skipped > 0}<li>跳过重复 {result.skipped} 条</li>{/if}
        {#if result.foldersAdded > 0}<li>新增文件夹 {result.foldersAdded} 个</li>{/if}
      </ul>
      <p class="hint">可以关闭此标签页了。</p>
    </div>
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

  .preview {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-subtle);
    font-size: 13px;
  }

  .danger {
    color: var(--danger);
  }

  .result {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-subtle);
    font-size: 13px;
  }

  .result ul {
    margin: 6px 0 0;
    padding-left: 18px;
  }

  input[type="file"] {
    font-size: 12px;
    padding: 6px 0;
  }
</style>
