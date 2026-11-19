import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 실패 작업 [다시 시도] — API-JOB-06 POST /jobs/{jobId}/tasks/{taskId}/retry(n5-task-retry.tsx).
// 실패 상태가 서버에서 받은 taskId 로 요청하고, 응답의 새 taskId 를 /tasks 로 추적해 끝나면 /blocks·/preview 를 다시 받는다.
//   번역 실패(n5-errors 9111 · translate 80101) → 12월 범위: [다시 시도]는 비활성 · 12월 안내 · 요청 없음(taskId 는 데이터로만 남는다)
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

test('번역 실패 [다시 시도] — 12월 범위: 보이지만 비활성 · 12월 안내 · 눌러도 재시도 요청 0회 · 직접 입력 가능', async ({ page }) => {
  const posts = trackRetries(page);
  await reachN5(page, { mockScenario: 'n5-errors' });
  const row = page.getByTestId('n5-block-row-9111');
  await expect(row.getByTestId('n5-cell-failure-translate')).toHaveText('번역하지 못했습니다');
  const button = page.getByTestId('n5-block-translate-retry-9111');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('다시 시도');
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).toHaveCSS('cursor', 'not-allowed');
  // Figma Button Secondary · XS · Disabled(57:1450) — BG/subtle 면 · 선 없음 · 24 높이 그대로. hover 해도 활성 모양이 되지 않는다
  await expect(button).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(button).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  expect((await button.boundingBox())!.height).toBe(24);
  const tooltip = page.getByTestId('n5-block-translate-retry-9111-tooltip');
  await expect(tooltip).toBeHidden();
  // 키보드 focus 로도 안내가 보인다
  await button.focus();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText('다시 시도는 12월 구현 예정입니다.');
  await button.blur();
  await expect(tooltip).toBeHidden();
  await button.hover();
  await expect(button).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(tooltip).toBeVisible();
  // 말풍선은 Figma 1090:10048 모양(흰 면 · #ff6a38 선 · radius 8)
  await expect(tooltip).toHaveCSS('border-top-color', 'rgb(255, 106, 56)');
  await expect(tooltip).toHaveCSS('border-top-left-radius', '8px');
  expect((await tooltip.boundingBox())!.y + (await tooltip.boundingBox())!.height).toBeLessThanOrEqual((await button.boundingBox())!.y);
  await expect(tooltip).toHaveText('다시 시도는 12월 구현 예정입니다.');
  await expect(button).toHaveAttribute('aria-describedby', (await tooltip.getAttribute('id'))!);
  // aria-disabled 라 Playwright 기본 클릭은 기다린다 — 실제로 눌러도 요청이 없는지 force 로 확인한다
  await button.click({ force: true });
  await button.press('Enter');
  await page.waitForTimeout(1_000);
  expect(posts).toEqual([]);
  await expect(row.getByTestId('n5-cell-failure-translate')).toBeVisible();
  // 번역문은 직접 입력할 수 있다
  const editor = page.getByTestId('n5-block-editor-9111');
  await expect(editor).toBeEditable();
  await editor.fill('직접 입력한 번역문');
  await expect(editor).toHaveValue('직접 입력한 번역문');
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
  // 번역 실패 재시도는 12월 범위라 섹션 렌더 실패 [렌더링 다시 시도]로 확인한다
  const failedRow = page.getByTestId('n5-section-status-1-failed');
  await page.getByTestId('n5-section-status-1-render-retry').click();
  await expect(page.getByTestId('n5-section-status-1-render-retry')).toHaveAttribute('data-retry-state', 'request-failed');
  await page.waitForTimeout(1_000);
  await expect(failedRow).toContainText('렌더링');
});
