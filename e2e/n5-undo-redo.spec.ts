import { type Page, test, expect } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 실행 취소·다시 실행(F-CFM-03) — 지금은 박스 이동·크기 조절의 local 초안만 대상이다(서버 저장 없음).
// 끌기 한 번(손을 놓을 때까지)이 한 단계이고, 값은 실제 결과 bbox다. 위치: Figma 544:3168 「After」 1512:23333.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

test('Undo/Redo가 캔버스 좌하단에 있고, 이력이 없으면 비활성이다', async ({ page }) => {
  await reachN5(page);

  const undo = page.getByTestId('n5-undo');
  const redo = page.getByTestId('n5-redo');
  for (const [btn, name] of [
    [undo, '실행 취소'],
    [redo, '다시 실행'],
  ] as const) {
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('aria-label', name);
  }
  await expect(page.getByRole('group', { name: '실행 취소·다시 실행' })).toBeVisible();

  // 위치: viewport(캔버스 영역) 왼쪽에서 24px, 아래에서 31px, 48×48 두 칸이 붙어 있다
  const vp = (await page.getByTestId('n5-viewport').boundingBox())!;
  const u = (await undo.boundingBox())!;
  const r = (await redo.boundingBox())!;
  expect(u.width).toBe(48);
  expect(u.height).toBe(48);
  expect(r.width).toBe(48);
  expect(r.height).toBe(48);
  expect(u.x - vp.x).toBe(24);
  expect(vp.y + vp.height - (u.y + u.height)).toBe(31);
  expect(r.x).toBe(u.x + 48);
  expect(r.y).toBe(u.y);
  test.info().annotations.push({
    type: 'measure',
    description: `viewport x=${vp.x} y=${vp.y} w=${vp.width} h=${vp.height} · undo x=${u.x} y=${u.y} · redo x=${r.x} y=${r.y}`,
  });
  await page.screenshot({ path: test.info().outputPath('n5-undo-redo-1920x1080.png') });
});

test('이력이 없을 때 Undo/Redo를 눌러도 선택·배율·이동·보기 모드·작성 중 번역문이 바뀌지 않는다', async ({ page }) => {
  await reachN5(page);

  // 블록 선택 + 번역문 작성 중 상태를 만든다
  const row = page.getByTestId('n5-block-row-9101');
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  const editor = page.getByTestId('n5-block-editor-9101');
  await editor.fill('작성 중인 번역문');

  const canvas = page.getByTestId('n5-canvas');
  const before = {
    zoom: await canvas.getAttribute('data-zoom'),
    panX: await canvas.getAttribute('data-pan-x'),
    panY: await canvas.getAttribute('data-pan-y'),
  };

  for (const id of ['n5-undo', 'n5-redo']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(editor).toHaveValue('작성 중인 번역문');
  await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');
  expect(await canvas.getAttribute('data-zoom')).toBe(before.zoom);
  expect(await canvas.getAttribute('data-pan-x')).toBe(before.panX);
  expect(await canvas.getAttribute('data-pan-y')).toBe(before.panY);
});

test('기존 토글·배율·섹션 선택은 그대로 동작한다', async ({ page }) => {
  await reachN5(page);

  await page.getByTestId('n5-view-mode-original').click();
  await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('n5-view-mode-translated').click();
  await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');

  const canvas = page.getByTestId('n5-canvas');
  const zoomBefore = Number(await canvas.getAttribute('data-zoom'));
  await page.getByTestId('n5-zoom-in').click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(zoomBefore);

  await page.getByTestId('n5-section-tag-1').click();
  await expect(page.getByTestId('n5-section-tag-1')).toHaveAttribute('aria-pressed', 'true');

  await expect(page.getByTestId('n5-undo-redo')).toBeVisible();
});

const BLOCK = 'n5-block-overlay-9102';
type Box = { x: number; y: number; width: number; height: number };
const near = (actual: number, expected: number, tolerance = 1) => expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
const sameBox = (a: Box, b: Box) => {
  for (const key of ['x', 'y', 'width', 'height'] as const) near(a[key], b[key], 0.5);
};

async function dragFrom(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}
const dragHandle = async (page: Page, key: string, dx: number, dy: number) => {
  const h = (await page.getByTestId(`n5-block-handle-${key}`).boundingBox())!;
  await dragFrom(page, h.x + h.width / 2, h.y + h.height / 2, dx, dy);
};
const dragBody = async (page: Page, dx: number, dy: number) => {
  const b = (await page.getByTestId(BLOCK).boundingBox())!;
  await dragFrom(page, b.x + b.width * 0.4, b.y + b.height * 0.6, dx, dy);
};
const current = async (page: Page) => (await page.getByTestId(BLOCK).boundingBox())!;

test.describe('박스 이동·크기 조절 이력', () => {
  test.beforeEach(async ({ page }) => {
    await reachN5(page);
    await page.getByTestId('n5-block-pin-9102').click();
    await expect(page.getByTestId('n5-block-selection')).toBeVisible();
  });

  test('move·resize — 끌기 한 번이 한 단계이고, 새 조작은 다시 실행 영역을 지운다', async ({ page }) => {
    const undo = page.getByTestId('n5-undo');
    const redo = page.getByTestId('n5-redo');
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) writes.push(r.url());
    });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    const start = await current(page);
    await dragHandle(page, 'e', -150, 0);
    const resized = await current(page);
    near(resized.width, start.width - 150);
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();

    await dragBody(page, 40, 30);
    const moved = await current(page);
    near(moved.x, resized.x + 40);

    // 끌기마다 중간 값 없이 한 단계씩 돌아간다
    await undo.click();
    sameBox(await current(page), resized);
    await expect(redo).toBeEnabled();
    await undo.click();
    sameBox(await current(page), start);
    await expect(undo).toBeDisabled();

    await redo.click();
    sameBox(await current(page), resized);
    await redo.click();
    sameBox(await current(page), moved);
    await expect(redo).toBeDisabled();

    // 되돌린 뒤 새 조작 — 다시 실행 영역이 사라진다
    await undo.click();
    await dragBody(page, -20, 10);
    await expect(redo).toBeDisabled();
    await expect(undo).toBeEnabled();

    // 움직이지 않은 클릭은 단계를 만들지 않는다
    const edited = await current(page);
    await page.mouse.click(edited.x + edited.width * 0.4, edited.y + edited.height * 0.6);
    await undo.click();
    sameBox(await current(page), resized);

    expect(writes).toEqual([]);
  });

  test('snap·경계 결과가 그대로 되돌아가고, pointercancel은 단계를 만들지 않는다', async ({ page }) => {
    await dragHandle(page, 'e', -200, 0);
    const before = await current(page);
    const undo = page.getByTestId('n5-undo');
    const redo = page.getByTestId('n5-redo');
    const slice = (await page.getByTestId('n5-slice-translated-501').boundingBox())!;
    const sliceCenter = slice.x + slice.width / 2;

    // 중앙선 근처에서 손을 놓으면 커서가 아니라 붙은 위치가 기록된다
    const c = before.x + before.width / 2;
    await dragBody(page, sliceCenter + 5 - c, 0);
    const snapped = await current(page);
    near(snapped.x + snapped.width / 2, sliceCenter);
    await undo.click();
    sameBox(await current(page), before);
    await redo.click();
    sameBox(await current(page), snapped);

    // 경계까지 넓힌 결과
    const beforeResize = await current(page);
    await dragHandle(page, 'e', 900, 0);
    const clamped = await current(page);
    near(clamped.x + clamped.width, slice.x + slice.width, 1);
    await undo.click();
    sameBox(await current(page), beforeResize);
    await redo.click();
    sameBox(await current(page), clamped);

    // 시스템 취소 — 시작 값으로 돌아가고 단계가 늘지 않는다
    await dragHandle(page, 'e', -100, 0);
    const beforeCancel = await current(page);
    await undo.click();
    await redo.click();
    const b = await current(page);
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.4 + 20, b.y + b.height * 0.6 + 20, { steps: 3 });
    await page.getByTestId(BLOCK).evaluate((el) => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
    await page.mouse.up();
    sameBox(await current(page), beforeCancel);
    await expect(redo).toBeDisabled();
    await undo.click();
    sameBox(await current(page), clamped);
  });

  test('단축키 — 캔버스에서는 동작하고, 입력칸에서는 글자 실행 취소를 가로채지 않는다', async ({ page }) => {
    const start = await current(page);
    await dragHandle(page, 'e', -100, 0);
    const resized = await current(page);

    await page.keyboard.press('ControlOrMeta+z');
    sameBox(await current(page), start);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    sameBox(await current(page), resized);

    const editor = page.getByTestId('n5-block-editor-9102');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+z');
    sameBox(await current(page), resized);

    // 「번역 전」은 조정 화면이 아니라 비활성이다
    await page.getByTestId('n5-view-mode-original').click();
    await expect(page.getByTestId('n5-undo')).toBeDisabled();
    await page.getByTestId('n5-view-mode-translated').click();
    await expect(page.getByTestId('n5-undo')).toBeEnabled();
  });
});
