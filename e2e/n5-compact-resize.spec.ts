import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 낮은 Auto Height block의 compact resize.
// 보이는 높이(preview scale × zoom)가 48 미만이면 오른쪽 손잡이(ne·e·se)는 보이기만 하고, 오른쪽 변 전체가 가로 resize(e) 하나를
// 받는다. 글자크기 손잡이는 Figma 위치(오른쪽 변, 위 +18) 그대로 보이는 12px만 받는다. 손잡이 위치는 어떤 높이에서도 움직이지 않는다.
// 높이는 zoom 입력으로 맞춘다 — 같은 block이라도 사용자가 보는 크기로 판정하는지 함께 본다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '조판 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const BLOCK = 9103; // 502 가격 한 줄 — Auto Height로 한 줄 높이가 된다
const BODY = 9102; // 501 본문 여러 줄 — 좁히면 줄이 늘어 높아진다
const overlayId = (id: number) => `n5-block-overlay-${id}`;
const OVERLAY = overlayId(BLOCK);
type Rect = { x: number; y: number; width: number; height: number };

const box = async (page: Page, testId: string): Promise<Rect> => (await page.getByTestId(testId).boundingBox())!;
const near = (a: number, b: number, label = '', tolerance = 0.6) => expect(Math.abs(a - b), `${label} ${a} ≈ ${b}`).toBeLessThanOrEqual(tolerance);
const centerOf = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const hitAt = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null, [x, y]);
/** section-local 표시 px(zoom 전) */
const canvasBox = (page: Page, id = BLOCK) =>
  page.getByTestId(overlayId(id)).evaluate((el) => {
    const { left, top, width, height } = (el as HTMLElement).style;
    return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) };
  });
const textHeight = (page: Page) =>
  page.locator(`[data-typeset-render="${BLOCK}"]`).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().height;
  });

async function setZoomPercent(page: Page, percent: number) {
  const input = page.getByTestId('n5-zoom-value');
  await input.fill(String(percent));
  await input.press('Enter');
  await expect(page.getByTestId('n5-canvas')).toHaveAttribute('data-zoom', String(percent / 100));
}

/** block을 보이게 맞춘 뒤 보이는 높이가 target이 되도록 zoom을 맞춘다 */
async function showAtHeight(page: Page, target: number, id = BLOCK) {
  const canvasHeight = (await canvasBox(page, id)).height;
  // zoom 입력은 소수 둘째 자리 %까지 받는다. 그 반올림이 경계(48)를 넘지 않게 올림·내림을 고른다
  const raw = (target / canvasHeight) * 100;
  const percent = target >= 48 ? Math.ceil(raw * 100) / 100 : Math.floor(raw * 100) / 100;
  await setZoomPercent(page, percent);
  const overlay = await box(page, overlayId(id));
  near(overlay.height, target, `height ${target}`, 0.6);
  return overlay;
}

async function openQa(page: Page, id = BLOCK) {
  await page.goto(`/jobs/${MOCK_JOB_ID}?qaTypeset=1`);
  await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`n5-block-pin-${id}`).click();
  await expect(page.getByTestId('n5-block-selection')).toHaveAttribute('data-auto-height', 'true');
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, hold?: () => Promise<void>) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  await hold?.();
  await page.mouse.up();
}

test.describe('compact resize', () => {
  for (const target of [60, 50, 48, 47, 36, 24, 14]) {
    const compact = target < 48;
    test(`보이는 높이 ${target} — ${compact ? 'compact' : '기존 방식'}이고 손잡이 위치는 Figma 그대로다`, async ({ page }) => {
      await openQa(page);
      const overlay = await showAtHeight(page, target);
      const selection = page.getByTestId('n5-block-selection');
      await expect(selection).toHaveAttribute('data-resize-mode', compact ? 'compact' : 'normal');

      // 보이는 위치 — 높이와 무관
      const right = overlay.x + overlay.width;
      const font = centerOf(await box(page, 'n5-font-scale-handle'));
      near(font.x, right, 'font x');
      near(font.y, overlay.y + 18, 'font y');
      const fontBox = await box(page, 'n5-font-scale-handle');
      near(fontBox.width, 12, 'font size', 0.1);
      for (const [key, fy] of [['ne', 0], ['e', 0.5], ['se', 1]] as const) {
        const c = centerOf(await box(page, `n5-block-handle-${key}`));
        near(c.x, right, `${key} x`);
        near(c.y, overlay.y + overlay.height * fy, `${key} y`);
      }

      // 글자크기 손잡이의 보이는 영역은 항상 글자크기다
      expect(await hitAt(page, font.x, font.y)).toBe('n5-font-scale-handle');

      const zone = page.getByTestId('n5-block-resize-zone-right');
      if (!compact) {
        await expect(zone).toHaveCount(0);
        await expect(page.getByTestId('n5-block-handle-e')).toHaveCSS('pointer-events', 'auto');
        return;
      }
      for (const key of ['ne', 'e', 'se']) await expect(page.getByTestId(`n5-block-handle-${key}`)).toHaveCSS('pointer-events', 'none');
      await expect(zone).toHaveCSS('cursor', 'ew-resize');
      // 오른쪽 변 위의 글자크기 손잡이 바깥은 어디든 resize 영역이다(e냐 se냐가 갈리지 않는다).
      // zoom이 1이 아니면 브라우저가 12px 손잡이를 화면 px에 맞춰 그려 1px 안팎 어긋난다 — 손잡이 가장자리에서 1.5px 떨어진 곳부터 본다
      const ys = [overlay.y + 1, overlay.y + overlay.height - 1, overlay.y - 6, overlay.y + overlay.height + 6, font.y - 8, font.y + 8].filter(
        (y) => Math.abs(y - font.y) >= 7.5 && y > overlay.y - 8 && y < overlay.y + overlay.height + 8,
      );
      expect(ys.length).toBeGreaterThan(0);
      for (const y of ys) for (const dx of [-6, 0, 6]) expect(await hitAt(page, right + dx, y), `zone ${target} y=${y - overlay.y} dx=${dx}`).toBe('n5-block-resize-zone-right');
      await page.screenshot({ path: test.info().outputPath(`compact-${target}.png`) });

      // 끌기 — 세로로 크게 움직여도 폭만 바뀌고 윗변·왼쪽은 그대로, 높이는 줄바꿈 결과다
      const zoom = Number(await page.getByTestId('n5-canvas').getAttribute('data-zoom'));
      const start = await canvasBox(page);
      const grab = { x: right + 3, y: ys[0] };
      await drag(page, grab, 40, 30);
      const wider = await canvasBox(page);
      near(wider.width * zoom, start.width * zoom + 40, 'wider width', 1);
      near(wider.left, start.left, 'left', 0.05);
      near(wider.top, start.top, 'top', 0.05);
      near(wider.height * zoom, await textHeight(page), 'auto height', 1);

      // 한 번 끌기 = 한 단계
      await page.getByTestId('n5-undo').click();
      const undone = await canvasBox(page);
      for (const key of ['left', 'top', 'width', 'height'] as const) near(undone[key], start[key], `undo ${key}`, 0.02);
      await expect(page.getByTestId('n5-undo')).toBeDisabled();

      // 글자크기 손잡이는 열고 닫는다
      await page.mouse.click(font.x, font.y);
      await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
      await page.mouse.click(font.x, font.y);
      await expect(page.getByTestId('n5-font-scale-toolbar')).toHaveCount(0);
    });
  }

  test('36 — 글자크기 손잡이와 e 중심이 같아도 손잡이는 툴바, 그 위·아래 오른쪽 변은 폭 조절이다', async ({ page }) => {
    await openQa(page);
    const overlay = await showAtHeight(page, 36);
    const font = centerOf(await box(page, 'n5-font-scale-handle'));
    const e = centerOf(await box(page, 'n5-block-handle-e'));
    near(font.y, e.y, 'same center', 0.6);
    const right = overlay.x + overlay.width;
    const zoom = Number(await page.getByTestId('n5-canvas').getAttribute('data-zoom'));
    for (const y of [font.y - 9, font.y + 9]) {
      const start = await canvasBox(page);
      await drag(page, { x: right, y }, -20, 0);
      near((await canvasBox(page)).width * zoom, start.width * zoom - 20, `edge ${y - overlay.y}`, 1);
      await page.getByTestId('n5-undo').click();
    }
    await page.mouse.click(font.x, font.y);
    await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
  });

  test('끄는 중 높이가 48을 넘어도 시작한 compact 조작이 손을 놓을 때까지 이어진다', async ({ page }) => {
    await openQa(page, BODY);
    // 넓혀 줄 수를 줄인 뒤 낮게 보이도록 축소한다
    const body = await box(page, overlayId(BODY));
    await drag(page, { x: body.x + body.width + 3, y: body.y + body.height / 2 }, 300, 0);
    await page.getByTestId('n5-undo').waitFor();
    const overlay = await showAtHeight(page, 40, BODY);
    const zoom = Number(await page.getByTestId('n5-canvas').getAttribute('data-zoom'));
    const start = await canvasBox(page, BODY);
    const selection = page.getByTestId('n5-block-selection');
    let duringMode: string | null = null;
    let duringHeight = 0;
    // 크게 좁혀 줄 수를 늘린다 → 보이는 높이가 48을 넘는다
    await drag(page, { x: overlay.x + overlay.width, y: overlay.y + 2 }, -(overlay.width * 0.7), 0, async () => {
      duringMode = await selection.getAttribute('data-resize-mode');
      duringHeight = (await canvasBox(page, BODY)).height * zoom;
    });
    expect(duringHeight).toBeGreaterThanOrEqual(48);
    expect(duringMode).toBe('compact');
    const narrow = await canvasBox(page, BODY);
    near(narrow.width * zoom, start.width * zoom - overlay.width * 0.7, 'narrow width', 1);
    near(narrow.top, start.top, 'top', 0.05);
    // 손을 놓으면 보이는 높이로 다시 판정한다
    await expect(selection).toHaveAttribute('data-resize-mode', 'normal');
    await expect(page.getByTestId('n5-block-resize-zone-right')).toHaveCount(0);

    await page.getByTestId('n5-undo').click();
    const undone = await canvasBox(page, BODY);
    for (const key of ['left', 'top', 'width', 'height'] as const) near(undone[key], start[key], `undo ${key}`, 0.02);
    await expect(selection).toHaveAttribute('data-resize-mode', 'compact');
    await page.getByTestId('n5-redo').click();
    const redone = await canvasBox(page, BODY);
    for (const key of ['left', 'top', 'width', 'height'] as const) near(redone[key], narrow[key], `redo ${key}`, 0.02);
  });

  test('section 오른쪽 경계에서 멈춘다', async ({ page }) => {
    await openQa(page);
    const overlay = await showAtHeight(page, 30);
    await drag(page, { x: overlay.x + overlay.width, y: overlay.y + 2 }, 3000, 0);
    const slice = await box(page, 'n5-slice-translated-502');
    const now = await box(page, OVERLAY);
    near(now.x + now.width, slice.x + slice.width, 'right', 1.5);
    near(now.x, overlay.x, 'left', 1);
  });
});
