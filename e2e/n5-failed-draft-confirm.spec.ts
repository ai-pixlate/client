import { test, expect, type Page } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 저장하지 못한 번역문 확정 안내 — PM 확정(10/29).
//
// 번역문 저장이 실패한 칸이 있어도 [저장하러 가기]를 막지 않고 확인창을 띄운다.
// [취소]는 아무 요청 없이 N5 에 남고, [계속]은 기존 확정(POST /confirm)만 1회 보낸다 —
// 실패한 초안을 다시 저장하지 않는다. 확정 자체가 실패하면 초안·집계가 그대로 남는다.
//
// 블록 PATCH·confirm 실패는 MSW 가 응답하기 전에 window.fetch 를 감싸 만든다
// (page.route 는 MSW Service Worker 응답을 가로채지 못한다 — e2e/n5-confirm.spec.ts 참고).
// ─────────────────────────────────────────────────────────────────

const BLOCK_A = 9101; // 501/title
const BLOCK_B = 9102; // 501/body

type Calls = { blockPatch: number; confirm: number };

/** 가로채기를 켠다. failBlocks=true 면 블록 PATCH 를 500, failConfirm=true 면 confirm 을 500 으로 돌려준다 */
async function intercept(page: Page, opts: { failBlocks: boolean; failConfirm: boolean }) {
  await page.evaluate((opts) => {
    const w = window as unknown as { __calls: Calls; __opts: typeof opts };
    w.__opts = opts;
    if (w.__calls) return; // 이미 감쌌으면 설정만 바꾼다
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

async function failSave(page: Page, blockId: number, text: string) {
  const editor = page.getByTestId(`n5-block-editor-${blockId}`);
  const save = page.getByTestId(`n5-block-save-${blockId}`);
  await editor.scrollIntoViewIfNeeded();
  await editor.fill(text);
  await save.click();
  await expect(save).toHaveText('확인'); // 저장 중 → 실패로 끝남
  await expect(editor).toHaveValue(text);
}

test.beforeEach(async ({ page }) => {
  await reachN5(page);
});

test('실패 칸 없음 → 확인창 없이 바로 확정(저장 시도 전 편집 중 초안은 세지 않는다)', async ({ page }) => {
  await intercept(page, { failBlocks: false, failConfirm: false });
  await page.getByTestId(`n5-block-editor-${BLOCK_A}`).fill('Not saved yet'); // 저장 시도 안 함

  await page.getByTestId('n5-confirm-button').click();

  await expect(page.getByTestId('n5-failed-draft-confirm')).toHaveCount(0);
  await expect.poll(async () => (await calls(page)).confirm).toBe(1);
});

test('실패 칸 1개 → 확인창 N=1 · 버튼은 막지 않는다 · 취소하면 요청 없이 초안 유지', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: false });
  await failSave(page, BLOCK_A, 'Failed draft A');

  const confirmButton = page.getByTestId('n5-confirm-button');
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#n5-failed-draft-title')).toHaveText('저장하지 못한 번역문이 1칸 있습니다.');
  await expect(page.locator('#n5-failed-draft-description')).toHaveText(
    '계속하면 이 칸들은 마지막으로 저장된 문장으로 확정됩니다.',
  );
  await expect(dialog.getByRole('button', { name: '계속' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '취소' })).toBeVisible();

  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(page.getByTestId('n5-failed-draft-confirm')).toHaveCount(0);
  await expect(page.getByTestId(`n5-block-editor-${BLOCK_A}`)).toHaveValue('Failed draft A');
  await expect(page.getByTestId('n5-panel')).toBeVisible();
  expect((await calls(page)).confirm).toBe(0);
  await expect(confirmButton).toBeFocused(); // 닫히면 [저장하러 가기]로 포커스 복귀
});

test('두 칸 실패 → N=2, 같은 칸 다시 실패해도 2', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: false });
  await failSave(page, BLOCK_A, 'Failed draft A');
  await failSave(page, BLOCK_B, 'Failed draft B');
  await page.getByTestId(`n5-block-save-${BLOCK_A}`).click(); // 같은 칸 재시도도 실패
  await expect(page.getByTestId(`n5-block-save-${BLOCK_A}`)).toHaveText('확인');

  await page.getByTestId('n5-confirm-button').click();
  await expect(page.locator('#n5-failed-draft-title')).toHaveText('저장하지 못한 번역문이 2칸 있습니다.');
});

test('Escape → 취소 · 키보드로 계속', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: false });
  await failSave(page, BLOCK_A, 'Failed draft A');

  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // 배경은 inert — 확인창 밖 요소가 막힌다
  expect(await page.getByTestId('n5-panel-body').evaluate((el) => !!el.closest('[inert]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await calls(page)).confirm).toBe(0);

  await page.getByTestId('n5-confirm-button').click();
  await page.keyboard.press('Tab'); // 첫 control = 취소
  await expect(page.getByTestId('n5-failed-draft-cancel')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('n5-failed-draft-continue')).toBeFocused();
  await page.keyboard.press('Tab'); // 확인창 안에서 순환
  await expect(page.getByTestId('n5-failed-draft-cancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter'); // 계속
  await expect.poll(async () => (await calls(page)).confirm).toBe(1);
});

test('계속 → 기존 확정 1회, 실패한 초안은 다시 저장하지 않는다', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: false });
  await failSave(page, BLOCK_A, 'Failed draft A');
  const patchesBefore = (await calls(page)).blockPatch;

  await page.getByTestId('n5-confirm-button').click();
  await page.getByTestId('n5-failed-draft-continue').click();

  await expect.poll(async () => (await calls(page)).confirm).toBe(1);
  await expect(page.getByTestId('n5-panel')).toHaveCount(0, { timeout: 15_000 }); // N6 로 이동
  expect((await calls(page)).blockPatch).toBe(patchesBefore);
});

test('계속 → 확정 실패 → N5 유지 · 초안과 집계가 남아 다시 누르면 확인창', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: true });
  await failSave(page, BLOCK_A, 'Failed draft A');

  await page.getByTestId('n5-confirm-button').click();
  await page.getByTestId('n5-failed-draft-continue').click();

  await expect(page.getByTestId('n5-confirm-error')).toBeVisible();
  await expect(page.getByTestId('n5-panel')).toBeVisible();
  await expect(page.getByTestId(`n5-block-editor-${BLOCK_A}`)).toHaveValue('Failed draft A');
  expect((await calls(page)).confirm).toBe(1);

  await page.getByTestId('n5-confirm-button').click();
  await expect(page.locator('#n5-failed-draft-title')).toHaveText('저장하지 못한 번역문이 1칸 있습니다.');
});

test('초안을 서버값으로 되돌리거나 재저장에 성공하면 집계에서 빠진다', async ({ page }) => {
  await intercept(page, { failBlocks: true, failConfirm: true });
  const editorA = page.getByTestId(`n5-block-editor-${BLOCK_A}`);
  await editorA.scrollIntoViewIfNeeded();
  const originalA = await editorA.inputValue();
  await failSave(page, BLOCK_A, 'Failed draft A');
  await failSave(page, BLOCK_B, 'Failed draft B');

  // A: 서버값과 같게 되돌림 → 빠짐
  await editorA.fill(originalA);
  // B: 재저장 성공 → 빠짐
  await intercept(page, { failBlocks: false, failConfirm: true });
  await page.getByTestId(`n5-block-save-${BLOCK_B}`).click();
  await expect(page.getByTestId(`n5-block-save-${BLOCK_B}`)).toBeDisabled();

  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByTestId('n5-failed-draft-confirm')).toHaveCount(0);
  await expect.poll(async () => (await calls(page)).confirm).toBe(1); // 확인창 없이 바로 확정 요청
});
