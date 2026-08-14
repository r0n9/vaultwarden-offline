<script lang="ts">
  import { CipherRepromptType, CipherType } from "@/core/vault/enums";
  import type { CipherView, FolderView } from "@/core/vault/models";
  import { CIPHER_TYPE_LABELS } from "@/core/vault/vault-search";
  import { sendMessage } from "@/platform/messaging";
  import type { AutofillFillResult } from "@/platform/messaging/types";

  import CipherIcon from "../components/CipherIcon.svelte";
  import CopyRow from "../components/CopyRow.svelte";
  import TotpDisplay from "../components/TotpDisplay.svelte";
  import { TYPE_FIELDS, readPayload } from "../lib/cipher-fields";

  const {
    cipher,
    folders,
    onEdit,
    onDelete,
    onRestore,
    onPurge,
    onToggleFavorite,
    onBack,
    onChanged,
  }: {
    cipher: CipherView;
    folders: FolderView[];
    onEdit: () => void;
    onDelete: () => void;
    onRestore: () => void;
    onPurge: () => void;
    onToggleFavorite: () => void;
    onBack: () => void;
    /** 附件增删后刷新条目数据。 */
    onChanged?: () => void;
  } = $props();

  /**
   * 条目级主密码复验。
   *
   * 标记了 reprompt 的条目在展示任何字段前先要求重输主密码——防的是
   * 「密码库已解锁、人却离开了座位」这种场景。
   */
  const needsReprompt = $derived(cipher.reprompt === CipherRepromptType.Password);
  let verified = $state(false);
  const unlocked = $derived(!needsReprompt || verified);

  let repromptPassword = $state("");
  let repromptError = $state("");
  let verifying = $state(false);

  let confirmingPurge = $state(false);

  let filling = $state(false);
  let fillResult = $state<AutofillFillResult | null>(null);

  let attachmentBusy = $state(false);
  let attachmentError = $state("");

  /** 附件增删后通知上层刷新条目。 */
  async function onAttachmentsChanged() {
    onChanged?.();
  }

  async function addAttachmentFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file == null || attachmentBusy) {
      return;
    }
    attachmentBusy = true;
    attachmentError = "";
    try {
      const data = await file.arrayBuffer();
      const result = await sendMessage("attachment:add", {
        cipherId: cipher.id,
        fileName: file.name,
        data,
      });
      if (result?.ok !== true) {
        attachmentError = result?.message ?? "上传失败";
        return;
      }
      await onAttachmentsChanged();
    } catch (e) {
      attachmentError = e instanceof Error ? e.message : String(e);
    } finally {
      attachmentBusy = false;
      (event.currentTarget as HTMLInputElement).value = "";
    }
  }

  async function downloadAttachment(attachmentId: string, fileName: string) {
    attachmentBusy = true;
    attachmentError = "";
    try {
      const result = await sendMessage("attachment:get", { attachmentId });
      if (result?.ok !== true || result.data == null) {
        attachmentError = result?.message ?? "下载失败";
        return;
      }
      const blob = new Blob([result.data], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      attachmentBusy = false;
    }
  }

  async function deleteAttachmentFile(attachmentId: string) {
    attachmentBusy = true;
    attachmentError = "";
    try {
      const result = await sendMessage("attachment:delete", {
        cipherId: cipher.id,
        attachmentId,
      });
      if (result?.ok !== true) {
        attachmentError = result?.message ?? "删除失败";
        return;
      }
      await onAttachmentsChanged();
    } finally {
      attachmentBusy = false;
    }
  }

  const canAutofill = $derived(
    cipher.type === CipherType.Login &&
      cipher.deletedDate == null &&
      ((cipher.login?.username ?? "") !== "" || (cipher.login?.password ?? "") !== ""),
  );

  async function fillToPage() {
    filling = true;
    fillResult = null;
    try {
      fillResult = (await sendMessage("autofill:fillActiveTab", { cipherId: cipher.id })) ?? null;
    } finally {
      filling = false;
    }
  }

  const folderName = $derived(
    cipher.folderId == null ? undefined : folders.find((f) => f.id === cipher.folderId)?.name,
  );

  const fields = $derived(TYPE_FIELDS[cipher.type] ?? []);
  const inTrash = $derived(cipher.deletedDate != null);

  function formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function verify(event: Event) {
    event.preventDefault();
    verifying = true;
    repromptError = "";
    try {
      const result = await sendMessage("vault:verifyPassword", {
        masterPassword: repromptPassword,
      });
      if (result?.valid === true) {
        verified = true;
        repromptPassword = "";
      } else {
        repromptError = "主密码不正确";
      }
    } finally {
      verifying = false;
    }
  }
</script>

<div class="detail">
  <button class="back" onclick={onBack}>‹ 返回</button>

  <header class="head">
    <CipherIcon {cipher} size={40} />
    <div class="title">
      <h1>{cipher.name || "（无名称）"}</h1>
      <p class="hint">{CIPHER_TYPE_LABELS[cipher.type]}{folderName == null ? "" : ` · ${folderName}`}</p>
    </div>
    <button class="star" onclick={onToggleFavorite} title={cipher.favorite ? "取消收藏" : "收藏"}>
      {cipher.favorite ? "★" : "☆"}
    </button>
  </header>

  {#if inTrash}
    <p class="alert">此条目在回收站中，删除于 {new Date(cipher.deletedDate!).toLocaleString()}</p>
  {/if}

  {#if !unlocked}
    <form class="reprompt" onsubmit={verify}>
      <p class="hint">该条目要求重新验证主密码后才能查看。</p>
      <input type="password" bind:value={repromptPassword} autocomplete="current-password" />
      {#if repromptError !== ""}<p class="alert">{repromptError}</p>{/if}
      <button class="btn" type="submit" disabled={verifying || repromptPassword === ""}>
        {verifying ? "验证中…" : "验证"}
      </button>
    </form>
  {:else}
    <div class="fields">
      {#if cipher.type === CipherType.Login}
        {#if cipher.login?.username}
          <CopyRow label="用户名" value={cipher.login.username} />
        {/if}
        {#if cipher.login?.password}
          <CopyRow label="密码" value={cipher.login.password} secret />
        {/if}
        {#if cipher.login?.totp}
          <div class="totp-row">
            <span class="totp-label">动态验证码</span>
            <TotpDisplay totpValue={cipher.login.totp} />
          </div>
          <CopyRow label="验证器密钥" value={cipher.login.totp} secret />
        {/if}
        {#each cipher.login?.uris ?? [] as entry, index (index)}
          {#if entry.uri}
            <CopyRow label={`网址 ${index + 1}`} value={entry.uri} href={entry.uri} />
          {/if}
        {/each}
      {:else}
        {#each fields as spec (spec.key)}
          {@const value = readPayload(cipher, spec.key)}
          {#if value !== ""}
            <CopyRow
              label={spec.label}
              {value}
              secret={spec.secret === true}
              multiline={spec.multiline === true}
            />
          {/if}
        {/each}
      {/if}

      {#each cipher.fields ?? [] as field, index (index)}
        {#if field.name != null || field.value != null}
          <CopyRow
            label={field.name ?? "自定义字段"}
            value={field.value ?? ""}
            secret={field.type === 1}
          />
        {/if}
      {/each}

      {#if cipher.notes}
        <CopyRow label="备注" value={cipher.notes} multiline />
      {/if}

      {#if (cipher.passwordHistory?.length ?? 0) > 0}
        <details class="history">
          <summary>密码历史（{cipher.passwordHistory!.length}）</summary>
          {#each cipher.passwordHistory! as entry, index (index)}
            <CopyRow
              label={new Date(entry.lastUsedDate).toLocaleString()}
              value={entry.password}
              secret
            />
          {/each}
        </details>
      {/if}

      <details class="history" open={false}>
        <summary>附件（{cipher.attachments?.length ?? 0}）</summary>

        {#if attachmentError !== ""}
          <p class="alert">{attachmentError}</p>
        {/if}

        {#if (cipher.attachments?.length ?? 0) > 0}
          <ul class="attachments">
            {#each cipher.attachments ?? [] as attachment (attachment.id)}
              <li>
                <span class="att-name" title={attachment.fileName}>{attachment.fileName}</span>
                <span class="att-size">{formatSize(attachment.size)}</span>
                <button
                  type="button"
                  onclick={() => void downloadAttachment(attachment.id, attachment.fileName)}
                  disabled={attachmentBusy}
                  title="下载"
                  aria-label="下载"
                >
                  ⤓
                </button>
                <button
                  type="button"
                  onclick={() => void deleteAttachmentFile(attachment.id)}
                  disabled={attachmentBusy}
                  title="删除"
                  aria-label="删除"
                >
                  ×
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">还没有附件。</p>
        {/if}

        <label class="add-attachment">
          <input
            type="file"
            onchange={(e) => void addAttachmentFile(e)}
            disabled={attachmentBusy}
            hidden
          />
          <span class="add-link">{attachmentBusy ? "处理中…" : "＋ 添加附件"}</span>
        </label>
      </details>
    </div>

    <dl class="meta">
      <dt>创建</dt>
      <dd>{new Date(cipher.creationDate).toLocaleString()}</dd>
      <dt>修改</dt>
      <dd>{new Date(cipher.revisionDate).toLocaleString()}</dd>
    </dl>

    <div class="actions">
      {#if inTrash}
        <button class="btn btn-secondary" onclick={onRestore}>恢复</button>
        {#if confirmingPurge}
          <p class="alert">永久删除不可恢复，确定？</p>
          <div class="row">
            <button class="btn btn-secondary" onclick={() => (confirmingPurge = false)}>取消</button>
            <button class="btn btn-danger" onclick={onPurge}>确认删除</button>
          </div>
        {:else}
          <button class="btn btn-danger" onclick={() => (confirmingPurge = true)}>永久删除</button>
        {/if}
      {:else}
        {#if canAutofill}
          <button class="btn" onclick={fillToPage} disabled={filling}>
            {filling ? "正在填充…" : "填充到当前页"}
          </button>

          {#if fillResult != null}
            {#if fillResult.ok}
              <p class="fill-ok">
                已填充 {fillResult.filled} 个字段{fillResult.frames != null && fillResult.frames > 1
                  ? `（跨 ${fillResult.frames} 个框架）`
                  : ""}
              </p>
              {#if fillResult.urlMatches === false}
                <p class="alert">
                  注意：该条目保存的网址与当前站点不一致。确认这是你想登录的站点，
                  钓鱼页面正是靠仿冒地址骗取密码。
                </p>
              {/if}
            {:else}
              <p class="alert">{fillResult.message}</p>
            {/if}
          {/if}
        {/if}

        <button class="btn btn-secondary" onclick={onEdit}>编辑</button>
        <button class="btn btn-danger" onclick={onDelete}>移入回收站</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .back {
    align-self: flex-start;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    padding: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .title {
    flex: 1;
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    word-break: break-all;
  }

  .star {
    border: none;
    background: transparent;
    color: #eab308;
    font-size: 18px;
    cursor: pointer;
    flex: none;
  }

  .reprompt {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .fields {
    display: flex;
    flex-direction: column;
  }

  .history summary {
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 8px 0;
  }

  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
    font-size: 11px;
    color: var(--text-muted);
  }

  .meta dd {
    margin: 0;
    text-align: right;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .totp-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
  }

  .totp-label {
    font-size: 11px;
    color: var(--text-muted);
  }

  .attachments {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .attachments li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .att-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .att-size {
    color: var(--text-muted);
    font-size: 11px;
    flex: none;
  }

  .attachments button {
    flex: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 2px 6px;
  }

  .attachments button:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--accent);
  }

  .attachments button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .add-attachment {
    display: inline-flex;
    margin-top: 6px;
    cursor: pointer;
  }

  .add-link {
    color: var(--accent);
    font-size: 12px;
  }

  .add-link:hover {
    text-decoration: underline;
  }

  .fill-ok {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--success);
    font-size: 12px;
  }
</style>
