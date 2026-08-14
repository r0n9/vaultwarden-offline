<script lang="ts">
  import { APPEARANCE_OPTIONS, type AppearanceTheme, type Settings } from "@/core/state/settings";
  import { sendMessage } from "@/platform/messaging";

  const {
    settings,
    onSaved,
    onBack,
  }: { settings: Settings; onSaved: (s: Settings) => void; onBack: () => void } = $props();

  async function updateTheme(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as AppearanceTheme;
    const saved = (await sendMessage("settings:save", { theme: value })) ?? settings;
    onSaved(saved);
    // 立即应用新主题（无需刷新）。
    const root = document.documentElement;
    if (value === "light" || value === "dark") {
      root.dataset.theme = value;
    } else {
      delete root.dataset.theme;
    }
  }
</script>

<button class="back" onclick={onBack}>‹ 返回</button>
<h1>外观</h1>
<div class="field">
  <label for="theme">主题</label>
  <select id="theme" value={settings.theme} onchange={updateTheme}>
    {#each APPEARANCE_OPTIONS as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <p class="hint">深色与浅色均与 Bitwarden popup 配色一致。</p>
</div>

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
