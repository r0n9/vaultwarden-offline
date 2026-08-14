<script lang="ts">
  import type { AutofillField } from "@/core/autofill/models";
  import { sendMessage } from "@/platform/messaging";
  import type { AutofillCollectionResult } from "@/platform/messaging/types";

  const { onBack }: { onBack: () => void } = $props();

  let result = $state<AutofillCollectionResult | null>(null);
  let busy = $state(false);
  let elapsedMs = $state(0);
  let showAll = $state(false);

  const frames = $derived(result?.frames.filter((frame) => frame.details != null) ?? []);
  const totalFields = $derived(
    frames.reduce((sum, frame) => sum + (frame.details?.fields.length ?? 0), 0),
  );
  const totalForms = $derived(
    frames.reduce((sum, frame) => sum + Object.keys(frame.details?.forms ?? {}).length, 0),
  );

  async function collect() {
    busy = true;
    const started = performance.now();
    try {
      result = (await sendMessage("autofill:collectActiveTab")) ?? null;
      elapsedMs = performance.now() - started;
    } finally {
      busy = false;
    }
  }

  /** 优先展示最可能有用的那几项标签来源。 */
  function bestLabel(field: AutofillField): string {
    return (
      field["label-tag"] ||
      field["label-aria"] ||
      field.placeholder ||
      field["label-left"] ||
      field["label-top"] ||
      ""
    );
  }

  function identity(field: AutofillField): string {
    return field.htmlID || field.htmlName || field.opid;
  }

  $effect(() => {
    void collect();
  });
</script>

<div class="subpage">
  <div class="subpage-head">
    <button class="back" onclick={onBack} aria-label="返回">‹</button>
    <h1>页面字段采集</h1>
  </div>
  <p class="hint">识别当前页面的表单与字段结构，用于调试自动填充匹配。</p>

  {#if busy}
    <p class="hint">正在采集…</p>
  {:else if result == null}
    <p class="hint">尚无结果</p>
  {:else if !result.ok}
    <p class="alert">{result.message}</p>
  {:else}
    <div class="summary">
      <strong>{totalFields}</strong> 个字段 ·
      <strong>{totalForms}</strong> 个表单 ·
      <strong>{frames.length}</strong> 个框架 ·
      {elapsedMs.toFixed(0)}ms
    </div>

    {#each frames as frame (frame.frameId)}
      {@const details = frame.details!}
      <section class="frame">
        <h2>
          {frame.frameId === 0 ? "主框架" : `iframe #${frame.frameId}`}
          <span class="hint">{details.fields.length} 字段</span>
        </h2>

        {#if details.fields.length === 0}
          <p class="hint">没有可填充字段</p>
        {:else}
          <ul>
            {#each showAll ? details.fields : details.fields.filter((f) => f.viewable) as field (field.opid)}
              <li>
                <span class="type">{field.type ?? field.tagName}</span>
                <span class="ident" title={identity(field)}>{identity(field)}</span>
                <span class="label" title={bestLabel(field)}>{bestLabel(field) || "—"}</span>
                <span class="flags">
                  {#if !field.viewable}<span class="flag hidden-flag" title="不可见">隐</span>{/if}
                  {#if field.autoCompleteType}<span class="flag" title="autocomplete={field.autoCompleteType}">AC</span>{/if}
                  {#if field.form}<span class="flag" title="属于 {field.form}">F</span>{/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}

    <label class="checkbox">
      <input type="checkbox" bind:checked={showAll} />
      <span>显示不可见字段</span>
    </label>
  {/if}

  <button class="btn btn-secondary" onclick={collect} disabled={busy}>
    {busy ? "采集中…" : "重新采集"}
  </button>
</div>

<style>
  h2 {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    display: flex;
    justify-content: space-between;
  }

  .summary {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-subtle);
    font-size: 12px;
  }

  .frame {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 260px;
    overflow-y: auto;
  }

  li {
    display: grid;
    grid-template-columns: 52px 1fr 1fr auto;
    gap: 5px;
    align-items: baseline;
    font-size: 11px;
  }

  .type {
    color: var(--accent);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ident,
  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .label {
    color: var(--text-muted);
  }

  .flags {
    display: flex;
    gap: 2px;
  }

  .flag {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--bg-subtle);
    color: var(--text-muted);
    font-size: 9px;
  }

  .hidden-flag {
    color: var(--danger);
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
