/**
 * 스파이크 검증용 눈금 이미지 생성기.
 *
 * 왜 필요한가:
 *   크롭 좌표가 맞는지 눈으로 확인하려면 이미지 위에 좌표가 적혀 있어야 합니다.
 *   실제 상품 상세페이지로는 "지금 y=3400 근처인가?"를 확인할 수 없습니다.
 *
 * 라이브러리를 쓰지 않고 PNG 를 직접 만듭니다.
 *   - node:zlib 로 압축, node:crypto 로 CRC. 둘 다 Node 기본 모듈입니다.
 *   - 이미지 라이브러리(sharp, canvas 등)를 설치하지 않기 위한 선택입니다.
 *
 * 실행:  node scripts/make-ruler.mjs
 * 출력:  public/spike/ruler-7000.png, ruler-10000.png, ruler-14000-preview.png
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'spike');

/* ---------- 아주 작은 5x7 비트맵 폰트 (숫자와 x 만) ---------- */
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
  ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
  x: ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function createCanvas(width, height) {
  // RGB 3바이트 × 픽셀. 흰 배경으로 채웁니다.
  const data = Buffer.alloc(width * height * 3, 0xff);
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
  for (const ch of String(text)) {
    const glyph = GLYPHS[ch];
    if (!glyph) {
      cursor += 6 * scale;
      continue;
    }
    glyph.forEach((row, ry) => {
      [...row].forEach((bit, rx) => {
        if (bit === '1') {
          fillRect(c, cursor + rx * scale, y + ry * scale, scale, scale, color);
        }
      });
    });
    cursor += 6 * scale;
  }
}

/* ---------- PNG 인코딩 ---------- */
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  // 스캔라인마다 filter 바이트 0 을 붙입니다.
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

/* ---------- 눈금 그리기 ---------- */
const GRAY = [0xd0, 0xd0, 0xd0];
const DARK = [0x33, 0x33, 0x33];
const BLUE = [0x1d, 0x4e, 0xd8];

/**
 * @param width      이미지 실제 폭 (px)
 * @param height     이미지 실제 높이 (px)
 * @param labelScale 눈금에 적을 좌표를 몇 배로 표기할지.
 *                   preview 이미지는 실제보다 큰 원본 좌표를 적어야 하므로 2 를 씁니다.
 */
function makeRuler(width, height, labelScale = 1) {
  const c = createCanvas(width, height);
  const step = 100 * (labelScale === 1 ? 1 : 1); // 이미지 픽셀 기준 간격

  for (let y = 0; y < height; y += step) {
    const isMajor = (y / step) % 5 === 0;
    fillRect(c, 0, y, isMajor ? width : 40, isMajor ? 2 : 1, isMajor ? DARK : GRAY);
    if (isMajor) {
      // 라벨은 "원본 좌표" 기준으로 적습니다. preview 는 실제 y × labelScale.
      drawText(c, String(y * labelScale), 8, y + 6, BLUE, 3);
    }
  }
  // 세로 눈금 (가로 좌표 확인용)
  for (let x = 0; x < width; x += step) {
    const isMajor = (x / step) % 5 === 0;
    fillRect(c, x, 0, isMajor ? 2 : 1, isMajor ? height : 20, isMajor ? DARK : GRAY);
  }
  // 상단에 이미지 크기 표기
  drawText(c, `${width * labelScale} x ${height * labelScale}`, 8, 20, DARK, 4);
  return c;
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'ruler-7000.png', w: 1000, h: 7000, labelScale: 1 },
  { file: 'ruler-10000.png', w: 1000, h: 10000, labelScale: 1 },
  // 원본 2000x14000 을 0.5 로 줄인 preview. 라벨은 원본 좌표로 적습니다.
  { file: 'ruler-14000-preview.png', w: 1000, h: 7000, labelScale: 2 },
];

for (const t of targets) {
  const png = encodePng(makeRuler(t.w, t.h, t.labelScale));
  writeFileSync(join(OUT_DIR, t.file), png);
  console.log(`${t.file}  ${t.w}x${t.h}  ${(png.length / 1024).toFixed(0)}KB`);
}
