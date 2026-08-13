/**
 * 生成扩展图标 PNG。
 *
 * 不引入任何图形库：直接手写 PNG 编码器（zlib 来自 node 内置），
 * 图形用 4×4 超采样在归一化坐标下绘制，保证各尺寸边缘平滑。
 * 这样图标是构建产物而非二进制资产，改配色只需改常量。
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(import.meta.dirname, "../public/images");

/**
 * 配色。bg 为垂直渐变（上 → 下）。
 *
 * 盾牌 + 钥匙孔：参考 Bitwarden（蓝底白盾）与 1Password（钥匙孔）——
 * 无字母，安全语义直接。盾 = 防护，钥匙孔 = 解锁密码库。
 */
const THEMES = {
  normal: {
    bgTop: [0x2f, 0x6b, 0xf3],
    bgBottom: [0x1e, 0x3a, 0x8a],
    shield: [0xff, 0xff, 0xff],
    keyhole: [0x1d, 0x3a, 0x8a],
  },
  locked: {
    bgTop: [0x64, 0x74, 0x8b],
    bgBottom: [0x47, 0x55, 0x69],
    shield: [0xe2, 0xe8, 0xf0],
    keyhole: [0x3f, 0x4c, 0x5e],
  },
};

const SIZES = [16, 19, 32, 38, 48, 96, 128];
const LOCKED_SIZES = [19, 38];

// --- PNG 编码 --------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型 RGBA
  ihdr[10] = 0; // 压缩方式
  ihdr[11] = 0; // 滤波方式
  ihdr[12] = 0; // 隔行扫描

  // 每条扫描线前置一个滤波类型字节（0 = None）。
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- 图形 ------------------------------------------------------------------

/** 圆角矩形命中测试，坐标归一化到 [0,1]。 */
function insideRoundedRect(x, y, margin, radius) {
  const min = margin;
  const max = 1 - margin;
  if (x < min || x > max || y < min || y > max) {
    return false;
  }
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 盾牌形：上半部圆角矩形，下半部以四分之一椭圆弧收口（底部圆润，非尖点）。 */
function insideShield(x, y) {
  const cx = 0.5;
  const topY = 0.16;
  const bottomY = 0.80;
  const halfW = 0.30;
  const waistY = topY + (bottomY - topY) * 0.55;

  if (y < topY || y > bottomY) {
    return false;
  }

  if (y <= waistY) {
    // 上半部：圆角矩形（圆角较大，观感圆润）
    const minX = cx - halfW;
    const maxX = cx + halfW;
    if (x < minX || x > maxX) {
      return false;
    }
    const radius = 0.10;
    const rx = Math.min(Math.max(x, minX + radius), maxX - radius);
    const ry = Math.min(Math.max(y, topY + radius), waistY - radius);
    return Math.hypot(x - rx, y - ry) <= radius;
  }

  // 下半部：四分之一椭圆弧——宽度按 sqrt(1 - t²) 衰减，
  // 底部形成圆弧而非直线收口的尖点。
  const t = (y - waistY) / (bottomY - waistY);
  const width = halfW * Math.sqrt(1 - t * t);
  return Math.abs(x - cx) <= width;
}

/** 钥匙孔：圆孔 + 向下渐宽的槽。 */
function insideKeyhole(x, y) {
  const cx = 0.5;
  const cy = 0.40;
  const radius = 0.085;

  if (Math.hypot(x - cx, y - cy) <= radius) {
    return true;
  }

  const slotHalfW = 0.042;
  const slotTop = cy + radius * 0.55;
  const slotBottom = 0.60;
  if (y >= slotTop && y <= slotBottom) {
    const t = (y - slotTop) / (slotBottom - slotTop);
    const width = slotHalfW * (1 + t * 0.8);
    return Math.abs(x - cx) <= width;
  }

  return false;
}

function renderIcon(size, theme) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 4;
  const total = samples * samples;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;

          if (!insideRoundedRect(x, y, 0.03, 0.22)) {
            continue;
          }
          covered++;

          let color;
          if (insideShield(x, y)) {
            color = insideKeyhole(x, y) ? theme.keyhole : theme.shield;
          } else {
            // 底色做垂直渐变。
            const t = Math.min(Math.max((y - 0.03) / 0.94, 0), 1);
            color = [
              Math.round(theme.bgTop[0] + (theme.bgBottom[0] - theme.bgTop[0]) * t),
              Math.round(theme.bgTop[1] + (theme.bgBottom[1] - theme.bgTop[1]) * t),
              Math.round(theme.bgTop[2] + (theme.bgBottom[2] - theme.bgTop[2]) * t),
            ];
          }

          r += color[0];
          g += color[1];
          b += color[2];
        }
      }

      const offset = (py * size + px) * 4;
      if (covered === 0) {
        continue; // 全透明
      }
      rgba[offset] = Math.round(r / covered);
      rgba[offset + 1] = Math.round(g / covered);
      rgba[offset + 2] = Math.round(b / covered);
      rgba[offset + 3] = Math.round((covered / total) * 255);
    }
  }

  return encodePng(size, size, rgba);
}

// --- 主流程 ----------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const written = [];

for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, renderIcon(size, THEMES.normal));
  written.push(`icon${size}.png`);
}

for (const size of LOCKED_SIZES) {
  const file = resolve(OUT_DIR, `icon${size}_locked.png`);
  writeFileSync(file, renderIcon(size, THEMES.locked));
  written.push(`icon${size}_locked.png`);
}

console.log(`✓ 已生成 ${written.length} 个图标 → public/images/`);
