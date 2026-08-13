<script lang="ts">
  import { CipherRepromptType, CipherType } from "@/core/vault/enums";
  import type { CipherView, FolderView } from "@/core/vault/models";
  import { CIPHER_TYPE_LABELS } from "@/core/vault/vault-search";
  import { sendMessage } from "@/platform/messaging";

  import CipherIcon from "../components/CipherIcon.svelte";
  import CopyRow from "../components/CopyRow.svelte";
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
  }: {
    cipher: CipherView;
    folders: FolderView[];
    onEdit: () => void;
    onDelete: () => void;
    onRestore: () => void;
    onPurge: () => void;
    onToggleFavorite: () => void;
    onBack: () => void;
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

  const folderName = $derived(
    cipher.folderId == null ? undefined : folders.find((f) => f.id === cipher.folderId)?.name,
  );

  const fields = $derived(TYPE_FIELDS[cipher.type] ?? []);
  const inTrash = $derived(cipher.deletedDate != null);

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
          <CopyRow label="验证器密钥（TOTP）" value={cipher.login.totp} secret />
          <p class="hint">动态验证码的生成将在 Phase 6 接入。</p>
        {/if}
        {#each cipher.login?.uris ?? [] as entry, index (index)}
          {#if entry.uri}
            <CopyRow label={`网址 ${index + 1}`} value={entry.uri} />
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
        <button class="btn" onclick={onEdit}>编辑</button>
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
</style>
