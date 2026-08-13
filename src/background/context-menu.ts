import type { VaultStorage } from "@/core/state/storage.port";
import { VaultStatus } from "@/core/state/vault-status";
import { decryptCipher } from "@/core/vault/cipher-encryption";
import { cipherMatchesUrl } from "@/core/vault/uri-matching";
import type { CipherView } from "@/core/vault/models";
import { sortCiphers } from "@/core/vault/vault-search";
import { getStatus, readVaultData, requireUserKey } from "@/core/vault/vault.service";
import { api, runtime, t } from "@/platform/browser-api";
import { logger } from "@/platform/logger";

import { fillTab } from "./autofill-fill";

/**
 * 右键菜单。
 *
 * 结构：一个「Vaultwarden Offline」父菜单，下面挂当前站点匹配的登录条目，
 * 点哪个填哪个——不用先打开密码库。锁定态下只留一个「打开密码库」。
 *
 * 菜单内容依赖「当前活动标签页」与「密码库状态」，这两者都可能变，
 * 因此在标签页切换、页面加载完成、密码库状态变化时重建。
 */

const MENU_ROOT_ID = "vwo-root";
const MENU_OPEN_VAULT_ID = "vwo-open-vault";
const MENU_FILL_PREFIX = "vwo-fill:";

/** 右键菜单里最多列出的匹配条目数——再多菜单就长到没法用。 */
const MAX_MENU_ITEMS = 8;

// 注：chrome.contextMenus 的菜单图标仅对顶层菜单生效，且 @types/chrome 未声明
// 该字段。这里不传图标，纯文字菜单在所有浏览器上表现一致。

/** 重建请求串行执行，避免 removeAll/create 并发交叉产生竞态。 */
let refreshChain: Promise<void> = Promise.resolve();

export function refreshContextMenu(storage: VaultStorage): Promise<void> {
  refreshChain = refreshChain.then(() => doRefresh(storage));
  return refreshChain;
}

async function doRefresh(storage: VaultStorage): Promise<void> {
    try {
      const status = await getStatus(storage);

      await api().contextMenus.removeAll();

      const [tab] = await api().tabs.query({ active: true, currentWindow: true });

      if (status !== VaultStatus.Unlocked) {
        await createRootMenu();
        await api().contextMenus.create({
          id: MENU_OPEN_VAULT_ID,
          parentId: MENU_ROOT_ID,
          title: status === VaultStatus.Uninitialized ? "尚未创建密码库，点击打开" : "密码库已锁定，点击解锁",
        });
        return;
      }

      const matches = await findMatchingLoginCiphers(storage, tab?.url);

      await createRootMenu();
      if (matches.length === 0) {
        await api().contextMenus.create({
          id: MENU_OPEN_VAULT_ID,
          parentId: MENU_ROOT_ID,
          title:
            tab?.url != null && /^https?:/i.test(tab.url)
              ? "当前页面没有匹配的登录项，点击打开密码库"
              : "打开密码库",
        });
        return;
      }

      for (const cipher of matches) {
        const title = cipher.name.slice(0, 32);
        const id = cipher.id;
        await api().contextMenus.create({
          id: `${MENU_FILL_PREFIX}${id}`,
          parentId: MENU_ROOT_ID,
          title,
        });
      }

      await api().contextMenus.create({
        id: MENU_OPEN_VAULT_ID,
        parentId: MENU_ROOT_ID,
        title: "打开密码库",
      });
    } catch (e) {
      logger.warn("重建右键菜单失败:", e);
    }
}

async function createRootMenu(): Promise<void> {
  await api().contextMenus.create({
    id: MENU_ROOT_ID,
    title: t("appName"),
    contexts: ["all"],
  });
}

/** 筛选匹配当前站点的登录条目，收藏优先、按名称排序，最多取 8 条。 */
export async function findMatchingLoginCiphers(
  storage: VaultStorage,
  url: string | undefined,
): Promise<CipherView[]> {
  if (url == null || !/^https?:/i.test(url)) {
    return [];
  }

  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);

  const matches: CipherView[] = [];

  for (const encrypted of data.ciphers) {
    if (encrypted.deletedDate != null || encrypted.type !== 1) {
      continue;
    }
    const cipher = await decryptCipher(encrypted, userKey);
    if (cipherMatchesUrl(cipher, url)) {
      matches.push(cipher);
    }
  }

  // 排序复用 vault-search 的 sortCiphers（收藏优先、名称次之）。
  // 两处各自实现同样的排序迟早会漂移——快捷键回退和右键菜单
  // 都靠「列表第一条」取目标条目，排序一旦不一致就会填错。
  return sortCiphers(matches).slice(0, MAX_MENU_ITEMS);
}

export function registerContextMenu(storage: VaultStorage): void {
  api().contextMenus.onClicked.addListener((info, tab) => {
    void (async () => {
      try {
        if (info.menuItemId === MENU_OPEN_VAULT_ID) {
          await api().tabs.create({
            url: runtime.getURL("popup/index.html"),
          });
          return;
        }

        if (
          typeof info.menuItemId === "string" &&
          info.menuItemId.startsWith(MENU_FILL_PREFIX)
        ) {
          const cipherId = info.menuItemId.slice(MENU_FILL_PREFIX.length);

          // 右键点击的标签页可能不是当前活动页，把填充目标指向它。
          const result = tab?.id == null ? undefined : await fillTab(storage, cipherId, tab);

          if (result != null && !result.ok) {
            logger.warn("右键填充失败:", result.message);
          }
        }
      } catch (e) {
        logger.error("处理右键菜单点击失败:", e);
      }
    })();
  });
}

/** 活动标签页变化或页面加载完成后重建菜单。 */
export function registerMenuRefreshTriggers(storage: VaultStorage): void {
  api().tabs.onActivated.addListener(() => refreshContextMenu(storage));
  api().tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
      refreshContextMenu(storage);
    }
  });
}
