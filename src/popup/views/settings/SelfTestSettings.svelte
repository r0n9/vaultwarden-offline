<script lang="ts">
  import CryptoSelfTest from "../../components/CryptoSelfTest.svelte";

  const { onBack }: { onBack: () => void } = $props();
</script>

<button class="back" onclick={onBack}>‹ 返回</button>
<h1>加密自检</h1>
<p class="hint">在浏览器真实的 WebCrypto 上重跑官方测试向量，验证加密原语正确性。</p>
<CryptoSelfTest />

<style>
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
</style>
