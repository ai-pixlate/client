import { test, expect, type Page } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 번역문 저장 실패 회귀 — PM 확정(10/29): 번역문 저장이 실패하면 입력한 초안과 편집 중
// 상태를 그대로 둔다(박스·섹션과 달리 마지막 저장 상태로 되돌리지 않는다). 같은 내용으로
// 다시 저장할 수 있어야 한다.
//
// TranslationEditor 동작은 이번에 바꾸지 않았다 — 기존 동작이 이 정책과 맞는지만 고정한다.
// 실패는 MSW 가 응답하기 전에 window.fetch 를 감싸 만든다(e2e/n5-confirm.spec.ts 참고).
// ─────────────────────────────────────────────────────────────────

const BLOCK = 9101;
const ROLLBACK_NOTICE = '변경 사항을 저장하지 못했습니다. 마지막으로 저장된 상태로 돌아갑니다.';

/** 블록 PATCH 를 실패시킨다. mode='http' 는 500 응답, mode='network' 는 응답 없이 reject. 해제 함수를 window 에 둔다 */
async function failBlockPatch(page: Page, mode: 'http' | 'network') {
  await page.evaluate((mode) => {
    const w = window as unknown as { __restoreFetch: () => void };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'PATCH' && /\/blocks\/\d+$/.test(url)) {
        if (mode === 'network') return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'mock 실패', retryable: true, traceId: 't' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return originalFetch(input, init);
    };
    w.__restoreFetch = () => {
      window.fetch = originalFetch;
    };
  }, mode);
}

for (const mode of ['http', 'network'] as const) {
  test(`번역문 저장 실패(${mode}) → 초안 유지 · 되돌림 안내 없음 · 같은 내용으로 다시 저장`, async ({ page }) => {
    await reachN5(page);
    const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
    const save = page.getByTestId(`n5-block-save-${BLOCK}`);
    await editor.scrollIntoViewIfNeeded();
    const original = await editor.inputValue();

    await failBlockPatch(page, mode);
    await editor.fill('Draft that failed to save');
    await save.click();

    // 저장 중 → 실패로 끝난 뒤에도 입력한 초안이 그대로다
    await expect(save).toHaveText('확인');
    await expect(editor).toHaveValue('Draft that failed to save');
    expect(await editor.inputValue()).not.toBe(original);
    // 저장 안 된 초안이라 다시 저장할 수 있다(편집 중 상태 유지)
    await expect(save).toBeEnabled();
    // 박스·섹션용 "마지막으로 저장된 상태로" 안내는 번역문에 쓰지 않는다
    await expect(page.getByText(ROLLBACK_NOTICE)).toHaveCount(0);

    // 같은 내용으로 재시도 → 성공
    const patchBodies: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().endsWith(`/blocks/${BLOCK}`)) patchBodies.push(req.postData() ?? '');
    });
    await page.evaluate(() => (window as unknown as { __restoreFetch: () => void }).__restoreFetch());
    await save.click();
    await expect.poll(() => patchBodies.length).toBe(1);
    expect(JSON.parse(patchBodies[0]).trans1).toBe('Draft that failed to save');
    await expect(save).toBeDisabled(); // 저장됨 → dirty 아님
    await expect(editor).toHaveValue('Draft that failed to save');
  });
}
