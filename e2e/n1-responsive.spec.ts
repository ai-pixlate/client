import { deflateSync } from 'node:zlib';

import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N1 정보 입력 반응형 — Figma 525:3023(1920×1080) 좌표를 지키고, 더 좁은 창에서도 2열(업로더 · 우측 설정 패널)이 무너지지 않는다.
// - 국가·언어 행: 1920 에서 810(그룹 385 × 2 · gap 40). 좌측 열이 그보다 좁으면 열 폭을 따라 줄어 우측 패널을 침범하지 않는다.
// - 썸네일 그리드: 업로더 안쪽 폭으로 열 수를 정한다(1920·1728 4열 · 1512·1440 3열 · 1280 2열). 카드 비율 244:320, 이미지는 원본 비율.
// - 우측 패널 516 고정 · 내용이 남는 높이보다 길 때만 패널 안 스크롤. 동의 체크와 [다음]은 화면 안에서 누를 수 있다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '화면 수치 검증은 Chromium 기준이다');

const VIEWPORTS = [
  { width: 1920, height: 1080, cols: 4 },
  { width: 1728, height: 885, cols: 4 },
  { width: 1512, height: 860, cols: 3 },
  { width: 1440, height: 900, cols: 3 },
  { width: 1280, height: 720, cols: 2 },
] as const;

/** 단색 PNG(w×h)를 메모리에서 만든다 — 저장소에 binary fixture 를 두지 않는다 */
function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8bit RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 세로형 · 가로형 · 세로 · 정사각을 섞는다 — 썸네일이 원본 비율을 지키는지 본다 */
const SIZES: [number, number][] = [
  [86, 240],
  [120, 80],
  [80, 120],
  [100, 100],
];
const files = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const [w, h] = SIZES[i % SIZES.length];
    return { name: `n1-${i + 1}.png`, mimeType: 'image/png', buffer: png(w, h, [60 + i * 20, 120, 200 - i * 15]) };
  });

async function openN1(page: Page) {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  await expect(page.getByTestId('n1-input-panel')).toBeVisible();
}

async function addImages(page: Page, count: number) {
  await page.getByLabel('파일 선택').first().setInputFiles(files(count));
  await expect(page.locator('[data-testid="n1-image-dropzone"] img[alt^="n1-"]')).toHaveCount(count);
}

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, testId: string): Promise<Box> => (await page.getByTestId(testId).boundingBox())!;
const near = (actual: number, expected: number, label: string, tolerance = 1) =>
  expect(Math.abs(actual - expected), `${label}: ${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
const nearBox = (actual: Box, [x, y, w, h]: number[], label: string) => {
  near(actual.x, x, `${label} x`);
  near(actual.y, y, `${label} y`);
  near(actual.width, w, `${label} w`);
  near(actual.height, h, `${label} h`);
};
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

/** 버튼 가운데를 누르면 그 버튼이 받는다(다른 요소에 가려지지 않음) */
async function isOnTop(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true }).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
}

for (const { width, height, cols } of VIEWPORTS) {
  test.describe(`${width}×${height}`, () => {
    test.use({ viewport: { width, height } });

    test('빈 업로더 — 2열 유지 · 국가·언어 행이 패널을 침범하지 않음 · CTA 사용 가능 · 가로 넘침 없음', async ({ page }) => {
      await openN1(page);
      const row = await box(page, 'n1-target-row');
      const dropzone = await box(page, 'n1-image-dropzone');
      const panel = await box(page, 'n1-input-panel');
      const consent = await box(page, 'n1-consent');
      const next = (await page.getByRole('button', { name: '다음', exact: true }).boundingBox())!;

      if (width === 1920) {
        // Figma 525:3023
        nearBox(row, [140, 96, 810, 39], 'row');
        nearBox(dropzone, [140, 147, 1184, 873], 'uploader');
        nearBox(panel, [1344, 96, 516, 795], 'panel');
        nearBox(consent, [1344, 907, 516, 28], 'consent');
        nearBox(next, [1712, 975, 148, 45], 'next');
      }

      // 2열 — 업로더 오른쪽 + gap 20 = 패널 왼쪽, 패널 516 · 오른쪽 여백 60
      near(right(dropzone) + 20, panel.x, 'uploader ↔ panel gap');
      near(panel.width, 516, 'panel w');
      near(width - right(panel), 60, 'right margin');
      // 국가·언어 행은 좌측 열 안 — 최대 810, 좁으면 열 폭
      expect(right(row)).toBeLessThanOrEqual(right(dropzone) + 0.5);
      near(row.width, Math.min(810, dropzone.width), 'row w');
      const fields = await page.getByTestId('n1-target-row').evaluate((el) =>
        [...el.querySelectorAll(':scope > div')].map((group) => {
          const label = group.querySelector('p')!.getBoundingClientRect();
          const select = group.querySelector('select')!.getBoundingClientRect();
          return { labelRight: label.right, selectLeft: select.left, selectWidth: select.width, selectRight: select.right };
        }),
      );
      expect(fields).toHaveLength(2);
      for (const f of fields) {
        expect(f.labelRight).toBeLessThan(f.selectLeft);
        expect(f.selectWidth).toBeGreaterThanOrEqual(180);
      }
      expect(fields[0].selectRight).toBeLessThan(fields[1].selectLeft);
      expect(fields[1].selectRight).toBeLessThan(panel.x);

      // 동의·[다음]은 패널 아래, 화면 안에서 누를 수 있다
      expect(consent.y).toBeGreaterThanOrEqual(bottom(panel));
      expect(bottom(next)).toBeLessThanOrEqual(height);
      expect(await isOnTop(page, '다음')).toBe(true);
      await expect(page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ })).toBeVisible();

      // 패널은 내용이 남는 높이보다 길 때만 안에서 스크롤하고, 끝까지 내리면 핵심 키워드가 보인다
      const scroll = await page.getByTestId('n1-input-panel').evaluate((el) => el.scrollHeight - el.clientHeight);
      if (width === 1920) expect(scroll).toBe(0);
      await page.getByTestId('n1-input-panel').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect(page.getByPlaceholder('키워드를 입력해주세요.')).toBeInViewport();

      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBe(0);
      await page.screenshot({ path: test.info().outputPath(`n1-empty-${width}x${height}.png`) });
    });

    for (const count of [1, 4, 8]) {
      test(`이미지 ${count}개 — ${cols}열 그리드 · 카드 244:320 · 원본 비율 · 「파일 추가」 카드가 넘치지 않음`, async ({ page }) => {
        await openN1(page);
        const panelBefore = await box(page, 'n1-input-panel');
        await addImages(page, count);

        const grid = await page.getByTestId('n1-image-dropzone').evaluate((dz) => {
          const gridEl = dz.querySelector('.grid')!;
          const cards = [...gridEl.children].map((c) => c.getBoundingClientRect());
          const add = dz.querySelector('[data-testid="n1-add-file-card"]')!;
          const addRect = add.getBoundingClientRect();
          const addOverflow = [...add.querySelectorAll('*')].some((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.left < addRect.left - 0.5 || r.right > addRect.right + 0.5);
          });
          const images = [...dz.querySelectorAll<HTMLImageElement>('img[alt^="n1-"]')].map((img) => {
            const card = img.getBoundingClientRect();
            const natural = img.naturalWidth / img.naturalHeight;
            // object-contain 으로 실제 그려지는 크기
            const scale = Math.min(card.width / img.naturalWidth, card.height / img.naturalHeight);
            return { fit: getComputedStyle(img).objectFit, natural, drawn: (img.naturalWidth * scale) / (img.naturalHeight * scale) };
          });
          return {
            cols: getComputedStyle(gridEl).gridTemplateColumns.split(' ').length,
            widths: [...new Set(cards.map((c) => Math.round(c.width * 10) / 10))],
            heights: [...new Set(cards.map((c) => Math.round(c.height * 10) / 10))],
            ratio: cards[0].width / cards[0].height,
            addOverflow,
            images,
          };
        });
        expect(grid.cols).toBe(cols);
        expect(grid.widths).toHaveLength(1);
        expect(grid.heights).toHaveLength(1);
        near(grid.ratio, 244 / 320, 'card ratio', 0.01);
        if (width === 1920) near(grid.widths[0], 244, 'card w');
        expect(grid.addOverflow).toBe(false);
        for (const image of grid.images) {
          expect(image.fit).toBe('contain');
          near(image.drawn, image.natural, 'image ratio', 0.01);
        }

        // 업로더가 우측 패널을 침범하지 않고 패널 위치도 그대로다. 많아지면 업로더 안에서만 스크롤한다
        const dropzone = await box(page, 'n1-image-dropzone');
        expect(right(dropzone)).toBeLessThanOrEqual(panelBefore.x - 20 + 0.5);
        nearBox(await box(page, 'n1-input-panel'), [panelBefore.x, panelBefore.y, panelBefore.width, panelBefore.height], 'panel');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBe(0);
        await page.getByTestId('n1-add-file-card').scrollIntoViewIfNeeded();
        await expect(page.getByTestId('n1-add-file-card').getByText('파일 선택')).toBeInViewport();
        expect(await isOnTop(page, '다음')).toBe(true);
        if (count === 8) await page.screenshot({ path: test.info().outputPath(`n1-images-${width}x${height}.png`) });
      });
    }
  });
}

test.describe('1280×720 — 좁은 그리드에서 삭제·재정렬', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('삭제하면 카드가 빠지고, 드래그 재정렬은 화면 순서를 바꾼다(서버 요청 없음)', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && !r.isNavigationRequest()) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await openN1(page);
    await addImages(page, 4);
    const order = () => page.locator('[data-testid="n1-image-dropzone"] img[alt^="n1-"]').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('alt')));
    expect(await order()).toEqual(['n1-1.png', 'n1-2.png', 'n1-3.png', 'n1-4.png']);

    await page.getByRole('button', { name: 'n1-2.png 삭제' }).click();
    expect(await order()).toEqual(['n1-1.png', 'n1-3.png', 'n1-4.png']);

    const card = (name: string) => page.locator('[data-testid="n1-image-dropzone"] [draggable="true"]').filter({ has: page.locator(`img[alt="${name}"]`) });
    await card('n1-4.png').dragTo(card('n1-1.png'));
    await expect.poll(order).toEqual(['n1-4.png', 'n1-1.png', 'n1-3.png']);
    expect(writes).toEqual([]);
  });
});
