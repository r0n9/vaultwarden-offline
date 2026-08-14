<script lang="ts">
  import { CipherRepromptType, CipherType, FieldType } from "@/core/vault/enums";
  import type { CipherView, FolderView } from "@/core/vault/models";
  import { CIPHER_TYPE_LABELS } from "@/core/vault/vault-search";

  import {
    defaultPassphraseOptions,
    defaultPasswordOptions,
    generatePassphrase,
    generatePassword,
    generateUsername,
  } from "@/core/generator";

  import { TYPE_FIELDS, readPayload, writePayload } from "../lib/cipher-fields";

  const {
    cipher,
    folders,
    onSave,
    onCancel,
  }: {
    cipher: CipherView;
    folders: FolderView[];
    onSave: (next: CipherView) => void;
    onCancel: () => void;
  } = $props();

  // 深拷贝后再编辑：直接改传入对象会让"取消"变得无法真正取消。
  // 本组件只在打开某一条目时挂载一次，因此这里刻意只取 cipher 的初始值。
  // svelte-ignore state_referenced_locally
  let draft = $state<CipherView>(structuredClone($state.snapshot(cipher)));
  // svelte-ignore state_referenced_locally
  let uris = $state<string[]>((cipher.login?.uris ?? []).map((entry) => entry.uri ?? ""));
  // svelte-ignore state_referenced_locally
  let customFields = $state(
    (cipher.fields ?? []).map((field) => ({
      name: field.name ?? "",
      value: field.value ?? "",
      type: field.type,
    })),
  );
  let saving = $state(false);
  let showPasswordMenu = $state(false);
  /** 密码默认不可见，可点击切换。 */
  let showPassword = $state(false);
  /** 验证器密钥默认不可见，可点击切换。 */
  let showTotp = $state(false);

  function generateStrong() {
    showPasswordMenu = false;
    draft.login = { ...(draft.login ?? {}), password: generatePassword({ ...defaultPasswordOptions() }) };
  }

  function generatePhrase() {
    showPasswordMenu = false;
    draft.login = { ...(draft.login ?? {}), password: generatePassphrase({ ...defaultPassphraseOptions() }) };
  }

  const fields = $derived(TYPE_FIELDS[draft.type] ?? []);
  const isNew = $derived(cipher.name === "");

  function setPayload(key: string, event: Event) {
    writePayload(draft, key, (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value);
  }

  function submit(event: Event) {
    event.preventDefault();
    if (draft.name.trim() === "" || saving) {
      return;
    }
    saving = true;

    const next: CipherView = { ...$state.snapshot(draft) } as CipherView;

    if (next.type === CipherType.Login) {
      const login = { ...(next.login ?? {}) };
      const cleaned = uris.map((uri) => uri.trim()).filter((uri) => uri !== "");
      if (cleaned.length > 0) {
        login.uris = cleaned.map((uri) => ({ uri }));
      } else {
        delete login.uris;
      }
      // 空串一律删键，避免导出文件里堆满空字段。
      for (const key of ["username", "password", "totp"] as const) {
        if (login[key] === "") {
          delete login[key];
        }
      }
      next.login = login;
    }

    if (next.type === CipherType.SecureNote) {
      next.secureNote = { type: 0 };
    }

    const validFields = customFields.filter((f) => f.name.trim() !== "" || f.value.trim() !== "");
    if (validFields.length > 0) {
      next.fields = validFields.map((f) => ({ name: f.name, value: f.value, type: f.type }));
    } else {
      delete next.fields;
    }

    if (next.notes === "") {
      delete next.notes;
    }
    if (next.folderId === "") {
      delete next.folderId;
    }

    onSave(next);
  }
</script>

{#snippet generatorIcon()}
  <!-- 循环箭头（与底部生成器 tab 图标一致，取自 Bitwarden） -->
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M12 22C9.86667 22 7.94583 21.3917 6.2375 20.175C4.52917 18.9583 3.31667 17.3667 2.6 15.4C2.51667 15.15 2.54167 14.9167 2.675 14.7C2.80833 14.4833 3.00833 14.3333 3.275 14.25C3.54167 14.1667 3.79583 14.1958 4.0375 14.3375C4.27917 14.4792 4.45 14.675 4.55 14.925C5.15 16.4417 6.125 17.6667 7.475 18.6C8.825 19.5333 10.3333 20 12 20C13.4333 20 14.7667 19.6458 16 18.9375C17.2333 18.2292 18.2 17.25 18.9 16H17C16.7167 16 16.4792 15.9042 16.2875 15.7125C16.0958 15.5208 16 15.2833 16 15C16 14.7167 16.0958 14.4792 16.2875 14.2875C16.4792 14.0958 16.7167 14 17 14H21C21.2833 14 21.5208 14.0958 21.7125 14.2875C21.9042 14.4792 22 14.7167 22 15V19C22 19.2833 21.9042 19.5208 21.7125 19.7125C21.5208 19.9042 21.2833 20 21 20C20.7167 20 20.4792 19.9042 20.2875 19.7125C20.0958 19.5208 20 19.2833 20 19V18C19.05 19.2667 17.875 20.25 16.475 20.95C15.075 21.65 13.5833 22 12 22ZM12 4C10.5667 4 9.23333 4.35417 8 5.0625C6.76667 5.77083 5.8 6.75 5.1 8H7C7.28333 8 7.52083 8.09583 7.7125 8.2875C7.90417 8.47917 8 8.71667 8 9C8 9.28333 7.90417 9.52083 7.7125 9.7125C7.52083 9.90417 7.28333 10 7 10H3C2.71667 10 2.47917 9.90417 2.2875 9.7125C2.09583 9.52083 2 9.28333 2 9V5C2 4.71667 2.09583 4.47917 2.2875 4.2875C2.47917 4.09583 2.71667 4 3 4C3.28333 4 3.52083 4.09583 3.7125 4.2875C3.90417 4.47917 4 4.71667 4 5V6C4.95 4.73333 6.125 3.75 7.525 3.05C8.925 2.35 10.4167 2 12 2C14.1333 2 16.0542 2.60833 17.7625 3.825C19.4708 5.04167 20.6833 6.63333 21.4 8.6C21.4833 8.85 21.4583 9.08333 21.325 9.3C21.1917 9.51667 20.9917 9.66667 20.725 9.75C20.4583 9.83333 20.2042 9.80417 19.9625 9.6625C19.7208 9.52083 19.55 9.325 19.45 9.075C18.85 7.55833 17.875 6.33333 16.525 5.4C15.175 4.46667 13.6667 4 12 4ZM12 15C11.1667 15 10.4583 14.7083 9.875 14.125C9.29167 13.5417 9 12.8333 9 12C9 11.1667 9.29167 10.4583 9.875 9.875C10.4583 9.29167 11.1667 9 12 9C12.8333 9 13.5417 9.29167 14.125 9.875C14.7083 10.4583 15 11.1667 15 12C15 12.8333 14.7083 13.5417 14.125 14.125C13.5417 14.7083 12.8333 15 12 15Z" />
  </svg>
{/snippet}

<form class="edit" onsubmit={submit}>
  <button class="back" type="button" onclick={onCancel}>‹ 取消</button>

  <h1>{isNew ? `新建${CIPHER_TYPE_LABELS[draft.type]}` : "编辑条目"}</h1>

  <div class="field">
    <label for="name">名称</label>
    <input id="name" type="text" bind:value={draft.name} required />
  </div>

  {#if draft.type === CipherType.Login}
    <div class="field">
      <label for="username">用户名</label>
      <div class="with-action">
        <input
          id="username"
          type="text"
          value={draft.login?.username ?? ""}
          oninput={(e) => {
            draft.login = { ...(draft.login ?? {}), username: e.currentTarget.value };
          }}
          autocomplete="off"
        />
        <button
          type="button"
          class="gen"
          title="生成用户名"
          onclick={() => {
            draft.login = { ...(draft.login ?? {}), username: generateUsername() };
          }}
        >
          {@render generatorIcon()}
        </button>
      </div>
    </div>

    <div class="field">
      <label for="password">密码</label>
      <div class="with-action">
        <input
          id="password"
          type={showPassword ? "text" : "password"}
          value={draft.login?.password ?? ""}
          oninput={(e) => {
            draft.login = { ...(draft.login ?? {}), password: e.currentTarget.value };
          }}
          autocomplete="off"
        />
        <button
          type="button"
          class="gen"
          onclick={() => (showPassword = !showPassword)}
          title={showPassword ? "隐藏" : "显示"}
          aria-label={showPassword ? "隐藏" : "显示"}
        >
          {showPassword ? "🙈" : "👁"}
        </button>
        {#if showPasswordMenu}
          <div class="gen-menu">
            <button type="button" onclick={generateStrong}>强密码（20 位）</button>
            <button type="button" onclick={generatePhrase}>密码短语（4 词）</button>
          </div>
        {:else}
          <button
            type="button"
            class="gen"
            title="生成密码"
            onclick={() => (showPasswordMenu = !showPasswordMenu)}
          >
            {@render generatorIcon()}
          </button>
        {/if}
      </div>
    </div>

    <div class="field">
      <label for="totp">验证器密钥（TOTP）</label>
      <div class="with-action">
        <input
          id="totp"
          type={showTotp ? "text" : "password"}
          value={draft.login?.totp ?? ""}
          oninput={(e) => {
            draft.login = { ...(draft.login ?? {}), totp: e.currentTarget.value };
          }}
          autocomplete="off"
        />
        <button
          type="button"
          class="gen"
          onclick={() => (showTotp = !showTotp)}
          title={showTotp ? "隐藏" : "显示"}
          aria-label={showTotp ? "隐藏" : "显示"}
        >
          {showTotp ? "🙈" : "👁"}
        </button>
      </div>
    </div>

    <div class="field">
      <label for="uri0">网址</label>
      {#each uris as _uri, index (index)}
        <div class="uri-row">
          <input id={index === 0 ? "uri0" : undefined} type="text" bind:value={uris[index]} />
          <button type="button" onclick={() => uris.splice(index, 1)} aria-label="删除网址">×</button>
        </div>
      {/each}
      <button class="add" type="button" onclick={() => uris.push("")}>＋ 添加网址</button>
    </div>
  {:else}
    {#each fields as spec (spec.key)}
      <div class="field">
        <label for={spec.key}>{spec.label}</label>
        {#if spec.multiline === true}
          <textarea id={spec.key} rows="3" value={readPayload(draft, spec.key)} oninput={(e) => setPayload(spec.key, e)}
          ></textarea>
        {:else}
          <input
            id={spec.key}
            type="text"
            value={readPayload(draft, spec.key)}
            oninput={(e) => setPayload(spec.key, e)}
            autocomplete="off"
          />
        {/if}
      </div>
    {/each}
  {/if}

  <div class="field">
    <label for="notes">备注</label>
    <textarea id="notes" rows="3" bind:value={draft.notes}></textarea>
  </div>

  <div class="field">
    <label for="folder">文件夹</label>
    <select id="folder" bind:value={draft.folderId}>
      <option value={undefined}>无文件夹</option>
      {#each folders as folder (folder.id)}
        <option value={folder.id}>{folder.name}</option>
      {/each}
    </select>
  </div>

  <div class="field">
    <span class="group-label">自定义字段</span>
    {#each customFields as field, index (index)}
      <div class="custom-row">
        <input type="text" placeholder="名称" bind:value={field.name} />
        <input type="text" placeholder="值" bind:value={field.value} />
        <select bind:value={field.type}>
          <option value={FieldType.Text}>文本</option>
          <option value={FieldType.Hidden}>隐藏</option>
          <option value={FieldType.Boolean}>布尔</option>
        </select>
        <button type="button" onclick={() => customFields.splice(index, 1)} aria-label="删除字段">×</button>
      </div>
    {/each}
    <button
      class="add"
      type="button"
      onclick={() => customFields.push({ name: "", value: "", type: FieldType.Text })}
    >
      ＋ 添加字段
    </button>
  </div>

  <label class="checkbox">
    <input
      type="checkbox"
      checked={draft.reprompt === CipherRepromptType.Password}
      onchange={(e) => {
        draft.reprompt = e.currentTarget.checked
          ? CipherRepromptType.Password
          : CipherRepromptType.None;
      }}
    />
    <span>
      查看前重新验证主密码
      <span class="hint">适合银行、身份证件这类特别敏感的条目</span>
    </span>
  </label>

  <button class="btn" type="submit" disabled={draft.name.trim() === "" || saving}>
    {saving ? "保存中…" : "保存"}
  </button>
</form>

<style>
  .edit {
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

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  textarea {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
  }

  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .with-action {
    position: relative;
    display: flex;
    gap: 6px;
  }

  .with-action input {
    flex: 1;
  }

  .gen {
    flex: none;
    width: 34px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-subtle);
    color: var(--text);
    font-size: 15px;
    cursor: pointer;
  }

  .gen:hover {
    border-color: var(--accent);
  }

  .gen-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 2px);
    z-index: 10;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    overflow: hidden;
  }

  .gen-menu button {
    padding: 7px 14px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }

  .gen-menu button:hover {
    background: var(--bg-subtle);
  }

  .group-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .uri-row,
  .custom-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .custom-row select {
    width: 74px;
    flex: none;
  }

  .uri-row button,
  .custom-row button {
    flex: none;
    width: 26px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 6px 0;
  }

  .add {
    align-self: flex-start;
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    padding: 2px 0;
  }

  .checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    cursor: pointer;
  }

  .checkbox input {
    margin: 2px 0 0;
    flex: none;
  }

  .checkbox span {
    display: flex;
    flex-direction: column;
  }
</style>
