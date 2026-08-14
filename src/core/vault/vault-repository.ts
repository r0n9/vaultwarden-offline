import { decryptCipher, decryptFolder, encryptCipher, encryptFolder } from "./cipher-encryption";
import { CipherRepromptType, type CipherType } from "./enums";
import type { CipherView, FolderView } from "./models";
import { readVaultData, requireUserKey, writeVaultData } from "./vault.service";

import type { VaultStorage } from "../state/storage.port";

/**
 * 条目仓储。
 *
 * 单条写入只解密**被改动的那一条**：其余条目原样保留密文搬运即可。
 * 一个 600 条的库若每次保存都全库解密再加密，既慢又平白扩大明文在内存中的暴露面。
 */

export interface VaultSnapshot {
  ciphers: CipherView[];
  folders: FolderView[];
}

/** 全量解密。列表界面需要它，因此每次打开弹窗会走一遍。 */
export async function loadVault(storage: VaultStorage): Promise<VaultSnapshot> {
  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);

  const [ciphers, folders] = await Promise.all([
    Promise.all(data.ciphers.map((cipher) => decryptCipher(cipher, userKey))),
    Promise.all(data.folders.map((folder) => decryptFolder(folder, userKey))),
  ]);

  return { ciphers, folders };
}

/**
 * 只读文件夹列表（不解密条目）。
 *
 * 设置页只需要文件夹，全量解密几百条条目纯属浪费——读取的仍是同一个
 * VaultData blob，但解密只落在 folders 上。
 */
export async function loadFolders(storage: VaultStorage): Promise<FolderView[]> {
  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);
  return Promise.all(data.folders.map((folder) => decryptFolder(folder, userKey)));
}

export async function getCipher(
  storage: VaultStorage,
  id: string,
): Promise<CipherView | undefined> {
  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);
  const found = data.ciphers.find((cipher) => cipher.id === id);

  return found == null ? undefined : await decryptCipher(found, userKey);
}

/** 新建条目的空白模板。 */
export function newCipherDraft(type: CipherType, folderId?: string): CipherView {
  const now = new Date().toISOString();
  const draft: CipherView = {
    id: crypto.randomUUID(),
    type,
    name: "",
    favorite: false,
    reprompt: CipherRepromptType.None,
    creationDate: now,
    revisionDate: now,
  };

  if (folderId != null) {
    draft.folderId = folderId;
  }

  return draft;
}

/**
 * 新增或更新条目。
 *
 * 改动密码时自动把旧密码压入密码历史——这是密码管理器的基本期待：
 * 改错了要能找回上一个值。
 */
export async function saveCipher(storage: VaultStorage, view: CipherView): Promise<CipherView> {
  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);

  const index = data.ciphers.findIndex((cipher) => cipher.id === view.id);
  const now = new Date().toISOString();

  const next: CipherView = { ...view, revisionDate: now };

  if (index >= 0) {
    const previous = await decryptCipher(data.ciphers[index]!, userKey);
    const oldPassword = previous.login?.password;
    const newPassword = next.login?.password;

    if (oldPassword != null && oldPassword !== "" && oldPassword !== newPassword) {
      next.passwordHistory = [
        { password: oldPassword, lastUsedDate: now },
        ...(previous.passwordHistory ?? []),
      ].slice(0, 5);

      if (next.login != null) {
        next.login.passwordRevisionDate = now;
      }
    }

    data.ciphers[index] = await encryptCipher(next, userKey);
  } else {
    data.ciphers.push(await encryptCipher(next, userKey));
  }

  await writeVaultData(storage, data);
  return next;
}

/** 软删除：进回收站，可恢复。 */
export async function softDeleteCipher(storage: VaultStorage, id: string): Promise<void> {
  await mutateCipher(storage, id, (cipher) => ({
    ...cipher,
    deletedDate: new Date().toISOString(),
  }));
}

export async function restoreCipher(storage: VaultStorage, id: string): Promise<void> {
  await mutateCipher(storage, id, (cipher) => {
    const { deletedDate: _deleted, ...rest } = cipher;
    return { ...rest, revisionDate: new Date().toISOString() };
  });
}

export async function toggleFavorite(storage: VaultStorage, id: string): Promise<void> {
  await mutateCipher(storage, id, (cipher) => ({ ...cipher, favorite: !cipher.favorite }));
}

/** 永久删除，不可恢复。 */
export async function purgeCipher(storage: VaultStorage, id: string): Promise<void> {
  const data = await readVaultData(storage);
  data.ciphers = data.ciphers.filter((cipher) => cipher.id !== id);
  await writeVaultData(storage, data);
}

export async function emptyTrash(storage: VaultStorage): Promise<number> {
  // 仅作解锁态的守卫；清空回收站本身不需要密钥——deletedDate 是明文元数据，
  // 无需为了筛选而全库解密。
  await requireUserKey(storage);

  const data = await readVaultData(storage);
  const before = data.ciphers.length;

  data.ciphers = data.ciphers.filter((cipher) => cipher.deletedDate == null);

  await writeVaultData(storage, data);
  return before - data.ciphers.length;
}

async function mutateCipher(
  storage: VaultStorage,
  id: string,
  mutate: (cipher: CipherView) => CipherView,
): Promise<void> {
  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);

  const index = data.ciphers.findIndex((cipher) => cipher.id === id);
  if (index < 0) {
    throw new Error(`条目不存在: ${id}`);
  }

  const current = await decryptCipher(data.ciphers[index]!, userKey);
  data.ciphers[index] = await encryptCipher(mutate(current), userKey);

  await writeVaultData(storage, data);
}

// --- 文件夹 ---------------------------------------------------------------

export async function saveFolder(storage: VaultStorage, view: FolderView): Promise<FolderView> {
  const userKey = await requireUserKey(storage);
  const data = await readVaultData(storage);

  const next: FolderView = { ...view, revisionDate: new Date().toISOString() };
  const index = data.folders.findIndex((folder) => folder.id === view.id);

  if (index >= 0) {
    data.folders[index] = await encryptFolder(next, userKey);
  } else {
    data.folders.push(await encryptFolder(next, userKey));
  }

  await writeVaultData(storage, data);
  return next;
}

export function newFolderDraft(name: string): FolderView {
  return { id: crypto.randomUUID(), name, revisionDate: new Date().toISOString() };
}

/**
 * 删除文件夹。
 *
 * 里面的条目**不删**，只是解除归属回到「无文件夹」——删掉一个分类不该连带
 * 销毁其中的密码。
 */
export async function deleteFolder(storage: VaultStorage, id: string): Promise<number> {
  const data = await readVaultData(storage);

  data.folders = data.folders.filter((folder) => folder.id !== id);

  let orphaned = 0;
  for (const cipher of data.ciphers) {
    if (cipher.folderId === id) {
      delete cipher.folderId;
      orphaned += 1;
    }
  }

  await writeVaultData(storage, data);
  return orphaned;
}
