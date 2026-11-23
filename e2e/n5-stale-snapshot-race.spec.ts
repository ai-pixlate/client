import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 stale snapshot race — PATCH 성공보다 먼저 시작한 /blocks·/preview snapshot 이 늦게 도착해도
// 화면 캐시(이미 반영된 PATCH 결과)를 과거 값으로 덮지 않는다(lib/queries/pixlate.ts markN5SnapshotBoundary · publishN5Snapshot).
//
// 재현: 다른 섹션(502) 저장의 재렌더 완료로 use-n5-preview-sync 가 snapshot 을 받기 시작하면 그 /preview 응답을 붙잡는다.
// 응답은 MSW 가 만든 뒤 붙잡으므로 내용은 「요청 시점(PATCH 전)」 서버 값이다. 그 사이 501 의 block 을 저장하고 응답을 놓아 준다.
// ?mockRenderHold=501 로 501 재렌더를 running 에 붙잡아, 놓아 준 뒤의 관찰 구간에 501 완료 재조회가 끼지 않게 한다.
//
// Mock 이다 — 실 BE 타이밍은 검증하지 않는다. Chromium 기준.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

const SECTION = 501;
const BLOCK = 9101; // section 501
const OTHER_BLOCK = 9103; // section 502

type Race = {
  armed: boolean;
  held: boolean;
  released: boolean;
  release: (() => void) | null;
  heldBlocks: { id: number; trans1: string | null; revision: number }[] | null;
  failPatch: number | null;
  log: string[];
  patches: { id: number; requestRevision: number; status: number; responseRevision: number | null }[];
};

async function instrument(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __race: Race; __origFetch: typeof fetch };
    w.__race = { armed: false, held: false, released: false, release: null, heldBlocks: null, failPatch: null, log: [], patches: [] };
    const original = window.fetch.bind(window);
    w.__origFetch = original;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, location.href).pathname.replace(/^\/jobs\/[^/]+/, '');
      const method = (init?.method ?? 'GET').toUpperCase();
      const race = w.__race;
      const patch = method === 'PATCH' ? path.match(/^\/blocks\/(\d+)$/) : null;
      if (patch) {
        const id = Number(patch[1]);
        const requestRevision = JSON.parse(String(init?.body ?? '{}')).revision;
        if (race.failPatch === id) {
          race.patches.push({ id, requestRevision, status: 500, responseRevision: null });
          return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'mock 실패', retryable: true, traceId: 't' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const response = await original(input, init);
        const body = await response.clone().json().catch(() => null);
        race.patches.push({ id, requestRevision, status: response.status, responseRevision: body?.block?.revision ?? null });
        return response;
      }
      if (method === 'POST' && path === '/confirm') race.log.push('POST confirm');
      if (method === 'GET' && race.armed && !race.held && (path === '/blocks' || path === '/preview')) {
        const response = await original(input, init);
        if (path === '/blocks') {
          race.heldBlocks = await response.clone().json();
          return response;
        }
        race.held = true;
        await new Promise<void>((resolve) => (race.release = resolve));
        race.released = true;
        return response;
      }
      return original(input, init);
    };
  });
}

const race = (page: Page) => page.evaluate(() => (window as unknown as { __race: Race }).__race);
const setRace = (page: Page, patch: Partial<Pick<Race, 'armed' | 'failPatch'>>) =>
  page.evaluate((patch) => Object.assign((window as unknown as { __race: Race }).__race, patch), patch);
const releaseHeld = (page: Page) => page.evaluate(() => (window as unknown as { __race: Race }).__race.release?.());

async function setMockParams(page: Page, params: Record<string, string | null>) {
  await page.evaluate((params) => {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(params)) {
      if (value == null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    history.replaceState(history.state, '', url);
  }, params);
}

/** 502 저장 → 그 재렌더 완료로 시작한 snapshot 의 /preview 응답을 붙잡는다(응답 내용은 붙잡은 시점 = 다음 PATCH 전 서버 값) */
async function holdSnapshotAfterOtherSectionSave(page: Page) {
  const other = page.getByTestId(`n5-block-editor-${OTHER_BLOCK}`);
  await other.scrollIntoViewIfNeeded();
  await other.fill('다른 섹션 선행 저장');
  await page.getByTestId(`n5-block-save-${OTHER_BLOCK}`).click();
  await expect.poll(async () => (await race(page)).patches.filter((p) => p.id === OTHER_BLOCK && p.status === 200).length).toBe(1);
  await setRace(page, { armed: true });
  await expect.poll(async () => (await race(page)).held, { timeout: 20_000 }).toBe(true);
}

test('A·B. PATCH 전에 시작한 snapshot 은 화면을 덮지 않고(새 문장·revision·local-typeset 유지), PATCH 뒤 시작한 snapshot 은 반영된다', async ({ page }) => {
  await reachN5(page);
  await setMockParams(page, { mockRenderHold: String(SECTION) });
  await instrument(page);
  const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
  const originalText = await editor.inputValue();

  // ① 이전 snapshot 조회 시작 → 응답 hold
  await holdSnapshotAfterOtherSectionSave(page);
  const heldBlock = (await race(page)).heldBlocks?.find((block) => block.id === BLOCK);
  expect(heldBlock?.trans1 ?? '').toBe(originalText); // 붙잡은 snapshot 은 PATCH 전 값이다

  // ② 501 block 수정 + [확인] → PATCH 200 → 화면 반영
  await editor.scrollIntoViewIfNeeded();
  await editor.fill('PATCH 뒤 최신 문장');
  await page.getByTestId(`n5-block-save-${BLOCK}`).click();
  await expect.poll(async () => (await race(page)).patches.filter((p) => p.id === BLOCK && p.status === 200).length).toBe(1);
  const saved = (await race(page)).patches.find((p) => p.id === BLOCK)!;
  expect(saved.responseRevision).not.toBeNull();
  expect(saved.responseRevision).not.toBe(heldBlock?.revision);
  const textLayer = page.getByTestId(`n5-text-layer-${SECTION}`);
  const slice = page.getByTestId(`n5-slice-translated-${SECTION}`);
  await expect(textLayer).toContainText('PATCH 뒤 최신 문장');

  // ③ 붙잡았던 이전 snapshot 응답 도착 → 화면은 그대로
  await releaseHeld(page);
  await expect.poll(async () => (await race(page)).released).toBe(true);
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(200);
    await expect(editor).toHaveValue('PATCH 뒤 최신 문장');
    await expect(textLayer).toContainText('PATCH 뒤 최신 문장');
    await expect(slice).toHaveAttribute('data-preview-display', 'local-typeset');
  }
  // 새 revision 유지 — 다음 저장이 PATCH 응답 revision 으로 나가 409 없이 성공한다
  await editor.fill('세 번째 저장');
  await page.getByTestId(`n5-block-save-${BLOCK}`).click();
  await expect.poll(async () => (await race(page)).patches.filter((p) => p.id === BLOCK).length).toBe(2);
  const third = (await race(page)).patches.filter((p) => p.id === BLOCK)[1];
  expect(third.requestRevision).toBe(saved.responseRevision);
  expect(third.status).toBe(200);
  await expect(textLayer).toContainText('세 번째 저장');

  // B. PATCH 뒤 시작한 snapshot 은 반영 — 다른 곳(다른 탭)에서 502 block 을 바꾼 뒤, 501 재렌더 완료로 새 snapshot 을 받는다
  await page.evaluate(async (blockId) => {
    const w = window as unknown as { __origFetch: typeof fetch };
    const base = location.pathname.replace(/\/$/, '');
    const blocks = (await (await w.__origFetch(`${base}/blocks`)).json()) as { id: number; revision: number }[];
    const revision = blocks.find((block) => block.id === blockId)!.revision;
    const response = await w.__origFetch(`${base}/blocks/${blockId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trans1: '다른 탭 변경', revision }),
    });
    if (!response.ok) throw new Error(`external PATCH ${response.status}`);
  }, OTHER_BLOCK);
  await setMockParams(page, { mockRenderHold: null });
  await expect(page.getByTestId(`n5-block-editor-${OTHER_BLOCK}`)).toHaveValue('다른 탭 변경', { timeout: 20_000 });
  await expect(editor).toHaveValue('세 번째 저장');
  await expect(textLayer).toContainText('세 번째 저장');
});

test('C. PATCH 실패(500) — 이전 snapshot 이 늦게 와도 초안 유지 · 저장 성공으로 다루지 않음 · confirm 0', async ({ page }) => {
  await reachN5(page);
  await instrument(page);
  const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
  const originalText = await editor.inputValue();

  await holdSnapshotAfterOtherSectionSave(page);
  await setRace(page, { failPatch: BLOCK });
  await editor.scrollIntoViewIfNeeded();
  await editor.fill('실패할 초안');
  await page.getByTestId(`n5-block-save-${BLOCK}`).click();
  await expect.poll(async () => (await race(page)).patches.filter((p) => p.id === BLOCK && p.status === 500).length).toBe(1);

  await releaseHeld(page);
  await expect.poll(async () => (await race(page)).released).toBe(true);
  await page.waitForTimeout(1_000);
  await expect(editor).toHaveValue('실패할 초안'); // 초안 유지(기존 실패 UX)
  await expect(page.getByTestId(`n5-text-layer-${SECTION}`)).toContainText('실패할 초안');
  expect(originalText).not.toBe('실패할 초안');
  expect((await race(page)).log.filter((entry) => entry === 'POST confirm')).toEqual([]);
});
