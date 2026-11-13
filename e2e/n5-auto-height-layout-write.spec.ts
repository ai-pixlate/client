import { type Page, type Request, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// 기본 Mock(layoutAdjust 쓰기 켜짐)에서의 최초 진입 Auto Height.
// useLocalLayoutEditing 을 쓰지 않는다 — 실제 Mock 화면 그대로다.
// Auto Height 표시 박스는 사용자 배치가 아니다: 진입만으로 PATCH·이력이 생기지 않고, 첫 사용자 조작의 「조작 전」은 서버 박스다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '조판 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const QA_URL = `/jobs/${MOCK_JOB_ID}?qaTypeset=1`;
const ORIGINAL_9112 = { x: 40, y: 300, w: 500, h: 80 };
type Box = { left: number; top: number; width: number; height: number };

const boxOf = (page: Page, id: number) =>
  page.getByTestId(`n5-block-overlay-${id}`).evaluate((el): Box => {
    const { left, top, width, height } = (el as HTMLElement).style;
    return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) };
  });
const textHeight = (page: Page, id: number) =>
  page.locator(`[data-typeset-render="${id}"]`).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().height;
  });
const lineCount = (page: Page, id: number) =>
  page.locator(`[data-typeset-render="${id}"]`).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
const bottoms = (page: Page, id: number) =>
  page.evaluate((blockId) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(`[data-typeset-render="${blockId}"]`)!);
    const overlay = document.querySelector(`[data-testid="n5-block-overlay-${blockId}"]`)!;
    return { text: range.getBoundingClientRect().bottom, box: overlay.getBoundingClientRect().bottom };
  }, id);

async function expectWrapsText(page: Page, id: number) {
  await expect.poll(async () => Math.abs((await boxOf(page, id)).height - (await textHeight(page, id))), { timeout: 10_000 }).toBeLessThanOrEqual(1);
  const b = await bottoms(page, id);
  expect(b.text, `block ${id} 글 아래 끝 ≤ 박스 아래 끝`).toBeLessThanOrEqual(b.box + 1);
}

type Patch = { blockId: number; body: { trans1: string; revision: number; layoutAdjust?: { box?: { x: number; y: number; w: number; h: number } | null; fontScale?: number | null } | null }; request: Request };
function trackPatches(page: Page) {
  const list: Patch[] = [];
  page.on('request', (req) => {
    const match = new URL(req.url()).pathname.match(/\/blocks\/(\d+)$/);
    if (req.method() === 'PATCH' && match) list.push({ blockId: Number(match[1]), body: req.postDataJSON(), request: req });
  });
  return list;
}
const responseLayout = async (patch: Patch) => ((await (await patch.request.response())!.json()) as { block: { layoutAdjust: unknown } }).block.layoutAdjust;

async function open(page: Page) {
  await page.goto(QA_URL);
  await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
  // 서버 style(renderInput) 조판 화면
  await expect(page.getByTestId('n5-slice-translated-501')).toHaveAttribute('data-preview-display', 'local-typeset');
  await expect(page.getByTestId('n5-slice-translated-502')).toHaveAttribute('data-preview-display', 'local-typeset');
}
async function dragBody(page: Page, id: number, dx: number, dy: number) {
  const b = (await page.getByTestId(`n5-block-overlay-${id}`).boundingBox())!;
  const x = b.x + b.width * 0.4;
  const y = b.y + b.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}
async function dragHandle(page: Page, key: string, dx: number) {
  const h = (await page.getByTestId(`n5-block-handle-${key}`).boundingBox())!;
  const x = h.x + h.width / 2 + (key.includes('e') ? 6.5 : 0);
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 6 });
  await page.mouse.up();
}
const settled = (page: Page) => expect(page.getByTestId('n5-undo')).toBeEnabled();

test('G·H·A·B·D. 쓰기 켜진 Mock 진입만으로 긴·짧은·서버 style 번역문이 박스 안에 들어오고 PATCH·이력이 없다', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  // 9104 = Section2 의 긴 caution 문장(여러 줄) · 9103 가격 · 9112 짧은 caution · 9101 제목 · 9102 본문
  for (const id of [9104, 9103, 9112, 9101, 9102]) await expectWrapsText(page, id);
  expect(await lineCount(page, 9104)).toBeGreaterThan(1);
  expect(await lineCount(page, 9112)).toBe(1);
  // 서버 h=80 그대로가 아니다(Auto Height 가 실제로 보인다)
  const shortBox = await boxOf(page, 9112);
  expect(Math.abs(shortBox.height - (shortBox.width * ORIGINAL_9112.h) / ORIGINAL_9112.w)).toBeGreaterThan(1);
  await page.waitForTimeout(800);
  expect(patches).toEqual([]);
  await expect(page.getByTestId('n5-undo')).toBeDisabled();
  await expect(page.getByTestId('n5-redo')).toBeDisabled();
});

test('I·J. 첫 move 는 화면 박스(Auto Height)를 저장하고, Undo 는 조작 전 서버 박스로 저장해 null 로 정규화되며 화면은 다시 Auto Height', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await expectWrapsText(page, 9112);
  await page.getByTestId('n5-block-pin-9112').click();
  const shown = await boxOf(page, 9112);
  await dragBody(page, 9112, 30, 20);
  await settled(page);

  expect(patches).toHaveLength(1);
  const moved = patches[0].body.layoutAdjust!.box!;
  expect(moved.w).toBe(ORIGINAL_9112.w);
  expect(Math.abs(moved.h - (shown.height * ORIGINAL_9112.w) / shown.width)).toBeLessThan(0.01);
  expect(moved.x).toBeGreaterThan(ORIGINAL_9112.x);

  await page.getByTestId('n5-undo').click();
  await expect(page.getByTestId('n5-redo')).toBeEnabled();
  expect(patches).toHaveLength(2);
  expect(patches[1].body.layoutAdjust).toEqual({ box: ORIGINAL_9112 });
  expect(await responseLayout(patches[1])).toBeNull();
  await expect(page.getByTestId('n5-undo')).toBeDisabled();
  // 화면은 서버 박스(h=80)가 아니라 다시 Auto Height 표시
  await expectWrapsText(page, 9112);
  const back = await boxOf(page, 9112);
  expect(Math.abs(back.left - shown.left)).toBeLessThan(0.02);
  expect(Math.abs(back.top - shown.top)).toBeLessThan(0.02);
  // Undo 뒤에도 진입 보정이 새 PATCH 를 만들지 않는다
  await page.waitForTimeout(800);
  expect(patches).toHaveLength(2);
});

test('I. resize 는 사용자 폭 + 그 폭의 Auto Height, 글자 배율은 배율과 그 배율의 Auto Height 를 저장한다', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await expectWrapsText(page, 9104);
  await page.getByTestId('n5-block-pin-9104').click();
  const start = await boxOf(page, 9104);
  await dragHandle(page, 'e', -150);
  await settled(page);
  const resize = patches.at(-1)!;
  expect(resize.blockId).toBe(9104);
  const resized = resize.body.layoutAdjust!.box!;
  const afterResize = await boxOf(page, 9104);
  expect(afterResize.width).toBeLessThan(start.width);
  expect(afterResize.height).toBeGreaterThan(start.height); // 폭이 줄어 줄이 늘었다
  await expectWrapsText(page, 9104);
  const scale = resized.w / afterResize.width;
  expect(Math.abs(resized.h - afterResize.height * scale)).toBeLessThan(0.05);

  await page.getByTestId('n5-font-scale-handle').click();
  await page.getByTestId('n5-font-scale-increase').click();
  await settled(page);
  const font = patches.at(-1)!;
  expect(typeof font.body.layoutAdjust!.fontScale).toBe('number');
  expect(font.body.layoutAdjust!.fontScale).toBeGreaterThan(1);
  await expectWrapsText(page, 9104);
  const afterFont = await boxOf(page, 9104);
  const fontBox = font.body.layoutAdjust!.box!;
  expect(Math.abs(fontBox.h - (afterFont.height * fontBox.w) / afterFont.width)).toBeLessThan(0.05);
});

test('세로 손잡이 — 사용자가 정한 높이는 사용자 배치라 기존 layout 저장을 탄다(진입 보정과 구분)', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await expectWrapsText(page, 9112);
  await page.getByTestId('n5-block-pin-9112').click();
  const shown = await boxOf(page, 9112);
  const h = (await page.getByTestId('n5-block-handle-s').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await settled(page);
  expect(patches).toHaveLength(1);
  const box = patches[0].body.layoutAdjust!.box!;
  const after = await boxOf(page, 9112);
  expect(after.height).toBeGreaterThan(shown.height + 20);
  expect(Math.abs(box.h - (after.height * ORIGINAL_9112.w) / after.width)).toBeLessThan(0.05);
  // 저장·재조회 뒤에도 Auto Height 가 사용자 높이를 덮지 않는다
  await expect(page.getByTestId('n5-block-selection')).toHaveAttribute('data-manual-height', 'true');
  await page.waitForTimeout(1_000);
  expect(Math.abs((await boxOf(page, 9112)).height - after.height)).toBeLessThan(0.05);
});
