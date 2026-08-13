<script lang="ts">
  import { runCryptoSelfTest, type SelfTestResult } from "@/core/crypto";

  let results = $state<SelfTestResult[] | null>(null);
  let running = $state(false);

  const allPassed = $derived(results?.every((r) => r.passed) ?? false);

  async function run() {
    running = true;
    try {
      results = await runCryptoSelfTest();
    } finally {
      running = false;
    }
  }

  $effect(() => {
    void run();
  });
</script>

<div class="self-test">
  <p class="hint">在浏览器真实的 WebCrypto 上重跑官方测试向量。</p>

  {#if results == null}
    <p class="hint">运行中…</p>
  {:else}
    <p class="verdict" class:ok={allPassed} class:bad={!allPassed}>
      {allPassed ? `${results.length} 项全部通过` : "存在失败项"}
    </p>
    <ul>
      {#each results as result (result.name)}
        <li>
          <span class="icon" class:ok={result.passed} class:bad={!result.passed}>
            {result.passed ? "✓" : "✗"}
          </span>
          <span class="name">{result.name}</span>
          <span class="detail" title={result.detail}>{result.detail}</span>
          <span class="ms">{result.durationMs.toFixed(0)}ms</span>
        </li>
      {/each}
    </ul>
  {/if}

  <button class="btn btn-secondary" onclick={run} disabled={running}>
    {running ? "运行中…" : "重新运行"}
  </button>
</div>

<style>
  .self-test {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
  }

  .verdict {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }

  .verdict.ok {
    color: var(--success);
  }

  .verdict.bad {
    color: var(--danger);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  li {
    display: grid;
    grid-template-columns: 14px 1fr auto auto;
    align-items: baseline;
    gap: 6px;
    font-size: 12px;
  }

  .icon {
    font-weight: 700;
  }

  .icon.ok {
    color: var(--success);
  }

  .icon.bad {
    color: var(--danger);
  }

  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .detail {
    color: var(--text-muted);
    font-size: 10px;
    max-width: 92px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ms {
    color: var(--text-muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
</style>
