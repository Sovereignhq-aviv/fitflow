// Draws the launcher icons from scratch — no image tooling, no committed binaries.
// Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------------------------------------- png out */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = buf => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;                       // 8-bit, RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;                  // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- the mark */
// A barbell, drawn in a 0..1 square: the bar, two inner plates, two outer ones.
// Everything is sampled 3x3 per pixel so the edges come out smooth.
const INK = [0xed, 0xef, 0xf2];
const GROUND = [0x13, 0x15, 0x19];

const rect = (x, y, w, h, r) => (px, py) => {
  const dx = Math.abs(px - x) - (w / 2 - r);
  const dy = Math.abs(py - y) - (h / 2 - r);
  if (dx <= 0 && dy <= 0) return true;
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return ox * ox + oy * oy <= r * r;
};
const BARBELL = [
  rect(0.5, 0.5, 0.46, 0.055, 0.027),   // bar
  rect(0.235, 0.5, 0.075, 0.30, 0.030), // inner plate, left
  rect(0.765, 0.5, 0.075, 0.30, 0.030), // inner plate, right
  rect(0.135, 0.5, 0.065, 0.19, 0.026), // outer plate, left
  rect(0.865, 0.5, 0.065, 0.19, 0.026), // outer plate, right
];
const inMark = (px, py) => BARBELL.some(f => f(px, py));

// `inset` shrinks the glyph so an adaptive icon's mask cannot crop it.
function draw(size, { background, inset = 1 }) {
  const buf = Buffer.alloc(size * size * 4);
  const S = 3, step = 1 / (size * S);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = (x + (sx + 0.5) / S) / size;
          const py = (y + (sy + 0.5) / S) / size;
          // map the glyph into the safe area
          const gx = (px - 0.5) / inset + 0.5;
          const gy = (py - 0.5) / inset + 0.5;
          if (inMark(gx, gy)) hits++;
        }
      }
      const a = hits / (S * S);
      const o = (y * size + x) * 4;
      if (background) {
        buf[o] = Math.round(GROUND[0] + (INK[0] - GROUND[0]) * a);
        buf[o + 1] = Math.round(GROUND[1] + (INK[1] - GROUND[1]) * a);
        buf[o + 2] = Math.round(GROUND[2] + (INK[2] - GROUND[2]) * a);
        buf[o + 3] = 255;
      } else {
        buf[o] = INK[0]; buf[o + 1] = INK[1]; buf[o + 2] = INK[2];
        buf[o + 3] = Math.round(a * 255);
      }
      void step;
    }
  }
  return png(size, buf);
}

/* ------------------------------------------------------------------ write */
const RES = resolve(ROOT, 'android/app/src/main/res');
// Legacy square icon, one per density.
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, px] of Object.entries(DENSITIES)) {
  const dir = resolve(RES, `mipmap-${d}`);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'ic_launcher.png'), draw(px, { background: true, inset: 0.74 }));
  // Adaptive foreground: 108dp canvas where only the middle 72dp is guaranteed
  // visible, so the glyph is drawn at two thirds and the rest left transparent.
  await writeFile(
    resolve(dir, 'ic_launcher_foreground.png'),
    draw(Math.round(px * 108 / 48), { background: false, inset: 0.50 }),
  );
}
// Play-store style preview, handy for the README.
await mkdir(resolve(ROOT, 'docs'), { recursive: true });
await writeFile(resolve(ROOT, 'docs/icon.png'), draw(512, { background: true, inset: 0.74 }));
console.log('icons written to android/app/src/main/res and docs/icon.png');
