<script lang="ts">
  import {
    CHARACTER_SETS,
    generatePassphrase,
    generatePassword,
    generateUsername,
  } from "@/core/generator";

  type Kind = "password" | "passphrase" | "username";

  let kind = $state<Kind>("password");

  // 密码参数
  let length = $state(20);
  let useLowercase = $state(true);
  let useUppercase = $state(true);
  let useDigits = $state(true);
  let useSymbols = $state(true);
  let avoidAmbiguous = $state(true);

  // 短语参数
  let wordCount = $state(4);
  let separator = $state("-");
  let capitalize = $state(true);
  let includeNumber = $state(true);

  // 用户名参数
  let usernameNumber = $state(true);

  let result = $state("");
  let copied = $state(false);
  let error = $state("");

  function generate() {
    error = "";
    try {
      if (kind === "password") {
        result = generatePassword({
          length,
          useLowercase,
          useUppercase,
          useDigits,
          useSymbols,
          minLowercase: useLowercase ? 1 : 0,
          minUppercase: useUppercase ? 1 : 0,
          minDigits: useDigits ? 1 : 0,
          minSymbols: useSymbols ? 1 : 0,
          avoidAmbiguous,
        });
      } else if (kind === "passphrase") {
        result = generatePassphrase({ wordCount, separator, capitalize, includeNumber });
      } else {
        result = generateUsername({ includeNumber: usernameNumber });
      }
      copied = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function copy() {
    if (result === "") {
      return;
    }
    try {
      await navigator.clipboard.writeText(result);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      // 剪贴板不可用时不打扰。
    }
  }

  $effect(() => {
    generate();
  });
</script>

<div class="generator">
  <div class="kinds">
    <button class:active={kind === "password"} onclick={() => (kind = "password")}>密码</button>
    <button class:active={kind === "passphrase"} onclick={() => (kind = "passphrase")}>
      密码短语
    </button>
    <button class:active={kind === "username"} onclick={() => (kind = "username")}>用户名</button>
  </div>

  {#if kind === "password"}
    <div class="field">
      <label for="plen">长度</label>
      <div class="range-row">
        <input
          id="plen"
          type="range"
          min="8"
          max="64"
          step="1"
          bind:value={length}
        />
        <span class="value">{length}</span>
      </div>
    </div>

    <div class="charsets">
      <label><input type="checkbox" bind:checked={useLowercase} /> 小写 a-z</label>
      <label><input type="checkbox" bind:checked={useUppercase} /> 大写 A-Z</label>
      <label><input type="checkbox" bind:checked={useDigits} /> 数字 0-9</label>
      <label><input type="checkbox" bind:checked={useSymbols} /> 符号 {CHARACTER_SETS.symbols}</label>
      <label><input type="checkbox" bind:checked={avoidAmbiguous} /> 剔除歧义字符</label>
    </div>
  {:else if kind === "passphrase"}
    <div class="field">
      <label for="wcount">单词数</label>
      <div class="range-row">
        <input
          id="wcount"
          type="range"
          min="2"
          max="8"
          step="1"
          bind:value={wordCount}
        />
        <span class="value">{wordCount}</span>
      </div>
    </div>

    <div class="field">
      <label for="sep">分隔符</label>
      <div class="sep-row">
        {#each ["-", "_", ".", " "] as option (option)}
          <button
            class:active={separator === option}
            onclick={() => (separator = option)}
          >
            {option === " " ? "空格" : option}
          </button>
        {/each}
      </div>
    </div>

    <div class="charsets">
      <label><input type="checkbox" bind:checked={capitalize} /> 每词首字母大写</label>
      <label><input type="checkbox" bind:checked={includeNumber} /> 追加两位数字</label>
    </div>
  {:else}
    <div class="charsets">
      <label><input type="checkbox" bind:checked={usernameNumber} /> 追加数字后缀</label>
    </div>
  {/if}

  <button class="btn" onclick={generate}>生成</button>

  {#if error !== ""}
    <p class="alert">{error}</p>
  {/if}

  {#if result !== ""}
    <div class="result">
      <code>{result}</code>
      <button class="copy" onclick={copy} title="复制" aria-label="复制">
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  {/if}
</div>

<style>
  .generator {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .kinds {
    display: flex;
    gap: 4px;
  }

  .kinds button {
    flex: 1;
    padding: 6px 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }

  .kinds button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  .range-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .range-row input {
    flex: 1;
  }

  .value {
    min-width: 22px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 13px;
  }

  .charsets {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
  }

  .charsets label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .sep-row {
    display: flex;
    gap: 4px;
  }

  .sep-row button {
    flex: 1;
    padding: 5px 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    cursor: pointer;
  }

  .sep-row button.active {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .result {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-subtle);
  }

  code {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    word-break: break-all;
  }

  .copy {
    flex: none;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .copy:hover {
    background: var(--bg-subtle);
    color: var(--text);
  }
</style>
