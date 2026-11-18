import { type Page, expect, test } from '@playwright/test';

import { reachN6 } from './helpers/reach-n6';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N6 [보관함에 저장] · ✕ — 팀 QA 결정.
// - 저장은 서버 저장 성공(POST /jobs/{jobId}/save 200) 뒤에만 보관함(M1 '/')으로 이동한다. 실패하면 N6 에 남아 오류를 보이고 다시 시도할 수 있다.
// - 디자인에 없는 초록 「보관함에 저장됨」 상태 글자를 두지 않는다.
// - ✕ 는 이번 QA 범위 밖이라 동작을 바꾸지 않았다 — 저장 전후 모두 보이고 기존 작업 취소 확인창을 연다.
// Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

type Req = { method: string; path: string };
function track(page: Page): Req[] {
  const list: Req[] = [];
  page.on('request', (r) => list.push({ method: r.method(), path: new URL(r.url()).pathname }));
  return list;
}
const saves = (rs: Req[]) => rs.filter((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/save`);
const deletes = (rs: Req[]) => rs.filter((r) => r.method === 'DELETE');

test('저장 성공 → 보관함으로 이동하고 저장한 카드가 보인다 · 초록 저장 완료 글자 없음', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);
  await expect(page.getByTestId('n6-save-button')).toHaveText('보관함에 저장');

  await page.getByTestId('n6-save-button').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  expect(saves(requests)).toHaveLength(1);
  await expect(page.getByTestId(`library-card-${MOCK_JOB_ID}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('n6-save-done')).toHaveCount(0);
  await expect(page.getByText('보관함에 저장됨')).toHaveCount(0);
});

test('저장 실패 → N6 에 남아 오류를 보이고, 다시 누르면 저장 뒤 보관함으로 이동한다', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);
  // 첫 저장만 500 으로 돌려준다
  await page.evaluate((jobId) => {
    const original = window.fetch.bind(window);
    let failed = false;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!failed && (init?.method ?? 'GET').toUpperCase() === 'POST' && new URL(url, location.href).pathname === `/jobs/${jobId}/save`) {
        failed = true;
        return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'mock 실패', retryable: true, traceId: 't' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return original(input, init);
    };
  }, MOCK_JOB_ID);

  await page.getByTestId('n6-save-button').click();
  await expect(page.getByTestId('n6-save-error')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  await expect(page.getByTestId('n6-save-button')).toBeEnabled();

  await page.getByTestId('n6-save-button').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  expect(saves(requests)).toHaveLength(1); // 실패한 첫 요청은 page 밖으로 나가지 않았다(가짜 응답) — 실제 저장은 1회
});

test('✕ — 저장 전·저장 뒤 모두 보이고 기존 작업 취소 확인창을 연다(동작은 바꾸지 않았다) · 확인창은 「저장하지 않았다」고 말하지 않는다', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);

  const expectExistingDialog = async () => {
    await expect(page.getByTestId('s0-exit')).toBeVisible();
    await page.getByTestId('s0-exit').click();
    const dialog = page.getByTestId('s0-exit-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('작업을 취소할까요?');
    await expect(dialog).not.toContainText('저장하지');
    await expect(dialog).not.toContainText('저장되지');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  };

  // 저장 전
  await expectExistingDialog();

  // 저장 → 보관함으로 이동. 뒤로가기로 같은 N6 에 다시 들어와도 ✕ 는 그대로 보이고 같은 확인창이다
  // (Mock 서버 상태는 문서를 새로 불러오면 처음으로 돌아가 새로고침 대신 뒤로가기로 다시 들어온다)
  await page.getByTestId('n6-save-button').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 15_000 });
  await expectExistingDialog();
  expect(deletes(requests)).toEqual([]); // 확인창을 닫았으니 DELETE 는 나가지 않는다
});
