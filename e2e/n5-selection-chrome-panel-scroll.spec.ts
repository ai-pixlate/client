import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { getFontScaleToolbarLeft } from '@/lib/n5/coordinates';

// ─────────────────────────────────────────────────────────────────
// N5 선택 UI(Figma 1512:23496 「Selection」)와 우측 패널 section 단위 스크롤(544:3168). Chromium Mock.
// - 선택 테두리·손잡이 중심은 글자(bbox)에서 화면 12px 바깥(Figma Selected Crop Fragment). bbox 자체는 바뀌지 않는다
// - 글자 기준으로 선택된 번호 배지는 왼쪽 32·위 40, 글자크기 툴바(117×34)는 왼쪽 8·위 58(테두리 기준 +4, -46) — 선택 즉시 보이고 서로 겹치지 않는다
// - 선택 안 된 번호 배지는 글자 왼쪽 위 바깥(왼쪽 20·위 20) — 글자를 가리지 않는다
// - 선택과 자동 이동은 분리한다(PM 확정). 왼쪽 section 배경 클릭은 block 선택 해제 + section 선택만 하고 패널·캔버스를 움직이지 않는다
//   (번역 후·번역 전 공통). 왼쪽 block 클릭은 패널의 그 block row 를 nearest 로 보이게 한다(이미 보이면 그대로, 같은 block 재클릭도 다시).
//   패널 안 block·SectionTag 클릭은 패널을 움직이지 않는다. SectionTag 는 sticky
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
  // 글자 ↔ 테두리 12(화면 px)
  near(frame.x, text.x - 12);
  near(frame.y, text.y - 12);
  near(frame.width, text.width + 24);
  near(frame.height, text.height + 24);
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
  // 번호 배지 — 글자 왼쪽 32·위 40(테두리 왼쪽 20·위 28), 20×20
  const badge = (await page.getByTestId(`n5-block-pin-${blockId}`).locator('span').boundingBox())!;
  near(badge.width, 20);
  near(badge.height, 20);
  near(badge.x, text.x - 32);
  near(badge.y, text.y - 40);
  // 글자크기 툴바 — 글자 왼쪽 8·위 58(테두리 +4·-46), 117×34
  const toolbar = await box(page, 'n5-font-scale-toolbar');
  near(toolbar.width, 117);
  near(toolbar.height, 34);
  near(toolbar.x, text.x - 8);
  near(toolbar.y, text.y - 58);
  // 셋은 서로 겹치지 않고, 배지는 글자를 가리지 않는다
  expect(overlaps(badge, toolbar)).toBe(false);
  expect(overlaps(badge, frame)).toBe(false);
  expect(overlaps(toolbar, frame)).toBe(false);
  expect(overlaps(badge, text)).toBe(false);
}

test('툴바 가로 위치 — 평소 테두리 왼쪽 +4, workspace 오른쪽 끝을 넘는 만큼만 밀고 테두리 왼쪽보다 더 밀지 않는다', () => {
  const at = (frameLeft: number) => getFontScaleToolbarLeft({ preferredLeft: frameLeft + 4, blockLeft: frameLeft, toolbarWidth: 117, maxRight: 1000 });
  expect(at(300)).toBe(304);
  expect(at(879)).toBe(883); // 오른쪽 끝 1000 에 딱 닿는다
  expect(at(900)).toBe(883); // 넘는 21만큼만 민다
  expect(at(1100)).toBe(983); // 테두리가 workspace 밖으로 나가면 함께 나간다(테두리 왼쪽 - 117)
});

test.describe('선택 UI', () => {
  test.beforeEach(async ({ page }) => {
    await reachN5(page);
    await expect(page.getByTestId('n5-viewport')).toBeVisible();
  });

  test('선택 안 된 번호 배지는 글자 왼쪽 위 바깥(20, 20)이라 글자를 가리지 않는다', async ({ page }) => {
    for (const id of [9101, 9102, 9112]) {
      const text = await box(page, `n5-block-overlay-${id}`);
      const badge = (await page.getByTestId(`n5-block-pin-${id}`).locator('span').boundingBox())!;
      near(badge.x, text.x - 20);
      near(badge.y, text.y - 20);
      expect(overlaps(badge, text)).toBe(false);
    }
  });

  test('글자↔테두리 12px · 배지·툴바 위치 · 선택 즉시 툴바 · zoom 을 바꿔도 화면 px 그대로', async ({ page }) => {
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
    // 손잡이는 bbox 바깥 12에 있지만 끈 거리(안쪽 20)가 그대로 bbox 왼쪽 변 이동이다(섹션 경계에 막히지 않게 줄이는 방향)
    await page.mouse.move(from.x + 10, from.y, { steps: 5 });
    await page.mouse.move(from.x + 20, from.y, { steps: 5 });
    await page.mouse.up();
    const after = await box(page, 'n5-block-overlay-9112');
    near(after.x, text.x + 20);
    near(after.width, text.width - 20);
    await expectChromeGeometry(page, 9112);
  });
});

test.describe('우측 패널 — 선택과 자동 이동 분리', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __reveals: { target: string; block: string | undefined }[] };
      w.__reveals = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
        const panel = this.closest('[data-testid="n5-panel"]');
        if (panel) {
          const block = typeof arg === 'object' ? arg.block : undefined;
          const row = this.querySelector('[data-testid^="n5-block-row-"]');
          w.__reveals.push({ target: this.getAttribute('data-testid') ?? row?.getAttribute('data-testid') ?? this.tagName, block });
        }
        return original.call(this, arg as ScrollIntoViewOptions);
      };
    });
    await reachN5(page);
    await expect(page.getByTestId('n5-panel')).toBeVisible();
  });

  const reveals = (page: Page) => page.evaluate(() => (window as unknown as { __reveals: { target: string; block?: string }[] }).__reveals);
  const clearReveals = (page: Page) => page.evaluate(() => ((window as unknown as { __reveals: unknown[] }).__reveals.length = 0));
  const panelBody = (page: Page) => page.getByTestId('n5-panel-body');
  const bodyScrollTop = (page: Page) => panelBody(page).evaluate((el) => el.scrollTop);
  const canvasPan = (page: Page) =>
    page.getByTestId('n5-canvas').evaluate((el) => [el.getAttribute('data-pan-x'), el.getAttribute('data-pan-y')].join(','));
  const blockIdsOf = (page: Page, order: number) =>
    page
      .getByTestId(`n5-panel-section-${order}`)
      .locator('[data-testid^="n5-block-row-"]')
      .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('data-testid')!.replace('n5-block-row-', ''))));
  /** 캔버스 section 순서(=패널 section 순서)대로의 sectionId */
  const sectionIds = (page: Page, mode: 'translated' | 'original') =>
    page
      .locator(`[data-testid^="n5-slice-${mode}-"]`)
      .evaluateAll((els, m) => els.map((el) => Number(el.getAttribute('data-testid')!.replace(`n5-slice-${m}-`, ''))), mode);
  /** 패널을 Section{order} 중간쯤으로 직접 스크롤한다 */
  async function scrollPanelInto(page: Page, order: number, offset = 120) {
    await page.evaluate(
      ({ order, offset }) => {
        const body = document.querySelector<HTMLElement>('[data-testid="n5-panel-body"]')!;
        const group = document.querySelector<HTMLElement>(`[data-testid="n5-panel-section-${order}"]`)!;
        body.scrollTop += group.getBoundingClientRect().top - body.getBoundingClientRect().top + offset;
      },
      { order, offset },
    );
    await page.waitForTimeout(100);
  }
  /** 패널 row 가 패널 스크롤 영역 안에 보이는지(sticky 태그 아래 ~ 아래 끝) */
  async function rowInPanel(page: Page, blockId: number) {
    const body = await box(page, 'n5-panel-body');
    const row = (await page.getByTestId(`n5-block-row-${blockId}`).boundingBox())!;
    return row.y >= body.y && row.y + Math.min(row.height, 120) <= body.y + body.height;
  }

  for (const mode of ['translated', 'original'] as const) {
    test(`A·B·C. ${mode === 'translated' ? '번역 후' : '번역 전'} — 왼쪽 section 배경 클릭: block 선택 해제 · section 선택 · 패널 scrollTop·캔버스 pan 불변`, async ({ page }) => {
      if (mode === 'original') await page.getByTestId('n5-view-mode-toggle').getByRole('button', { name: '번역 전' }).click();
      const ids = await sectionIds(page, mode);
      expect(ids.length).toBeGreaterThanOrEqual(4);
      const first = await blockIdsOf(page, 1);

      // Section1 의 block 을 고른 뒤, 사용자가 패널을 Section4 중간으로 스크롤해 둔다
      await page.getByTestId(`n5-block-row-${first[0]}`).click({ position: { x: 4, y: 4 } });
      await expect(page.getByTestId(`n5-block-row-${first[0]}`)).toHaveAttribute('aria-pressed', 'true');
      await scrollPanelInto(page, 4);
      const before = await bodyScrollTop(page);
      const panBefore = await canvasPan(page);
      expect(before).toBeGreaterThan(0);
      await clearReveals(page);

      // 왼쪽 Section2 배경 클릭(글 박스가 아닌 section 표면)
      await page.getByTestId(`n5-slice-${mode}-${ids[1]}`).dispatchEvent('click');
      await expect(page.getByTestId('n5-section-tag-2')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-testid^="n5-block-row-"][aria-pressed="true"]')).toHaveCount(0);
      await page.waitForTimeout(700);
      const after = await bodyScrollTop(page);
      console.log(`[n5-section-click] ${mode} scrollTop ${before} → ${after}`);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
      expect(await reveals(page)).toEqual([]);
      expect(await canvasPan(page)).toBe(panBefore);

      // 키보드 Enter 도 같다
      await page.getByTestId(`n5-slice-${mode}-${ids[2]}`).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('n5-section-tag-3')).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(700);
      expect(Math.abs((await bodyScrollTop(page)) - before)).toBeLessThanOrEqual(1);
      expect(await reveals(page)).toEqual([]);
    });
  }

  test('D·E. 왼쪽 block 클릭 — 그 block row 를 nearest 로 보이고(section 맨 위로 가지 않음), 이미 보이면 그대로, 같은 block 재클릭도 다시 보인다', async ({ page }) => {
    const fourth = await blockIdsOf(page, 4);
    const target = fourth[fourth.length - 1];
    await panelBody(page).evaluate((el) => (el.scrollTop = 0));
    expect(await rowInPanel(page, target)).toBe(false);
    await clearReveals(page);

    // D — 패널 밖의 block: 그 row 로 최소 이동(nearest), section 시작점 이동 없음
    await selectOnCanvas(page, target);
    await expect(page.getByTestId(`n5-block-row-${target}`)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => rowInPanel(page, target)).toBe(true);
    expect(await reveals(page)).toEqual([{ target: `n5-block-row-${target}`, block: 'nearest' }]);
    // 아래로 내려온 최소 이동이라 row 는 패널 맨 위(section 시작점)가 아니라 아래쪽에 있다
    const body = await box(page, 'n5-panel-body');
    const row = await box(page, `n5-block-row-${target}`);
    expect(row.y).toBeGreaterThan(body.y + 60);

    // 이미 보이는 같은 section 의 다른 block — 패널이 움직이지 않는다
    await page.waitForTimeout(600);
    const visibleOther = fourth.length > 1 ? fourth[fourth.length - 2] : target;
    if (await rowInPanel(page, visibleOther)) {
      const top = await bodyScrollTop(page);
      await selectOnCanvas(page, visibleOther);
      await page.waitForTimeout(600);
      expect(Math.abs((await bodyScrollTop(page)) - top)).toBeLessThanOrEqual(1);
    }

    // E — 같은 block 을 다시 고르면(선택 값은 같아도) 수동으로 밀어 둔 row 를 다시 보여 준다
    await selectOnCanvas(page, target);
    await expect.poll(() => rowInPanel(page, target)).toBe(true);
    await panelBody(page).evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(100);
    expect(await rowInPanel(page, target)).toBe(false);
    await selectOnCanvas(page, target);
    await expect.poll(() => rowInPanel(page, target)).toBe(true);
  });

  test('F. 패널에서 block row·SectionTag 를 눌러도 패널은 그대로이고, 캔버스가 그 대상을 보인다 · SectionTag sticky', async ({ page }) => {
    const second = await blockIdsOf(page, 2);
    await scrollPanelInto(page, 2, 40);
    const row = page.getByTestId(`n5-block-row-${second[0]}`);
    await row.scrollIntoViewIfNeeded();
    await clearReveals(page);
    const top = await bodyScrollTop(page);
    const panBefore = await canvasPan(page);
    // Playwright 의 click 은 지점이 sticky 태그에 가려지면 스스로 스크롤한다 — 보이는 지점을 마우스로 직접 누른다
    const bodyBox = await box(page, 'n5-panel-body');
    const rowBox = (await row.boundingBox())!;
    await page.mouse.click(rowBox.x + 4, Math.max(rowBox.y, bodyBox.y + 60) + 4);
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(700);
    expect(await reveals(page)).toEqual([]);
    expect(Math.abs((await bodyScrollTop(page)) - top)).toBeLessThanOrEqual(1);
    // 캔버스는 그 block 을 보이게 한다(밖에 있었다면 pan 이 움직인다)
    const overlay = await box(page, `n5-block-overlay-${second[0]}`);
    const viewport = await box(page, 'n5-viewport');
    expect(overlay.y).toBeGreaterThanOrEqual(viewport.y);
    expect(overlay.y).toBeLessThan(viewport.y + viewport.height);
    console.log(`[n5-panel-row-click] canvas pan ${panBefore} → ${await canvasPan(page)}`);

    // SectionTag — 선택만 바뀌고 패널은 그대로
    await page.getByTestId('n5-section-tag-2').click();
    await expect(page.getByTestId('n5-section-tag-2')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(700);
    expect(await reveals(page)).toEqual([]);
    expect(Math.abs((await bodyScrollTop(page)) - top)).toBeLessThanOrEqual(1);

    // Section2 를 보는 동안 Section2 태그가 패널 위에 붙어 있다(Section1 태그는 밀려 올라갔다)
    const body = await box(page, 'n5-panel-body');
    near((await box(page, 'n5-section-tag-sticky-2')).y, body.y);
    expect((await box(page, 'n5-section-tag-sticky-1')).y).toBeLessThan(body.y);
  });
});
