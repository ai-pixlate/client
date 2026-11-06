import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 Figma 재정합(544:3168) — shell·canvas·패널 geometry, 선택 block UI(1512:23496),
// 글자크기 action handle과 툴바(저장 계약 없음), 패널 목록·저장 버튼 분리.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;
const near = (actual: number, expected: number, tolerance = 2) => expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);

test.beforeEach(async ({ page }) => {
  await reachN5(page);
  await expect(page.getByTestId('n5-viewport')).toBeVisible();
});

test('1920×1080 — 핵심 container가 Figma 좌표에 있다', async ({ page }) => {
  const exit = (await page.getByRole('button', { name: '작업 취소' }).boundingBox())!;
  expect([exit.x, exit.y, exit.width, exit.height]).toEqual([40, 40, 40, 40]);

  const stepNav = (await page.getByText('정보 입력', { exact: true }).boundingBox())!;
  near(stepNav.x + stepNav.width / 2, 58);

  const workspace = await box(page, 'n5-viewport');
  expect([workspace.x, workspace.y, workspace.width, workspace.height]).toEqual([120, 0, 1255, 1080]);

  const panel = await box(page, 'n5-panel');
  near(panel.x, 1427, 1);
  near(panel.width, 433, 1);

  const save = await box(page, 'n5-confirm-button');
  near(save.x, 1428);
  expect([save.y, save.height]).toEqual([955, 45]);
  near(save.width, 433, 1);

  const undo = await box(page, 'n5-undo-redo');
  expect([undo.x, undo.y, undo.width, undo.height]).toEqual([144, 1001, 96, 48]);

  const zoom = await box(page, 'n5-zoom-controls');
  near(zoom.x + zoom.width, 1347, 1);
  near(zoom.y, 20, 1);
  near(zoom.height, 14, 1);

  // Figma에 없는 하단 중앙 도구는 없고, 좌측 하단 도구만 남는다
  await expect(page.getByTestId('n5-placement-toolbar')).toHaveCount(0);
  for (const id of ['n5-tool-text', 'n5-tool-section', 'n5-tool-delete']) await expect(page.getByTestId(id)).toHaveCount(0);

  // 데이터 scale은 그대로 두고 시작 위치만 Figma(y156)에 맞춘다
  const canvas = await box(page, 'n5-canvas');
  expect(canvas.y).toBe(156);
  expect(canvas.width).toBe(400);
  await expect(page.getByTestId('n5-canvas')).toHaveAttribute('data-zoom', '1');
  near(canvas.x + canvas.width / 2, workspace.x + workspace.width / 2, 1);
  await page.screenshot({ path: test.info().outputPath('n5-1920x1080.png') });
});

test('상단 정보는 실제 Job 값이고 Figma 위치에 있다', async ({ page }) => {
  const meta = page.getByTestId('n5-job-meta');
  await expect(meta).toContainText('미국');
  await expect(meta).toContainText('화장품');
  await expect(meta).not.toContainText('OTC');
  await expect(meta).not.toContainText('선크림');
  const rect = await box(page, 'n5-job-meta');
  expect([rect.x, rect.y]).toEqual([152, 46]);
});

test('선택 block은 테두리·번호·핸들 8개·action handle을 보이고, 다른 block을 고르면 옮겨 간다', async ({ page }) => {
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(0);
  await page.getByTestId('n5-block-pin-9112').click();

  await expect(page.getByTestId('n5-block-overlay-9112')).toHaveCSS('border-top-color', 'rgb(255, 106, 56)');
  await expect(page.getByTestId('n5-block-pin-9112').locator('span')).toHaveCSS('background-color', 'rgb(255, 106, 56)');
  const handles = page.locator('[data-testid^="n5-block-handle-"]');
  await expect(handles).toHaveCount(8);
  const overlay = await box(page, 'n5-block-overlay-9112');
  const nw = await box(page, 'n5-block-handle-nw');
  const se = await box(page, 'n5-block-handle-se');
  near(nw.x + nw.width / 2, overlay.x, 1);
  near(se.y + se.height / 2, overlay.y + overlay.height, 1);
  near(nw.width, 7.667, 0.5);

  // action handle은 block 높이와 무관하게 오른쪽 변 위, block 위에서 18(Figma 1512:23496). 툴바는 눌러야 열린다
  const handle = await box(page, 'n5-font-scale-handle');
  expect([handle.width, handle.height]).toEqual([12, 12]);
  near(handle.x + 6, overlay.x + overlay.width, 1);
  near(handle.y + 6, overlay.y + 18, 1);
  await expect(page.getByTestId('n5-font-scale-toolbar')).toHaveCount(0);

  // 번호 배지가 왼쪽 위 핸들보다 위에 그려지고, 잡기는 핸들이 받는다
  const pin = page.getByTestId('n5-block-pin-9112');
  const pinZ = Number(await pin.evaluate((el) => getComputedStyle(el).zIndex));
  const handleZ = Number(await page.getByTestId('n5-block-handle-nw').evaluate((el) => getComputedStyle(el).zIndex));
  expect(pinZ).toBeGreaterThan(handleZ);
  await expect(pin).toHaveCSS('pointer-events', 'none');

  const firstHandle = await box(page, 'n5-block-handle-nw');
  await page.getByTestId('n5-block-pin-9103').click();
  await expect(handles).toHaveCount(8);
  expect((await box(page, 'n5-block-handle-nw')).y).not.toBe(firstHandle.y);
});

test('글자크기 버튼은 서버 요청 없이 동작하고 선택이 풀리지 않는다', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) writes.push(`${r.method()} ${r.url()}`);
  });
  await page.getByTestId('n5-block-pin-9112').click();
  await page.getByTestId('n5-font-scale-handle').click();
  for (const id of ['n5-font-scale-increase', 'n5-font-scale-decrease']) {
    await expect(page.getByTestId(id)).toBeEnabled();
    await expect(page.getByTestId(id)).not.toHaveAttribute('title');
    await page.getByTestId(id).click();
  }
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(1);
  await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
  expect(writes).toEqual([]);
});

test('글자크기 툴바 — 선택 직후 닫혀 있고 handle로 여닫으며, 다른 block을 고르면 닫힌다', async ({ page }) => {
  const toolbar = page.getByTestId('n5-font-scale-toolbar');
  const handle = page.getByTestId('n5-font-scale-handle');
  await page.getByTestId('n5-block-pin-9112').click();
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await expect(toolbar).toHaveCount(0);

  await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect(toolbar).toContainText('글자크기');
  const button = await box(page, 'n5-font-scale-increase');
  expect([button.width, button.height]).toEqual([28, 28]);
  const rect = await box(page, 'n5-font-scale-toolbar');
  expect([Math.round(rect.width), Math.round(rect.height)]).toEqual([119, 38]);
  await page.screenshot({ path: test.info().outputPath('n5-font-toolbar-open.png') });

  await handle.click();
  await expect(toolbar).toHaveCount(0);

  // 키보드도 같은 동작이다(Space는 pan 키와 겹치지 않아야 한다)
  await handle.focus();
  await page.keyboard.press('Enter');
  await expect(toolbar).toBeVisible();
  await page.keyboard.press('Space');
  await expect(toolbar).toHaveCount(0);

  // 다른 block으로 옮기면 닫히고, 원래 block으로 돌아와도 닫힌 채다
  await handle.click();
  await expect(toolbar).toBeVisible();
  await page.getByTestId('n5-block-pin-9103').click();
  await expect(page.getByTestId('n5-block-overlay-9103')).toHaveCSS('border-top-color', 'rgb(255, 106, 56)');
  await expect(toolbar).toHaveCount(0);
  await page.getByTestId('n5-block-pin-9112').click();
  await expect(page.getByTestId('n5-block-overlay-9112')).toHaveCSS('border-top-color', 'rgb(255, 106, 56)');
  await expect(toolbar).toHaveCount(0);
});

test('handle과 툴바를 눌러도 선택이 바뀌지 않고 section이 선택되지 않는다', async ({ page }) => {
  await page.getByTestId('n5-block-pin-9112').click();
  const before = await page.getByTestId('n5-section-selected-tag').textContent();
  await page.getByTestId('n5-font-scale-handle').click();
  const toolbar = await box(page, 'n5-font-scale-toolbar');
  await page.mouse.click(toolbar.x + 20, toolbar.y + 19);
  await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
  await expect(page.getByTestId('n5-block-overlay-9112')).toHaveCSS('border-top-color', 'rgb(255, 106, 56)');
  await expect(page.getByTestId('n5-section-selected-tag')).toHaveText(before!);
});

test('section 오른쪽 끝 block — 툴바가 section 밖 오른쪽에 그대로 뜨고 잘리지 않는다', async ({ page }) => {
  // 폭이 넓어 예전에는 아래로 옮겨 붙던 block
  await page.getByTestId('n5-block-pin-9102').click();
  await page.getByTestId('n5-font-scale-handle').click();
  const overlay = await box(page, 'n5-block-overlay-9102');
  const canvas = await box(page, 'n5-canvas');
  const rect = await box(page, 'n5-font-scale-toolbar');
  near(rect.x, overlay.x + overlay.width + 25, 1);
  near(rect.y, overlay.y - 1, 1);
  expect(rect.x + rect.width).toBeGreaterThan(canvas.x + canvas.width);

  // 실제로 그 자리에서 눌리는지(잘리거나 다른 요소에 가리지 않는지)와 화면 캡처
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="n5-font-scale-toolbar"]') !== null,
    [rect.x + rect.width - 6, rect.y + rect.height / 2],
  );
  expect(hit).toBe(true);
  await page.screenshot({ path: test.info().outputPath('n5-font-toolbar-overflow.png') });
});

test('높은 block의 action handle은 Figma 1512:23496대로 block 위에서 18이다', async ({ page }) => {
  await page.getByTestId('n5-block-pin-9102').click();
  const overlay = await box(page, 'n5-block-overlay-9102');
  const handle = await box(page, 'n5-font-scale-handle');
  expect(overlay.height).toBeGreaterThanOrEqual(68);
  near(handle.x + 6, overlay.x + overlay.width, 1);
  near(handle.y + 6, overlay.y + 18, 1);
});

test('zoom·pan — 툴바가 block과 함께 움직이고 화면 크기는 그대로다', async ({ page }) => {
  await page.getByTestId('n5-block-pin-9112').click();
  await page.getByTestId('n5-font-scale-handle').click();
  const relative = async () => {
    const overlay = await box(page, 'n5-block-overlay-9112');
    const rect = await box(page, 'n5-font-scale-toolbar');
    const handle = await box(page, 'n5-font-scale-handle');
    return { rect, overlay, dx: rect.x - (overlay.x + overlay.width), dy: rect.y - overlay.y, handleY: handle.y + 6 - overlay.y };
  };
  const start = await relative();

  await page.getByTestId('n5-zoom-in').click();
  await expect(page.getByTestId('n5-canvas')).not.toHaveAttribute('data-zoom', '1');
  const zoomed = await relative();
  expect(zoomed.overlay.width).toBeGreaterThan(start.overlay.width);
  near(zoomed.dx, 25, 1);
  near(zoomed.dy, -1, 1);
  near(zoomed.handleY, 18, 1);
  near(zoomed.rect.width, 119, 1);
  near(zoomed.rect.height, 38, 1);

  const viewport = await box(page, 'n5-viewport');
  await page.mouse.move(viewport.x + 200, viewport.y + 400);
  await page.mouse.wheel(0, 80);
  await expect.poll(async () => (await relative()).rect.y).not.toBe(zoomed.rect.y);
  const panned = await relative();
  near(panned.dx, 25, 1);
  near(panned.dy, -1, 1);
  near(panned.overlay.y - zoomed.overlay.y, panned.rect.y - zoomed.rect.y, 1);
});

test('workspace 오른쪽 끝 — 필요한 만큼만 왼쪽으로 밀고 뒤집지 않으며, handle로 닫을 수 있다', async ({ page }) => {
  await page.getByTestId('n5-block-pin-9102').click();
  const viewport = await box(page, 'n5-viewport');
  const limit = viewport.x + viewport.width - 24;
  await page.getByTestId('n5-font-scale-handle').click();
  const zoomUntil = async (reached: (blockRight: number) => boolean) => {
    for (let i = 0; i < 30; i += 1) {
      const current = await box(page, 'n5-block-overlay-9102');
      if (reached(current.x + current.width)) return;
      await page.getByTestId('n5-zoom-in').click();
      await expect.poll(async () => (await box(page, 'n5-block-overlay-9102')).width).toBeGreaterThan(current.width);
    }
    throw new Error('배율을 올려도 block 오른쪽 변이 목표 위치에 닿지 않았다');
  };

  // 화면 중심 기준으로 확대하면 block이 위로 밀려나므로 세로로 다시 데려온다
  const bringBlockIntoView = async () => {
    const before = await box(page, 'n5-block-overlay-9102');
    await page.mouse.move(viewport.x + 100, viewport.y + 500);
    await page.mouse.wheel(0, before.y - (viewport.y + 400));
    await expect.poll(async () => Math.abs((await box(page, 'n5-font-scale-handle')).y - (viewport.y + 400))).toBeLessThan(100);
  };

  // 배율을 올려 block 오른쪽 변을 workspace 끝 쪽으로 보낸다 — 넘는 만큼만 민다
  await zoomUntil((blockRight) => blockRight + 25 + 119 > limit);
  await bringBlockIntoView();
  const overlay = await box(page, 'n5-block-overlay-9102');
  const rect = await box(page, 'n5-font-scale-toolbar');
  near(rect.x + rect.width, limit, 1);
  near(rect.y, overlay.y - 1, 1);
  expect(rect.x).toBeGreaterThan(overlay.x + overlay.width);
  await page.screenshot({ path: test.info().outputPath('n5-font-toolbar-clamped.png') });

  // 더 올려 툴바가 handle과 겹쳐도 workspace 안에 있고, handle이 위에 남아 닫을 수 있다
  await zoomUntil((blockRight) => blockRight > limit - 119 + 6);
  await bringBlockIntoView();
  const covered = await box(page, 'n5-block-overlay-9102');
  expect(covered.x + covered.width).toBeLessThan(limit);
  near((await box(page, 'n5-font-scale-toolbar')).x + 119, limit, 1);
  await page.screenshot({ path: test.info().outputPath('n5-font-toolbar-covered.png') });
  await page.getByTestId('n5-font-scale-handle').click();
  await expect(page.getByTestId('n5-font-scale-toolbar')).toHaveCount(0);
});

test('선택한 section 태그는 section 바로 위에 뜨고 canvas 크기를 바꾸지 않는다', async ({ page }) => {
  const before = await box(page, 'n5-canvas');
  await page.getByTestId('n5-section-tag-1').click();
  const tag = await box(page, 'n5-section-selected-tag');
  const slice = await box(page, 'n5-slice-translated-501');
  near(tag.y + tag.height, slice.y - 4, 1);
  expect(tag.x).toBe(slice.x);
  expect(await box(page, 'n5-canvas')).toEqual(before);
});

test('토글 전환에도 zoom·pan·선택이 유지되고 화면 구조가 그대로다', async ({ page }) => {
  await page.getByTestId('n5-zoom-in').click();
  await page.getByTestId('n5-block-pin-9112').click();
  const canvas = page.getByTestId('n5-canvas');
  const before = [await canvas.getAttribute('data-zoom'), await canvas.getAttribute('data-pan-x'), await canvas.getAttribute('data-pan-y')];
  const translated = await box(page, 'n5-view-mode-translated');
  expect([translated.width, translated.height]).toEqual([74, 30]);

  await page.getByTestId('n5-view-mode-original').click();
  await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
  expect([await canvas.getAttribute('data-zoom'), await canvas.getAttribute('data-pan-x'), await canvas.getAttribute('data-pan-y')]).toEqual(before);
  // 선택은 유지되고, 조정 UI는 「번역 후」 화면에만 있다(F-CFM-15)
  await expect(page.getByTestId('n5-block-overlay-9112')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(0);
  await page.getByTestId('n5-view-mode-translated').click();
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(1);
});

test('우측 패널 위계 — 목록만 스크롤하고 저장 버튼은 하단에 남으며 내용 폭은 433이다', async ({ page }) => {
  const panel = page.getByTestId('n5-panel');
  for (const text of ['번역 결과', '직접 수정하기', '번역문', '번역근거']) await expect(panel.getByText(text, { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('n5-section-tag-1')).toBeVisible();
  await expect(page.getByTestId('n5-block-save-9101')).toHaveText('확인');

  const tag = await box(page, 'n5-section-tag-1');
  near(tag.y, 130, 1);
  const editor = page.getByTestId('n5-block-editor-9101');
  const card = (await editor.locator('xpath=..').boundingBox())!;
  near(card.width, 433, 1);
  near(card.x, 1427, 1);
  const save = await box(page, 'n5-block-save-9101');
  near(save.height, 24, 1);
  near(save.x + save.width, card.x + card.width - 20, 1);
  await expect(page.getByTestId('n5-block-source-reference').first()).toHaveText('순수 비타민 C 세럼');

  const body = page.getByTestId('n5-panel-body');
  const metrics = await body.evaluate((el) => ({ overflow: el.scrollHeight > el.clientHeight, sideways: el.scrollWidth > el.clientWidth }));
  expect(metrics).toEqual({ overflow: true, sideways: false });
  const confirmBefore = await box(page, 'n5-confirm-button');
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await box(page, 'n5-confirm-button')).toEqual(confirmBefore);
  // 끝까지 내리면 마지막 블록이 페이드에 가려지지 않고 번역근거 박스까지 보인다
  const lastBox = (await page.getByTestId('n5-panel-fade').boundingBox())!;
  const lastEvidence = (await panel.getByText('번역근거', { exact: true }).last().boundingBox())!;
  expect(lastEvidence.y + lastEvidence.height).toBeLessThanOrEqual(lastBox.y + 1);
});

for (const size of [
  { width: 1512, height: 860 },
  { width: 1440, height: 800 },
]) {
  test(`${size.width}×${size.height} — 도구와 저장 버튼이 잘리지 않는다`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const id of ['n5-undo-redo', 'n5-zoom-controls', 'n5-confirm-button', 'n5-job-meta']) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const tag = page.getByTestId('n5-section-tag-1');
    await tag.click();
    await expect(page.getByTestId('n5-section-selected-tag')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: test.info().outputPath(`n5-${size.width}.png`) });
  });
}
