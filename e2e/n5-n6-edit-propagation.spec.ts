import { type Page, type Response, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { reachN5 } from './helpers/reach-n5';
import { enableN5GeneralHistoryForTest } from './helpers/n5-general-history';

// 보존한 일반 실행 취소·다시 실행 검증 — 12월 화면에서는 숨겼으므로 Mock 전용 스위치를 켠다(e2e/helpers/n5-general-history.ts)
test.beforeEach(async ({ page }) => {
  await enableN5GeneralHistoryForTest(page);
});

// ─────────────────────────────────────────────────────────────────
// N5 수정값 → N6 최종 결과 전파(Chromium, Mock).
//
// N6 결과의 정본은 confirm 시점의 서버 block 상태다. Mock 최종 렌더도 confirm(POST /confirm)이 새 렌더를 등록하는 순간
// n5BlockState(trans1·revision)를 snapshot 하고, 산출물 이미지(SVG data URL)를 그 snapshot 으로 만든다(lib/msw/handlers.ts).
// 그래서 N6 이미지에 새 문장이 보이면 「저장 완료 → confirm → final render」 순서가 지켜졌다는 뜻이다(N5 화면 state 를 넘기지 않는다).
// 실서버 렌더 품질·manifest 검증이 아니다.
// 아래 「재렌더 done → confirm」 순서 확인은 현재 FE 의 UX 장벽(사용자가 최신 저장 결과의 미리보기를 본 뒤 확정)을 지키는지 보는 것이다.
// N6 반영의 서버 필수 조건은 아니다 — BE(44e7164) confirm 은 진행 중 preview 재렌더를 취소하고 저장 완료된 값으로 최종 렌더를 따로 만든다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'N5→N6 전파 검증은 Chromium 기준이다');

type LogEntry = { seq: number; kind: string; detail?: string };

/** 순서 비교용 네트워크 기록 — 요청 시작과 /tasks 응답(재렌더 done 여부)을 한 줄씩 남긴다 */
function recordNetwork(page: Page) {
  const log: LogEntry[] = [];
  let seq = 0;
  page.on('request', (req) => {
    const { pathname } = new URL(req.url());
    if (!pathname.startsWith(`/jobs/${MOCK_JOB_ID}`)) return;
    const path = pathname.slice(`/jobs/${MOCK_JOB_ID}`.length) || '/';
    if (req.method() === 'PATCH' && /^\/blocks\/\d+$/.test(path)) log.push({ seq: seq++, kind: 'PATCH block', detail: path.split('/')[2] });
    else if (req.method() === 'POST' && path === '/confirm') log.push({ seq: seq++, kind: 'POST confirm' });
    else if (req.method() === 'GET' && path === '/blocks') log.push({ seq: seq++, kind: 'GET blocks' });
    else if (req.method() === 'GET' && path === '/deliverables') log.push({ seq: seq++, kind: 'GET deliverables' });
  });
  page.on('response', async (res: Response) => {
    const { pathname } = new URL(res.url());
    if (res.request().method() !== 'GET' || pathname !== `/jobs/${MOCK_JOB_ID}/tasks`) return;
    // 응답이 도착한 순간의 순번을 먼저 잡는다(본문 읽기는 비동기라 그사이 다음 요청이 기록될 수 있다)
    const at = seq++;
    const body = (await res.json().catch(() => null)) as { items?: { taskId: number; taskType: string; unitType: string; status: string }[] } | null;
    for (const item of body?.items ?? []) {
      if (item.taskType === 'render' && item.unitType === 'text_block' && item.status === 'done') log.push({ seq: at, kind: 'rerender done', detail: String(item.taskId) });
      if (item.taskType === 'render' && item.unitType === 'job' && item.status === 'done') log.push({ seq: at, kind: 'final render done', detail: String(item.taskId) });
    }
  });
  const first = (kind: string, detail?: string) =>
    log.filter((e) => e.kind === kind && (detail == null || e.detail === detail)).reduce((min, e) => Math.min(min, e.seq), Infinity) === Infinity
      ? -1
      : log.filter((e) => e.kind === kind && (detail == null || e.detail === detail)).reduce((min, e) => Math.min(min, e.seq), Infinity);
  const last = (kind: string, before = Infinity) => [...log].reverse().find((e) => e.kind === kind && e.seq < before)?.seq ?? -1;
  const count = (kind: string) => log.filter((e) => e.kind === kind).length;
  return { log, first, last, count };
}

/** PATCH 응답의 rerenderTaskId */
async function patchTaskIds(page: Page, action: () => Promise<void>) {
  const ids: number[] = [];
  const onResponse = async (res: Response) => {
    if (res.request().method() !== 'PATCH' || !/\/blocks\/\d+$/.test(new URL(res.url()).pathname)) return;
    const body = (await res.json().catch(() => null)) as { rerenderTaskId?: number | null } | null;
    if (typeof body?.rerenderTaskId === 'number') ids.push(body.rerenderTaskId);
  };
  page.on('response', onResponse);
  await action();
  return { ids, stop: () => page.off('response', onResponse) };
}

/** N6 에 보이는 최종 결과 이미지들의 글(SVG 안 문장) */
async function n6ResultTexts(page: Page): Promise<string> {
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 30_000 });
  const images = page.getByAltText('번역 결과 이미지');
  await expect(images.first()).toBeVisible();
  const srcs = await images.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src));
  return srcs.map((src) => decodeURIComponent(src).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).join('\n');
}

const editor = (page: Page, id: number) => page.getByTestId(`n5-block-editor-${id}`);
const saveButton = (page: Page, id: number) => page.getByTestId(`n5-block-save-${id}`);

test.beforeEach(async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-clean' });
});

test('A. 저장한 번역문 A→B → 저장 완료 → [저장하러 가기] → N6 결과가 B 기반이다(순서: PATCH → 재렌더 done → GET blocks → confirm → final render → deliverables)', async ({ page }) => {
  const net = recordNetwork(page);
  const original = await editor(page, 9101).inputValue();
  const NEXT = 'Propagated Title B';
  expect(original).not.toBe(NEXT);

  const { ids } = await patchTaskIds(page, async () => {
    await editor(page, 9101).fill(NEXT);
    await saveButton(page, 9101).click();
    await expect(saveButton(page, 9101)).toBeDisabled();
  });
  await expect(page.getByText('재렌더링 중…')).toHaveCount(0, { timeout: 15_000 });
  await page.getByTestId('n5-confirm-button').click();

  const texts = await n6ResultTexts(page);
  expect(texts).toContain(NEXT);
  expect(texts).not.toContain(original);

  const confirmAt = net.first('POST confirm');
  expect(net.count('POST confirm')).toBe(1);
  expect(net.first('PATCH block', '9101')).toBeLessThan(confirmAt);
  expect(net.first('rerender done', String(ids[0]))).toBeLessThan(confirmAt);
  expect(net.last('GET blocks', confirmAt)).toBeGreaterThan(net.first('rerender done', String(ids[0])));
  expect(net.first('final render done')).toBeGreaterThan(confirmAt);
  expect(net.first('GET deliverables')).toBeGreaterThan(net.first('final render done'));
});

test('B. 블록 저장 PATCH 가 끝나기 전에는 [저장하러 가기]가 비활성이고, 강제 클릭해도 confirm 0건 → 저장이 끝난 뒤에만 확정', async ({ page }) => {
  // 블록 PATCH 응답을 붙잡는다(MSW 응답 전에 window.fetch 를 감싼다 — page.route 는 Service Worker 응답을 가로채지 못한다)
  await page.evaluate(() => {
    const w = window as unknown as { __release?: () => void; __confirms: number };
    w.__confirms = 0;
    const gate = new Promise<void>((resolve) => (w.__release = resolve));
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'PATCH' && /\/blocks\/\d+$/.test(url)) await gate;
      if (init?.method === 'POST' && url.endsWith('/confirm')) w.__confirms += 1;
      return originalFetch(input, init);
    };
  });
  const confirms = () => page.evaluate(() => (window as unknown as { __confirms: number }).__confirms);

  await editor(page, 9101).fill('Held save');
  await saveButton(page, 9101).click();
  await expect(saveButton(page, 9101)).toHaveText('저장 중…');
  const confirmButton = page.getByTestId('n5-confirm-button');
  await expect(confirmButton).toBeDisabled();
  // UI 가드를 벗겨 강제로 눌러도 핸들러가 막는다
  await confirmButton.evaluate((button: HTMLButtonElement) => {
    button.disabled = false;
    button.click();
    button.click();
  });
  await page.waitForTimeout(800);
  expect(await confirms()).toBe(0);

  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await expect(saveButton(page, 9101)).toHaveText('확인');
  await expect(confirmButton).toBeEnabled();
  expect(await confirms()).toBe(0); // 저장이 끝났다고 저절로 확정하지 않는다
  await confirmButton.click();
  await expect.poll(confirms, { timeout: 20_000 }).toBe(1);
  expect(await n6ResultTexts(page)).toContain('Held save');
});

test('C·E. 개별 저장 없이 편집만 한 초안 → [저장하러 가기]가 저장 → 그 재렌더 완료 → 확정 · N6 는 수정한 문장', async ({ page }) => {
  const net = recordNetwork(page);
  const DRAFT = 'Draft only, saved by confirm';
  const { ids } = await patchTaskIds(page, async () => {
    await editor(page, 9102).fill(DRAFT); // [확인]을 누르지 않는다
    await page.getByTestId('n5-confirm-button').click();
    await expect(page.getByTestId('n5-confirm-button')).toHaveText('저장하는 중…');
    await expect.poll(() => net.count('PATCH block'), { timeout: 10_000 }).toBe(1);
  });

  expect(await n6ResultTexts(page)).toContain(DRAFT);
  const confirmAt = net.first('POST confirm');
  expect(net.count('POST confirm')).toBe(1);
  expect(net.first('PATCH block', '9102')).toBeLessThan(confirmAt);
  // E — 확정이 그 저장의 재렌더보다 앞서지 않는다
  expect(ids).toHaveLength(1);
  const rerenderDone = net.first('rerender done', String(ids[0]));
  expect(rerenderDone).toBeGreaterThan(-1);
  expect(rerenderDone).toBeLessThan(confirmAt);
  expect(net.last('GET blocks', confirmAt)).toBeGreaterThan(rerenderDone);
});

test('E. [확인] 저장 직후(재렌더 진행 중) 바로 [저장하러 가기] → 재렌더 완료를 기다린 뒤 확정', async ({ page }) => {
  const net = recordNetwork(page);
  const { ids } = await patchTaskIds(page, async () => {
    await editor(page, 9101).fill('Saved while rerendering');
    await saveButton(page, 9101).click();
    await expect(saveButton(page, 9101)).toBeDisabled();
  });
  await expect(page.getByText('재렌더링 중…')).toBeVisible(); // 아직 진행 중
  await page.getByTestId('n5-confirm-button').click();

  expect(await n6ResultTexts(page)).toContain('Saved while rerendering');
  const confirmAt = net.first('POST confirm');
  expect(net.first('rerender done', String(ids[0]))).toBeGreaterThan(-1);
  expect(net.first('rerender done', String(ids[0]))).toBeLessThan(confirmAt);
});

test('F. 여러 block 수정(하나는 저장, 둘은 초안) → 모두 저장된 뒤 confirm 1회 · N6 에 셋 다', async ({ page }) => {
  const net = recordNetwork(page);
  await editor(page, 9101).fill('Multi A saved');
  await saveButton(page, 9101).click();
  await expect(saveButton(page, 9101)).toBeDisabled();
  await editor(page, 9102).fill('Multi B draft');
  await editor(page, 9103).fill('$11.11');

  await page.getByTestId('n5-confirm-button').click();

  const texts = await n6ResultTexts(page);
  for (const text of ['Multi A saved', 'Multi B draft', '$11.11']) expect(texts).toContain(text);
  const confirmAt = net.first('POST confirm');
  expect(net.count('POST confirm')).toBe(1);
  for (const id of ['9101', '9102', '9103']) expect(net.first('PATCH block', id)).toBeLessThan(confirmAt);
});

test('H. N6 결과는 이번 확정이 등록한 최종 렌더의 산출물이다(이전 고정 이미지·이전 렌더 결과가 아니다)', async ({ page }) => {
  await page.getByTestId('n5-confirm-button').click();
  const texts = await n6ResultTexts(page);
  const tasks = await page.evaluate(async (jobId) => (await (await fetch(`/jobs/${jobId}/tasks`)).json()) as { items: { taskId: number; taskType: string; unitType: string; status: string }[] }, MOCK_JOB_ID);
  const finalRender = tasks.items.filter((item) => item.taskType === 'render' && item.unitType === 'job');
  expect(finalRender).toHaveLength(1);
  // 산출물 SVG 의 메타데이터가 그 렌더 task 를 가리킨다
  expect(texts).toContain(`"renderTaskId":${finalRender[0].taskId}`);
  expect(texts).not.toContain('/mock/n5/sections/501-translated.png');
});

// ─────────────────────────────────────────────────────────────────
// 박스 위치·크기·글자 배율(layoutAdjust) → N6.
// 배치 조작은 N5 에서 local 초안만 바꾼다(PATCH·재렌더 task 없음). [저장하러 가기]가 배치 미저장 블록을 같은 PATCH 경로로 저장하고
// (실 API·Mock 동일), 모든 PATCH 성공 응답 뒤에만 confirm 한다. Mock 최종 렌더 snapshot 은 confirm 시점 서버 block 의 layoutAdjust 를
// 담는다(BE final manifest 의 box·font_scale 과 같은 의미 — server tests/test_block_layout_adjust.py).
// N6 데이터 정확성의 기준은 「PATCH 응답 완료 → confirm」이다. 「재렌더 done → confirm」은 최신 미리보기를 보고 확정하게 하는
// 현재 UX 장벽(서버 필수 조건 아님)이라 따로 본다.
// ─────────────────────────────────────────────────────────────────

type LayoutAdjust = { box: { x: number; y: number; w: number; h: number } | null; fontScale: number | null } | null;
type SnapshotBlock = { blockId: number; trans1: string; revision: number | null; layoutAdjust: LayoutAdjust };

/** N6 결과 이미지(SVG <desc> JSON)에 담긴 최종 렌더 입력 block */
async function n6RenderInput(page: Page, blockId: number): Promise<SnapshotBlock> {
  const texts = await n6ResultTexts(page);
  const blocks = [...texts.matchAll(/<desc>([\s\S]*?)<\/desc>/g)].flatMap((m) => (JSON.parse(m[1]) as { blocks: SnapshotBlock[] }).blocks);
  const found = blocks.find((b) => b.blockId === blockId);
  expect(found, `N6 최종 렌더 입력에 block ${blockId} 가 있다`).toBeTruthy();
  return found!;
}

type SavedPatch = { blockId: number; body: { trans1: string; revision: number; layoutAdjust?: LayoutAdjust }; doneAt: number; status: number; responseBlock: { layoutAdjust: LayoutAdjust; revision: number } | null };

/** block PATCH 의 본문·응답 완료 순번, confirm 요청 순번(같은 시계) */
function recordSaves(page: Page) {
  const patches: SavedPatch[] = [];
  const confirms: number[] = [];
  let clock = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === `/jobs/${MOCK_JOB_ID}/confirm`) confirms.push(++clock);
  });
  page.on('requestfinished', async (req) => {
    const match = new URL(req.url()).pathname.match(/\/blocks\/(\d+)$/);
    if (req.method() !== 'PATCH' || !match) return;
    const doneAt = ++clock;
    const res = await req.response();
    const json = (await res?.json().catch(() => null)) as { block?: { layoutAdjust: LayoutAdjust; revision: number } } | null;
    patches.push({ blockId: Number(match[1]), body: req.postDataJSON(), doneAt, status: res?.status() ?? 0, responseBlock: json?.block ?? null });
  });
  return { patches, confirms };
}

const overlay = (page: Page, id: number) => page.getByTestId(`n5-block-overlay-${id}`);
async function dragBy(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const t of [1 / 3, 2 / 3, 1]) await page.mouse.move(x + dx * t, y + dy * t, { steps: 3 });
  await page.mouse.up();
}
async function selectBlock(page: Page, id: number) {
  await page.getByTestId(`n5-block-pin-${id}`).click();
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();
}
/** local 조작이 이력에 들어갈 때까지 */
const layoutSettled = (page: Page) => expect(page.getByTestId('n5-undo')).toBeEnabled();
async function moveBox(page: Page, id: number) {
  await selectBlock(page, id);
  const b = (await overlay(page, id).boundingBox())!;
  await dragBy(page, b.x + b.width * 0.4, b.y + b.height * 0.6, 30, 20);
  await layoutSettled(page);
}
async function resizeBox(page: Page, id: number) {
  await selectBlock(page, id);
  const h = (await page.getByTestId('n5-block-handle-e').boundingBox())!;
  await dragBy(page, h.x + h.width / 2 + 6.5, h.y + h.height / 2, -80, 0);
  await layoutSettled(page);
}
async function bumpFontScale(page: Page, id: number) {
  await selectBlock(page, id);
  await page.getByTestId('n5-font-scale-increase').click();
  await expect(overlay(page, id)).toHaveAttribute('data-font-scale', '1.05');
  await layoutSettled(page);
}

const LAYOUT_BLOCK = 9112;
const layoutPatchesOf = (list: SavedPatch[]) => list.filter((p) => p.blockId === LAYOUT_BLOCK && p.body.layoutAdjust !== undefined);
/** 조작 직후 — 서버 저장도, 번역문 칸 「재렌더링 중…」도 없다 */
async function expectNoSaveYet(page: Page, saves: ReturnType<typeof recordSaves>) {
  await page.waitForTimeout(500);
  expect(saves.patches).toEqual([]);
  await expect(page.getByText('재렌더링 중…')).toHaveCount(0);
}

test.describe('배치(layoutAdjust) → N6', () => {
  test('B. 박스 위치만 — 조작 직후 PATCH 0 → [저장하러 가기]에서 layoutAdjust.box PATCH → 응답 뒤 confirm → N6 최종 입력에 이동한 box', async ({ page }) => {
    const saves = recordSaves(page);
    await moveBox(page, LAYOUT_BLOCK);
    await expectNoSaveYet(page, saves);

    await page.getByTestId('n5-confirm-button').click();
    const input = await n6RenderInput(page, LAYOUT_BLOCK);
    const sent = layoutPatchesOf(saves.patches);
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0].body.layoutAdjust!)).toEqual(['box']);
    expect(sent[0].status).toBe(200);
    console.log(`[layout-move] PATCH body ${JSON.stringify(sent[0].body)}`);
    expect(input.layoutAdjust?.box).toEqual(sent[0].responseBlock!.layoutAdjust!.box);
    expect(input.revision).toBe(sent[0].responseBlock!.revision);
    expect(saves.confirms).toHaveLength(1);
    expect(sent[0].doneAt).toBeLessThan(saves.confirms[0]);
  });

  test('C. 박스 크기만 — resize 직후 PATCH 0 → 저장된 box 가 N6 최종 입력에 그대로', async ({ page }) => {
    const saves = recordSaves(page);
    await resizeBox(page, LAYOUT_BLOCK);
    await expectNoSaveYet(page, saves);
    await page.getByTestId('n5-confirm-button').click();
    const input = await n6RenderInput(page, LAYOUT_BLOCK);
    const sent = layoutPatchesOf(saves.patches);
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0].body.layoutAdjust!)).toEqual(['box']);
    console.log(`[layout-resize] PATCH body ${JSON.stringify(sent[0].body)}`);
    expect(input.layoutAdjust?.box).toEqual(sent[0].responseBlock!.layoutAdjust!.box);
    expect(sent[0].doneAt).toBeLessThan(saves.confirms[0]);
  });

  test('D. 글자 크기만 — [+] 직후 PATCH 0 → 저장된 절대 fontScale 이 N6 최종 입력에 그대로', async ({ page }) => {
    const saves = recordSaves(page);
    await bumpFontScale(page, LAYOUT_BLOCK);
    await expectNoSaveYet(page, saves);
    await page.getByTestId('n5-confirm-button').click();
    const input = await n6RenderInput(page, LAYOUT_BLOCK);
    const sent = layoutPatchesOf(saves.patches);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.layoutAdjust!.fontScale).toBe(1.05);
    console.log(`[layout-font] PATCH body ${JSON.stringify(sent[0].body)}`);
    expect(input.layoutAdjust?.fontScale).toBe(1.05);
    expect(input.layoutAdjust?.box).toEqual(sent[0].responseBlock!.layoutAdjust!.box);
    expect(sent[0].doneAt).toBeLessThan(saves.confirms[0]);
  });

  test('E. 번역문 초안 + 박스 + 글자 크기 — 같은 블록은 PATCH 1회 · 모든 PATCH 응답 뒤 confirm 1회 · N6 에 셋 다', async ({ page }) => {
    const saves = recordSaves(page);
    await moveBox(page, LAYOUT_BLOCK);
    await page.getByTestId('n5-font-scale-increase').click();
    await expect(overlay(page, LAYOUT_BLOCK)).toHaveAttribute('data-font-scale', '1.05');
    await layoutSettled(page);
    const DRAFT = 'All three edits';
    await editor(page, LAYOUT_BLOCK).fill(DRAFT); // [확인]을 누르지 않는다
    await resizeBox(page, 9101); // 다른 블록 배치도 함께
    await expectNoSaveYet(page, saves);

    await page.getByTestId('n5-confirm-button').click();
    const input = await n6RenderInput(page, LAYOUT_BLOCK);
    const for9112 = saves.patches.filter((p) => p.blockId === LAYOUT_BLOCK);
    expect(for9112).toHaveLength(1); // 번역 초안 + 배치를 한 요청으로
    expect(for9112[0].body.trans1).toBe(DRAFT);
    expect(Object.keys(for9112[0].body.layoutAdjust!).sort()).toEqual(['box', 'fontScale']);
    expect(input.trans1).toBe(DRAFT);
    expect(input.layoutAdjust?.fontScale).toBe(1.05);
    expect(input.layoutAdjust?.box).toEqual(for9112[0].responseBlock!.layoutAdjust!.box);
    const for9101 = saves.patches.filter((p) => p.blockId === 9101);
    expect(for9101).toHaveLength(1);
    expect((await n6RenderInput(page, 9101)).layoutAdjust?.box).toEqual(for9101[0].responseBlock!.layoutAdjust!.box);
    // 네트워크 순서 — 모든 PATCH 응답 완료 → POST /confirm(1회)
    expect(saves.confirms).toHaveLength(1);
    for (const p of saves.patches) {
      expect(p.status).toBe(200);
      expect(p.doneAt).toBeLessThan(saves.confirms[0]);
    }
  });

  test('배치 PATCH 응답 전에는 확정하지 않는다 — 응답을 붙잡은 동안 confirm 0건, 풀리면 그 뒤 1건', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as { __release?: () => void; __confirms: number; __layoutPatches: number };
      w.__confirms = 0;
      w.__layoutPatches = 0;
      const gate = new Promise<void>((resolve) => (w.__release = resolve));
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (init?.method === 'PATCH' && /\/blocks\/\d+$/.test(url) && String(init.body).includes('layoutAdjust')) {
          w.__layoutPatches += 1;
          await gate;
        }
        if (init?.method === 'POST' && url.endsWith('/confirm')) w.__confirms += 1;
        return originalFetch(input, init);
      };
    });
    const counts = () => page.evaluate(() => {
      const w = window as unknown as { __confirms: number; __layoutPatches: number };
      return { confirms: w.__confirms, patches: w.__layoutPatches };
    });
    await moveBox(page, LAYOUT_BLOCK);
    expect(await counts()).toEqual({ confirms: 0, patches: 0 });
    await page.getByTestId('n5-confirm-button').click();
    await expect.poll(async () => (await counts()).patches).toBe(1);
    await page.waitForTimeout(800);
    expect((await counts()).confirms).toBe(0);
    await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await expect.poll(async () => (await counts()).confirms, { timeout: 20_000 }).toBe(1);
    expect((await n6RenderInput(page, LAYOUT_BLOCK)).layoutAdjust?.box).not.toBeNull();
  });
});
