/**
 * N5 Before/After 비교 viewer 검증용 test fixture 이미지 생성기.
 *
 * 왜 필요한가:
 *   lib/mock-api/fixtures.ts의 ReviewSourceImage가 가리키던 /mock/*.jpg는
 *   실제 파일이 없어 항상 404였다. 그래서 이미지 두 레이어를 실제로 겹쳐
 *   그리고 clip-path로 자르는 동작, section.topOffset 기준 crop 위치가
 *   정확한지를 눈으로 검증할 방법이 없었다. 이 스크립트는 그 문제를 풀기
 *   위한 test/mock fixture만 만든다 — 실서비스 asset이 아니다.
 *
 * scripts/make-ruler.mjs와 같은 방식(외부 이미지 라이브러리 없이 PNG를 직접
 * 인코딩)을 쓴다. 그 파일과 완전히 독립적으로 동작하도록 인코더를 그대로
 * 복제해 둔다 — Day8 범위가 아닌 기존 스크립트는 건드리지 않는다.
 *
 * 만드는 것 (총 4장, lib/mock-api/fixtures.ts의 preview 값과 반드시 맞춰야 한다):
 *   SRC_A: 400 x 3400 (원본 1000 x 8500, scale 0.4) — original / translated
 *   SRC_B: 400 x 2800 (원본 1000 x 7000, scale 0.4) — original / translated
 *
 * 눈금은 "원본 이미지 좌표"를 라벨로 적는다 — section.topOffset이 가리키는
 * 지점이 실제로 그 위치를 crop해서 보여주는지 확인하기 위함이다.
 * original/translated는 배경색 + 문구로 한눈에 구분된다.
 *
 * 실행:  node scripts/make-n5-fixture-images.mjs (npm run make:n5-fixtures)
 * 출력:  public/mock/n5/detail-{a,b}-{original,translated}.png
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'mock', 'n5');

/* ---------- 5x7 비트맵 폰트 (숫자 + 라벨에 필요한 대문자만) ---------- */
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
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
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

/* ---------- PNG 인코딩 (scripts/make-ruler.mjs와 동일한 방식, 독립 복제) ---------- */
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

/* ---------- N5 fixture 렌더링 ---------- */

const ORIGINAL_BG = [0xdc, 0xe6, 0xf5]; // 옅은 블루그레이
const TRANSLATED_BG = [0xe0, 0xf5, 0xe4]; // 옅은 그린 — 원본과 확실히 구분되는 톤
const TICK_MINOR = [0xaa, 0xaa, 0xaa];
const TICK_MAJOR = [0x22, 0x22, 0x22];
const LABEL_COLOR = [0x1d, 0x4e, 0xd8];
const WATERMARK_COLOR = [0x88, 0x88, 0x88];

/**
 * @param width         preview 폭 (px) — lib/mock-api/fixtures.ts의 previewWidth와 일치해야 함
 * @param height        preview 높이 (px) — previewHeight와 일치해야 함
 * @param originalScale 눈금 라벨을 "원본 이미지 좌표"로 적기 위한 배율 (1/scaleY)
 * @param sourceLabel   예: "SRC A"
 * @param layerLabel    "ORIGINAL" | "TRANSLATED"
 * @param background    레이어 구분용 배경색
 */
function makeFixtureImage(width, height, originalScale, sourceLabel, layerLabel, background) {
  const c = createCanvas(width, height, background);
  const minorStep = 40; // preview px 기준
  const majorEvery = 5; // 5 * minorStep = 200px 마다 major (원본 좌표로는 500px 간격)

  for (let y = 0, i = 0; y < height; y += minorStep, i += 1) {
    const isMajor = i % majorEvery === 0;
    fillRect(c, 0, y, width, isMajor ? 2 : 1, isMajor ? TICK_MAJOR : TICK_MINOR);
    if (isMajor) {
      drawText(c, String(Math.round(y * originalScale)), 6, y + 4, LABEL_COLOR, 2);
    }
  }

  // 제목 워터마크 — 스크롤 중 아무 위치에서나 어떤 레이어/이미지인지 바로 알 수 있도록
  // 800px마다 반복해서 그린다. SRC_A -> SRC_B 경계, before/after 색 전환을 눈으로 확인하는 용도.
  const title = `${sourceLabel} ${layerLabel}`;
  for (let y = 60; y < height; y += 800) {
    drawText(c, title, 10, y, WATERMARK_COLOR, 3);
  }

  return c;
}

const scaleY = 0.4; // lib/mock-api/fixtures.ts와 반드시 일치
const originalScale = 1 / scaleY; // 라벨을 원본 좌표로 표기하기 위한 배율(2.5)

const targets = [
  { file: 'detail-a-original.png', width: 400, height: 3400, source: 'SRC A', layer: 'ORIGINAL', bg: ORIGINAL_BG },
  { file: 'detail-a-translated.png', width: 400, height: 3400, source: 'SRC A', layer: 'TRANSLATED', bg: TRANSLATED_BG },
  { file: 'detail-b-original.png', width: 400, height: 2800, source: 'SRC B', layer: 'ORIGINAL', bg: ORIGINAL_BG },
  { file: 'detail-b-translated.png', width: 400, height: 2800, source: 'SRC B', layer: 'TRANSLATED', bg: TRANSLATED_BG },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const t of targets) {
  const canvas = makeFixtureImage(t.width, t.height, originalScale, t.source, t.layer, t.bg);
  const png = encodePng(canvas);
  writeFileSync(join(OUT_DIR, t.file), png);
  console.log(`${t.file}  ${t.width}x${t.height}  ${(png.length / 1024).toFixed(0)}KB`);
}
