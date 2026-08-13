import { argon2id } from "hash-wasm";

import { toUtf8Bytes } from "./encoding";
import { sha256 } from "./primitives";

/**
 * Argon2id 密钥派生。
 *
 * WASM 实现来自 hash-wasm —— 它把 wasm 以 base64 内联在 JS 里，运行期
 * 不发起任何 fetch，符合本项目的零网络约束（纯 JS 实现的 Argon2 在
 * 32MiB 内存参数下慢到无法接受，故必须用 WASM）。
 */

export interface Argon2Params {
  password: string | Uint8Array;
  /** 原始 salt。注意本函数内部会先做 SHA-256，见下方说明。 */
  salt: string | Uint8Array;
  /** 迭代轮数（Argon2 的 t 参数）。 */
  iterations: number;
  /** 内存用量，单位 **MiB**（Bitwarden 的计量单位）。 */
  memoryMiB: number;
  /** 并行度（Argon2 的 p 参数）。 */
  parallelism: number;
  outputByteLength?: number;
}

/**
 * ⚠️ 互通关键：Bitwarden 传给 Argon2 的 salt 是 **SHA-256(原始 salt)**，
 * 而非原始 salt 本身。原因是 Argon2 要求 salt 至少 8 字节，Bitwarden 选择
 * 统一哈希成定长 32 字节。
 *
 * 少做这一步 SHA-256，派生出的密钥会完全不同 —— 表现为"密码正确却解不开
 * 别人的导出文件"。此细节已在当前版本的 Bitwarden 客户端中下沉到 Rust SDK，
 * 无法从 JS 源码直接确认，**待 Phase 3 用真实的 Argon2 密码保护导出文件验证**。
 */
export async function argon2idDerive(params: Argon2Params): Promise<Uint8Array> {
  const {
    password,
    salt,
    iterations,
    memoryMiB,
    parallelism,
    outputByteLength = 32,
  } = params;

  const saltBytes = typeof salt === "string" ? toUtf8Bytes(salt) : salt;
  const hashedSalt = await sha256(saltBytes);

  return await argon2id({
    password,
    salt: hashedSalt,
    iterations,
    // hash-wasm 的 memorySize 单位是 KiB。
    memorySize: memoryMiB * 1024,
    parallelism,
    hashLength: outputByteLength,
    outputType: "binary",
  });
}
