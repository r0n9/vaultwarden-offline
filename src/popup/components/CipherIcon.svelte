<script lang="ts">
  import { extractHostname } from "@/core/vault/uri-matching";
  import { cipherHue, cipherInitial } from "@/core/vault/vault-search";
  import type { CipherView } from "@/core/vault/models";
  import { storage } from "@/platform/browser-api";

  const { cipher, size = 32 }: { cipher: CipherView; size?: number } = $props();

  const hue = $derived(cipherHue(cipher));

  // 缓存了站点 favicon 就用真实图标，否则回退到首字母色块。
  let favicon = $state<string | undefined>(undefined);

  $effect(() => {
    const firstUri = cipher.login?.uris?.[0]?.uri;
    if (firstUri == null) {
      return;
    }
    const domain = extractHostname(firstUri);
    if (domain == null) {
      return;
    }
    void storage.local
      .get<{ dataUrl?: string }>(`vwo:favicons:${domain}`)
      .then((entry) => {
        favicon = entry?.dataUrl;
      });
  });
</script>

<!--
  有缓存时显示站点真实 favicon（获取方式见 background/favicon.ts）；
  未缓存时回退到本地生成的首字母色块，绝不请求 icons.bitwarden.net。
-->
{#if favicon != null}
  <img
    class="icon favicon"
    style:width="{size}px"
    style:height="{size}px"
    src={favicon}
    alt=""
  />
{:else}
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
{/if}

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

  .favicon {
    object-fit: cover;
    background: var(--bg-subtle);
  }
</style>
