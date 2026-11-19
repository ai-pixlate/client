import { type Page, type Request, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 블록 배치 저장(F-CFM-15, BlockPatch.layoutAdjust) — 실 API·Mock 같은 경로(BE develop 구현 완료, dev 배포 미확인).
// - 박스 이동·크기·글자 배율·실행 취소/다시 실행은 N5 에서 local 초안만 바꾼다 — 조작 직후 PATCH·재렌더 task 없음
// - [저장하러 가기]에서 배치 미저장 블록마다 PATCH 1회: { trans1(서버 현재 값), revision(최신), layoutAdjust(바뀐 키만) }
//   같은 블록의 번역 초안이 있으면 한 요청(trans1 = 초안)으로. 응답 block 이 정본(정규화)
// - 저장이 하나라도 실패하면 confirm 하지 않고 N5 에 남으며 local 초안을 그대로 둔다
// Mock 은 실제 계약 모양으로 응답하지만 실서버 검증이 아니다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '배치 저장 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const url = (scenario?: string) => `/jobs/${MOCK_JOB_ID}?qaTypeset=1${scenario ? `&mockScenario=${scenario}` : ''}`;
const overlay = (page: Page, id: number) => page.getByTestId(`n5-block-overlay-${id}`);
const slice = (page: Page, id: number) => page.getByTestId(`n5-slice-translated-${id}`);

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
  await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
}
/** local 조작이 이력에 들어갈 때까지(서버 저장 없음) */
const settled = (page: Page) => expect(page.getByTestId('n5-undo')).toBeEnabled();
const confirmPosts = (page: Page) => {
  const list: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/confirm')) list.push(r.url());
  });
  return list;
};
/** [저장하러 가기] — 미저장 수정 저장 뒤 확인창(기본 fixture 는 확인 항목이 있다)이나 오류가 뜰 때까지 */
async function saveAll(page: Page) {
  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByTestId('n5-review-dialog').or(page.getByTestId('n5-confirm-error'))).toBeVisible({ timeout: 20_000 });
}

const ORIGINAL_9112 = { x: 40, y: 300, w: 500, h: 80 };

test('move — 조작 직후 PATCH 0 · 재렌더 없음 → [저장하러 가기]에서 1회(box 만 · 서버 trans1 · 최신 revision) · 응답이 정본', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await select(page, 9112);
  const before = await localBox(page, 9112);
  await dragBody(page, 9112, 30, 20);
  await settled(page);
  const after = await localBox(page, 9112);
  expect(after.left).toBeGreaterThan(before.left);
  // 조작 직후 — 서버 저장·미리보기 재렌더 없음, 번역문 칸 「재렌더링 중…」 없음
  await page.waitForTimeout(500);
  expect(patches).toEqual([]);
  await expect(page.getByText('재렌더링 중…')).toHaveCount(0);
  await expect(slice(page, 502)).toHaveAttribute('data-preview-display', 'local-typeset');

  await saveAll(page);
  const sent = layoutPatches(patches);
  expect(sent).toHaveLength(1);
  const { body } = sent[0];
  expect(Object.keys(body).sort()).toEqual(['layoutAdjust', 'revision', 'trans1']);
  expect(body.trans1).toBe('Instant effect guaranteed');
  expect(Object.keys(body.layoutAdjust!)).toEqual(['box']);
  const box = body.layoutAdjust!.box!;
  // 옮기기 = 위치만. 폭·높이는 옮긴 박스(선택 테두리 = 서버 박스) 그대로다 — 글 높이로 잰 Auto Height 표시 높이를 저장하지 않는다. 좌표는 섹션 로컬 원본 px
  expect(box.w).toBe(ORIGINAL_9112.w);
  expect(Math.abs(box.h - (before.height * ORIGINAL_9112.w) / before.width)).toBeLessThan(0.01);
  expect(box.h).toBe(ORIGINAL_9112.h);
  expect(box.x).toBeGreaterThan(ORIGINAL_9112.x);
  expect(Math.abs(after.left / after.width - box.x / box.w)).toBeLessThan(0.001);
  const response = await responseOf(sent[0]);
  expect(response.block.revision).toBe(body.revision + 1);
  expect(response.block.layoutAdjust).toEqual({ box, fontScale: null });
  expect(typeof response.rerenderTaskId).toBe('number');
});

test('저장 뒤 미리보기 안내는 section 위 상태 자리에 보이고, viewer·section 위치는 움직이지 않는다', async ({ page }) => {
  await open(page);
  // 섹션끼리의 위치 — viewer 스크롤과 무관하게 안내가 section 을 밀어내는지만 본다(제외 버튼을 누르려고 스크롤한다)
  const tops = () =>
    page.evaluate(() => {
      const top = (id: number) => document.querySelector(`[data-testid="n5-slice-translated-${id}"]`)!.getBoundingClientRect().top;
      return [502, 503, 504, 505].map((id) => top(id) - top(501));
    });
  const before = await tops();
  const slot = page.getByTestId('n5-preview-status-slot-502');
  await expect(slot).toBeAttached();
  await expect(slot).toBeEmpty();

  // 재렌더를 running 에 붙잡는다(?mockRenderHold=502 — 주소에서 빼면 끝난다)
  const setHold = (value: string | null) =>
    page.evaluate((value) => {
      const next = new URL(location.href);
      if (value == null) next.searchParams.delete('mockRenderHold');
      else next.searchParams.set('mockRenderHold', value);
      history.replaceState(history.state, '', next);
    }, value);
  await setHold('502');
  await page.getByTestId('n5-block-editor-9112').fill('Visible effect');
  await page.getByTestId('n5-block-save-9112').click();
  // 번역문 [확인] 저장 + 재검사 — 이 칸에는 「재렌더링 중…」이 보인다
  await expect(page.getByTestId('n5-block-row-9112').getByText('재렌더링 중…')).toBeVisible();
  // 저장 직후에는 /preview 를 다시 받지 않는다(재렌더 task 완료 때 /blocks·/preview 를 한 쌍으로 — f0b6d8c). 그래서 안내도 아직 없다
  await expect(slot).toBeEmpty();
  // 재렌더 중 /preview 를 다시 받는 계기(다른 섹션 N5 제외 — SEC-03 재조회)로 「최신 미리보기 아님」(이전 결과 + 진행 중 시도)을 받는다
  await page.getByTestId('n5-slice-translated-505').hover();
  await page.getByTestId('n5-section-exclude-505').click();
  await expect(page.getByTestId('n5-section-excluded-505')).toBeVisible();
  // 안내는 상태 자리에 보이고, 이미지 위 공간(헤더)은 생기지 않으며 viewer·section 위치가 그대로다(제외도 자리·높이를 유지한다)
  await expect(slot.getByTestId('n5-canvas-section-status-notice')).toHaveText('최신 미리보기 아님');
  await expect(page.getByTestId('n5-section-header-2')).toHaveCount(0);
  expect(await tops()).toEqual(before);
  await expect(page.getByTestId('n5-section-status-2-notice')).toBeVisible();
  // 편집한 섹션은 재렌더 중에도 이전 서버 이미지로 돌아가지 않는다(ad69843)
  await expect(slice(page, 502)).toHaveAttribute('data-preview-display', 'local-typeset');
  await setHold(null);
  await expect(slot).toBeEmpty({ timeout: 20_000 });
  expect(await tops()).toEqual(before);
});

test('resize(Auto Height) — 조작 직후 PATCH 0 → [저장하러 가기]에서 1회(box 만 · 높이는 줄바꿈 결과)', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await select(page, 9112);
  const h = (await page.getByTestId('n5-block-handle-e').boundingBox())!;
  await drag(page, h.x + h.width / 2 + 6.5, h.y + h.height / 2, -120, 0);
  await settled(page);
  await page.waitForTimeout(500);
  expect(patches).toEqual([]);
  const shown = await localBox(page, 9112);

  await saveAll(page);
  const sent = layoutPatches(patches);
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0].body.layoutAdjust!)).toEqual(['box']);
  const box = sent[0].body.layoutAdjust!.box!;
  expect(box.w).toBeLessThan(ORIGINAL_9112.w);
  // 보낸 박스 비율 = 화면(Auto Height 로 맞춘) 박스 비율
  expect(Math.abs(shown.height / shown.width - box.h / box.w)).toBeLessThan(0.001);
});

test('font [+][−] — 누를 때마다 PATCH 0 → [저장하러 가기]에서 마지막 값 1회(box + 절대 fontScale)', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await select(page, 9112);
  await openFontToolbar(page);
  await page.getByTestId('n5-font-scale-increase').click();
  await page.getByTestId('n5-font-scale-increase').click();
  await page.getByTestId('n5-font-scale-increase').click();
  await page.getByTestId('n5-font-scale-decrease').click();
  await expect(overlay(page, 9112)).toHaveAttribute('data-font-scale', '1.1');
  await settled(page);
  await page.waitForTimeout(500);
  expect(patches).toEqual([]);
  await expect(page.getByText('재렌더링 중…')).toHaveCount(0);

  await saveAll(page);
  const sent = layoutPatches(patches);
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0].body.layoutAdjust!).sort()).toEqual(['box', 'fontScale']);
  expect(sent[0].body.layoutAdjust!.fontScale).toBe(1.1);
  expect(((await responseOf(sent[0])).block.layoutAdjust as { fontScale: number | null }).fontScale).toBe(1.1);
});

test('Undo/Redo — local 만 바꾼다(PATCH 0) · 원래대로 돌아가면 저장할 배치가 없고, 다시 실행하면 그 값을 저장한다', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await select(page, 9112);
  const original = await localBox(page, 9112);
  await dragBody(page, 9112, 30, 20);
  await settled(page);
  const moved = await localBox(page, 9112);

  await page.getByTestId('n5-undo').click();
  await expect(page.getByTestId('n5-redo')).toBeEnabled();
  await expect(page.getByTestId('n5-undo')).toBeDisabled();
  const back = await localBox(page, 9112);
  for (const key of ['left', 'top'] as const) expect(Math.abs(back[key] - original[key])).toBeLessThan(0.01);
  await page.getByTestId('n5-redo').click();
  await settled(page);
  const again = await localBox(page, 9112);
  for (const key of ['left', 'top'] as const) expect(Math.abs(again[key] - moved[key])).toBeLessThan(0.01);
  await page.waitForTimeout(500);
  expect(patches).toEqual([]);

  await saveAll(page);
  const sent = layoutPatches(patches);
  expect(sent).toHaveLength(1);
  expect(sent[0].body.layoutAdjust!.box!.x).toBeGreaterThan(ORIGINAL_9112.x);
});

test('Undo 로 원래 배치로 돌아간 블록은 [저장하러 가기]에서 보내지 않는다', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await select(page, 9112);
  await dragBody(page, 9112, 30, 20);
  await settled(page);
  await page.getByTestId('n5-undo').click();
  await expect(page.getByTestId('n5-undo')).toBeDisabled();
  await saveAll(page);
  expect(layoutPatches(patches)).toEqual([]);
});

test('같은 블록의 번역 초안 + 배치 — PATCH 1회(trans1 = 초안 + layoutAdjust) · [확인]으로 이미 저장한 번역문은 다시 보내지 않는다', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  // 9101 — [확인]으로 이미 저장
  await page.getByTestId('n5-block-editor-9101').fill('Saved by confirm button');
  await page.getByTestId('n5-block-save-9101').click();
  await expect(page.getByTestId('n5-block-save-9101')).toHaveText('확인');
  await expect.poll(() => patches.length).toBe(1);
  // 9112 — 번역 초안 + 박스 이동(둘 다 미저장)
  await page.getByTestId('n5-block-editor-9112').fill('Draft and layout');
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();
  await dragBody(page, 9112, 30, 20);
  await settled(page);
  expect(patches).toHaveLength(1);

  await saveAll(page);
  const for9112 = patches.filter((p) => p.blockId === 9112);
  expect(for9112).toHaveLength(1);
  console.log(`[layout-combined] PATCH body ${JSON.stringify(for9112[0].body)}`);
  expect(for9112[0].body.trans1).toBe('Draft and layout');
  expect(Object.keys(for9112[0].body.layoutAdjust!)).toEqual(['box']);
  expect(patches.filter((p) => p.blockId === 9101)).toHaveLength(1);
  // 배치가 실린 저장은 조작마다 새 Idempotency-Key(UUID v4), 번역문만 저장은 키를 싣지 않는다
  expect(for9112[0].request.headers()['idempotency-key']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(patches.find((p) => p.blockId === 9101)!.request.headers()['idempotency-key']).toBeUndefined();
  const res = await responseOf(for9112[0]);
  expect(res.block.revision).toBe(for9112[0].body.revision + 1);
});

test('같은 블록 번역문을 [확인]으로 저장한 뒤 배치만 바꾸면 — [저장하러 가기]는 배치 PATCH 1회(trans1 = 저장된 서버값)만, 번역문을 다시 저장하지 않는다', async ({ page }) => {
  const patches = trackPatches(page);
  await open(page);
  await page.getByTestId('n5-block-editor-9112').fill('Confirmed first');
  await page.getByTestId('n5-block-save-9112').click();
  await expect(page.getByTestId('n5-block-save-9112')).toHaveText('확인');
  await expect.poll(() => patches.length).toBe(1);
  const confirmed = await responseOf(patches[0]);
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();
  await dragBody(page, 9112, 30, 20);
  await settled(page);
  await page.waitForTimeout(500);
  expect(patches).toHaveLength(1);

  await saveAll(page);
  expect(patches).toHaveLength(2);
  const final = patches[1];
  expect(final.blockId).toBe(9112);
  expect(final.body.trans1).toBe('Confirmed first');
  expect(final.body.revision).toBe(confirmed.block.revision);
  expect(Object.keys(final.body.layoutAdjust!)).toEqual(['box']);
  // 번역문만 다시 보내는 요청은 없다
  expect(patches.filter((p) => !('layoutAdjust' in p.body))).toHaveLength(1);
});

for (const [scenario, label] of [
  ['n5-layout-conflict', '409 REVISION_CONFLICT'],
  ['n5-layout-fail', '500'],
] as const) {
  test(`배치 저장 실패(${label}) — confirm 하지 않고 N5 에 남으며 local 초안(옮긴 박스)을 그대로 둔다`, async ({ page }) => {
    const patches = trackPatches(page);
    const confirms = confirmPosts(page);
    await open(page, scenario);
    await select(page, 9112);
    await dragBody(page, 9112, 30, 20);
    await settled(page);
    const moved = await localBox(page, 9112);
    await saveAll(page);
    await expect(page.getByTestId('n5-confirm-error')).toHaveText('저장하지 못한 수정이 있어 다음 단계로 넘어가지 않았습니다. 표시된 칸을 확인한 뒤 다시 시도해 주세요.');
    expect(layoutPatches(patches)).toHaveLength(1);
    expect(confirms).toEqual([]);
    const kept = await localBox(page, 9112);
    for (const key of ['left', 'top', 'width', 'height'] as const) expect(Math.abs(kept[key] - moved[key])).toBeLessThan(0.01);
    await expect(page.getByTestId('n5-review-dialog')).toHaveCount(0);
    if (scenario === 'n5-layout-conflict') await expect(page.getByTestId('n5-block-conflict-9112')).toBeVisible();
  });
}

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
  /**
   * 화면 박스의 위치·폭 비율이 그 원본 px box 와 같은지(표시 배율과 무관하게). 높이는 Auto Height 표시값(글 높이)이라 서버 h 와 다를 수 있다
   */
  async function expectScreenBox(page: Page, box: Box) {
    await expect
      .poll(async () => {
        const shown = await localBox(page, 9112);
        return Math.abs(shown.left / shown.width - box.x / box.w) < 0.001 && Math.abs(shown.top / shown.width - box.y / box.w) < 0.001;
      })
      .toBe(true);
  }

  test('legacy 적용 box를 편집 시작값으로 쓰고, 옮긴 배치를 [저장하러 가기]에서 저장한다', async ({ page }) => {
    const patches = trackPatches(page);
    await open(page, 'n5-layout-legacy');
    const initial = await readBlock(page, 9112);
    expect(initial.layoutAdjust).toBeNull();
    expect(await renderBox(page, 9112)).toEqual(LEGACY_9112);
    // 편집 시작값 = renderInput legacy box(원본 bbox 아님)
    await expectScreenBox(page, LEGACY_9112);

    await select(page, 9112);
    const shownBefore = await localBox(page, 9112);
    await dragBody(page, 9112, 30, 20);
    await settled(page);
    expect(patches).toEqual([]);
    await saveAll(page);
    const [move] = layoutPatches(patches);
    const moved = move.body.layoutAdjust!.box!;
    // 옮기기는 legacy box 폭·높이 그대로(시작값이 원본 bbox 였다면 w=500 이 나간다) — Auto Height 표시 높이를 저장하지 않는다
    expect(moved.w).toBe(LEGACY_9112.w);
    expect(Math.abs(moved.h - (shownBefore.height * LEGACY_9112.w) / shownBefore.width)).toBeLessThan(0.01);
    expect(moved.x).toBeGreaterThan(LEGACY_9112.x);
    expect(move.body.revision).toBe(initial.revision);
    const moveRes = await responseOf(move);
    expect(moveRes.block.revision).toBe(initial.revision + 1);
    expect(moveRes.block.layoutAdjust).toEqual({ box: moved, fontScale: null });
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
