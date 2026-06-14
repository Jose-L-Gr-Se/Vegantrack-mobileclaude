/**
 * Genera los iconos de la app (PNG RGBA) con la identidad de marca:
 * círculo verde bosque + punto crema. Sin dependencias externas — encoder
 * PNG propio con zlib nativo. Ejecutar: node scripts/gen-icons.js
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const FOREST = [47, 93, 65];     // #2f5d41
const FOREST_DEEP = [30, 58, 42]; // #1e3a2a
const CREAM = [243, 239, 227];   // #f3efe3

function makeCanvas(w, h) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

function fillRect(cv, color, a = 255) {
  for (let i = 0; i < cv.w * cv.h; i++) {
    cv.data[i * 4] = color[0];
    cv.data[i * 4 + 1] = color[1];
    cv.data[i * 4 + 2] = color[2];
    cv.data[i * 4 + 3] = a;
  }
}

// Círculo anti-aliased (4x supersampling en el borde) con alpha blending.
function drawCircle(cv, cx, cy, r, color, alpha = 255) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(cv.w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(cv.h - 1, Math.ceil(cy + r + 1));
  const SS = 4;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const d = Math.hypot(px - cx, py - cy);
          if (d <= r) hits++;
        }
      }
      if (hits === 0) continue;
      const cov = (hits / (SS * SS)) * (alpha / 255);
      const i = (y * cv.w + x) * 4;
      const inv = 1 - cov;
      cv.data[i] = color[0] * cov + cv.data[i] * inv;
      cv.data[i + 1] = color[1] * cov + cv.data[i + 1] * inv;
      cv.data[i + 2] = color[2] * cov + cv.data[i + 2] * inv;
      cv.data[i + 3] = Math.max(cv.data[i + 3], Math.round(cov * 255));
    }
  }
}

function encodePNG(cv) {
  const { w, h, data } = cv;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filtro none
    for (let x = 0; x < w * 4; x++) {
      raw[y * (w * 4 + 1) + 1 + x] = data[y * w * 4 + x];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  function chunk(type, payload) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(payload.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, payload]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const OUT = path.join(__dirname, '..', 'assets');

// 1) icon.png — iOS, cuadrado completo verde bosque + punto crema arriba-dcha
(() => {
  const S = 1024;
  const cv = makeCanvas(S, S);
  fillRect(cv, FOREST);
  drawCircle(cv, S * 0.645, S * 0.37, S * 0.135, CREAM);
  fs.writeFileSync(path.join(OUT, 'icon.png'), encodePNG(cv));
})();

// 2) adaptive background — verde bosque sólido
(() => {
  const S = 1024;
  const cv = makeCanvas(S, S);
  fillRect(cv, FOREST);
  fs.writeFileSync(path.join(OUT, 'android-icon-background.png'), encodePNG(cv));
})();

// 3) adaptive foreground — punto crema en zona segura (centro), transparente
(() => {
  const S = 1024;
  const cv = makeCanvas(S, S); // transparente
  drawCircle(cv, S * 0.585, S * 0.415, S * 0.125, CREAM);
  fs.writeFileSync(path.join(OUT, 'android-icon-foreground.png'), encodePNG(cv));
})();

// 4) monochrome — punto blanco
(() => {
  const S = 1024;
  const cv = makeCanvas(S, S);
  drawCircle(cv, S * 0.585, S * 0.415, S * 0.125, [255, 255, 255]);
  fs.writeFileSync(path.join(OUT, 'android-icon-monochrome.png'), encodePNG(cv));
})();

// 5) splash-icon — logo completo (círculo verde + punto) transparente, centrado
(() => {
  const S = 1024;
  const cv = makeCanvas(S, S);
  drawCircle(cv, S / 2, S / 2, S * 0.32, FOREST);
  drawCircle(cv, S * 0.595, S * 0.41, S * 0.082, CREAM);
  fs.writeFileSync(path.join(OUT, 'splash-icon.png'), encodePNG(cv));
})();

// 6) favicon — logo pequeño
(() => {
  const S = 96;
  const cv = makeCanvas(S, S);
  drawCircle(cv, S / 2, S / 2, S * 0.46, FOREST);
  drawCircle(cv, S * 0.62, S * 0.38, S * 0.13, CREAM);
  fs.writeFileSync(path.join(OUT, 'favicon.png'), encodePNG(cv));
})();

console.log('Iconos generados en assets/');
