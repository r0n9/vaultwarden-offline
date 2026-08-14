<script lang="ts">
  import CryptoSelfTest from "../../components/CryptoSelfTest.svelte";

  const { onBack }: { onBack: () => void } = $props();
</script>

<div class="subpage">
  <div class="subpage-head">
    <button class="back" onclick={onBack} aria-label="返回">‹</button>
    <h1>加密自检</h1>
  </div>
  <p class="hint">在浏览器真实的 WebCrypto 上重跑官方测试向量，验证加密原语正确性。</p>
  <CryptoSelfTest />
</div>
