import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 [저장하러 가기] 저장 장벽 — BE 계약(release 44e7164) 점검.
//
// confirm 은 「confirm 시점에 DB 에 저장 완료된 값」으로 최종 렌더 입력을 고정한다. PATCH 를 먼저 보냈다는 사실만으로
// PATCH 가 먼저 처리된다는 보장이 없고(같은 job row lock 을 먼저 잡는 쪽이 이긴다), 여러 block PATCH 는 한 transaction 이 아니다.
// 그래서 FE 는 저장이 필요한 모든 block PATCH 의 「성공 응답」을 받은 뒤에만 confirm 을 보낸다 — 서버 409 를 race 방지 수단으로 쓰지 않는다.
//
// 요청 시작·응답 도착 순서는 MSW 가 응답하기 전에 window.fetch 를 감싸 기록한다(page.route 는 Service Worker 응답을 가로채지 못한다).
// Mock 이다 — 실서버 lock 순서를 검증하지 않는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

const A = 9101;
const B = 9102;
const C = 9103;

type Opts = { holdBlock: number | null; failBlock: number | null };
type Barrier = { log: string[]; opts: Opts; release: (() => void) | null };

/** fetch 를 감싸 「PATCH start/ok/fail」「POST confirm」「GET blocks」를 순서대로 남긴다. holdBlock 의 PATCH 응답은 release 전까지 붙잡는다 */
async function instrument(page: Page, opts: Opts) {
  await page.evaluate((opts) => {
    const w = window as unknown as { __barrier: Barrier };
    if (w.__barrier) {
      w.__barrier.opts = opts;
      return;
    }
    w.__barrier = { log: [], opts, release: null };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, location.href);
      const block = pathname.match(/\/blocks\/(\d+)$/);
      const method = (init?.method ?? 'GET').toUpperCase();
      const state = w.__barrier;
      if (method === 'PATCH' && block) {
        const id = Number(block[1]);
        state.log.push(`PATCH start ${id}`);
        if (state.opts.failBlock === id) {
          state.log.push(`PATCH fail ${id}`);
          return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'mock 실패', retryable: true, traceId: 't' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const response = await original(input, init);
        if (state.opts.holdBlock === id) await new Promise<void>((resolve) => (state.release = resolve));
        state.log.push(`PATCH ${response.ok ? 'ok' : `fail(${response.status})`} ${id}`);
        return response;
      }
      if (method === 'POST' && pathname.endsWith('/confirm')) state.log.push('POST confirm');
      if (method === 'GET' && pathname.endsWith('/blocks')) state.log.push('GET blocks');
      return original(input, init);
    };
  }, opts);
}

const log = (page: Page) => page.evaluate(() => (window as unknown as { __barrier: Barrier }).__barrier.log);
const confirms = async (page: Page) => (await log(page)).filter((entry) => entry === 'POST confirm').length;

async function editDraft(page: Page, blockId: number, text: string) {
  const editor = page.getByTestId(`n5-block-editor-${blockId}`);
  await editor.scrollIntoViewIfNeeded();
  await editor.fill(text);
}

test.beforeEach(async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-clean' });
});

test('Case 1 — 한 block 수정: PATCH start → PATCH 성공 → GET blocks → confirm', async ({ page }) => {
  await instrument(page, { holdBlock: null, failBlock: null });
  await editDraft(page, A, 'Barrier one');
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  const entries = await log(page);
  const confirmAt = entries.indexOf('POST confirm');
  expect(entries.indexOf(`PATCH start ${A}`)).toBeLessThan(entries.indexOf(`PATCH ok ${A}`));
  expect(entries.indexOf(`PATCH ok ${A}`)).toBeLessThan(confirmAt);
  expect(entries.lastIndexOf('GET blocks', confirmAt)).toBeGreaterThan(entries.indexOf(`PATCH ok ${A}`));
});

test('Case 2 — 세 block 수정: 세 PATCH 모두 성공 응답 뒤 confirm 1회', async ({ page }) => {
  await instrument(page, { holdBlock: null, failBlock: null });
  await editDraft(page, A, 'Barrier A');
  await editDraft(page, B, 'Barrier B');
  await editDraft(page, C, 'Barrier C');
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  const entries = await log(page);
  const patchEntries = entries.filter((entry) => entry.startsWith('PATCH'));
  // 하나씩 저장한다 — 앞 PATCH 의 성공 응답을 받은 뒤 다음 PATCH 를 시작한다
  expect(patchEntries).toEqual([`PATCH start ${A}`, `PATCH ok ${A}`, `PATCH start ${B}`, `PATCH ok ${B}`, `PATCH start ${C}`, `PATCH ok ${C}`]);
  const confirmAt = entries.indexOf('POST confirm');
  for (const id of [A, B, C]) expect(entries.indexOf(`PATCH ok ${id}`)).toBeLessThan(confirmAt);
  expect(entries.lastIndexOf('GET blocks', confirmAt)).toBeGreaterThan(entries.indexOf(`PATCH ok ${C}`));
  await page.waitForTimeout(1_000);
  expect(await confirms(page)).toBe(1);
});

test('Case 3 — 마지막 PATCH 지연: C 응답 전에는 confirm 0회(강제 클릭 포함) · C 성공 뒤에만 confirm', async ({ page }) => {
  await instrument(page, { holdBlock: C, failBlock: null });
  await editDraft(page, A, 'Delay A');
  await editDraft(page, B, 'Delay B');
  await editDraft(page, C, 'Delay C');
  const button = page.getByTestId('n5-confirm-button');
  await button.click();

  await expect.poll(async () => (await log(page)).includes(`PATCH start ${C}`), { timeout: 20_000 }).toBe(true);
  expect(await log(page)).toEqual(expect.arrayContaining([`PATCH ok ${A}`, `PATCH ok ${B}`]));
  await expect(button).toBeDisabled();
  // 버튼 비활성만이 아니라 핸들러 ref guard 도 막는다 — 강제 클릭·DOM click 이벤트
  await button.click({ force: true });
  await button.evaluate((el) => (el as HTMLButtonElement).click());
  await page.waitForTimeout(2_000);
  expect(await confirms(page)).toBe(0);

  await page.evaluate(() => (window as unknown as { __barrier: Barrier }).__barrier.release?.());
  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  const entries = await log(page);
  expect(entries.indexOf(`PATCH ok ${C}`)).toBeLessThan(entries.indexOf('POST confirm'));
  await page.waitForTimeout(1_000);
  expect(await confirms(page)).toBe(1);
});

test('Case 4 — A 성공 · B 500 → confirm 0회 · N5 유지 · B 초안 유지 · B 선택', async ({ page }) => {
  await instrument(page, { holdBlock: null, failBlock: B });
  await editDraft(page, A, 'Saved A');
  await editDraft(page, B, 'Failing B');
  await editDraft(page, C, 'Untouched C');
  await page.getByTestId('n5-confirm-button').click();

  await expect(page.getByTestId('n5-confirm-error')).toContainText('저장하지 못한 번역문');
  await page.waitForTimeout(1_000);
  const entries = await log(page);
  expect(entries.filter((entry) => entry.startsWith('PATCH'))).toEqual([`PATCH start ${A}`, `PATCH ok ${A}`, `PATCH start ${B}`, `PATCH fail ${B}`]);
  expect(await confirms(page)).toBe(0);
  await expect(page.getByTestId('n5-panel')).toBeVisible();
  await expect(page.getByTestId(`n5-block-editor-${B}`)).toHaveValue('Failing B');
  await expect(page.getByTestId(`n5-block-editor-${C}`)).toHaveValue('Untouched C');
  await expect(page.getByTestId(`n5-block-row-${B}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-confirm-button')).toBeEnabled();
});

test('Case 5 — PATCH 409 REVISION_CONFLICT → confirm 0회 · N5 유지 · 충돌 표시 유지', async ({ page }) => {
  await instrument(page, { holdBlock: null, failBlock: null });
  await editDraft(page, B, 'My conflicting draft');
  // 다른 클라이언트가 먼저 같은 block 을 저장해 서버 revision 을 올린다(화면 캐시를 거치지 않는 직접 요청)
  const setupStatus = await page.evaluate(
    async ([jobId, blockId]) => {
      const blocks = (await (await fetch(`/jobs/${jobId}/blocks`)).json()) as { id: number; revision: number }[];
      const current = blocks.find((block) => block.id === blockId)!;
      const res = await fetch(`/jobs/${jobId}/blocks/${blockId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trans1: 'Other client', revision: current.revision }),
      });
      return res.status;
    },
    [MOCK_JOB_ID, B] as const,
  );
  expect(setupStatus).toBe(200);
  const before = (await log(page)).length;

  await page.getByTestId('n5-confirm-button').click();

  await expect(page.getByTestId(`n5-block-conflict-${B}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('n5-confirm-error')).toContainText('저장하지 못한 번역문');
  await page.waitForTimeout(1_000);
  const entries = (await log(page)).slice(before);
  expect(entries.filter((entry) => entry.startsWith('PATCH'))).toEqual([`PATCH start ${B}`, `PATCH fail(409) ${B}`]);
  expect(await confirms(page)).toBe(0);
  await expect(page.getByTestId('n5-panel')).toBeVisible();
  await expect(page.getByTestId(`n5-block-editor-${B}`)).toHaveValue('My conflicting draft');
  await expect(page.getByTestId(`n5-block-conflict-${B}`)).toBeVisible();
});

test('Case 6 — 저장할 변경 없음 → PATCH 0회 · confirm 1회', async ({ page }) => {
  await instrument(page, { holdBlock: null, failBlock: null });
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  expect((await log(page)).filter((entry) => entry.startsWith('PATCH'))).toEqual([]);
});
