import { fromBase64, toBase64 } from "./encoding";
import { EncryptionType, EXPECTED_PART_COUNT, encryptionTypeName } from "./encryption-type";

/**
 * Bitwarden 的密文字符串。
 *
 * 序列化形态：`{类型}.{段1}|{段2}|{段3}`
 *   type 0: `0.{iv}|{data}`
 *   type 2: `2.{iv}|{data}|{mac}`
 * 各段均为 base64。
 *
 * 另有一种无类型前缀的远古形态 `{iv}|{data}`，按 type 0 解析——
 * Vaultwarden 里可能残留极老的数据，为了不丢数据保留兼容。
 */
export class EncString {
  readonly encryptionType: EncryptionType;
  readonly iv: string;
  readonly data: string;
  readonly mac: string | undefined;

  private constructor(
    encryptionType: EncryptionType,
    iv: string,
    data: string,
    mac: string | undefined,
  ) {
    this.encryptionType = encryptionType;
    this.iv = iv;
    this.data = data;
    this.mac = mac;
  }

  get ivBytes(): Uint8Array {
    return fromBase64(this.iv);
  }

  get dataBytes(): Uint8Array {
    return fromBase64(this.data);
  }

  get macBytes(): Uint8Array | undefined {
    return this.mac == null ? undefined : fromBase64(this.mac);
  }

  static fromBytes(
    encryptionType: EncryptionType,
    iv: Uint8Array,
    data: Uint8Array,
    mac?: Uint8Array,
  ): EncString {
    return new EncString(
      encryptionType,
      toBase64(iv),
      toBase64(data),
      mac == null ? undefined : toBase64(mac),
    );
  }

  /** 解析失败抛异常。批量导入等场景请用 {@link tryParse}。 */
  static parse(value: string): EncString {
    const parsed = EncString.tryParse(value);
    if (parsed == null) {
      throw new Error(`不是合法的密文字符串: ${truncate(value)}`);
    }
    return parsed;
  }

  /** 解析失败返回 null。 */
  static tryParse(value: string | null | undefined): EncString | null {
    if (value == null || value === "") {
      return null;
    }

    const { encryptionType, parts } = splitEncryptedString(value);

    if (Number.isNaN(encryptionType) || EXPECTED_PART_COUNT[encryptionType] !== parts.length) {
      return null;
    }

    switch (encryptionType) {
      case EncryptionType.AesCbc256_HmacSha256_B64:
        return new EncString(encryptionType, parts[0] as string, parts[1] as string, parts[2]);
      case EncryptionType.AesCbc256_B64:
        return new EncString(encryptionType, parts[0] as string, parts[1] as string, undefined);
      default:
        // 非对称与 COSE 格式能识别但本项目不处理，交由上层报出可读错误。
        return new EncString(encryptionType as EncryptionType, "", parts[0] as string, parts[1]);
    }
  }

  static isSerialized(value: string | null | undefined): boolean {
    return EncString.tryParse(value) != null;
  }

  toString(): string {
    const parts = this.mac == null ? [this.iv, this.data] : [this.iv, this.data, this.mac];
    return `${this.encryptionType}.${parts.join("|")}`;
  }

  toJSON(): string {
    return this.toString();
  }

  describe(): string {
    return encryptionTypeName(this.encryptionType);
  }
}

function splitEncryptedString(value: string): { encryptionType: number; parts: string[] } {
  const headerPieces = value.split(".");

  if (headerPieces.length === 2) {
    return {
      encryptionType: Number.parseInt(headerPieces[0] as string, 10),
      parts: (headerPieces[1] as string).split("|"),
    };
  }

  // 无类型前缀的远古格式，按 AesCbc256_B64 处理。
  return {
    encryptionType: EncryptionType.AesCbc256_B64,
    parts: value.split("|"),
  };
}

function truncate(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`;
}
