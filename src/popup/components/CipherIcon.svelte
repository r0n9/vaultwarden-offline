<script lang="ts">
  import { cipherHue, cipherInitial } from "@/core/vault/vault-search";
  import type { CipherView } from "@/core/vault/models";

  const { cipher, size = 32 }: { cipher: CipherView; size?: number } = $props();

  const hue = $derived(cipherHue(cipher));
</script>

<!--
  站点图标完全本地生成。绝不请求 icons.bitwarden.net 之类的远程服务——
  那等于把「用户在哪些站点有账号」这份极敏感的清单交给第三方。
-->
<span
  class="icon"
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.42)}px"
  style:background="hsl({hue} 62% 46%)"
  aria-hidden="true"
>
  {cipherInitial(cipher)}
</span>

<style>
  .icon {
    display: grid;
    place-items: center;
    flex: none;
    border-radius: 7px;
    color: #ffffff;
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }
</style>
