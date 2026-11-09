import { type Page, type Request, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { useLocalLayoutEditing } from './helpers/layout-write';

// ─────────────────────────────────────────────────────────────────
// N5 블록 배치 저장(F-CFM-15, BlockPatch.layoutAdjust) — 계약 확정·서버 구현 대기. Mock 에서만 쓰기가 켜진다.
// - 조작을 마쳤을 때 1회 저장: 끌기·손잡이는 손을 놓을 때(box 만), [+][−] 는 한 번 누를 때(box + fontScale)
// - 본문 = { trans1(서버 현재 값), revision(실행 시점 최신), layoutAdjust } · 응답 block 이 정본(정규화)
// - Undo/Redo 는 과거 값을 현재 revision 으로 다시 저장한다
// - 실서버(쓰기 차단)는 useLocalLayoutEditing 으로 같은 화면에서 확인한다
// Mock 은 실제 계약 모양으로 응답하지만 실서버 검증이 아니다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '배치 저장 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const url = (scenario?: string) => `/jobs/${MOCK_JOB_ID}?qaTypeset=1${scenario ? `&mockScenario=${scenario}` : ''}`;
const overlay = (page: Page, id: number) => page.getByTestId(`n5-block-overlay-${id}`);
const slice = (page: Page, id: number) => page.getByTestId(`n5-slice-translated-${id}`);
const overflow9104 = (page: Page) => page.getByTestId('n5-block-row-9104').getByTestId('n5-cell-failure-overflow');

type LayoutBody = { trans1: string; revision: number; layoutAdjust?: { box?: { x: number; y: number; w: number; h: number } | null; fontScale?: number | null } | null };
type Patch = { blockId: number; body: LayoutBody; request: Request };

function trackPatches(page: Page) {
  const list: Patch[] = [];
  page.on('request', (req) => {
    const match = new URL(req.url()).pathname.match(/\/blocks\/(\d+)$/);
    if (req.method() === 'PATCH' && match) list.push({ blockId: Number(match[1]), body: req.postDataJSON(), request: req });
  });
  return list;
}
const layoutPatches = (list: Patch[]) => list.filter((p) => 'layoutAdjust' in p.body);
const responseOf = async (patch: Patch) => (await (await patch.request.response())!.json()) as { block: { revision: number; layoutAdjust: unknown }; rerenderTaskId: number | null };

async function open(page: Page, scenario?: string) {
  await page.goto(url(scenario));
  await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
  await expect(slice(page, 501)).toHaveAttribute('data-preview-display', 'local-typeset');
}

const localBox = (page: Page, id: number) =>
  overlay(page, id).evaluate((el) => {
    const { left, top, width, height } = (el as HTMLElement).style;
    return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) };
  });

async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 3, y + dy / 3, { steps: 3 });
  await page.mouse.move(x + (dx * 2) / 3, y + (dy * 2) / 3, { steps: 3 });
  await page.mouse.move(x + dx, y + dy, { steps: 3 });
  await page.mouse.up();
}
async function dragBody(page: Page, id: number, dx: number, dy: number) {
  const b = (await overlay(page, id).boundingBox())!;
  await drag(page, b.x + b.width * 0.4, b.y + b.height * 0.6, dx, dy);
}
async function select(page: Page, id: number) {
  await page.getByTestId(`n5-block-pin-${id}`).click();
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();
}
async function openFontToolbar(page: Page) {
  await page.getByTestId('n5-font-scale-handle').click();
  await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
}
/** 저장이 끝나 이력 버튼이 다시 쓸 수 있게 될 때까지 */
const settled = (page: Page) => expect(page.getByTestId('n5-undo')).toBeEnabled();

const ORIGINAL_9112 = { x: 40, y: 300, w: 500, h: 80 };

test('move — 손을 놓을 때 1회, box 만 · 서버 trans1 · 최신 revision · 이전 결과 이미지 · 넘침 숨김 → 렌더 뒤 최신 조판', async ({ page }) => {
  const patches = trackPatches(page);
  const previewReads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && new URL(r.url()).pathname.endsWith('/preview')) previewReads.push(r.url());
  });
  await open(page);
  await expect(overflow9104(page)).toBeVisible();
  await select(page, 9112);
  const before = await localBox(page, 9112);
  await dragBody(page, 9112, 30, 20);
  await settled(page);

  const sent = layoutPatches(patches);
  expect(sent).toHaveLength(1);
  const { body } = sent[0];
  expect(Object.keys(body).sort()).toEqual(['layoutAdjust', 'revision', 'trans1']);
  expect(body.trans1).toBe('Instant effect guaranteed');
  expect(Object.keys(body.layoutAdjust!)).toEqual(['box']);
  const box = body.layoutAdjust!.box!;
  // 옮기기 = 위치만. 크기는 원본 그대로, 좌표는 섹션 로컬 원본 px
  expect([box.w, box.h]).toEqual([ORIGINAL_9112.w, ORIGINAL_9112.h]);
  expect(box.x).toBeGreaterThan(ORIGINAL_9112.x);
  expect(box.y).toBeGreaterThan(ORIGINAL_9112.y);
  const after = await localBox(page, 9112);
  expect(Math.abs(after.left / after.width - box.x / box.w)).toBeLessThan(0.001);
  expect(after.left).toBeGreaterThan(before.left);

  const response = await responseOf(sent[0]);
  expect(response.block.revision).toBe(body.revision + 1);
  expect(response.block.layoutAdjust).toEqual({ box, fontScale: null });
  expect(typeof response.rerenderTaskId).toBe('number');

  // 재렌더 동안: 이전 결과 이미지(새 HTML 을 얹지 않음) · 서버 넘침 숨김
  await expect(slice(page, 502)).toHaveAttribute('data-preview-display', 'previous-rendered-image');
  await expect(overflow9104(page)).toHaveCount(0);
  // task 완료 → /preview 재조회 → 최신 조판 · 넘침 복귀
  await expect(slice(page, 502)).toHaveAttribute('data-preview-display', 'local-typeset', { timeout: 20_000 });
  expect(previewReads.length).toBeGreaterThan(1);
  await expect(overflow9104(page)).toBeVisible();
  // 저장 뒤 화면 박스 = 서버 저장값(renderInput 적용 박스)
  const synced = await localBox(page, 9112);
  for (const key of ['left', 'top', 'width', 'height'] as const) expect(Math.abs(synced[key] - after[key])).toBeLessThan(0.01);
});

test('저장 뒤 미리보기 안내는 section 위 상태 자리에 보이고, viewer·section 위치는 움직이지 않는다', async ({ page }) => {
  await open(page);
  const tops = () =>
    page.evaluate(() => [501, 502, 503, 504, 505].map((id) => document.querySelector(`[data-testid="n5-slice-translated-${id}"]`)!.getBoundingClientRect().top));
  const before = await tops();
  const slot = page.getByTestId('n5-preview-status-slot-502');
  await expect(slot).toBeAttached();
  await expect(slot).toBeEmpty();

  await page.getByTestId('n5-block-editor-9112').fill('Visible effect');
  await page.getByTestId('n5-block-save-9112').click();
  // 재렌더 동안 — 안내가 상태 자리에 보이고, 이미지 위 공간(헤더)은 생기지 않는다
  await expect(slot.getByTestId('n5-canvas-section-status-notice')).toBeVisible();
  await expect(page.getByTestId('n5-section-header-2')).toHaveCount(0);
  expect(await tops()).toEqual(before);
  // 우측 패널에는 같은 안내가 그대로 있다
  await expect(page.getByTestId('n5-section-status-2-notice')).toBeVisible();
  // 재렌더가 끝나면 안내가 사라지고 위치는 여전히 같다
  await expect(slot).toBeEmpty({ timeout: 20_000 });
  expect(await tops()).toEqual(before);
});

test('resize(Auto Height) — 손을 놓을 때 1회, box 만 · 높이는 줄바꿈 결과 그대로', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await select(page, 9112);
  const h = (await page.getByTestId('n5-block-handle-e').boundingBox())!;
  await drag(page, h.x + h.width / 2 + 6.5, h.y + h.height / 2, -120, 0);
  await settled(page);
  const sent = layoutPatches(patches);
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0].body.layoutAdjust!)).toEqual(['box']);
  const box = sent[0].body.layoutAdjust!.box!;
  expect(box.w).toBeLessThan(ORIGINAL_9112.w);
  const shown = await localBox(page, 9112);
  // 보낸 박스 비율 = 화면(Auto Height 로 맞춘) 박스 비율
  expect(Math.abs(shown.height / shown.width - box.h / box.w)).toBeLessThan(0.001);
});

test('font [+][−] — 한 번 누름 = 저장 1회(box + 절대 fontScale), 연속 클릭은 순서대로 최신 revision, 1.0 은 null 로 정규화', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await select(page, 9112);
  await openFontToolbar(page);
  await page.getByTestId('n5-font-scale-increase').click();
  await page.getByTestId('n5-font-scale-increase').click();
  await expect(overlay(page, 9112)).toHaveAttribute('data-font-scale', '1.1');
  await settled(page);
  await page.getByTestId('n5-font-scale-decrease').click();
  await page.getByTestId('n5-font-scale-decrease').click();
  await expect(overlay(page, 9112)).toHaveAttribute('data-font-scale', '1');
  await settled(page);

  const sent = layoutPatches(patches);
  expect(sent.map((p) => p.body.layoutAdjust!.fontScale)).toEqual([1.05, 1.1, 1.05, 1]);
  for (const p of sent) expect(Object.keys(p.body.layoutAdjust!).sort()).toEqual(['box', 'fontScale']);
  // 앞 저장이 끝난 뒤 그 응답 revision 으로 보낸다 — 연속 클릭도 409 없이 하나씩
  const revisions = sent.map((p) => p.body.revision);
  for (let i = 1; i < revisions.length; i += 1) expect(revisions[i]).toBe(revisions[i - 1] + 1);
  const last = await responseOf(sent[3]);
  expect((last.block.layoutAdjust as { fontScale: number | null } | null)?.fontScale ?? null).toBeNull();
  await expect(page.getByTestId('n5-history-notice')).toHaveCount(0);
});

test('Undo/Redo — 이전 box·이후 box 를 현재 revision 으로 다시 저장한다 · 원본으로 돌아가면 layoutAdjust null 로 정규화', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await select(page, 9112);
  await dragBody(page, 9112, 30, 20);
  await settled(page);
  const moved = layoutPatches(patches)[0].body.layoutAdjust!.box!;

  await page.getByTestId('n5-undo').click();
  await expect(page.getByTestId('n5-redo')).toBeEnabled();
  const undo = layoutPatches(patches)[1];
  expect(undo.body.layoutAdjust).toEqual({ box: ORIGINAL_9112 });
  expect(undo.body.revision).toBe(layoutPatches(patches)[0].body.revision + 1);
  expect((await responseOf(undo)).block.layoutAdjust).toBeNull();
  await expect(page.getByTestId('n5-undo')).toBeDisabled();

  await page.getByTestId('n5-redo').click();
  await settled(page);
  const redo = layoutPatches(patches)[2];
  expect(redo.body.layoutAdjust).toEqual({ box: moved });
  expect((await responseOf(redo)).block.layoutAdjust).toEqual({ box: moved, fontScale: null });
});

test('Idempotency-Key — 배치 저장은 조작마다 새 UUID v4(끌기·[+]·Undo·Redo 각각), 번역문 저장은 키를 싣지 않는다', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await page.getByTestId('n5-block-editor-9112').fill('Visible effect');
  await page.getByTestId('n5-block-save-9112').click();
  await expect(page.getByTestId('n5-block-save-9112')).toHaveText('확인');
  await settled(page);
  await dragBody(page, 9112, 30, 20);
  await settled(page);
  await openFontToolbar(page);
  await page.getByTestId('n5-font-scale-increase').click();
  await settled(page);
  await page.getByTestId('n5-undo').click();
  await expect(page.getByTestId('n5-redo')).toBeEnabled();
  await page.getByTestId('n5-redo').click();
  await settled(page);

  const keyOf = (p: Patch) => p.request.headers()['idempotency-key'];
  const layout = layoutPatches(patches);
  expect(layout).toHaveLength(4); // 끌기 · [+] · Undo · Redo
  const keys = layout.map(keyOf);
  for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(new Set(keys).size).toBe(keys.length); // 다른 조작에 같은 키를 쓰지 않는다
  const text = patches.filter((p) => !('layoutAdjust' in p.body));
  expect(text.length).toBeGreaterThan(0);
  for (const p of text) expect(keyOf(p)).toBeUndefined();
});

test('혼합 이력 — 번역문 저장 뒤 옮기기, Undo 두 번은 box → 번역문 순서로 저장한다', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await page.getByTestId('n5-block-editor-9112').fill('Visible effect');
  await page.getByTestId('n5-block-save-9112').click();
  await expect(page.getByTestId('n5-block-save-9112')).toHaveText('확인');
  await settled(page);
  // 편집기에 들어가면서 이미 선택됐다
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();
  await dragBody(page, 9112, 30, 20);
  await settled(page);

  await page.getByTestId('n5-undo').click();
  await expect(page.getByTestId('n5-redo')).toBeEnabled();
  await page.getByTestId('n5-undo').click();
  await expect(page.getByTestId('n5-undo')).toBeDisabled();
  await expect(page.getByTestId('n5-block-editor-9112')).toHaveValue('Instant effect guaranteed');

  const order = patches.map((p) => ('layoutAdjust' in p.body ? 'layout' : `text:${p.body.trans1}`));
  expect(order).toEqual(['text:Visible effect', 'layout', 'layout', 'text:Instant effect guaranteed']);
  // 배치 저장은 그 시점 서버 번역문을 싣는다
  expect(layoutPatches(patches).map((p) => p.body.trans1)).toEqual(['Visible effect', 'Visible effect']);
});

test('저장하지 않은 번역 초안이 있어도 배치 저장은 서버 번역문을 보내고 초안을 지킨다', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await page.getByTestId('n5-block-editor-9112').fill('Unsaved draft');
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();
  await dragBody(page, 9112, 30, 20);
  await settled(page);
  const sent = layoutPatches(patches);
  expect(sent).toHaveLength(1);
  expect(sent[0].body.trans1).toBe('Instant effect guaranteed');
  expect(patches.filter((p) => p.body.trans1 === 'Unsaved draft')).toHaveLength(0);
  await expect(page.getByTestId('n5-block-editor-9112')).toHaveValue('Unsaved draft');
  await expect(page.getByTestId('n5-block-save-9112')).toBeEnabled();
});

test('409 REVISION_CONFLICT — 화면 박스를 되돌리고 이력을 남기지 않으며 기존 충돌 표시로 넘긴다', async ({ page }) => {
  await open(page, 'n5-layout-conflict');
  await select(page, 9112);
  const before = await localBox(page, 9112);
  await dragBody(page, 9112, 30, 20);
  await expect(page.getByTestId('n5-history-notice')).toHaveText('변경 사항을 저장하지 못했습니다. 마지막으로 저장된 상태로 돌아갑니다.');
  const back = await localBox(page, 9112);
  for (const key of ['left', 'top', 'width', 'height'] as const) expect(Math.abs(back[key] - before[key])).toBeLessThan(0.01);
  await expect(page.getByTestId('n5-undo')).toBeDisabled();
  await expect(page.getByTestId('n5-block-conflict-9112')).toBeVisible();
});

test('저장 실패(500) — 마지막 저장 상태로 되돌리고 이력을 남기지 않는다', async ({ page }) => {
  await open(page, 'n5-layout-fail');
  await select(page, 9112);
  const before = await localBox(page, 9112);
  await dragBody(page, 9112, 30, 20);
  await expect(page.getByTestId('n5-history-notice')).toBeVisible();
  const back = await localBox(page, 9112);
  for (const key of ['left', 'top'] as const) expect(Math.abs(back[key] - before[key])).toBeLessThan(0.01);
  await expect(page.getByTestId('n5-undo')).toBeDisabled();
});

test('실서버 쓰기 차단 — 같은 조작이 세션 local 로만 바뀌고 배치 PATCH 가 나가지 않는다', async ({ page }) => {
  await useLocalLayoutEditing(page);
  const patches = trackPatches(page);
  await open(page);
  await select(page, 9112);
  const before = await localBox(page, 9112);
  await dragBody(page, 9112, 30, 20);
  await openFontToolbar(page);
  await page.getByTestId('n5-font-scale-increase').click();
  await expect(overlay(page, 9112)).toHaveAttribute('data-font-scale', '1.05');
  expect((await localBox(page, 9112)).left).toBeGreaterThan(before.left);
  await page.waitForTimeout(300);
  expect(patches).toEqual([]);
  await expect(page.getByTestId('n5-undo')).toBeEnabled();
});

test.describe('Mock 서버 계약 — 해제·정규화·범위·형식·렌더 대상', () => {
  const patch = (page: Page, blockId: number, body: unknown) =>
    page.evaluate(
      async ({ blockId, body, jobId }) => {
        const res = await fetch(`/jobs/${jobId}/blocks/${blockId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, json: await res.json() };
      },
      { blockId, body, jobId: MOCK_JOB_ID },
    );
  const revisionOf = (page: Page, blockId: number) =>
    page.evaluate(
      async ({ blockId, jobId }) => {
        const res = await fetch(`/jobs/${jobId}/blocks`);
        const blocks = (await res.json()) as { id: number; revision: number; trans1: string; layoutAdjust: unknown }[];
        return blocks.find((b) => b.id === blockId)!;
      },
      { blockId, jobId: MOCK_JOB_ID },
    );

  test('전체 해제(null) · 부분 해제(box/fontScale null) · 정규화', async ({ page }) => {
    await open(page);
    let block = await revisionOf(page, 9112);
    expect(block.layoutAdjust).toBeNull();
    const moved = { x: 60.5, y: 310.25, w: 480.75, h: 80 };
    let res = await patch(page, 9112, { trans1: block.trans1, revision: block.revision, layoutAdjust: { box: moved, fontScale: 1.1 } });
    expect(res.status).toBe(200);
    expect(res.json.block.layoutAdjust).toEqual({ box: moved, fontScale: 1.1 }); // 소수 그대로
    expect(typeof res.json.rerenderTaskId).toBe('number');

    res = await patch(page, 9112, { trans1: block.trans1, revision: res.json.block.revision, layoutAdjust: { box: null } });
    expect(res.json.block.layoutAdjust).toEqual({ box: null, fontScale: 1.1 }); // 배율은 유지
    res = await patch(page, 9112, { trans1: block.trans1, revision: res.json.block.revision, layoutAdjust: { box: moved } });
    res = await patch(page, 9112, { trans1: block.trans1, revision: res.json.block.revision, layoutAdjust: { fontScale: null } });
    expect(res.json.block.layoutAdjust).toEqual({ box: moved, fontScale: null }); // 박스는 유지
    res = await patch(page, 9112, { trans1: block.trans1, revision: res.json.block.revision, layoutAdjust: { fontScale: 1.2 } });
    res = await patch(page, 9112, { trans1: block.trans1, revision: res.json.block.revision, layoutAdjust: null });
    expect(res.json.block.layoutAdjust).toBeNull(); // 전부 해제 → 원본 bbox · 1.0

    // 원본 bbox·1.0 을 보내면 null 로 정규화되고, 지금과 같으면 변경 없음(revision 유지 · rerenderTaskId null)
    block = await revisionOf(page, 9112);
    res = await patch(page, 9112, { trans1: block.trans1, revision: block.revision, layoutAdjust: { box: ORIGINAL_9112, fontScale: 1 } });
    expect(res.status).toBe(200);
    expect(res.json.block.layoutAdjust).toBeNull();
    expect(res.json.block.revision).toBe(block.revision);
    expect(res.json.rerenderTaskId).toBeNull();
  });

  test('섹션 밖 박스는 400(보정하지 않음) · 형식 오류는 422 · 렌더 대상 아님은 409 not_render_target', async ({ page }) => {
    await open(page);
    const block = await revisionOf(page, 9112);
    const send = (layoutAdjust: unknown) => patch(page, 9112, { trans1: block.trans1, revision: block.revision, layoutAdjust });
    for (const box of [
      { x: -1, y: 300, w: 100, h: 80 },
      { x: 40, y: -0.5, w: 100, h: 80 },
      { x: 40, y: 300, w: 0, h: 80 },
      { x: 40, y: 300, w: 100, h: 0 },
      { x: 900.5, y: 300, w: 100, h: 80 },
      { x: 40, y: 99999, w: 100, h: 80 },
    ]) {
      const res = await send({ box });
      expect(res.status, JSON.stringify(box)).toBe(400);
      expect(res.json.error.code).toBe('VALIDATION_ERROR');
    }
    for (const bad of [{}, { box: { x: 1, y: 2 } }, { fontScale: 0 }, { other: 1 }]) {
      expect((await send(bad)).status, JSON.stringify(bad)).toBe(422);
    }
    // 아무것도 적용되지 않았다
    expect((await revisionOf(page, 9112)).revision).toBe(block.revision);

    const label = await revisionOf(page, 9105);
    const res = await patch(page, 9105, { trans1: label.trans1 ?? '', revision: label.revision, layoutAdjust: { fontScale: 1.1 } });
    expect(res.status).toBe(409);
    expect(res.json.error.details.reason).toBe('not_render_target');
  });
});

// ─────────────────────────────────────────────────────────────────
// server PR #116 대비 — legacy 적용 box(?mockScenario=n5-layout-legacy)
// 9112 는 /blocks layoutAdjust=null 이지만 /preview renderInput.box 에 legacy box 가 적용된 상태로 시작한다.
// FE 에는 아직 reset(layoutAdjust null) UI 가 없다 — reset 요청·반복 reset 은 Mock 서버 계약으로 확인하고,
// 편집 시작값과 Undo 는 실제 화면 조작으로 확인한다.
// ─────────────────────────────────────────────────────────────────
test.describe('PR #116 대비 — legacy 적용 box', () => {
  const LEGACY_9112 = { x: 120, y: 340, w: 420, h: 80 };
  type Box = { x: number; y: number; w: number; h: number };

  const readBlock = (page: Page, blockId: number) =>
    page.evaluate(
      async ({ blockId, jobId }) => {
        const blocks = (await (await fetch(`/jobs/${jobId}/blocks`)).json()) as { id: number; revision: number; trans1: string; layoutAdjust: unknown }[];
        return blocks.find((b) => b.id === blockId)!;
      },
      { blockId, jobId: MOCK_JOB_ID },
    );
  const renderBox = (page: Page, blockId: number) =>
    page.evaluate(
      async ({ blockId, jobId }) => {
        const preview = (await (await fetch(`/jobs/${jobId}/preview`)).json()) as {
          sections: { renderInput?: { blocks: { blockId: number; box: { x: number; y: number; w: number; h: number } }[] } | null }[];
        };
        for (const section of preview.sections) {
          const hit = section.renderInput?.blocks.find((b) => b.blockId === blockId);
          if (hit) return hit.box;
        }
        return null;
      },
      { blockId, jobId: MOCK_JOB_ID },
    );
  const send = (page: Page, blockId: number, body: unknown) =>
    page.evaluate(
      async ({ blockId, body, jobId }) => {
        const res = await fetch(`/jobs/${jobId}/blocks/${blockId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, json: await res.json() };
      },
      { blockId, body, jobId: MOCK_JOB_ID },
    );
  const taskStatus = (page: Page, taskId: number) =>
    page.evaluate(
      async ({ taskId, jobId }) => {
        const tasks = (await (await fetch(`/jobs/${jobId}/tasks`)).json()) as { items?: { taskId: number; status: string }[] };
        return tasks.items?.find((item) => item.taskId === taskId)?.status ?? null;
      },
      { taskId, jobId: MOCK_JOB_ID },
    );
  /** 화면 박스 비율이 그 원본 px box 와 같은지(표시 배율과 무관하게) */
  async function expectScreenBox(page: Page, box: Box) {
    await expect
      .poll(async () => {
        const shown = await localBox(page, 9112);
        return Math.abs(shown.left / shown.width - box.x / box.w) < 0.001 && Math.abs(shown.height / shown.width - box.h / box.w) < 0.001;
      })
      .toBe(true);
  }

  test('legacy 적용 box를 편집 시작값으로 쓰고, 옮긴 뒤 Undo하면 화면의 이전 box를 다시 저장한다', async ({ page }) => {
    const patches = trackPatches(page);
    const previewReads: number[] = [];
    page.on('request', (r) => {
      if (r.method() === 'GET' && new URL(r.url()).pathname.endsWith('/preview')) previewReads.push(Date.now());
    });
    await open(page, 'n5-layout-legacy');
    const initial = await readBlock(page, 9112);
    expect(initial.layoutAdjust).toBeNull();
    expect(await renderBox(page, 9112)).toEqual(LEGACY_9112);
    // 편집 시작값 = renderInput legacy box(원본 bbox 아님)
    await expectScreenBox(page, LEGACY_9112);

    await select(page, 9112);
    await dragBody(page, 9112, 30, 20);
    await settled(page);
    const [move] = layoutPatches(patches);
    const moved = move.body.layoutAdjust!.box!;
    // 옮기기는 legacy box 크기 그대로 — 시작값이 원본 bbox 였다면 w=500 이 나간다
    expect([moved.w, moved.h]).toEqual([LEGACY_9112.w, LEGACY_9112.h]);
    expect(moved.x).toBeGreaterThan(LEGACY_9112.x);
    expect(move.body.revision).toBe(initial.revision);
    const moveRes = await responseOf(move);
    expect(moveRes.block.revision).toBe(initial.revision + 1);

    await page.getByTestId('n5-undo').click();
    await expect(page.getByTestId('n5-redo')).toBeEnabled();
    await expect(page.getByTestId('n5-undo')).toBeDisabled();
    const undo = layoutPatches(patches)[1];
    // Undo = 이전 적용 box 를 명시적으로 다시 저장(legacy 출처·null 복원을 기대하지 않는다)
    expect(undo.body).toEqual({ trans1: initial.trans1, revision: initial.revision + 1, layoutAdjust: { box: LEGACY_9112 } });
    const undoRes = await responseOf(undo);
    expect(undoRes.block.revision).toBe(initial.revision + 2);
    expect(undoRes.block.layoutAdjust).toEqual({ box: LEGACY_9112, fontScale: null }); // 저장 출처는 seller layoutAdjust
    expect(typeof undoRes.rerenderTaskId).toBe('number');
    await expectScreenBox(page, LEGACY_9112);

    // 재렌더 완료 → /blocks·/preview 재조회 뒤에도 같은 box · 이후 revision 정본 = Undo 응답 값
    const readsBefore = previewReads.length;
    await expect.poll(() => taskStatus(page, undoRes.rerenderTaskId!), { timeout: 20_000 }).toBe('done');
    await expect.poll(() => previewReads.length, { timeout: 20_000 }).toBeGreaterThan(readsBefore);
    await expect(slice(page, 502)).toHaveAttribute('data-preview-display', 'local-typeset', { timeout: 20_000 });
    expect(await renderBox(page, 9112)).toEqual(LEGACY_9112);
    expect((await readBlock(page, 9112)).revision).toBe(undoRes.block.revision);
    await expectScreenBox(page, LEGACY_9112);
  });

  test('layoutAdjust가 null로 유지돼도 revision과 rerenderTaskId가 바뀌면 변경으로 처리한다(Mock 서버 계약)', async ({ page }) => {
    await open(page, 'n5-layout-legacy');
    const before = await readBlock(page, 9112);
    expect(before.layoutAdjust).toBeNull();
    expect(await renderBox(page, 9112)).toEqual(LEGACY_9112);

    const reset = await send(page, 9112, { trans1: before.trans1, revision: before.revision, layoutAdjust: null });
    expect(reset.status).toBe(200);
    expect(reset.json.block.layoutAdjust).toBeNull(); // null → null
    expect(reset.json.block.revision).toBe(before.revision + 1);
    expect(typeof reset.json.rerenderTaskId).toBe('number');
    await expect.poll(() => taskStatus(page, reset.json.rerenderTaskId), { timeout: 20_000 }).toBe('done');
    // 적용 box 가 원본 bbox 로 바뀐다
    expect(await renderBox(page, 9112)).toEqual(ORIGINAL_9112);
    expect((await readBlock(page, 9112)).revision).toBe(before.revision + 1);

    // Undo 와 같은 요청 — 이전 적용 box 를 명시적으로 저장하면 seller layoutAdjust 가 된다
    const undo = await send(page, 9112, { trans1: before.trans1, revision: before.revision + 1, layoutAdjust: { box: LEGACY_9112 } });
    expect(undo.json.block.layoutAdjust).toEqual({ box: LEGACY_9112, fontScale: null });
    expect(undo.json.block.revision).toBe(before.revision + 2);
    expect(await renderBox(page, 9112)).toEqual(LEGACY_9112);
  });

  test('적용 box가 이미 원본이면 같은 reset 요청은 no-op으로 처리한다(Mock 서버 계약)', async ({ page }) => {
    await open(page, 'n5-layout-legacy');
    const before = await readBlock(page, 9112);
    const first = await send(page, 9112, { trans1: before.trans1, revision: before.revision, layoutAdjust: null });
    expect(first.json.rerenderTaskId).not.toBeNull();
    const again = await send(page, 9112, { trans1: before.trans1, revision: first.json.block.revision, layoutAdjust: null });
    expect(again.status).toBe(200);
    expect(again.json.block.revision).toBe(first.json.block.revision);
    expect(again.json.block.layoutAdjust).toBeNull();
    expect(again.json.rerenderTaskId).toBeNull();
    expect(await renderBox(page, 9112)).toEqual(ORIGINAL_9112);
  });
});
