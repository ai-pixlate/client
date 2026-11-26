import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 규칙 검사 상태(TextBlock.check — BlockCheck · confirmReview 「규칙 검사 연결」).
//   in_progress = 「검사 중…」 · [저장하러 가기] 비활성(이유 안내) · 끝날 때까지 /tasks 추적 뒤 /blocks 재조회
//   missing·outdated = 「검사 준비 중」 · 버튼 활성 / failed = 「검사하지 못했습니다」(e2e/n5-status-messages.spec.ts) / settled = 표시 없음
//   POST /confirm 409 INVALID_STATE · details.reason=check_not_settled → 사용자 오류가 아니라 복구 계약(PM 확정): 오류 안내 없이
//   N5 에 남아 블록 상태를 바로 재조회 → 「검사 중…」 · 기존 /tasks 2초 추적 → settled 면 다시 저장 가능 · N6 로 가지 않음.
//   reason 이 다른 409 는 기존 오류 안내 그대로.
// Mock /blocks 에는 check 가 없어 페이지 안에서 응답의 check 를 바꿔 만든다(window.__check). Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

type Control = {
  check: Record<number, string>;
  confirm409: boolean;
  /** 409 의 details.reason — 기본 check_not_settled */
  confirm409Reason: string;
  confirmPosts: number;
  /** GET /tasks 횟수 — N5 에서는 블록 검사 중(in_progress)일 때만 추적한다 */
  tasksGets: number;
  /** 확정 오류 안내(n5-confirm-error)가 한 번이라도 그려졌는지와 그 문구 */
  errorTexts: string[];
};

async function controlServer(page: Page, initial: Record<number, string>) {
  await page.addInitScript((initial) => {
    const w = window as unknown as { __ctl: Control };
    w.__ctl = { check: initial, confirm409: false, confirm409Reason: 'check_not_settled', confirmPosts: 0, tasksGets: 0, errorTexts: [] };
    const watchError = () =>
      new MutationObserver(() => {
        const text = document.querySelector('[data-testid="n5-confirm-error"]')?.textContent?.trim();
        if (text && w.__ctl.errorTexts.at(-1) !== text) w.__ctl.errorTexts.push(text);
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchError);
    else watchError();
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && /^\/jobs\/[^/]+\/tasks$/.test(url.pathname)) w.__ctl.tasksGets += 1;
      if (method === 'POST' && /^\/jobs\/[^/]+\/confirm$/.test(url.pathname)) {
        w.__ctl.confirmPosts += 1;
        if (w.__ctl.confirm409) {
          w.__ctl.confirm409 = false;
          const reason = w.__ctl.confirm409Reason;
          return new Response(
            JSON.stringify({
              error: {
                code: 'INVALID_STATE',
                message: reason === 'check_not_settled' ? '검사가 끝나지 않은 블록이 있다' : '작업이 확정할 수 있는 단계가 아닙니다.',
                retryable: false,
                details:
                  reason === 'check_not_settled'
                    ? { reason, blocks: [{ blockId: 9101, state: 'outdated' }], registeredBlockIds: [9101] }
                    : { reason },
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

const CHECK_NOT_SETTLED_OLD_ERROR = '번역문 검사가 아직 끝나지 않아 다음 단계로 넘어가지 않았습니다. 검사가 끝나면 다시 저장해 주세요.';

test('A·B·C. 검사 준비 중(outdated) → 확정 → 409 check_not_settled — 오류 안내 없이 바로 「검사 중…」, 기존 /tasks 추적으로 이어져 settled 면 다시 저장할 수 있다', async ({ page }) => {
  await controlServer(page, { 9101: 'outdated' });
  await reachN5(page, { mockScenario: 'n5-clean' });
  // A. 검사 준비 중 — 버튼은 활성(확정 요청이 복구 경로다)
  await expect(page.getByTestId('n5-block-check-9101')).toHaveText('검사 준비 중');
  const confirm = page.getByTestId('n5-confirm-button');
  await expect(confirm).toBeEnabled();
  // N5 에서는 블록 검사 중이 아니면 /tasks 를 묻지 않는다
  await page.waitForTimeout(2_500);
  const tasksBefore = (await ctl(page)).tasksGets;

  // 서버가 확정 요청에서 검사를 등록하고 409 로 답한다 — 그 뒤 /blocks 는 in_progress
  await setCtl(page, { confirm409: true, check: { 9101: 'in_progress' } });
  await confirm.click();
  await expect(page.getByTestId('n5-block-check-9101')).toHaveText('검사 중…', { timeout: 10_000 });
  await expect(confirm).toBeDisabled();
  await expect(page.getByTestId('n5-confirm-check-notice')).toHaveText('번역문 검사가 끝나면 저장할 수 있습니다.');
  expect((await ctl(page)).confirmPosts).toBe(1);

  // C. 기존 검사 추적(/tasks 2초)으로 이어진다
  await expect.poll(async () => (await ctl(page)).tasksGets - tasksBefore, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('번역이 완료되었습니다.')).toHaveCount(0);
  await expect(page.getByTestId('n5-panel')).toBeVisible();

  // 검사가 끝나면 /blocks 재조회로 풀리고 다시 저장할 수 있다
  await setCtl(page, { check: { 9101: 'settled' } });
  await expect(page.getByTestId('n5-block-check-9101')).toHaveCount(0, { timeout: 15_000 });
  await expect(confirm).toBeEnabled();
  await expect(page.getByTestId('n5-confirm-check-notice')).toHaveCount(0);

  // B. 흐름 전체에서 확정 오류 안내가 한 번도 그려지지 않았다(이전 409 안내 문구 포함)
  expect((await ctl(page)).errorTexts).toEqual([]);
  await expect(page.getByTestId('n5-confirm-error')).toHaveCount(0);
  await expect(page.getByText(CHECK_NOT_SETTLED_OLD_ERROR)).toHaveCount(0);
});

test('D. reason 이 check_not_settled 가 아닌 409 INVALID_STATE 는 기존 확정 오류 안내를 그대로 보인다', async ({ page }) => {
  await controlServer(page, {});
  await reachN5(page, { mockScenario: 'n5-clean' });
  await setCtl(page, { confirm409: true, confirm409Reason: 'job_not_editable' });
  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByTestId('n5-confirm-error')).toHaveText('작업이 확정할 수 있는 단계가 아닙니다.', { timeout: 20_000 });
  expect((await ctl(page)).confirmPosts).toBe(1);
  await expect(page.getByTestId('n5-panel')).toBeVisible();
  await expect(page.getByText('번역이 완료되었습니다.')).toHaveCount(0);
});

test('409 check_not_settled(검사 정보 없음 → in_progress) — N5 에 남아 오류 없이 「검사 중…」·버튼 비활성, N6 로 가지 않는다', async ({ page }) => {
  await controlServer(page, {});
  await reachN5(page, { mockScenario: 'n5-clean' });
  // 서버가 확정 요청에서 검사를 등록하고 409 로 답한다 — 그 뒤 /blocks 는 in_progress
  await setCtl(page, { confirm409: true, check: { 9101: 'in_progress' } });
  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByTestId('n5-block-check-9101')).toHaveText('검사 중…', { timeout: 20_000 });
  expect((await ctl(page)).confirmPosts).toBe(1);
  await expect(page.getByTestId('n5-confirm-button')).toBeDisabled();
  await page.waitForTimeout(1_000);
  await expect(page.getByText('번역이 완료되었습니다.')).toHaveCount(0);
  await expect(page.getByTestId('n5-panel')).toBeVisible();
  expect((await ctl(page)).errorTexts).toEqual([]);

  // 검사가 끝나면 다시 저장할 수 있다
  await setCtl(page, { check: { 9101: 'settled' } });
  await expect(page.getByTestId('n5-confirm-button')).toBeEnabled({ timeout: 15_000 });
});

// ── 버튼을 다시 켜는 기준(BE 확정): 409 의 blocks·registeredBlockIds 가 아니라 /blocks 재조회 결과의 「포함 섹션 검사 대상 블록 전체」다.
// 서버 job_block_states() 는 bucket=include 이면서 run_scope 에 든 섹션의 검사 대상 블록에만 상태를 준다(그 밖은 check=null).
// n5-clean fixture 의 서로 다른 포함 섹션: 9101(section 501) · 9103(section 502). 409 의 registeredBlockIds 는 9101 하나뿐이다.
const BLOCK_A = 9101; // section 501
const BLOCK_B = 9103; // section 502
for (const finalB of ['settled', 'failed'] as const) {
  test(`E${finalB === 'failed' ? '·F' : ''}. 다른 포함 섹션(502)의 검사가 남아 있으면 409 로 등록된 블록(501)이 끝나도 비활성 — 전체가 settled/failed(B=${finalB}) 가 된 뒤에만 활성`, async ({ page }) => {
    await controlServer(page, { [BLOCK_A]: 'outdated', [BLOCK_B]: 'outdated' });
    await reachN5(page, { mockScenario: 'n5-clean' });
    const confirm = page.getByTestId('n5-confirm-button');
    const notice = page.getByTestId('n5-confirm-check-notice');
    // 두 블록이 서로 다른 포함 섹션에 있다
    await expect(page.getByTestId(`n5-block-row-${BLOCK_A}`).locator('xpath=ancestor::*[starts-with(@data-testid,"n5-panel-section-")][1]')).toHaveAttribute('data-testid', 'n5-panel-section-1');
    await expect(page.getByTestId(`n5-block-row-${BLOCK_B}`).locator('xpath=ancestor::*[starts-with(@data-testid,"n5-panel-section-")][1]')).toHaveAttribute('data-testid', 'n5-panel-section-2');
    await expect(page.getByTestId(`n5-block-check-${BLOCK_A}`)).toHaveText('검사 준비 중');
    await expect(page.getByTestId(`n5-block-check-${BLOCK_B}`)).toHaveText('검사 준비 중');
    await expect(confirm).toBeEnabled();

    // 1. 확정 → 409 check_not_settled(registeredBlockIds=[9101] 만). 재조회한 /blocks 에서는 두 섹션 모두 in_progress
    await setCtl(page, { confirm409: true, check: { [BLOCK_A]: 'in_progress', [BLOCK_B]: 'in_progress' } });
    await confirm.click();
    await expect(page.getByTestId(`n5-block-check-${BLOCK_A}`)).toHaveText('검사 중…', { timeout: 10_000 });
    await expect(page.getByTestId(`n5-block-check-${BLOCK_B}`)).toHaveText('검사 중…');
    await expect(confirm).toBeDisabled();
    expect((await ctl(page)).confirmPosts).toBe(1);

    // 2. 409 로 등록된 A 만 끝났다(settled) — 다른 섹션 B 가 in_progress 라 버튼은 계속 비활성 · 안내 유지 · /tasks 추적 유지
    await setCtl(page, { check: { [BLOCK_A]: 'settled', [BLOCK_B]: 'in_progress' } });
    await expect(page.getByTestId(`n5-block-check-${BLOCK_A}`)).toHaveCount(0, { timeout: 15_000 });
    const tasksAtASettled = (await ctl(page)).tasksGets;
    await expect(page.getByTestId(`n5-block-check-${BLOCK_B}`)).toHaveText('검사 중…');
    await expect(confirm).toBeDisabled();
    await expect(notice).toHaveText('번역문 검사가 끝나면 저장할 수 있습니다.');
    await expect.poll(async () => (await ctl(page)).tasksGets - tasksAtASettled, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect(confirm).toBeDisabled();
    expect((await ctl(page)).confirmPosts).toBe(1);

    // 3. B 도 끝났다(settled 또는 failed) — 포함 섹션 검사 대상 전체가 settled/failed 라 다시 저장할 수 있다
    await setCtl(page, { check: { [BLOCK_A]: 'settled', [BLOCK_B]: finalB } });
    await expect(confirm).toBeEnabled({ timeout: 15_000 });
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId(`n5-block-check-${BLOCK_B}`)).toHaveCount(0);
    // failed 는 확정을 막지 않고 블록에 「검사하지 못했습니다」만 보인다(e2e/n5-status-messages.spec.ts)
    if (finalB === 'failed') await expect(page.getByTestId(`n5-block-row-${BLOCK_B}`)).toContainText('검사하지 못했습니다');
    // 검사가 끝나면 추적을 멈춘다
    const tasksAtDone = (await ctl(page)).tasksGets;
    await page.waitForTimeout(4_500);
    expect((await ctl(page)).tasksGets - tasksAtDone).toBeLessThanOrEqual(1);

    // 409 흐름 전체에서 확정 오류 안내는 한 번도 그려지지 않았다
    expect((await ctl(page)).errorTexts).toEqual([]);
  });
}
