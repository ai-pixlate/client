import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 규칙 검사 상태(TextBlock.check — BlockCheck · confirmReview 「규칙 검사 연결」).
//   in_progress = 「검사 중…」 · [저장하러 가기] 비활성(이유 안내) · 끝날 때까지 /tasks 추적 뒤 /blocks 재조회
//   missing·outdated = 「검사 준비 중」 · 버튼 활성 / failed = 「검사하지 못했습니다」(e2e/n5-status-messages.spec.ts) / settled = 표시 없음
//   POST /confirm 409 INVALID_STATE · details.reason=check_not_settled → N5 에 남고 안내 · 블록 상태 재조회 · N6 로 가지 않음
// Mock /blocks 에는 check 가 없어 페이지 안에서 응답의 check 를 바꿔 만든다(window.__check). Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

type Control = { check: Record<number, string>; confirm409: boolean; confirmPosts: number };

async function controlServer(page: Page, initial: Record<number, string>) {
  await page.addInitScript((initial) => {
    const w = window as unknown as { __ctl: Control };
    w.__ctl = { check: initial, confirm409: false, confirmPosts: 0 };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && /^\/jobs\/[^/]+\/confirm$/.test(url.pathname)) {
        w.__ctl.confirmPosts += 1;
        if (w.__ctl.confirm409) {
          w.__ctl.confirm409 = false;
          return new Response(
            JSON.stringify({
              error: {
                code: 'INVALID_STATE',
                message: '검사가 끝나지 않은 블록이 있다',
                retryable: false,
                details: { reason: 'check_not_settled', blocks: [{ blockId: 9101, state: 'missing' }], registeredBlockIds: [9101] },
                traceId: 't',
              },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }
      }
      const response = await original(input, init);
      if (method !== 'GET' || !/^\/jobs\/[^/]+\/blocks$/.test(url.pathname) || !response.ok) return response;
      const blocks = (await response.clone().json()) as { id: number }[];
      const next = blocks.map((block) => (w.__ctl.check[block.id] ? { ...block, check: { inputKey: null, state: w.__ctl.check[block.id] } } : block));
      return new Response(JSON.stringify(next), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, initial);
}
const setCtl = (page: Page, patch: Partial<Control>) =>
  page.evaluate((patch) => Object.assign((window as unknown as { __ctl: Control }).__ctl, patch), patch);
const ctl = (page: Page) => page.evaluate(() => (window as unknown as { __ctl: Control }).__ctl);

test('검사 중(in_progress) — 「검사 중…」·[저장하러 가기] 비활성·이유 안내, 검사가 끝나면(settled) 재조회로 풀린다', async ({ page }) => {
  await controlServer(page, { 9101: 'in_progress' });
  await reachN5(page, { mockScenario: 'n5-clean' });
  await expect(page.getByTestId('n5-block-check-9101')).toHaveText('검사 중…');
  const confirm = page.getByTestId('n5-confirm-button');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveAttribute('title', '번역문 검사가 끝나면 저장할 수 있습니다.');
  await expect(page.getByTestId('n5-confirm-check-notice')).toBeVisible();

  // 서버 검사가 끝났다 — /tasks 추적이 /blocks 를 다시 받아 풀린다
  await setCtl(page, { check: { 9101: 'settled' } });
  await expect(page.getByTestId('n5-block-check-9101')).toHaveCount(0, { timeout: 15_000 });
  await expect(confirm).toBeEnabled();
  await expect(page.getByTestId('n5-confirm-check-notice')).toHaveCount(0);
});

test('검사 준비 중(missing·outdated) — 「검사 준비 중」, 버튼은 활성 · 검사 완료(settled)는 표시 없음', async ({ page }) => {
  await controlServer(page, { 9101: 'missing', 9102: 'outdated', 9103: 'settled' });
  await reachN5(page, { mockScenario: 'n5-clean' });
  await expect(page.getByTestId('n5-block-check-9101')).toHaveText('검사 준비 중');
  await expect(page.getByTestId('n5-block-check-9102')).toHaveText('검사 준비 중');
  await expect(page.getByTestId('n5-block-check-9103')).toHaveCount(0);
  await expect(page.getByTestId('n5-confirm-button')).toBeEnabled();
});

test('409 check_not_settled — N5 에 남아 안내하고 블록 상태를 다시 받으며(검사 중이 되면 버튼 비활성) N6 로 가지 않는다', async ({ page }) => {
  await controlServer(page, {});
  await reachN5(page, { mockScenario: 'n5-clean' });
  // 서버가 확정 요청에서 검사를 등록하고 409 로 답한다 — 그 뒤 /blocks 는 in_progress
  await setCtl(page, { confirm409: true, check: { 9101: 'in_progress' } });
  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByTestId('n5-confirm-error')).toHaveText(
    '번역문 검사가 아직 끝나지 않아 다음 단계로 넘어가지 않았습니다. 검사가 끝나면 다시 저장해 주세요.',
    { timeout: 20_000 },
  );
  expect((await ctl(page)).confirmPosts).toBe(1);
  await expect(page.getByTestId('n5-block-check-9101')).toHaveText('검사 중…');
  await expect(page.getByTestId('n5-confirm-button')).toBeDisabled();
  await page.waitForTimeout(1_000);
  await expect(page.getByText('번역이 완료되었습니다.')).toHaveCount(0);
  await expect(page.getByTestId('n5-panel')).toBeVisible();

  // 검사가 끝나면 다시 저장할 수 있다
  await setCtl(page, { check: { 9101: 'settled' } });
  await expect(page.getByTestId('n5-confirm-button')).toBeEnabled({ timeout: 15_000 });
});
