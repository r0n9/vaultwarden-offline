<script lang="ts">
  import { hostWithPort } from "@/core/vault/uri-matching";
  import type { CipherView } from "@/core/vault/models";
  import { storage } from "@/platform/browser-api";

  import { DEFAULT_CIPHER_ICONS, DEFAULT_ICON_VIEWBOX } from "../lib/default-cipher-icons";

  const { cipher, size = 32 }: { cipher: CipherView; size?: number } = $props();

  // 有缓存 favicon 用真实图标；没有则显示类型默认图标（Bitwarden 同款行为）。
  let favicon = $state<string | undefined>(undefined);

  $effect(() => {
    const firstUri = cipher.login?.uris?.[0]?.uri;
    if (firstUri == null) {
      return;
    }
    const hostKey = hostWithPort(firstUri);
    if (hostKey == null) {
      return;
    }
    void storage.local
      .get<{ dataUrl?: string }>(`vwo:favicons:${hostKey}`)
      .then((entry) => {
        favicon = entry?.dataUrl;
      });
  });
</script>

{#if favicon != null}
  <img
    class="icon favicon"
    style:width="{size}px"
    style:height="{size}px"
    src={favicon}
    alt=""
  />
{:else}
  <!-- 类型默认图标（取自 Bitwarden bwi 图标字体） -->
  <span
    class="icon default"
    style:width="{size}px"
    style:height="{size}px"
    aria-hidden="true"
  >
    {#if DEFAULT_CIPHER_ICONS[cipher.type] != null}
      <svg
        viewBox={DEFAULT_ICON_VIEWBOX}
        style:width="{Math.round(size * 0.55)}px"
        style:height="{Math.round(size * 0.55)}px"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={DEFAULT_CIPHER_ICONS[cipher.type]!.path} />
      </svg>
    {/if}
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

  /* 默认图标：淡灰圆底 + 灰色类型图标（Bitwarden 无 favicon 时的呈现） */
  .default {
    background: var(--bg-subtle);
    color: var(--text-muted);
    border-radius: 50%;
  }
</style>
