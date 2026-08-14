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
          ⚄
        </button>
      </div>
    </div>

    <div class="field">
      <label for="password">密码</label>
      <div class="with-action">
        <input
          id="password"
          type="text"
          value={draft.login?.password ?? ""}
          oninput={(e) => {
            draft.login = { ...(draft.login ?? {}), password: e.currentTarget.value };
          }}
          autocomplete="off"
        />
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
            ⚄
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
