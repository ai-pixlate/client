import { test, expect, type Page } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 미저장·저장 실패 번역문과 [저장하러 가기].
//
// [저장하러 가기] = N5 최종 저장이다. 서버값과 다른 번역문 초안은 확정 전에 칸의 [확인]과 같은 PATCH 경로로 저장하고,
// 하나라도 실패(4xx·5xx·409·네트워크)하면 POST /confirm 을 보내지 않고 N5 에 남는다(초안 유지·안내).
// 이전 정책(10/29: 저장하지 못한 칸이 있어도 확인창에서 [계속]하면 마지막 저장값으로 확정)은
// 「N5 에서 수정한 내용이 N6 에서 사라지면 안 된다」는 요구로 바뀌었다.
//
// 블록 PATCH·confirm 실패는 MSW 가 응답하기 전에 window.fetch 를 감싸 만든다
// (page.route 는 MSW Service Worker 응답을 가로채지 못한다 — e2e/n5-confirm.spec.ts 참고).
// ─────────────────────────────────────────────────────────────────

const BLOCK_A = 9101; // 501/title
const BLOCK_B = 9102; // 501/body

type Calls = { blockPatch: number; confirm: number; order: string[] };

/** 가로채기를 켠다. failBlocks=true 면 블록 PATCH 를 500, failConfirm=true 면 confirm 을 500 으로 돌려준다 */
async function intercept(page: Page, opts: { failBlocks: boolean; failConfirm: boolean }) {
  await page.evaluate((opts) => {
    const w = window as unknown as { __calls: Calls; __opts: typeof opts };
    w.__opts = opts;
    if (w.__calls) return; // 이미 감쌌으면 설정만 바꾼다
    w.__calls = { blockPatch: 0, confirm: 0, order: [] };
    const originalFetch = window.fetch.bind(window);
    const fail = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'mock 실패', retryable: true, traceId: 't' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const block = url.match(/\/blocks\/(\d+)$/);
      if (init?.method === 'PATCH' && block) {
        w.__calls.blockPatch += 1;
        w.__calls.order.push(`PATCH ${block[1]}`);
        if (w.__opts.failBlocks) return fail();
      }
      if (init?.method === 'POST' && url.endsWith('/confirm')) {
        w.__calls.confirm += 1;
        w.__calls.order.push('POST confirm');
        if (w.__opts.failConfirm) return fail();
      }
      return originalFetch(input, init);
    };
  }, opts);
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Calls }).__calls);

async function failSave(page: Page, blockId: number, text: string) {
  const editor = page.getByTestId(`n5-block-editor-${blockId}`);
  const save = page.getByTestId(`n5-block-save-${blockId}`);
  await editor.scrollIntoViewIfNeeded();
  await editor.fill(text);
  await save.click();
  await expect(save).toHaveText('확인'); // 저장 중 → 실패로 끝남
  await expect(editor).toHaveValue(text);
}

/** 확정이 저장 실패로 거절됐는지 — 안내가 보이고 버튼이 다시 쓸 수 있게 된다 */
async function expectRefused(page: Page) {
  await expect(page.getByTestId('n5-confirm-error')).toContainText('저장하지 못한 번역문');
  await expect(page.getByTestId('n5-confirm-button')).toBeEnabled();
  await expect(page.getByTestId('n5-review-dialog')).toHaveCount(0); // 저장 실패를 확인창으로 넘기지 않는다
  await expect(page.getByTestId('n5-panel')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-clean' });
});

test('편집 중(저장 시도 전) 초안 → [저장하러 가기]가 먼저 저장(PATCH) → 성공 뒤 확정 1회', async ({ page }) => {
  await intercept(page, { failBlocks: false, failConfirm: true });
  await page.getByTestId(`n5-block-editor-${BLOCK_A}`).fill('Not saved yet');

  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(async () => (await calls(page)).confirm, { timeout: 20_000 }).toBe(1);
  expect((await calls(page)).order).toEqual([`PATCH ${BLOCK_A}`, 'POST confirm']);
  await expect(page.getByTestId('n5-review-dialog')).toHaveCount(0);
});

test('저장 실패한 칸 → 버튼은 막지 않는다 · 다시 저장 시도도 실패하면 확정 0건 · N5 유지 · 초안 유지', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: false });
  await failSave(page, BLOCK_A, 'Failed draft A');
  const patchesBefore = (await calls(page)).blockPatch;

  const confirmButton = page.getByTestId('n5-confirm-button');
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expectRefused(page);
  expect((await calls(page)).blockPatch).toBe(patchesBefore + 1);
  expect((await calls(page)).confirm).toBe(0);
  await expect(page.getByTestId(`n5-block-editor-${BLOCK_A}`)).toHaveValue('Failed draft A');
  await expect(page.getByTestId(`n5-block-row-${BLOCK_A}`)).toHaveAttribute('aria-pressed', 'true'); // 실패한 칸으로 안내
});

test('두 칸 실패 → 첫 실패에서 멈추고 확정하지 않는다 · 둘 다 초안 유지', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: false });
  await failSave(page, BLOCK_A, 'Failed draft A');
  await failSave(page, BLOCK_B, 'Failed draft B');
  const patchesBefore = (await calls(page)).blockPatch;

  await page.getByTestId('n5-confirm-button').click();

  await expectRefused(page);
  expect((await calls(page)).blockPatch).toBe(patchesBefore + 1);
  expect((await calls(page)).confirm).toBe(0);
  await expect(page.getByTestId(`n5-block-editor-${BLOCK_A}`)).toHaveValue('Failed draft A');
  await expect(page.getByTestId(`n5-block-editor-${BLOCK_B}`)).toHaveValue('Failed draft B');
});

test('저장 실패 뒤 서버가 회복되면 [저장하러 가기]가 두 칸을 모두 저장하고 확정 1회', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: true });
  await failSave(page, BLOCK_A, 'Recovered draft A');
  await failSave(page, BLOCK_B, 'Recovered draft B');
  await intercept(page, { failBlocks: false, failConfirm: true });
  const orderBefore = (await calls(page)).order.length;

  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(async () => (await calls(page)).confirm, { timeout: 30_000 }).toBe(1);
  expect((await calls(page)).order.slice(orderBefore)).toEqual([`PATCH ${BLOCK_A}`, `PATCH ${BLOCK_B}`, 'POST confirm']);
  // 확정 자체가 실패하면 N5 에 남고 안내한다
  await expect(page.getByTestId('n5-confirm-error')).toBeVisible();
  await expect(page.getByTestId('n5-panel')).toBeVisible();
});

test('초안을 서버값으로 되돌리면 저장할 것이 없어 바로 확정한다', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: true });
  const editorA = page.getByTestId(`n5-block-editor-${BLOCK_A}`);
  await editorA.scrollIntoViewIfNeeded();
  const originalA = await editorA.inputValue();
  await failSave(page, BLOCK_A, 'Failed draft A');
  await editorA.fill(originalA);
  const patchesBefore = (await calls(page)).blockPatch;

  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(async () => (await calls(page)).confirm, { timeout: 20_000 }).toBe(1);
  expect((await calls(page)).blockPatch).toBe(patchesBefore);
  await expect(page.getByTestId('n5-review-dialog')).toHaveCount(0);
});
