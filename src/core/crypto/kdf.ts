import { argon2idDerive } from "./argon2";
import { pbkdf2 } from "./primitives";

/**
 * KDF 类型，数值与 Bitwarden 一致（导出文件的 `kdfType` 字段直接取这些值）。
 */
export const KdfType = {
  PBKDF2_SHA256: 0,
  Argon2id: 1,
} as const;

export type KdfType = (typeof KdfType)[keyof typeof KdfType];

export interface Pbkdf2Config {
  type: typeof KdfType.PBKDF2_SHA256;
  iterations: number;
}

export interface Argon2Config {
  type: typeof KdfType.Argon2id;
  iterations: number;
  /** 单位 MiB。 */
  memory: number;
  parallelism: number;
}

export type KdfConfig = Pbkdf2Config | Argon2Config;

/** 取值范围与默认值，与 Bitwarden 客户端保持一致。 */
export const KdfLimits = {
  pbkdf2: { min: 5_000, max: 2_000_000, default: 600_000 },
  argon2: {
    iterations: { min: 2, max: 10, default: 6 },
    memory: { min: 16, max: 1024, default: 32 },
    parallelism: { min: 1, max: 16, default: 4 },
  },
} as const;

/**
 * 本地新建密码库的默认 KDF。
 *
 * 选 PBKDF2 而非 Argon2id：前者由 WebCrypto 原生实现，解锁无需加载 WASM，
 * 在 MV3 那种随时被回收的 service worker 里更稳。用户可在设置中改用 Argon2id。
 */
export function defaultKdfConfig(): KdfConfig {
  return { type: KdfType.PBKDF2_SHA256, iterations: KdfLimits.pbkdf2.default };
}

export function defaultArgon2Config(): Argon2Config {
  return {
    type: KdfType.Argon2id,
    iterations: KdfLimits.argon2.iterations.default,
    memory: KdfLimits.argon2.memory.default,
    parallelism: KdfLimits.argon2.parallelism.default,
  };
}

/**
 * 校验从外部文件读来的 KDF 参数。
 *
 * 导入他人的导出文件时，参数是不可信输入：迭代次数被恶意调成 1 会让派生密钥
 * 形同虚设；内存参数调到 4GiB 则直接把浏览器标签页打崩。因此上下界都要卡。
 */
export function validateKdfConfig(config: KdfConfig): void {
  if (config.type === KdfType.PBKDF2_SHA256) {
    const { min, max } = KdfLimits.pbkdf2;
    if (!Number.isInteger(config.iterations) || config.iterations < min || config.iterations > max) {
      throw new Error(`PBKDF2 迭代次数必须在 ${min} 与 ${max} 之间，收到 ${config.iterations}`);
    }
    return;
  }

  const { iterations, memory, parallelism } = KdfLimits.argon2;
  if (
    !Number.isInteger(config.iterations) ||
    config.iterations < iterations.min ||
    config.iterations > iterations.max
  ) {
    throw new Error(
      `Argon2 迭代次数必须在 ${iterations.min} 与 ${iterations.max} 之间，收到 ${config.iterations}`,
    );
  }
  if (!Number.isInteger(config.memory) || config.memory < memory.min || config.memory > memory.max) {
    throw new Error(
      `Argon2 内存必须在 ${memory.min}MiB 与 ${memory.max}MiB 之间，收到 ${config.memory}`,
    );
  }
  if (
    !Number.isInteger(config.parallelism) ||
    config.parallelism < parallelism.min ||
    config.parallelism > parallelism.max
  ) {
    throw new Error(
      `Argon2 并行度必须在 ${parallelism.min} 与 ${parallelism.max} 之间，收到 ${config.parallelism}`,
    );
  }
}

/**
 * 由口令与 salt 派生 32 字节密钥材料。
 *
 * 这是主密钥（MasterKey）的来源，也是导出文件密钥的第一步。
 */
export async function deriveKdfMaterial(
  password: string | Uint8Array,
  salt: string | Uint8Array,
  config: KdfConfig,
): Promise<Uint8Array> {
  validateKdfConfig(config);

  if (config.type === KdfType.PBKDF2_SHA256) {
    return await pbkdf2(password, salt, config.iterations, 32, "SHA-256");
  }

  return await argon2idDerive({
    password,
    salt,
    iterations: config.iterations,
    memoryMiB: config.memory,
    parallelism: config.parallelism,
    outputByteLength: 32,
  });
}
