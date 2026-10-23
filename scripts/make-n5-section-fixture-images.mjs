/**
 * N5 실제 계약(v3.4.2, GET /jobs/:jobId/preview) mock용 섹션별 test fixture 이미지 생성기.
 *
 * 왜 필요한가:
 *   v3.4.2 계약은 sourceImage 하나를 통째로 내려주고 FE가 backgroundPosition으로
 *   섹션을 잘라 쓰던 이전 계약과 다르다 — 섹션마다 이미 own originalUrl/renderedUrl이
 *   개별 발급된다(CLAUDE.md: "프리뷰는 섹션별 이미지로 구성한다. 전체 높이를 가진
 *   단일 이미지 요소로 합성하지 않는다"). scripts/make-n5-fixture-images.mjs(sourceImage
 *   단위, 구 계약 mock)는 건드리지 않고, 이 스크립트가 섹션 단위 이미지를 따로 만든다.
 *
 * scripts/make-n5-fixture-images.mjs와 같은 방식(외부 이미지 라이브러리 없이 PNG를
 * 직접 인코딩)을 쓴다 — 인코더를 그대로 복제해 독립적으로 동작한다.
 *
 * lib/mock-api/n5-fixtures.ts의 섹션 목록과 반드시 맞춰야 한다 (id/width/height/scale).
 *
 * 실행:  node scripts/make-n5-section-fixture-images.mjs (npm run make:n5-section-fixtures)
 * 출력:  public/mock/n5/sections/{id}-{original,translated}.png
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'mock', 'n5', 'sections');

/* ---------- 5x7 비트맵 폰트 (make-n5-fixture-images.mjs와 동일, 독립 복제) ---------- */
const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  x: ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};

function createCanvas(width, height, background) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 3] = background[0];
    data[i * 3 + 1] = background[1];
    data[i * 3 + 2] = background[2];
  }
  return { width, height, data };
}

function setPixel(c, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const i = (y * c.width + x) * 3;
  c.data[i] = r;
  c.data[i + 1] = g;
  c.data[i + 2] = b;
}

function fillRect(c, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) setPixel(c, x + dx, y + dy, color);
  }
}

function drawText(c, text, x, y, color, scale = 1) {
  let cursor = x;
  for (const ch of String(text).toUpperCase()) {
    const glyph = GLYPHS[ch];
    if (!glyph) {
      cursor += 6 * scale;
      continue;
    }
    glyph.forEach((row, ry) => {
      [...row].forEach((bit, rx) => {
        if (bit === '1') fillRect(c, cursor + rx * scale, y + ry * scale, scale, scale, color);
      });
    });
    cursor += 6 * scale;
  }
}

/* ---------- PNG 인코딩 (make-n5-fixture-images.mjs와 동일, 독립 복제) ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function encodePng(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.width, 0);
  ihdr.writeUInt32BE(c.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = c.width * 3;
  const raw = Buffer.alloc((stride + 1) * c.height);
  for (let y = 0; y < c.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    c.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- N5 section fixture 렌더링 ---------- */

const ORIGINAL_BG = [0xdc, 0xe6, 0xf5]; // 옅은 블루그레이
const TRANSLATED_BG = [0xe0, 0xf5, 0xe4]; // 옅은 그린
const BORDER = [0xea, 0xea, 0xea];
const LABEL_COLOR = [0x17, 0x17, 0x17];
const WATERMARK_COLOR = [0x88, 0x88, 0x88];

function makeSectionImage(width, height, idLabel, layerLabel, background) {
  const c = createCanvas(width, height, background);
  fillRect(c, 0, 0, width, 1, BORDER);
  fillRect(c, 0, height - 1, width, 1, BORDER);
  fillRect(c, 0, 0, 1, height, BORDER);
  fillRect(c, width - 1, 0, 1, height, BORDER);
  drawText(c, `SEC ${idLabel}`, 10, 10, LABEL_COLOR, 2);
  drawText(c, layerLabel, 10, 30, WATERMARK_COLOR, 2);
  drawText(c, `${width}x${height}`, 10, height - 20, WATERMARK_COLOR, 1);
  return c;
}

// scale=0.4 — lib/mock-api/n5-fixtures.ts와 반드시 일치.
const targets = [
  { id: 501, width: 400, height: 360, layers: ['original', 'translated'] },
  { id: 502, width: 400, height: 280, layers: ['original', 'translated'] },
  { id: 503, width: 400, height: 200, layers: ['original', 'translated'] }, // N5 제외 섹션 — 오버레이로 가려짐
  { id: 504, width: 400, height: 240, layers: ['original'] }, // renderedUrl null(렌더 전) 시나리오 — translated 파일 없음
  { id: 505, width: 360, height: 320, layers: ['original', 'translated'] }, // 다른 원본 폭 — align=left 검증
];

mkdirSync(OUT_DIR, { recursive: true });

for (const t of targets) {
  for (const layer of t.layers) {
    const bg = layer === 'original' ? ORIGINAL_BG : TRANSLATED_BG;
    const canvas = makeSectionImage(t.width, t.height, t.id, layer.toUpperCase(), bg);
    const png = encodePng(canvas);
    const file = `${t.id}-${layer}.png`;
    writeFileSync(join(OUT_DIR, file), png);
    console.log(`${file}  ${t.width}x${t.height}  ${(png.length / 1024).toFixed(1)}KB`);
  }
}
