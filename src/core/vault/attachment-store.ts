import { EncString, EncryptionType } from "@/core/crypto";

/**
 * 附件二进制存储（IndexedDB）。
 *
 * 文件本体不随条目进 chrome.storage——大文件进 storage.local 会反复
 * 整库复制拖慢所有读写。IndexedDB 按附件 id 独立存取，
 * 密文为 EncString type 2 的 iv/data/mac 拆分（无 base64 膨胀）。
 */

const DB_NAME = "vwo-attachments";
const STORE_NAME = "files";
const DB_VERSION = 1;

/** IndexedDB 中存储的附件密文（EncString type 2 的三段，原始字节）。 */
export interface StoredAttachment {
  iv: Uint8Array;
  data: Uint8Array;
  mac: Uint8Array;
}

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putAttachment(
  id: string,
  attachment: StoredAttachment,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  void requestToPromise(tx.objectStore(STORE_NAME).put(attachment, id));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAttachment(id: string): Promise<StoredAttachment | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  return await requestToPromise(tx.objectStore(STORE_NAME).get(id) as IDBRequest<StoredAttachment>);
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  void requestToPromise(tx.objectStore(STORE_NAME).delete(id));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 从存储形态还原 EncString。 */
export function storedToEncString(stored: StoredAttachment): EncString {
  return EncString.fromBytes(
    EncryptionType.AesCbc256_HmacSha256_B64,
    stored.iv,
    stored.data,
    stored.mac,
  );
}
