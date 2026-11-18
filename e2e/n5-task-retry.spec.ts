import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 실패 작업 [다시 시도] — API-JOB-06 POST /jobs/{jobId}/tasks/{taskId}/retry(n5-task-retry.tsx).
// 실패 상태가 서버에서 받은 taskId 로 요청하고, 응답의 새 taskId 를 /tasks 로 추적해 끝나면 /blocks·/preview 를 다시 받는다.
//   번역 실패(n5-errors 9111 · translate 80101) → translation_failed 해제 · 번역문 반영
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

test('번역 실패 [다시 시도] — 서버 taskId 로 재시도 → 진행 중 비활성 → 끝나면 번역 실패 해제·번역문 반영', async ({ page }) => {
  const posts = trackRetries(page);
  await reachN5(page, { mockScenario: 'n5-errors' });
  const row = page.getByTestId('n5-block-row-9111');
  await expect(row.getByTestId('n5-cell-failure-translate')).toBeVisible();
  const button = page.getByTestId('n5-block-translate-retry-9111');
  await expect(button).toBeEnabled();
  await button.click();
  expect(posts).toEqual([`/jobs/${MOCK_JOB_ID}/tasks/80101/retry`]);
  await expect(row.getByTestId('n5-cell-failure-translate')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('n5-block-editor-9111')).not.toHaveValue('');
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
  const failedRow = page.getByTestId('n5-section-status-1-failed');
  await expect(failedRow).toContainText('렌더링');
  const button = page.getByTestId('n5-section-status-1-render-retry');
  await expect(button).toBeEnabled();
  await button.click();
  expect(posts).toEqual([`/jobs/${MOCK_JOB_ID}/tasks/80001/retry`]);
  // 렌더링 실패가 풀린다(인페인팅 실패는 재시도 계약이 없어 그대로 남는다)
  await expect(failedRow).not.toContainText('렌더링', { timeout: 20_000 });
  await expect(page.getByTestId('n5-section-status-1-render-retry')).toHaveCount(0);
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
  const row = page.getByTestId('n5-block-row-9111');
  await page.getByTestId('n5-block-translate-retry-9111').click();
  await expect(page.getByTestId('n5-block-translate-retry-9111')).toHaveAttribute('data-retry-state', 'request-failed');
  await page.waitForTimeout(1_000);
  await expect(row.getByTestId('n5-cell-failure-translate')).toBeVisible();
});
