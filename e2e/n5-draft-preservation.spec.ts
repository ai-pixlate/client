import { test, expect, type Page } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 미저장 번역문 초안 보존 — 원문 보기로 바꾸면 TranslationEditor 가 unmount 된다. 초안은 N5Panel 이
// 들고 있으므로(N5 화면 안의 메모리 상태) 번역문 보기로 돌아와도 입력한 문장·실패 상태가 그대로여야 한다.
//
// 블록 PATCH·confirm 실패는 MSW 가 응답하기 전에 window.fetch 를 감싸 만든다
// (page.route 는 MSW Service Worker 응답을 가로채지 못한다 — e2e/n5-confirm.spec.ts 참고).
// ─────────────────────────────────────────────────────────────────

const BLOCK_A = 9101; // 501/title
const BLOCK_B = 9102; // 501/body

type Calls = { blockPatch: number; confirm: number };

async function intercept(page: Page, opts: { failBlocks: boolean; failConfirm: boolean }) {
  await page.evaluate((opts) => {
    const w = window as unknown as { __calls: Calls; __opts: typeof opts };
    w.__opts = opts;
    if (w.__calls) return;
    w.__calls = { blockPatch: 0, confirm: 0 };
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
      if (init?.method === 'PATCH' && /\/blocks\/\d+$/.test(url)) {
        w.__calls.blockPatch += 1;
        if (w.__opts.failBlocks) return fail();
      }
      if (init?.method === 'POST' && url.endsWith('/confirm')) {
        w.__calls.confirm += 1;
        if (w.__opts.failConfirm) return fail();
      }
      return originalFetch(input, init);
    };
  }, opts);
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Calls }).__calls);
const editorOf = (page: Page, id: number) => page.getByTestId(`n5-block-editor-${id}`);
const saveOf = (page: Page, id: number) => page.getByTestId(`n5-block-save-${id}`);

async function failSave(page: Page, blockId: number, text: string) {
  await editorOf(page, blockId).scrollIntoViewIfNeeded();
  await editorOf(page, blockId).fill(text);
  await saveOf(page, blockId).click();
  await expect(saveOf(page, blockId)).toHaveText('확인'); // 저장 중 → 실패로 끝남
  await expect(editorOf(page, blockId)).toHaveValue(text);
}

/** 원문 보기 → 번역문 보기 왕복. 원문 보기에서는 편집기가 실제로 사라진다(unmount) */
async function roundTripViewMode(page: Page) {
  await page.getByTestId('n5-view-mode-original').click();
  await expect(page.locator('[data-testid^="n5-block-editor-"]')).toHaveCount(0);
  await page.getByTestId('n5-view-mode-translated').click();
  await expect(editorOf(page, BLOCK_A)).toBeVisible();
}

async function failedCountInDialog(page: Page): Promise<string | null> {
  await page.getByTestId('n5-confirm-button').click();
  const dialog = page.getByTestId('n5-failed-draft-confirm');
  if ((await dialog.count()) === 0) return null;
  const title = await page.locator('#n5-failed-draft-title').textContent();
  await page.getByTestId('n5-failed-draft-cancel').click();
  return title;
}

test.beforeEach(async ({ page }) => {
  await reachN5(page);
});

test('A. 저장 실패 → 원문 보기 왕복 → 초안·실패 상태·N 그대로', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: false });
  await failSave(page, BLOCK_A, 'Failed draft A');

  await roundTripViewMode(page);

  await expect(editorOf(page, BLOCK_A)).toHaveValue('Failed draft A');
  await expect(saveOf(page, BLOCK_A)).toBeEnabled(); // 편집 중(미저장) 상태 그대로 — 다시 저장 가능
  expect(await failedCountInDialog(page)).toBe('저장하지 못한 번역문이 1칸 있습니다.');
  expect((await calls(page)).confirm).toBe(0);
});

test('저장 시도 전 편집 중 초안도 왕복 후 남고, 실패 칸으로 세지 않는다', async ({ page }) => {
  await intercept(page, { failBlocks: false, failConfirm: true });
  await editorOf(page, BLOCK_A).fill('Typing, not saved yet');

  await roundTripViewMode(page);

  await expect(editorOf(page, BLOCK_A)).toHaveValue('Typing, not saved yet');
  expect(await failedCountInDialog(page)).toBeNull(); // 확인창 없이 바로 확정 요청
  await expect.poll(async () => (await calls(page)).confirm).toBe(1);
});

test('B. 저장 성공 → 왕복 → 서버 저장값 · 실패 칸 없음', async ({ page }) => {
  await intercept(page, { failBlocks: false, failConfirm: true });
  await editorOf(page, BLOCK_A).scrollIntoViewIfNeeded();
  await editorOf(page, BLOCK_A).fill('Saved text A');
  await saveOf(page, BLOCK_A).click();
  await expect(saveOf(page, BLOCK_A)).toBeDisabled();

  await roundTripViewMode(page);

  await expect(editorOf(page, BLOCK_A)).toHaveValue('Saved text A');
  await expect(saveOf(page, BLOCK_A)).toBeDisabled(); // 미저장 변경 없음
  const serverText = await page.evaluate(async (jobId) => {
    const res = await fetch(`/jobs/${jobId}/blocks`);
    const blocks = (await res.json()) as { id: number; trans1: string }[];
    return blocks.find((b) => b.id === 9101)?.trans1;
  }, MOCK_JOB_ID);
  expect(serverText).toBe('Saved text A');
  expect(await failedCountInDialog(page)).toBeNull();
});

test('C. 실패 초안을 서버값으로 직접 되돌림 → 실패 칸 제거 → 왕복 후에도 서버값', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: true });
  await editorOf(page, BLOCK_A).scrollIntoViewIfNeeded();
  const original = await editorOf(page, BLOCK_A).inputValue();
  await failSave(page, BLOCK_A, 'Failed draft A');

  await editorOf(page, BLOCK_A).fill(original);
  await expect(saveOf(page, BLOCK_A)).toBeDisabled();

  await roundTripViewMode(page);

  await expect(editorOf(page, BLOCK_A)).toHaveValue(original);
  expect(await failedCountInDialog(page)).toBeNull();
});

test('D. 두 칸 실패 → 왕복 → 둘 다 초안 유지 · N=2', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: false });
  await failSave(page, BLOCK_A, 'Failed draft A');
  await failSave(page, BLOCK_B, 'Failed draft B');

  await roundTripViewMode(page);

  await expect(editorOf(page, BLOCK_A)).toHaveValue('Failed draft A');
  await expect(editorOf(page, BLOCK_B)).toHaveValue('Failed draft B');
  expect(await failedCountInDialog(page)).toBe('저장하지 못한 번역문이 2칸 있습니다.');
});

test('E. 실패 초안 → 계속 → 확정 실패 → N5 유지 · 왕복해도 초안 그대로', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: true });
  await failSave(page, BLOCK_A, 'Failed draft A');
  const patchesBefore = (await calls(page)).blockPatch;

  await page.getByTestId('n5-confirm-button').click();
  await page.getByTestId('n5-failed-draft-continue').click();
  await expect(page.getByTestId('n5-confirm-error')).toBeVisible();
  await expect(editorOf(page, BLOCK_A)).toHaveValue('Failed draft A');

  await roundTripViewMode(page);
  await expect(editorOf(page, BLOCK_A)).toHaveValue('Failed draft A');
  expect((await calls(page)).blockPatch).toBe(patchesBefore); // 실패 초안을 다시 저장하지 않았다
  expect(await failedCountInDialog(page)).toBe('저장하지 못한 번역문이 1칸 있습니다.');
});

test('F. 409 → 초안 유지 · 왕복해도 유지 · [최신 값 불러오기]를 고를 때만 서버값으로', async ({ page }) => {
  const editor = editorOf(page, 9103);
  await page.getByTestId('n5-block-row-9103').click();
  await editor.fill('$99.99 (내 초안)');
  // 다른 클라이언트가 먼저 revision 을 올린다(캐시를 거치지 않는 직접 fetch)
  const status = await page.evaluate(async (jobId) => {
    const res = await fetch(`/jobs/${jobId}/blocks/9103`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trans1: '$50.00 (다른 클라이언트)', revision: 1 }),
    });
    return res.status;
  }, MOCK_JOB_ID);
  expect(status).toBe(200);

  await saveOf(page, 9103).click();
  await expect(page.getByTestId('n5-block-conflict-9103')).toBeVisible();
  await expect(editor).toHaveValue('$99.99 (내 초안)');

  await roundTripViewMode(page);
  await expect(editor).toHaveValue('$99.99 (내 초안)'); // 409 뒤에도 초안은 자동으로 사라지지 않는다
  expect(await failedCountInDialog(page)).toBe('저장하지 못한 번역문이 1칸 있습니다.');

  // 충돌 안내는 편집기 표시 상태라 왕복 뒤 다시 저장하면 다시 뜬다 → 사용자가 최신 값을 고른다
  await saveOf(page, 9103).click();
  await page.getByTestId('n5-block-conflict-load-9103').click();
  await expect(editor).toHaveValue('$50.00 (다른 클라이언트)');
  await roundTripViewMode(page);
  await expect(editor).toHaveValue('$50.00 (다른 클라이언트)');
  expect(await failedCountInDialog(page)).toBeNull();
});
