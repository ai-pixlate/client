import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { useLocalLayoutEditing } from './helpers/layout-write';

// ─────────────────────────────────────────────────────────────────
// F-CFM-15 배치 영역 조정(「번역 후」 화면) — 손잡이 8방향은 크기만, 본체 끌기는 위치만 바꾼다.
// 둘 다 자기 section 밖으로 나가지 못하고, 다른 block과 겹치는 것은 막지 않는다. 옮길 때만 가운데선에 붙는다.
// 이 세션의 local 초안이며 서버 쓰기는 없다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

// 박스·배율은 세션 local 편집만 본다 — Mock 에서도 layoutAdjust 쓰기를 끈다(실서버 쓰기 차단과 같은 동작). 저장 흐름은 n5-layout-adjust.spec.ts
test.beforeEach(async ({ page }) => {
  await useLocalLayoutEditing(page);
});

const BLOCK_ID = 9102;
const BLOCK = `n5-block-overlay-${BLOCK_ID}`;
const SLICE = 'n5-slice-translated-501';
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;
const near = (actual: number, expected: number, tolerance = 1.5) => expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);

async function dragPoint(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  await page.mouse.up();
}

async function dragHandle(page: Page, handle: string, dx: number, dy: number) {
  const h = await box(page, `n5-block-handle-${handle}`);
  // 오른쪽 변 손잡이는 낮은 block에서 action handle과 겹친다 — 그 옆을 잡는다(누르는 영역 안)
  await dragPoint(page, { x: h.x + h.width / 2 + (handle.includes('e') ? 6.5 : 0), y: h.y + h.height / 2 }, dx, dy);
}

/** block 안쪽(왼쪽 위 손잡이·번호와 오른쪽 action handle을 피한 지점)을 잡아 끈다 */
async function dragBody(page: Page, dx: number, dy: number, id = BLOCK) {
  const b = await box(page, id);
  await dragPoint(page, { x: b.x + b.width * 0.4, y: b.y + b.height * 0.6 }, dx, dy);
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** section 영역 */
const inner = (s: { x: number; y: number; width: number; height: number }) => ({
  left: s.x,
  top: s.y,
  right: s.x + s.width,
  bottom: s.y + s.height,
});

const collectWrites = (page: Page) => {
  const list: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) list.push(`${r.method()} ${r.url()}`);
  });
  return list;
};

test.beforeEach(async ({ page }) => {
  await reachN5(page);
  await page.getByTestId(`n5-block-pin-${BLOCK_ID}`).click();
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();
});

// 글이 있는 block의 Auto Height 는 e2e/n5-auto-height.spec.ts 에서 본다. 여기는 글이 비어 잴 수 없는 block의 자유 조절이다
const useFreeResize = async (page: Page) => {
  await page.getByTestId(`n5-block-editor-${BLOCK_ID}`).fill('');
  await expect(page.getByTestId('n5-block-selection')).toHaveAttribute('data-auto-height', 'false');
};

test('resize — 방향별로 크기만 바뀌고 서버 요청이 없다', async ({ page }) => {
  await useFreeResize(page);
  const sent = collectWrites(page);
  const start = await box(page, BLOCK);

  await dragHandle(page, 'e', -40, 30);
  let now = await box(page, BLOCK);
  near(now.width, start.width - 40);
  near(now.height, start.height);
  near(now.x, start.x);

  await dragHandle(page, 's', 30, 25);
  now = await box(page, BLOCK);
  near(now.height, start.height + 25);
  near(now.width, start.width - 40);

  const beforeNw = await box(page, BLOCK);
  await dragHandle(page, 'nw', 12, 8);
  now = await box(page, BLOCK);
  near(now.x, beforeNw.x + 12);
  near(now.y, beforeNw.y + 8);
  near(now.width, beforeNw.width - 12);
  near(now.height, beforeNw.height - 8);

  // 가운데 근처로 끝나도 resize에는 snap이 없다
  const slice = inner(await box(page, SLICE));
  const beforeSe = await box(page, BLOCK);
  await dragHandle(page, 'se', 15, 10);
  now = await box(page, BLOCK);
  near(now.width, beforeSe.width + 15);
  near(now.height, beforeSe.height + 10);
  near(now.x, beforeSe.x);
  near(now.y, beforeSe.y);
  expect(slice.right).toBeGreaterThan(now.x + now.width);

  await expect(page.getByTestId(`n5-block-row-${BLOCK_ID}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-font-scale-toolbar')).toHaveCount(0);
  expect(sent).toEqual([]);
});

test('resize boundary — 네 방향과 모서리 모두 section 경계에서 멈춘다', async ({ page }) => {
  await useFreeResize(page);
  const slice = inner(await box(page, SLICE));

  await dragHandle(page, 'e', 300, 0);
  near((await box(page, BLOCK)).x + (await box(page, BLOCK)).width, slice.right, 2);

  await dragHandle(page, 'w', -300, 0);
  near((await box(page, BLOCK)).x, slice.left, 2);

  await dragHandle(page, 'n', 0, -600);
  near((await box(page, BLOCK)).y, slice.top, 2);

  await dragHandle(page, 's', 0, 900);
  const b = await box(page, BLOCK);
  near(b.y + b.height, slice.bottom, 2);

  // 모서리 — 한 번에 두 경계
  await dragHandle(page, 'nw', 100, 100);
  await dragHandle(page, 'nw', -500, -500);
  const corner = await box(page, BLOCK);
  near(corner.x, slice.left, 2);
  near(corner.y, slice.top, 2);

  // 반대 변을 훨씬 넘겨도 뒤집히지 않는다
  await dragHandle(page, 'e', -2000, 0);
  await dragHandle(page, 's', 0, -2000);
  const flat = await box(page, BLOCK);
  expect(flat.width).toBeGreaterThan(0);
  expect(flat.height).toBeGreaterThan(0);
  near(flat.x, slice.left, 2);
});

test('move — 위치만 바뀌고, section 밖으로 못 나가며, 다른 block과는 겹친다', async ({ page }) => {
  const sent = collectWrites(page);
  await page.getByTestId('n5-font-scale-handle').click();
  const start = await box(page, BLOCK);

  await dragBody(page, 25, 30);
  const moved = await box(page, BLOCK);
  near(moved.x, start.x + 25);
  near(moved.y, start.y + 30);
  near(moved.width, start.width);
  near(moved.height, start.height);

  // 번호·손잡이·action handle·열린 툴바가 따라온다. 선택은 유지되고 툴바도 닫히지 않는다
  const pin = await box(page, `n5-block-pin-${BLOCK_ID}`);
  near(pin.x, moved.x - 8, 2);
  near(pin.y, moved.y - 8, 2);
  const se = await box(page, 'n5-block-handle-se');
  near(se.x + se.width / 2, moved.x + moved.width);
  near(se.y + se.height / 2, moved.y + moved.height);
  const action = await box(page, 'n5-font-scale-handle');
  near(action.x + 6, moved.x + moved.width);
  near(action.y + 6, moved.y + 18);
  const toolbar = await box(page, 'n5-font-scale-toolbar');
  near(toolbar.x, moved.x + moved.width + 25);
  near(toolbar.y, moved.y - 1);
  await expect(page.getByTestId(`n5-block-row-${BLOCK_ID}`)).toHaveAttribute('aria-pressed', 'true');

  // 다른 block(9101, 바로 위) 위로 옮겨도 그대로 겹친다
  const other = await box(page, 'n5-block-overlay-9101');
  const before = await box(page, BLOCK);
  await dragBody(page, 0, other.y - before.y + 5);
  const overlapped = await box(page, BLOCK);
  near(overlapped.y, other.y + 5, 1.5);
  expect(overlapped.y).toBeLessThan(other.y + other.height);
  near((await box(page, 'n5-block-overlay-9101')).y, other.y, 0.5);

  // 아래 section 쪽으로 끌어도 자기 section 끝에서 멈춘다
  const slice = inner(await box(page, SLICE));
  await dragBody(page, 0, 1500);
  let b = await box(page, BLOCK);
  near(b.y + b.height, slice.bottom, 2);
  near(b.height, start.height);
  await dragBody(page, 900, 0);
  b = await box(page, BLOCK);
  near(b.x + b.width, slice.right, 2);
  await dragBody(page, -900, -900);
  b = await box(page, BLOCK);
  near(b.x, slice.left, 2);
  near(b.y, slice.top, 2);
  near(b.width, start.width);

  expect(sent).toEqual([]);
});

test('click과 drag — 누르면 선택, 끌면 선택하며 옮기고, pointercancel은 되돌린다', async ({ page }) => {
  // 폭이 section 대부분이라 먼저 줄여 움직일 자리를 만든다
  await dragHandle(page, 'e', -150, 0);

  const other = 'n5-block-overlay-9101';

  // 짧은 클릭은 선택만 한다
  const first = await box(page, other);
  await page.mouse.click(first.x + first.width * 0.4, first.y + first.height * 0.6);
  await expect(page.getByTestId('n5-block-row-9101')).toHaveAttribute('aria-pressed', 'true');
  const clicked = await box(page, other);
  near(clicked.x, first.x, 0.5);
  near(clicked.y, first.y, 0.5);

  // 선택되지 않은 block을 끌면 선택되면서 옮겨진다
  await dragBody(page, 20, 15);
  await expect(page.getByTestId(`n5-block-row-${BLOCK_ID}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-section-selected-tag')).toHaveText('Section1');

  // 끌기 뒤 따라오는 click이 section 선택으로 번지지 않는다
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();

  // 시스템 취소 — 시작 위치로 돌아간다
  const start = await box(page, BLOCK);
  await page.mouse.move(start.x + start.width * 0.4, start.y + start.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width * 0.4 + 40, start.y + start.height * 0.6 + 20, { steps: 3 });
  near((await box(page, BLOCK)).x, start.x + 40, 2);
  await page.getByTestId(BLOCK).evaluate((el) => {
    el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
  });
  const restored = await box(page, BLOCK);
  near(restored.x, start.x, 0.5);
  near(restored.y, start.y, 0.5);
  await page.mouse.up();

  // 「번역 전」은 조정 화면이 아니다 — 원본 bbox를 보이고 손잡이·끌기가 없으며, 돌아오면 초안이 남아 있다
  const edited = await box(page, BLOCK);
  await page.getByRole('button', { name: '번역 전' }).click();
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(0);
  await expect(page.getByTestId(BLOCK)).toHaveAttribute('aria-pressed', 'true');
  const originalBox = await box(page, BLOCK);
  expect(originalBox.width).toBeGreaterThan(edited.width + 100);
  await dragBody(page, 30, 30);
  near((await box(page, BLOCK)).x, originalBox.x, 0.5);
  await page.getByRole('button', { name: '번역 후' }).click();
  near((await box(page, BLOCK)).x, edited.x, 0.5);
  near((await box(page, BLOCK)).width, edited.width, 0.5);
});

test('center snap(실제 mouse) — 화면 중심이 1px 안으로 맞고, 유지·해제·guide·X/Y 독립이 동작한다', async ({ page }) => {
  // 폭이 section 대부분이라 먼저 줄여 움직일 자리를 만든다
  await dragHandle(page, 'e', -200, 0);

  const offsets = async () => {
    const b = center(await box(page, BLOCK));
    const s = center(await box(page, SLICE));
    return { x: b.x - s.x, y: b.y - s.y };
  };
  const dragToOffset = async (ox: number | null, oy: number | null) => {
    const o = await offsets();
    await dragBody(page, ox == null ? 0 : ox - o.x, oy == null ? 0 : oy - o.y);
  };
  const guideX = page.getByTestId('n5-snap-guide-x');
  const guideY = page.getByTestId('n5-snap-guide-y');

  // X만 — 세로 중앙선 근접, Y는 그대로
  await dragToOffset(60, -80);
  await dragToOffset(5, -80);
  let o = await offsets();
  expect(Math.abs(o.x)).toBeLessThan(1);
  near(o.y, -80, 2);

  // Y만 — 가로 중앙선 근접, X는 그대로
  await dragToOffset(50, 4);
  o = await offsets();
  near(o.x, 50, 2);
  expect(Math.abs(o.y)).toBeLessThan(1);

  // 둘 다 → 정중앙 (손을 놓으면 guide가 사라진다). 이미 붙은 축은 구간을 벗어난 뒤에야 다시 붙으므로 밖에서 다가온다
  await dragToOffset(40, 40);
  await dragToOffset(5, 5);
  o = await offsets();
  expect(Math.abs(o.x)).toBeLessThan(1);
  expect(Math.abs(o.y)).toBeLessThan(1);
  await expect(guideX).toHaveCount(0);
  await expect(guideY).toHaveCount(0);

  // 한 번의 끌기 안에서 — 밖에서 들어와 붙으면 guide 표시, 20px 전까지 유지, X만 넘기면 X만 풀린다
  await dragToOffset(-40, -40);
  const here = await box(page, BLOCK);
  const px = here.x + here.width * 0.4 + 40;
  const py = here.y + here.height * 0.6 + 40;
  await page.mouse.move(px - 40, py - 40);
  await page.mouse.down();
  await page.mouse.move(px, py, { steps: 6 });
  o = await offsets();
  expect(Math.abs(o.x)).toBeLessThan(1);
  expect(Math.abs(o.y)).toBeLessThan(1);
  await page.mouse.move(px + 15, py + 15, { steps: 4 });
  o = await offsets();
  expect(Math.abs(o.x)).toBeLessThan(1);
  expect(Math.abs(o.y)).toBeLessThan(1);
  await expect(guideX).toBeVisible();
  await expect(guideY).toBeVisible();
  await expect(guideX).toHaveCSS('pointer-events', 'none');
  const guideBox = (await guideX.boundingBox())!;
  expect(Math.abs(guideBox.x + guideBox.width / 2 - center(await box(page, SLICE)).x)).toBeLessThan(1);
  await page.mouse.move(px + 26, py + 15, { steps: 4 });
  o = await offsets();
  near(o.x, 26, 2);
  expect(Math.abs(o.y)).toBeLessThan(1);
  await expect(guideX).toHaveCount(0);
  await expect(guideY).toBeVisible();
  await page.mouse.move(px + 26, py + 26, { steps: 4 });
  o = await offsets();
  near(o.y, 26, 2);
  await expect(guideY).toHaveCount(0);
  await page.mouse.up();

  // 빠른 끌기 — 판정 구간을 건너뛰어도 선을 지나 release 안에 멈추면 붙는다(pointermove 한 번)
  await dragToOffset(-60, null);
  const from = await box(page, BLOCK);
  const fx = from.x + from.width * 0.4;
  const fy = from.y + from.height * 0.6;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(fx + 2, fy, { steps: 2 }); // 끌기 시작(판정 구간 밖)
  await page.mouse.move(fx + 76, fy); // -60 → +16 로 한 번에 건너뜀
  expect(Math.abs((await offsets()).x)).toBeLessThan(1);
  await page.mouse.up();

  // 판정 거리(12px) 밖에서 다가와 멈추면 붙지 않는다
  await dragToOffset(40, 40);
  await dragToOffset(16, 16);
  o = await offsets();
  near(o.x, 16, 1.5);
  near(o.y, 16, 1.5);

  // zoom 50·110·200 — 화면 기준 거리는 같다
  const canvas = page.getByTestId('n5-canvas');
  for (const step of [{ id: 'n5-zoom-out', n: 5, zoom: 0.5 }, { id: 'n5-zoom-in', n: 6, zoom: 1.1 }, { id: 'n5-zoom-in', n: 9, zoom: 2 }]) {
    for (let i = 0; i < step.n; i += 1) await page.getByTestId(step.id).click();
    await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeCloseTo(step.zoom, 5);
    const viewport = await box(page, 'n5-viewport');
    const current = await box(page, BLOCK);
    if (current.y < viewport.y + 100 || current.y + current.height > viewport.y + viewport.height - 100) {
      await page.mouse.move(viewport.x + 60, viewport.y + 500);
      await page.mouse.wheel(0, current.y - (viewport.y + 300));
      await expect.poll(async () => Math.abs((await box(page, BLOCK)).y - (viewport.y + 300))).toBeLessThan(60);
    }
    await dragToOffset(50, null);
    await dragToOffset(8, null);
    expect(Math.abs((await offsets()).x), `zoom ${step.zoom}: 8px → 붙음`).toBeLessThan(1);
    await dragToOffset(50, null);
    await dragToOffset(16, null);
    near((await offsets()).x, 16, 1.5);
  }
  await page.screenshot({ path: test.info().outputPath('n5-snap-200.png') });
});

test('텍스트가 없는 block도 bbox만 있으면 같은 규칙으로 붙는다', async ({ page }) => {
  // 9107은 번역이 생성되지 않은 block(trans1=null)이다
  await page.getByTestId('n5-block-row-9107').click();
  await expect(page.getByTestId('n5-block-editor-9107')).toHaveValue('');
  const id = 'n5-block-overlay-9107';
  const sliceId = 'n5-slice-translated-504';
  await expect(page.getByTestId(id)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(id)).toBeInViewport();

  const move = async (ox: number | null, oy: number | null) => {
    const b = await box(page, id);
    const c = center(b);
    const s = center(await box(page, sliceId));
    await dragPoint(page, { x: b.x + b.width * 0.4, y: b.y + b.height * 0.6 }, ox == null ? 0 : s.x + ox - c.x, oy == null ? 0 : s.y + oy - c.y);
  };
  const off = async () => {
    const c = center(await box(page, id));
    const s = center(await box(page, sliceId));
    return { x: c.x - s.x, y: c.y - s.y };
  };

  // 폭이 넓어 먼저 줄여 움직일 자리를 만든다
  await dragHandle(page, 'e', -150, 0);
  const yBefore = (await off()).y;
  await move(40, null);
  await move(5, null);
  let o = await off();
  expect(Math.abs(o.x)).toBeLessThan(1);
  near(o.y, yBefore, 1);
  await move(40, 5);
  o = await off();
  near(o.x, 40, 2);
  expect(Math.abs(o.y)).toBeLessThan(1);
});
