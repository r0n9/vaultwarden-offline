import { decryptToBytes, encryptBytes } from "@/core/crypto";
import type { VaultStorage } from "@/core/state/storage.port";
import {
  deleteAttachment as deleteStoredAttachment,
  getAttachment as getStoredAttachment,
  putAttachment,
  storedToEncString,
} from "@/core/vault/attachment-store";
import { getCipher, saveCipher } from "@/core/vault/vault-repository";
import { requireUserKey } from "@/core/vault/vault.service";
import type { AttachmentViewResult } from "@/platform/messaging/types";

/**
 * 附件处理。
 *
 * 文件加密/解密在背景页完成（UserKey 只在背景页 session 中），
 * 密文存 IndexedDB，元数据随条目加密存储。
 */

/** 单附件大小上限（20 MB）——消息通道与内存的双重护栏。 */
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

export async function addAttachment(
  storage: VaultStorage,
  cipherId: string,
  fileName: string,
  data: ArrayBuffer,
): Promise<{ id: string } | { error: string }> {
  if (data.byteLength > MAX_ATTACHMENT_SIZE) {
    return { error: `附件不能超过 ${MAX_ATTACHMENT_SIZE / 1024 / 1024} MB` };
  }

  try {
    const userKey = await requireUserKey(storage);
    const cipher = await getCipher(storage, cipherId);
    if (cipher == null) {
      return { error: "条目不存在" };
    }

    const encrypted = await encryptBytes(new Uint8Array(data), userKey);
    const id = crypto.randomUUID();

    await putAttachment(id, {
      iv: encrypted.ivBytes,
      data: encrypted.dataBytes,
      mac: encrypted.macBytes as Uint8Array,
    });

    const attachment = {
      id,
      fileName,
      size: data.byteLength,
      containerName: "files",
      creationDate: new Date().toISOString(),
    };

    cipher.attachments = [...(cipher.attachments ?? []), attachment];
    await saveCipher(storage, cipher);

    return { id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getAttachmentBytes(
  storage: VaultStorage,
  attachmentId: string,
): Promise<AttachmentViewResult> {
  try {
    const userKey = await requireUserKey(storage);
    const stored = await getStoredAttachment(attachmentId);
    if (stored == null) {
      return { ok: false, message: "附件不存在" };
    }

    const decrypted = await decryptToBytes(storedToEncString(stored), userKey);
    return { ok: true, data: decrypted.buffer as ArrayBuffer };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function removeAttachment(
  storage: VaultStorage,
  cipherId: string,
  attachmentId: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    await requireUserKey(storage);
    const cipher = await getCipher(storage, cipherId);
    if (cipher == null) {
      return { ok: false, message: "条目不存在" };
    }

    await deleteStoredAttachment(attachmentId);

    cipher.attachments = (cipher.attachments ?? []).filter((a) => a.id !== attachmentId);
    await saveCipher(storage, cipher);

    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
