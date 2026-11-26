import { type Page, expect, test } from '@playwright/test';

import { reachN6 } from './helpers/reach-n6';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N6 [저장하고 보관함으로 가기] · 나가기 — 팀 QA 결정.
// - 저장은 서버 저장 성공(POST /jobs/{jobId}/save 200) 뒤에만 보관함(M1 '/')으로 이동한다. 실패하면 N6 에 남아 오류를 보이고 다시 시도할 수 있다.
// - 디자인에 없는 초록 「보관함에 저장됨」 상태 글자를 두지 않는다.
// - 나가기(12월 — ✕ 없음 · 상단 메뉴 로고로 본다) — 저장 여부의 정본은 서버 job.isSaved 다. isSaved=true(저장 성공 직후 cache 포함)면
//   작업 취소 확인창·DELETE 없이 보관함으로 바로 간다. 저장 전·저장 중·저장 실패는 기존 작업 취소 확인창을 그대로 연다(저장한 결과물을
//   취소로 지우지 않게 하는 P0 수정). 완료 여부는 화면 루트 data-exit-guard(on/off)로 기다린다.
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
  await expect(page.getByTestId('n6-save-button')).toHaveText('저장하고 보관함으로 이동');

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

const exitButton = (page: Page) => page.getByTestId('job-header-home');
const exitGuard = (page: Page) => page.locator('[data-exit-guard]');
const exitDialog = (page: Page) => page.getByTestId('s0-exit-dialog');
const N6_URL = new RegExp(`/jobs/${MOCK_JOB_ID}$`);

/** 페이지 안 fetch 를 감싼다 — DELETE 를 센다(MSW 로 가기 전 단계라 서버 도달 여부와 무관하게 「보냈는지」를 본다).
 *  save: 'delay' 는 저장 응답을 ms 만큼 늦추고, 'fail' 은 500 을 준다. rscDelayMs 는 보관함('/') 이동용 RSC 요청을 늦춘다. */
async function instrument(page: Page, opts: { save?: 'delay' | 'fail'; saveDelayMs?: number; rscDelayMs?: number } = {}) {
  await page.evaluate(
    ({ jobId, save, saveDelayMs, rscDelayMs }) => {
      const w = window as unknown as { __deletes: string[] };
      w.__deletes = [];
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(raw, location.href);
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method === 'DELETE') w.__deletes.push(url.pathname);
        if (method === 'POST' && url.pathname === `/jobs/${jobId}/save`) {
          if (save === 'fail') {
            return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'mock 실패', retryable: true, traceId: 't' } }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (save === 'delay') await new Promise((r) => setTimeout(r, saveDelayMs));
        }
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (rscDelayMs && url.pathname === '/' && (headers.has('RSC') || url.searchParams.has('_rsc'))) {
          await new Promise((r) => setTimeout(r, rscDelayMs));
        }
        return original(input, init);
      };
    },
    { jobId: MOCK_JOB_ID, save: opts.save, saveDelayMs: opts.saveDelayMs ?? 0, rscDelayMs: opts.rscDelayMs ?? 0 },
  );
}
const pageDeletes = (page: Page) => page.evaluate(() => (window as unknown as { __deletes: string[] }).__deletes);

/** 기존 작업 취소 확인창이 뜨는지 — 닫으면(Escape) DELETE 는 나가지 않는다 */
async function expectCancelDialogThenDismiss(page: Page) {
  await exitButton(page).click();
  await expect(exitDialog(page)).toBeVisible();
  await expect(exitDialog(page)).toContainText('작업을 취소할까요?');
  await page.keyboard.press('Escape');
  await expect(exitDialog(page)).toHaveCount(0);
}

test('F. 저장 전 N6 — 나가기는 기존 작업 취소 확인창을 연다(「저장하지 않았다」고 말하지 않는다)', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);
  await instrument(page);
  await expect(exitGuard(page)).toHaveAttribute('data-exit-guard', 'on');
  await exitButton(page).click();
  await expect(exitDialog(page)).toContainText('작업을 취소할까요?');
  await expect(exitDialog(page)).not.toContainText('저장하지');
  await expect(exitDialog(page)).not.toContainText('저장되지');
  await page.keyboard.press('Escape');
  await expect(exitDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(N6_URL);
  expect(await pageDeletes(page)).toEqual([]);
  expect(deletes(requests)).toEqual([]);
});

test('A. 저장 성공 · 서버 재조회로 isSaved=true 확인 뒤(이동 전) 나가기 — 확인창 없이 보관함으로, DELETE 0건', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);
  // 보관함 이동을 늦춰 N6 에 머무는 동안 로고를 누를 수 있게 한다
  await instrument(page, { rscDelayMs: 4_000 });
  const savedJobRefetch = page.waitForResponse(async (r) => {
    if (r.request().method() !== 'GET' || new URL(r.url()).pathname !== `/jobs/${MOCK_JOB_ID}`) return false;
    return ((await r.json().catch(() => null)) as { isSaved?: boolean } | null)?.isSaved === true;
  });

  await page.getByTestId('n6-save-button').click();
  await savedJobRefetch; // 서버 job.isSaved=true
  await expect(page).toHaveURL(N6_URL);
  await expect(exitGuard(page)).toHaveAttribute('data-exit-guard', 'off');
  await exitButton(page).click();
  await expect(exitDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByTestId(`library-card-${MOCK_JOB_ID}`)).toBeVisible({ timeout: 10_000 });
  expect(saves(requests)).toHaveLength(1);
  expect(await pageDeletes(page)).toEqual([]);
  expect(deletes(requests)).toEqual([]);
});

test('B. 저장 성공 응답 직후(cache 반영 · 이동 전) 나가기 — 확인창 없음, DELETE 0건', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);
  await instrument(page, { rscDelayMs: 4_000 });
  const saveResponse = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/save`);

  await page.getByTestId('n6-save-button').click();
  expect((await saveResponse).status()).toBe(200);
  // 성공 콜백이 cache 를 isSaved=true 로 바꾼 직후 — 이동(지연)은 아직 끝나지 않았다
  await expect(exitGuard(page)).toHaveAttribute('data-exit-guard', 'off');
  await expect(page).toHaveURL(N6_URL);
  await exitButton(page).click();
  await expect(exitDialog(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(exitDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  expect(await pageDeletes(page)).toEqual([]);
  expect(deletes(requests)).toEqual([]);
});

test('C. 저장 → 보관함 → 뒤로 가기로 N6 재진입 → 나가기 — 확인창 없이 보관함으로, DELETE 0건', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);
  await instrument(page);

  await page.getByTestId('n6-save-button').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  // Mock 서버 상태는 문서를 새로 불러오면 처음으로 돌아가 새로고침 대신 뒤로가기로 다시 들어온다
  await page.goBack();
  await expect(page).toHaveURL(N6_URL);
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 15_000 });
  await expect(exitGuard(page)).toHaveAttribute('data-exit-guard', 'off');
  await exitButton(page).click();
  await expect(exitDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  expect(saves(requests)).toHaveLength(1);
  expect(await pageDeletes(page)).toEqual([]);
  expect(deletes(requests)).toEqual([]);
});

test('D. 저장 중(응답 지연) 나가기 — 기존 작업 취소 확인창이 뜨고, 닫으면 DELETE 없음', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);
  await instrument(page, { save: 'delay', saveDelayMs: 5_000 });

  await page.getByTestId('n6-save-button').click();
  await expect(page.getByTestId('n6-save-button')).toHaveText('저장하는 중…');
  await expect(exitGuard(page)).toHaveAttribute('data-exit-guard', 'on');
  await expectCancelDialogThenDismiss(page);
  await expect(page).toHaveURL(N6_URL);
  expect(await pageDeletes(page)).toEqual([]);
  expect(deletes(requests)).toEqual([]);
});

test('E. 저장 실패(500) 뒤 나가기 — 저장 완료로 보지 않고 기존 작업 취소 확인창을 연다', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);
  await instrument(page, { save: 'fail' });

  await page.getByTestId('n6-save-button').click();
  await expect(page.getByTestId('n6-save-error')).toBeVisible();
  await expect(page.getByTestId('n6-save-button')).toHaveText('저장하고 보관함으로 이동');
  await expect(exitGuard(page)).toHaveAttribute('data-exit-guard', 'on');
  await expectCancelDialogThenDismiss(page);
  await expect(page).toHaveURL(N6_URL);
  expect(await pageDeletes(page)).toEqual([]);
  expect(deletes(requests)).toEqual([]);
});
