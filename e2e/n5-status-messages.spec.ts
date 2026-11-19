import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 상태 문구 — 각 문구의 trigger(서버 값)를 Mock 으로 직접 만들어 실제로 그려지는지 본다.
//   A 번역 실패  : 블록 signals[].code=translation_failed (?mockScenario=n5-errors · 9111)
//   B 검사 실패  : 블록 check.state=failed (BlockCheck — 계약 확정 FE 11-03). /blocks 응답의 check 를 바꿔 만든다
//   C 미리보기 실패 : 이 칸 저장의 재렌더 task failed (Mock 은 번역문에 「실패유도」가 있으면 재렌더가 실패한다)
//   D 일반 넘침  : 서버 overflow=true 여도 문구 없음(팀 QA 결정 — e2e/n5-overflow-server-source.spec.ts)
//   E 자동 조정  : 블록 autoAdjust 가 오면 표시(Mock fixture 9104 — 현재 서버는 2차에 이 값을 만들지 않는다)
// 다시 시도 버튼은 서버 retryable 이면 활성이다(재시도 흐름은 e2e/n5-task-retry.spec.ts). Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

const row = (page: Page, id: number) => page.getByTestId(`n5-block-row-${id}`);

/** /blocks 응답에서 지정한 블록의 check 를 바꿔 돌려준다 */
async function overrideCheck(page: Page, blockId: number, state: string) {
  await page.addInitScript(
    ({ blockId, state }) => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET' || !/^\/jobs\/[^/]+\/blocks$/.test(url.pathname) || !response.ok) return response;
        const blocks = (await response.clone().json()) as { id: number; check?: unknown }[];
        const next = blocks.map((block) => (block.id === blockId ? { ...block, check: { inputKey: 'k', state } } : block));
        return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    },
    { blockId, state },
  );
}

test('A 번역 실패 — translation_failed signal 이면 「번역하지 못했습니다」·직접 입력 안내', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-errors' });
  await expect(row(page, 9111).getByTestId('n5-cell-failure-translate')).toHaveText('번역하지 못했습니다');
  await expect(page.getByTestId('n5-block-editor-9111')).toHaveAttribute('placeholder', '번역문을 직접 입력하세요');
  // 번역 실패 [다시 시도]는 12월 범위 — signal 의 retryable=true 여도 비활성이다(n5-task-retry.spec.ts 가 요청 0회를 본다)
  await expect(page.getByTestId('n5-block-translate-retry-9111')).toHaveAttribute('aria-disabled', 'true');
});

test('B 검사 실패 — 블록 check.state=failed 면 「검사하지 못했습니다」, settled 면 없음', async ({ page }) => {
  await overrideCheck(page, 9101, 'failed');
  await reachN5(page);
  await expect(row(page, 9101).getByTestId('n5-cell-failure-verify')).toHaveText('검사하지 못했습니다');
  // 다른 블록(check 없음)에는 없다
  await expect(row(page, 9102).getByTestId('n5-cell-failure-verify')).toHaveCount(0);
});

test('B 검사 정상 — check.state=settled 면 검사 실패 문구 없음', async ({ page }) => {
  await overrideCheck(page, 9101, 'settled');
  await reachN5(page);
  await expect(page.getByTestId('n5-block-editor-9101')).toBeVisible();
  await expect(row(page, 9101).getByTestId('n5-cell-failure-verify')).toHaveCount(0);
});

test('C 미리보기 실패 — 이 칸 저장의 재렌더가 실패하면 「미리보기를 갱신하지 못했습니다」·다시 시도', async ({ page }) => {
  await reachN5(page);
  const editor = page.getByTestId('n5-block-editor-9102');
  await editor.scrollIntoViewIfNeeded();
  await editor.fill('실패유도 문장');
  await page.getByTestId('n5-block-save-9102').click();
  await expect(row(page, 9102).getByTestId('n5-cell-failure-preview')).toHaveText('미리보기를 갱신하지 못했습니다', { timeout: 20_000 });
  await expect(page.getByTestId('n5-block-preview-retry-9102')).toBeEnabled(); // 재렌더 task 의 retryable=true
});

test('D·E — 일반 넘침 문구는 없고(서버 overflow=true), 받은 autoAdjust 는 「자동 글자 크기 조정 적용됨」으로 보인다', async ({ page }) => {
  await reachN5(page);
  const r = row(page, 9104);
  await r.scrollIntoViewIfNeeded();
  await expect(r).not.toContainText('글자가 넘칩니다');
  await expect(r).not.toContainText('짧은 표현이 필요합니다');
  await expect(r).toContainText('자동 글자 크기 조정 적용됨 (85%)');
});
