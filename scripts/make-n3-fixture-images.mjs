/**
 * N3 section 이미지(Section.imageKey/renderImageKey/thumbnailUrl) 실측 크기
 * fixture 생성기 — "실데이터 방어 검증" 전용.
 *
 * 왜 필요한가:
 *   lib/mock-api/fixtures.ts의 mockSectionsResponse가 가리키던
 *   /mock/section-0N-*.jpg는 실제 파일이 없어 항상 404였다(fixture 객체에는
 *   숫자만 있고 브라우저가 실제로 디코드하는 파일이 없었다는 뜻). 이 스크립트는
 *   scripts/make-n5-fixture-images.mjs와 같은 방식(외부 이미지 라이브러리 없이
 *   PNG를 직접 인코딩)으로, 실제 실측 크기가 보장된 파일 4장을 만든다.
 *
 * 만드는 것 (총 4장 — 이미지 내용은 단순 색상 채움이면 충분하다, 중요한 건
 * "브라우저가 실제로 로드했을 때 naturalWidth/naturalHeight"가 정확히
 * 아래 값이어야 한다는 점이다):
 *   section-1000x1360.png  1000 x 1360
 *   section-212x8000.png    212 x 8000  (긴 상세페이지 극단값 — 성능 방어 검증용)
 *   section-830x3225.png    830 x 3225
 *   section-800x220.png     800 x  220
 *
 * 실행:  node scripts/make-n3-fixture-images.mjs (npm run make:n3-fixtures)
 * 출력:  public/mock/n3/section-{WxH}.png
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'mock', 'n3');

/* ---------- PNG 인코딩 (scripts/make-n5-fixture-images.mjs와 동일한 방식, 독립 복제) ---------- */
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

/**
 * 세로 그라데이션 + 상/하단 대비 띠로 단순하게 채운다 — 텍스트 렌더링 없이도
 * 스크롤 위치를 눈으로 가늠할 수 있고, width*height*3 바이트를 그대로
 * IDAT으로 압축해 실제 픽셀 크기가 보장된 PNG를 만든다.
 */
function encodePng(width, height, [r, g, b]) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: none
    const band = Math.floor(y / 40) % 2 === 0;
    for (let x = 0; x < width; x += 1) {
      const o = rowStart + 1 + x * 3;
      raw[o] = band ? r : Math.min(255, r + 40);
      raw[o + 1] = band ? g : Math.min(255, g + 40);
      raw[o + 2] = band ? b : Math.min(255, b + 40);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  { width: 1000, height: 1360, color: [0xdc, 0xe6, 0xf5] },
  { width: 212, height: 8000, color: [0xf5, 0xe0, 0xdc] },
  { width: 830, height: 3225, color: [0xe0, 0xf5, 0xe4] },
  { width: 800, height: 220, color: [0xf5, 0xf0, 0xdc] },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const t of targets) {
  const file = `section-${t.width}x${t.height}.png`;
  const png = encodePng(t.width, t.height, t.color);
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`${file}  ${t.width}x${t.height}  ${(png.length / 1024).toFixed(0)}KB`);
}
