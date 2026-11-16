import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { useLocalLayoutEditing } from './helpers/layout-write';
import { getFontScaleToolbarLeft } from '@/lib/n5/coordinates';

// ─────────────────────────────────────────────────────────────────
// N5 선택 UI(Figma 1512:23496 「Selection」)와 우측 패널 section 단위 스크롤(544:3168). Chromium Mock.
// - 선택 테두리·손잡이는 글자(bbox)에서 화면 16px 바깥. bbox 자체는 바뀌지 않는다
// - 선택된 번호 배지는 테두리 왼쪽 16·위 24, 글자크기 툴바(117×34)는 테두리 왼쪽 8·위 42 — 선택 즉시 보이고 서로 겹치지 않는다
// - 패널은 같은 section 안 block 선택으로 움직이지 않고, section이 바뀔 때만 그 section 시작점으로 이동한다. SectionTag는 sticky
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

type Rect = { x: number; y: number; width: number; height: number };
const box = async (page: Page, testId: string): Promise<Rect> => (await page.getByTestId(testId).boundingBox())!;
const near = (actual: number, expected: number, tolerance = 1) =>
  expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** 캔버스 block 선택 — pan 위치와 무관하게 번호 배지 클릭을 보낸다 */
const selectOnCanvas = (page: Page, blockId: number) => page.getByTestId(`n5-block-pin-${blockId}`).dispatchEvent('click');

async function expectChromeGeometry(page: Page, blockId: number) {
  const text = await box(page, `n5-block-overlay-${blockId}`);
  const frame = await box(page, 'n5-block-selection-frame');
  // 글자 ↔ 테두리 16(화면 px)
  near(frame.x, text.x - 16);
  near(frame.y, text.y - 16);
  near(frame.width, text.width + 32);
  near(frame.height, text.height + 32);
  // 손잡이 8개는 넓힌 테두리 위에 있다
  const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const nw = center(await box(page, 'n5-block-handle-nw'));
  const se = center(await box(page, 'n5-block-handle-se'));
  const e = center(await box(page, 'n5-block-handle-e'));
  near(nw.x, frame.x);
  near(nw.y, frame.y);
  near(se.x, frame.x + frame.width);
  near(se.y, frame.y + frame.height);
  near(e.y, frame.y + frame.height / 2);
  // 번호 배지 — 테두리 왼쪽 16·위 24, 20×20
  const badge = (await page.getByTestId(`n5-block-pin-${blockId}`).locator('span').boundingBox())!;
  near(badge.width, 20);
  near(badge.height, 20);
  near(badge.x, frame.x - 16);
  near(badge.y, frame.y - 24);
  // 글자크기 툴바 — 테두리 왼쪽 8·위 42, 117×34
  const toolbar = await box(page, 'n5-font-scale-toolbar');
  near(toolbar.width, 117);
  near(toolbar.height, 34);
  near(toolbar.x, frame.x + 8);
  near(toolbar.y, frame.y - 42);
  // 셋은 서로 겹치지 않고, 배지는 글자를 가리지 않는다
  expect(overlaps(badge, toolbar)).toBe(false);
  expect(overlaps(badge, frame)).toBe(false);
  expect(overlaps(toolbar, frame)).toBe(false);
  expect(overlaps(badge, text)).toBe(false);
}

test('툴바 가로 위치 — 평소 테두리 왼쪽 +8, workspace 오른쪽 끝을 넘는 만큼만 밀고 테두리 왼쪽보다 더 밀지 않는다', () => {
  const at = (frameLeft: number) => getFontScaleToolbarLeft({ preferredLeft: frameLeft + 8, blockLeft: frameLeft, toolbarWidth: 117, maxRight: 1000 });
  expect(at(300)).toBe(308);
  expect(at(875)).toBe(883); // 오른쪽 끝 1000 에 딱 닿는다
  expect(at(900)).toBe(883); // 넘는 17만큼만 민다
  expect(at(1100)).toBe(983); // 테두리가 workspace 밖으로 나가면 함께 나간다(테두리 왼쪽 - 117)
});

test.describe('선택 UI', () => {
  test.beforeEach(async ({ page }) => {
    await useLocalLayoutEditing(page);
    await reachN5(page);
    await expect(page.getByTestId('n5-viewport')).toBeVisible();
  });

  test('글자↔테두리 16px · 배지·툴바 위치 · 선택 즉시 툴바 · zoom 을 바꿔도 화면 px 그대로', async ({ page }) => {
    const before = await box(page, 'n5-block-overlay-9112');
    await page.getByTestId('n5-block-pin-9112').click();
    // bbox(글자 영역)는 선택만으로 바뀌지 않는다
    expect(await box(page, 'n5-block-overlay-9112')).toEqual(before);
    // 작은 trigger 없이 툴바가 바로 보인다
    await expect(page.getByTestId('n5-font-scale-handle')).toHaveCount(0);
    await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
    for (const id of ['n5-font-scale-increase', 'n5-font-scale-decrease']) {
      const button = await box(page, id);
      expect([button.width, button.height]).toEqual([28, 28]);
    }
    const plus = await box(page, 'n5-font-scale-increase');
    const minus = await box(page, 'n5-font-scale-decrease');
    near(minus.x - (plus.x + plus.width), 2, 0.5);
    await expectChromeGeometry(page, 9112);
    await page.screenshot({ path: test.info().outputPath('selection-zoom-100.png'), clip: { x: 120, y: 0, width: 1255, height: 700 } });

    await page.getByTestId('n5-zoom-in').click();
    await page.getByTestId('n5-zoom-in').click();
    await expect(page.getByTestId('n5-canvas')).not.toHaveAttribute('data-zoom', '1');
    await expectChromeGeometry(page, 9112);
    await page.screenshot({ path: test.info().outputPath('selection-zoom-in.png'), clip: { x: 120, y: 0, width: 1255, height: 1080 } });
  });

  test('+ / - 는 선택 즉시 누를 수 있고 배율이 바뀐다 · 손잡이를 끈 거리만큼 bbox 폭이 바뀐다', async ({ page }) => {
    await page.getByTestId('n5-block-pin-9112').click();
    const overlay = page.getByTestId('n5-block-overlay-9112');
    const start = Number(await overlay.getAttribute('data-font-scale'));
    await page.getByTestId('n5-font-scale-increase').click();
    await expect.poll(async () => Number(await overlay.getAttribute('data-font-scale'))).toBeGreaterThan(start);
    await page.getByTestId('n5-font-scale-decrease').click();
    await expect.poll(async () => Number(await overlay.getAttribute('data-font-scale'))).toBe(start);

    const text = await box(page, 'n5-block-overlay-9112');
    const handle = await box(page, 'n5-block-handle-w');
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // 손잡이는 bbox 바깥 16에 있지만 끈 거리(안쪽 20)가 그대로 bbox 왼쪽 변 이동이다(섹션 경계에 막히지 않게 줄이는 방향)
    await page.mouse.move(from.x + 10, from.y, { steps: 5 });
    await page.mouse.move(from.x + 20, from.y, { steps: 5 });
    await page.mouse.up();
    const after = await box(page, 'n5-block-overlay-9112');
    near(after.x, text.x + 20);
    near(after.width, text.width - 20);
    await expectChromeGeometry(page, 9112);
  });
});

test.describe('우측 패널 section 단위 스크롤', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __reveals: { target: string; block: string | undefined }[] };
      w.__reveals = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
        const panel = this.closest('[data-testid="n5-panel"]');
        if (panel) {
          const block = typeof arg === 'object' ? arg.block : undefined;
          w.__reveals.push({ target: this.getAttribute('data-testid') ?? this.tagName, block });
        }
        return original.call(this, arg as ScrollIntoViewOptions);
      };
    });
    await reachN5(page);
    await expect(page.getByTestId('n5-panel')).toBeVisible();
  });

  const reveals = (page: Page) => page.evaluate(() => (window as unknown as { __reveals: { target: string; block?: string }[] }).__reveals);
  const clearReveals = (page: Page) => page.evaluate(() => ((window as unknown as { __reveals: unknown[] }).__reveals.length = 0));
  const bodyScrollTop = (page: Page) => page.getByTestId('n5-panel-body').evaluate((el) => el.scrollTop);
  const blockIdsOf = (page: Page, order: number) =>
    page
      .getByTestId(`n5-panel-section-${order}`)
      .locator('[data-testid^="n5-block-row-"]')
      .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-testid')!.replace('n5-block-row-', ''))));

  test('같은 section block 변경 → 자동 스크롤 0 · section 변경 → section 시작점으로 1회 · SectionTag sticky', async ({ page }) => {
    const first = await blockIdsOf(page, 1);
    const second = await blockIdsOf(page, 2);
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(second.length).toBeGreaterThanOrEqual(1);

    // 처음 선택(선택 없음 → Section1)은 section 이동 1회
    await selectOnCanvas(page, first[0]);
    await expect.poll(() => reveals(page)).toEqual([{ target: 'n5-panel-section-1', block: 'start' }]);
    await page.waitForTimeout(600);

    // 같은 section 안 block 변경 — 패널이 움직이지 않는다
    await clearReveals(page);
    const top = await bodyScrollTop(page);
    await selectOnCanvas(page, first[1]);
    await selectOnCanvas(page, first[2]);
    await page.waitForTimeout(600);
    expect(await reveals(page)).toEqual([]);
    expect(await bodyScrollTop(page)).toBe(top);

    // 사용자가 직접 스크롤한 뒤 같은 section block 을 골라도 위치를 지킨다
    await page.getByTestId('n5-panel-body').evaluate((el) => el.scrollBy(0, 240));
    const manual = await bodyScrollTop(page);
    expect(manual).toBeGreaterThan(top);
    await selectOnCanvas(page, first[first.length - 1]);
    await page.waitForTimeout(600);
    expect(await reveals(page)).toEqual([]);
    expect(await bodyScrollTop(page)).toBe(manual);

    // Section1 을 스크롤하는 동안 Section1 태그가 패널 위에 붙어 있다
    const body = await box(page, 'n5-panel-body');
    near((await box(page, 'n5-section-tag-sticky-1')).y, body.y);

    // section 변경 — Section2 시작점으로 한 번
    await selectOnCanvas(page, second[0]);
    await expect.poll(() => reveals(page)).toEqual([{ target: 'n5-panel-section-2', block: 'start' }]);
    await expect.poll(async () => Math.abs((await box(page, 'n5-section-tag-sticky-2')).y - body.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('panel-section2.png'), clip: { x: 1400, y: 0, width: 520, height: 1080 } });

    // Section2 를 조금 내려도 Section2 태그가 위에 남는다(Section1 태그는 밀려 올라갔다)
    await page.getByTestId('n5-panel-body').evaluate((el) => el.scrollBy(0, 120));
    near((await box(page, 'n5-section-tag-sticky-2')).y, body.y);
    expect((await box(page, 'n5-section-tag-sticky-1')).y).toBeLessThan(body.y);
  });

  test('패널에서 다른 section 의 block 을 눌러도 패널을 다시 움직이지 않는다', async ({ page }) => {
    const second = await blockIdsOf(page, 2);
    const row = page.getByTestId(`n5-block-row-${second[0]}`);
    await row.scrollIntoViewIfNeeded();
    await clearReveals(page);
    const top = await bodyScrollTop(page);
    await row.click({ position: { x: 4, y: 4 } });
    await page.waitForTimeout(600);
    expect(await reveals(page)).toEqual([]);
    expect(await bodyScrollTop(page)).toBe(top);
  });
});
