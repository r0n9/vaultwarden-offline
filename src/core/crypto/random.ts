/**
 * 密码学安全随机数。
 *
 * 全项目**只允许**从这里取随机字节。`Math.random()` 不是 CSPRNG，
 * 用它生成 IV 或密钥会直接摧毁整套加密体系。
 */

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error(`随机字节长度必须是正整数，收到 ${length}`);
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** AES-CBC 的初始化向量固定 16 字节。 */
export function randomIv(): Uint8Array {
  return randomBytes(16);
}

/**
 * 无偏均匀随机整数，范围 [0, max)。
 *
 * 用取模会引入偏置（低位数字概率更高），对密码生成器是实打实的强度损失，
 * 因此这里用拒绝采样。
 */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error(`上界必须是正整数，收到 ${max}`);
  }
  if (max === 1) {
    return 0;
  }

  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0] as number;
  } while (value >= limit);

  return value % max;
}
