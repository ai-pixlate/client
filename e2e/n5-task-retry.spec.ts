import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 실패 작업 [다시 시도] — API-JOB-06 POST /jobs/{jobId}/tasks/{taskId}/retry(n5-task-retry.tsx).
// 실패 상태가 서버에서 받은 taskId 로 요청하고, 응답의 새 taskId 를 /tasks 로 추적해 끝나면 /blocks·/preview 를 다시 받는다.
//   번역 실패(n5-errors 9111 · translate 80101) → 재시도는 이후 기능: 칸에 [다시 시도]가 없다(taskId 는 데이터로만 남는다)
//   미리보기 갱신 실패(이 칸 저장의 재렌더 실패 — 「실패유도」) → 실패 표시 해제 · 최신 미리보기
//   섹션 렌더 실패(n5-errors 섹션 501 · render 80001) → 실행 실패 행 해제
// Mock 재시도 시도는 「실패유도」 규칙을 타지 않고 끝난다(lib/msw/handlers.ts). Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

function trackRetries(page: Page): string[] {
  const posts: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (r.method() === 'POST' && /\/tasks\/\d+\/retry$/.test(path)) posts.push(path);
  });
  return posts;
}

/** 편집 박스(회색) 아래에 다른 요소(재시도 줄 등)가 붙지 않았는가 — 버튼이 빠진 자리에 빈 공간이 남지 않는다 */
const editBoxIsLastInCell = (page: Page, blockId: number) =>
  page.getByTestId(`n5-block-editor-${blockId}`).evaluate((editor) => editor.parentElement?.nextElementSibling == null);

test('번역 실패 칸 — 실패 문구·직접 입력·[확인]은 그대로, [다시 시도]와 안내 말풍선은 없다(서버 retryable=true 여도)', async ({ page }) => {
  const posts = trackRetries(page);
  // 9111 은 translation_failed signal 에 서버 taskId·retryable=true 가 있다(lib/mock-api/n5-error-fixtures.ts) — 이후 기능이라 버튼을 만들지 않는다
  await reachN5(page, { mockScenario: 'n5-errors' });
  const row = page.getByTestId('n5-block-row-9111');
  await expect(row.getByTestId('n5-cell-failure-translate')).toHaveText('번역하지 못했습니다');
  await expect(page.getByTestId('n5-block-translate-retry-9111')).toHaveCount(0);
  await expect(row.getByRole('button', { name: '다시 시도' })).toHaveCount(0);
  await expect(row.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByText('다시 시도는 12월 구현 예정입니다.')).toHaveCount(0);
  expect(await editBoxIsLastInCell(page, 9111)).toBe(true);

  // 번역문은 직접 입력하고 [확인]으로 저장한다
  const editor = page.getByTestId('n5-block-editor-9111');
  await expect(editor).toHaveAttribute('placeholder', '번역문을 직접 입력하세요');
  await expect(editor).toBeEditable();
  await editor.fill('직접 입력한 번역문');
  await expect(editor).toHaveValue('직접 입력한 번역문');
  await expect(page.getByTestId('n5-block-save-9111')).toBeEnabled();
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
});

test('정상 블록 — 재시도 줄·빈 공간이 없다', async ({ page }) => {
  await reachN5(page);
  await expect(page.getByTestId('n5-block-row-9101').locator('[data-testid$="-retry-9101"]')).toHaveCount(0);
  expect(await editBoxIsLastInCell(page, 9101)).toBe(true);
});

test('미리보기 갱신 실패 [미리보기 다시 시도] — 재렌더 재시도 → 「재렌더링 중…」 → 끝나면 실패 해제·최신 미리보기', async ({ page }) => {
  const posts = trackRetries(page);
  await reachN5(page);
  const editor = page.getByTestId('n5-block-editor-9102');
  await editor.scrollIntoViewIfNeeded();
  await editor.fill('실패유도 문장');
  await page.getByTestId('n5-block-save-9102').click();
  const row = page.getByTestId('n5-block-row-9102');
  await expect(row.getByTestId('n5-cell-failure-preview')).toBeVisible({ timeout: 20_000 });

  // 같은 task 를 칸이 보이는 동안 섹션 안내에는 [미리보기 다시 시도]를 다시 내지 않는다(활성 버튼은 칸 하나)
  await expect(page.getByTestId('n5-block-preview-retry-9102')).toBeEnabled();
  await expect(page.locator('[data-testid$="-preview-retry"]')).toHaveCount(0);
  await page.getByTestId('n5-block-preview-retry-9102').click();
  expect(posts).toHaveLength(1);
  await expect(row.getByTestId('n5-cell-failure-preview')).toHaveCount(0, { timeout: 20_000 });
  await expect(row.getByText('재렌더링 중…')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('n5-slice-translated-501')).toHaveAttribute('data-preview-display', 'local-typeset');
  await expect(page.getByTestId('n5-text-layer-501')).toContainText('실패유도 문장');
});

test('섹션 렌더 실패 [렌더링 다시 시도] — 서버 render task 로 재시도 → 끝나면 실행 실패 행 해제', async ({ page }) => {
  const posts = trackRetries(page);
  await reachN5(page, { mockScenario: 'n5-errors' });
  const failedRow = page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-failed');
  await expect(failedRow).toContainText('렌더링');
  const button = page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-render-retry');
  await expect(button).toBeEnabled();
  await button.click();
  expect(posts).toEqual([`/jobs/${MOCK_JOB_ID}/tasks/80001/retry`]);
  // 렌더링 실패가 풀린다(인페인팅 실패는 재시도 계약이 없어 그대로 남는다)
  await expect(failedRow).not.toContainText('렌더링', { timeout: 20_000 });
  await expect(page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-render-retry')).toHaveCount(0);
});

test('재시도 요청이 거절되면(409 RETRY_NOT_ALLOWED) 실패 상태가 그대로 남는다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-errors' });
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if ((init?.method ?? 'GET').toUpperCase() === 'POST' && /\/tasks\/\d+\/retry$/.test(url.pathname)) {
        return new Response(JSON.stringify({ error: { code: 'RETRY_NOT_ALLOWED', message: '다시 시도할 수 없습니다', retryable: false, traceId: 't' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return original(input, init);
    };
  });
  // 번역 실패 칸에는 재시도 버튼이 없어(이후 기능) 섹션 렌더 실패 [렌더링 다시 시도]로 확인한다
  const failedRow = page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-failed');
  await page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-render-retry').click();
  await expect(page.getByTestId('n5-section-header-1').getByTestId('n5-canvas-section-status-render-retry')).toHaveAttribute('data-retry-state', 'request-failed');
  await page.waitForTimeout(1_000);
  await expect(failedRow).toContainText('렌더링');
});
