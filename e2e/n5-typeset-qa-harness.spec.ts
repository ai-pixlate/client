import { type Page, expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// 조판 QA 화면(/spike/typeset-measure, dev 전용) 검증 — Chromium.
// TypesetBlock 표시, 측정, 최종 출력 offset, 블록 넘침·이미지 이탈 평가를 예시 데이터로 함께 확인한다.
// 엔진 자체의 픽셀·clean 문서 대조는 n5-typeset-measurement.spec.ts 가 맡는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '조판 QA 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1280, height: 900 } });

async function openQa(page: Page) {
  await page.goto('/spike/typeset-measure');
  await expect(page.getByTestId('typeset-qa-font')).toHaveAttribute('data-status', 'ready');
  await expect(block(page, 101)).toHaveAttribute('data-font-px', '32');
}

const block = (page: Page, id: number) => page.getByTestId(`typeset-qa-block-${id}`);
const section = (page: Page, id: number) => page.getByTestId(`typeset-qa-section-${id}`);
const rendered = (page: Page, id: number) => page.locator(`[data-typeset-render="${id}"]`);

async function expectEvaluation(page: Page, id: number, overflow: string, boundary: string) {
  await expect(block(page, id)).toHaveAttribute('data-block-overflow', overflow);
  await expect(block(page, id)).toHaveAttribute('data-image-boundary', boundary);
}

test('블록 넘침과 최종 이미지 이탈을 서로 독립적으로 보여준다', async ({ page }) => {
  await openQa(page);
  await expectEvaluation(page, 101, 'none', 'none');
  await expectEvaluation(page, 103, 'right', 'none');
  await expectEvaluation(page, 301, 'none', 'bottom');
  await expectEvaluation(page, 302, 'bottom', 'bottom');
  // 화면 글자로도 두 판정이 따로 보인다
  await expect(block(page, 301)).toContainText('Block overflow');
  await expect(block(page, 301)).toContainText('Image boundary');
  await expect(block(page, 301).locator('dd').nth(0)).toHaveText('none');
  await expect(block(page, 301).locator('dd').nth(1)).toHaveText('bottom');
});

test('TypesetBlock 은 역할 style·개행·강제 분할 없음을 지키고 측정기와 같은 줄 경계를 만든다', async ({ page }) => {
  await openQa(page);

  const expected: Record<number, { fontSize: string; fontWeight: string; letterSpacing: string; lineHeight: string }> = {
    101: { fontSize: '32px', fontWeight: '600', letterSpacing: `${32 * -0.015}px`, lineHeight: `${32 * 1.2}px` },
    102: { fontSize: '16px', fontWeight: '400', letterSpacing: `${16 * -0.03}px`, lineHeight: `${16 * 1.2}px` },
    103: { fontSize: '14px', fontWeight: '400', letterSpacing: `${14 * -0.01}px`, lineHeight: `${14 * 1.2}px` },
    104: { fontSize: '24px', fontWeight: '600', letterSpacing: `${24 * -0.02}px`, lineHeight: `${24 * 1.2}px` },
    301: { fontSize: '16px', fontWeight: '400', letterSpacing: `${16 * -0.03}px`, lineHeight: `${16 * 1.2}px` },
  };
  for (const [id, css] of Object.entries(expected)) {
    const actual = await rendered(page, Number(id)).evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        fontSize: parseFloat(s.fontSize),
        fontWeight: s.fontWeight,
        letterSpacing: parseFloat(s.letterSpacing),
        lineHeight: parseFloat(s.lineHeight),
        family: s.fontFamily,
        whiteSpace: s.whiteSpace,
        kerning: s.fontKerning,
      };
    });
    expect(actual.fontSize).toBeCloseTo(parseFloat(css.fontSize), 3);
    expect(actual.fontWeight).toBe(css.fontWeight);
    expect(actual.letterSpacing).toBeCloseTo(parseFloat(css.letterSpacing), 2);
    expect(actual.lineHeight).toBeCloseTo(parseFloat(css.lineHeight), 2);
    expect(actual.family).toBe('Pretendard');
    expect(actual.whiteSpace).toBe('pre-line');
    expect(actual.kerning).toBe('normal');
  }

  await expect(block(page, 102)).toHaveAttribute('data-line-count', '2');
  await expect(rendered(page, 102)).toHaveCSS('text-align', 'center');
  await expect(rendered(page, 101)).toHaveCSS('text-align', 'left');
  // 긴 단어는 한 줄을 유지하고 넘친다
  await expect(block(page, 103)).toHaveAttribute('data-line-count', '1');

  // 화면 DOM 과 숨은 측정 요소의 줄 경계가 같아야 평가를 믿을 수 있다
  for (const id of [101, 102, 103, 104, 105, 201, 301, 302]) {
    const measured = JSON.parse((await block(page, id).getAttribute('data-dom-bounds'))!);
    const actual = await rendered(page, id).evaluate((el) => {
      const origin = el.parentElement!.parentElement!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      return {
        left: Math.min(...rects.map((r) => r.left)) - origin.left,
        top: Math.min(...rects.map((r) => r.top)) - origin.top,
        right: Math.max(...rects.map((r) => r.right)) - origin.left,
        bottom: Math.max(...rects.map((r) => r.bottom)) - origin.top,
      };
    });
    expect(actual, `block ${id}`).toEqual(measured);
  }

  // 제외 블록은 그리지 않는다
  await expect(rendered(page, 303)).toHaveCount(0);
  await expect(block(page, 303)).toHaveAttribute('data-state', 'block-excluded');
});

test('섹션을 제외하면 뒤 섹션의 finalOutputOffset 이 바뀌고 복원하면 돌아온다', async ({ page }) => {
  await openQa(page);
  const offsets = async () =>
    Promise.all([1, 2, 3].map((id) => section(page, id).getAttribute('data-final-offset')));

  expect(await offsets()).toEqual(['0', '500', '800']);
  await expect(page.getByTestId('typeset-qa-final-height')).toHaveAttribute('data-height', '1200');
  await expect(block(page, 301)).toHaveAttribute('data-final-y', '1190');

  await page.getByTestId('typeset-qa-include-2').click();
  expect(await offsets()).toEqual(['0', '', '500']);
  await expect(page.getByTestId('typeset-qa-final-height')).toHaveAttribute('data-height', '900');
  await expect(block(page, 301)).toHaveAttribute('data-final-y', '890');
  await expect(block(page, 201)).toHaveAttribute('data-state', 'section-excluded');
  await expect(rendered(page, 201)).toHaveCount(0);
  // N5 화면 스택 참고값은 그대로다(최종 출력과 별개)
  await expect(section(page, 3).locator('td').nth(4)).toHaveText('800');
  await expect(page.getByTestId('typeset-qa-stack-3')).toHaveCSS('top', '500px');

  await page.getByTestId('typeset-qa-include-2').click();
  expect(await offsets()).toEqual(['0', '500', '800']);

  await page.getByTestId('typeset-qa-include-1').click();
  expect(await offsets()).toEqual(['', '0', '300']);
  await page.getByTestId('typeset-qa-include-1').click();

  // S1 끝을 넘는 블록: 뒤 섹션이 있으면 이미지 안, 모두 제외하면 이미지 이탈. 블록 판정은 그대로다
  await expectEvaluation(page, 105, 'none', 'none');
  await page.getByTestId('typeset-qa-include-2').click();
  await page.getByTestId('typeset-qa-include-3').click();
  await expectEvaluation(page, 105, 'none', 'bottom');
});

test('사용자 글자 배율은 기본 크기에 곱하며 누적되지 않는다', async ({ page }) => {
  await openQa(page);
  const scale = page.getByTestId('typeset-qa-scale');
  const fontPx = async () => Number(await block(page, 102).getAttribute('data-font-px'));

  await scale.fill('1.25');
  await expect(block(page, 102)).toHaveAttribute('data-font-px', '20');
  await expect(rendered(page, 102)).toHaveCSS('font-size', '20px');
  await scale.fill('1.5');
  // 20 × 1.5 = 30 이 아니라 16 × 1.5 = 24
  await expect(block(page, 102)).toHaveAttribute('data-font-px', '24');
  await expect(rendered(page, 102)).toHaveCSS('font-size', '24px');
  await scale.fill('1');
  await expect(block(page, 102)).toHaveAttribute('data-font-px', '16');
  expect(await fontPx()).toBe(16);
});

test('조정 박스가 있으면 그 박스를 쓰고 끄면 원본 박스로 돌아온다', async ({ page }) => {
  await openQa(page);
  const original = { x: 24, y: 250, width: 200, height: 40 };
  const adjusted = { x: 24.5, y: 250.25, width: 60.125, height: 40 };
  await expect(block(page, 104)).toHaveAttribute('data-active-bbox', JSON.stringify(original));
  await expect(block(page, 104)).toHaveAttribute('data-block-overflow', 'none');

  await page.getByTestId('typeset-qa-adjusted').check();
  await expect(block(page, 104)).toHaveAttribute('data-active-bbox', JSON.stringify(adjusted));
  await expect(rendered(page, 104)).toHaveCSS('left', '24.5px');
  await expect(rendered(page, 104)).toHaveCSS('top', '250.25px');
  await expect(block(page, 104)).not.toHaveAttribute('data-block-overflow', 'none');
  await expect(block(page, 104)).toHaveAttribute('data-final-y', '250.25');

  await page.getByTestId('typeset-qa-adjusted').uncheck();
  await expect(block(page, 104)).toHaveAttribute('data-active-bbox', JSON.stringify(original));
});

test('bbox·DOM·ink 표시가 측정값 위치에 그려진다', async ({ page }) => {
  await openQa(page);
  const stack = (await page.getByTestId('typeset-qa-stack-1').boundingBox())!;
  const bbox = (await page.getByTestId('typeset-qa-bbox-103').boundingBox())!;
  expect(bbox.x - stack.x).toBe(24);
  expect(bbox.y - stack.y).toBe(190);
  expect(bbox.width).toBe(80);
  await expect(page.getByTestId('typeset-qa-dom-103')).toBeVisible();
  const ink = (await page.getByTestId('typeset-qa-ink-103').boundingBox())!;
  // 넘친 글자의 ink 가 bbox 오른쪽 밖에 있다
  expect(ink.x + ink.width).toBeGreaterThan(bbox.x + bbox.width);
});

test('Pretendard 에 없는 글자는 glyph-fallback 으로 실패하고 평가를 내지 않는다', async ({ page }) => {
  await openQa(page);
  await expect(block(page, 304)).toHaveAttribute('data-failure', 'glyph-fallback');
  await expect(block(page, 304)).toHaveAttribute('data-block-overflow', '');
  await expect(block(page, 304)).toHaveAttribute('data-image-boundary', '');
});

test('없는 폰트를 지정하면 font-not-ready 로 측정하지 않고, 되돌리면 다시 측정한다', async ({ page }) => {
  await openQa(page);
  await page.getByTestId('typeset-qa-missing-font').check();
  await expect(page.getByTestId('typeset-qa-font')).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('typeset-qa-font-missing')).toHaveText('400 no-font-face, 600 no-font-face');
  await expect(block(page, 101)).toHaveAttribute('data-font-px', '');
  await expect(block(page, 101)).toHaveAttribute('data-block-overflow', '');

  await page.getByTestId('typeset-qa-missing-font').uncheck();
  await expect(page.getByTestId('typeset-qa-font')).toHaveAttribute('data-status', 'ready');
  await expect(block(page, 101)).toHaveAttribute('data-font-px', '32');
});

test('Pretendard CSS 를 받지 못하면 시스템 폰트로 측정하지 않는다', async ({ page }) => {
  await page.route('**/pretendard.css', (route) => route.abort());
  await page.goto('/spike/typeset-measure');
  await expect(page.getByTestId('typeset-qa-font')).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('typeset-qa-font-missing')).toHaveText('400 no-font-face, 600 no-font-face');
  await expect(block(page, 101)).toHaveAttribute('data-font-px', '');
});

test('폰트 파일을 받지 못하면 document.fonts.ready 와 상관없이 측정하지 않는다', async ({ page }) => {
  // 실제 CSS 는 local() 을 먼저 쓰므로 Pretendard 가 설치된 PC 에서는 woff2 차단만으로 실패가 재현되지 않는다 — url() 만 있는 CSS 로 바꿔 어느 환경에서나 같게 만든다
  const face = (weight: number) =>
    `@font-face{font-family:'Pretendard';font-weight:${weight};src:url(https://cdn.jsdelivr.net/pixlate-qa-missing-${weight}.woff2) format('woff2');}`;
  await page.route('**/pretendard.css', (route) => route.fulfill({ contentType: 'text/css', body: face(400) + face(600) }));
  await page.route('**/pixlate-qa-missing-*.woff2', (route) => route.abort());
  await page.goto('/spike/typeset-measure');
  await expect(page.getByTestId('typeset-qa-font')).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('typeset-qa-font-missing')).toHaveText('400 not-loaded, 600 not-loaded');
  await expect(block(page, 101)).toHaveAttribute('data-font-px', '');
});
