<script lang="ts">
  import { validatePin } from "@/core/vault/vault.service";
  import { sendMessage } from "@/platform/messaging";

  const { onBack }: { onBack: () => void } = $props();

  let pinEnabled = $state(false);
  let pinMode = $state<"idle" | "edit" | "remove">("idle");
  let pinValue = $state("");
  let pinConfirm = $state("");
  let pinError = $state("");
  let pinBusy = $state(false);

  const pinInvalid = $derived(validatePin(pinValue));
  const pinMismatch = $derived(pinConfirm.length > 0 && pinValue !== pinConfirm);

  $effect(() => {
    void (async () => {
      const pinResult = await sendMessage("vault:hasPin");
      pinEnabled = pinResult?.hasPin === true;
    })();
  });

  async function savePin() {
    if (pinBusy || pinInvalid != null || pinMismatch) {
      return;
    }
    pinBusy = true;
    pinError = "";
    try {
      const result = await sendMessage("vault:setPin", { pin: pinValue });
      if (result?.ok === true) {
        pinEnabled = true;
        pinMode = "idle";
        pinValue = "";
        pinConfirm = "";
      } else {
        pinError = result?.message ?? "设置失败";
      }
    } finally {
      pinBusy = false;
    }
  }

  async function removePin() {
    pinBusy = true;
    pinError = "";
    try {
      const result = await sendMessage("vault:clearPin");
      if (result?.ok === true) {
        pinEnabled = false;
        pinMode = "idle";
      } else {
        pinError = result?.message ?? "移除失败";
      }
    } finally {
      pinBusy = false;
    }
  }
</script>

<div class="subpage">
  <div class="subpage-head">
    <button class="back" onclick={onBack} aria-label="返回">‹</button>
    <h1>解锁方式</h1>
  </div>

  {#if pinMode === "idle"}
    <section class="panel">
      <p class="pin-status">PIN 解锁：{pinEnabled ? "已启用" : "未设置"}</p>
      <p class="hint">
        PIN 是主密码的快捷解锁方式（4-12 位数字或字母）。数据加密强度不变，
        但浏览器端无系统设备锁保护，PIN 熵低属于便利换风险，请自行权衡。
      </p>
      <div class="row">
        <button class="btn btn-secondary" onclick={() => (pinMode = "edit")}>
          {pinEnabled ? "修改 PIN" : "设置 PIN"}
        </button>
        {#if pinEnabled}
          <button class="btn btn-secondary" onclick={() => (pinMode = "remove")}>移除 PIN</button>
        {/if}
      </div>
    </section>
  {:else if pinMode === "edit"}
    <section class="panel">
      <div class="field">
        <label for="pin-new">PIN</label>
        <input id="pin-new" type="password" bind:value={pinValue} autocomplete="new-password" />
        {#if pinValue.length > 0 && pinInvalid != null}
          <p class="hint invalid">{pinInvalid}</p>
        {/if}
      </div>
      <div class="field">
        <label for="pin-confirm">确认 PIN</label>
        <input id="pin-confirm" type="password" bind:value={pinConfirm} autocomplete="new-password" />
        {#if pinMismatch}
          <p class="hint invalid">两次输入不一致</p>
        {/if}
      </div>
      {#if pinError !== ""}
        <p class="alert">{pinError}</p>
      {/if}
      <div class="row">
        <button
          class="btn btn-secondary"
          onclick={() => {
            pinMode = "idle";
            pinValue = "";
            pinConfirm = "";
            pinError = "";
          }}
        >
          取消
        </button>
        <button
          class="btn"
          onclick={() => void savePin()}
          disabled={pinBusy || pinInvalid != null || pinMismatch || pinValue === ""}
        >
          {pinBusy ? "保存中…" : "保存"}
        </button>
      </div>
    </section>
  {:else}
    <section class="panel danger">
      <p class="alert">移除 PIN 后将只能使用主密码解锁。确定移除？</p>
      <div class="row">
        <button class="btn btn-secondary" onclick={() => (pinMode = "idle")}>取消</button>
        <button class="btn btn-danger" onclick={() => void removePin()} disabled={pinBusy}>
          {pinBusy ? "移除中…" : "确认移除"}
        </button>
      </div>
    </section>
  {/if}
</div>

<style>
  .pin-status {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
</style>
