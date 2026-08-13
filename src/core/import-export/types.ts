import type { CipherView, FolderView } from "@/core/vault/models";

/** 从导入文件解析出的保险库内容（已是明文视图）。 */
export interface ParsedVault {
  ciphers: CipherView[];
  folders: FolderView[];
  /** 组织集合被降级成了多少个文件夹。 */
  degradedCollections: number;
}

export const ImportFormat = {
  BitwardenJson: "bitwarden-json",
  BitwardenCsv: "bitwarden-csv",
} as const;

export type ImportFormat = (typeof ImportFormat)[keyof typeof ImportFormat];

/** 先探测再解析：密码保护的文件需要先向用户要口令。 */
export interface ImportProbe {
  format: ImportFormat;
  /** 需要用户提供该文件的解密口令。 */
  requiresPassword: boolean;
  /** 明文文件可直接给出条目数；加密文件解密前未知。 */
  cipherCount?: number;
  folderCount?: number;
}

export const MergeStrategy = {
  /** 跳过与现有条目重复的（按 id，其次按 名称+用户名）。 */
  SkipDuplicates: "skip-duplicates",
  /** 同 id 的条目用导入的覆盖。 */
  Overwrite: "overwrite",
  /** 全部作为新条目加入，重新分配 id。 */
  AppendAll: "append-all",
} as const;

export type MergeStrategy = (typeof MergeStrategy)[keyof typeof MergeStrategy];

export interface MergeResult {
  added: number;
  updated: number;
  skipped: number;
  foldersAdded: number;
}

export const ExportFormat = {
  Json: "json",
  EncryptedJson: "encrypted-json",
  Csv: "csv",
} as const;

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** 文件口令错误，与"文件格式不对"区分开，UI 才能给出正确提示。 */
export class ImportPasswordError extends ImportError {
  constructor() {
    super("文件口令不正确");
    this.name = "ImportPasswordError";
  }
}
