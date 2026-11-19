import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { N6_TASK_UNRESOLVED_LIMIT_MS } from '@/lib/queries/n6-render-task';
import { reachN5 } from './helpers/reach-n5';
import { reachN6 } from './helpers/reach-n6';

// ─────────────────────────────────────────────────────────────────
// N6 최종 렌더 — FE 는 POST /render 를 자동으로 보내지 않는다(BE release 44e7164 계약).
// 최초 최종 렌더는 confirm 이 N6 전환과 함께 등록하고, POST /render 는 사용자의 명시적 재렌더·실패 재시도 전용이다.
//
// Mock(MSW) + window.fetch 감싸기(route-stub) 결과다 — 실 BE 연동이 아니다.
// confirm 성공 뒤부터 GET /tasks 응답 본문을 스크립트로 바꿔 끼운다(MSW 에도 그대로 보내 Mock 렌더 상태는 진행시킨다).
// page.route 는 Service Worker 응답을 가로채지 못해 fetch 를 감싼다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

type Item = { taskId: number; taskType: 'render'; unitType: 'job' | 'section' | 'text_block'; unitId: number; status: string };
type Script = { armed: boolean; responses: Item[][]; afterRender: Item[][] | null; cursor: number; log: string[] };

const JOB = Number(MOCK_JOB_ID);
const job = (taskId: number, status: string): Item => ({ taskId, taskType: 'render', unitType: 'job', unitId: JOB, status });

/** GET /tasks 를 responses 순서로 응답한다(마지막은 반복). POST /render 가 오면 afterRender 로 갈아 끼운다. armed 전에는 손대지 않는다 */
async function scriptTasks(page: Page, responses: Item[][], options: { afterRender?: Item[][]; armNow?: boolean } = {}) {
  await page.addInitScript(
    ({ responses, afterRender, armNow }) => {
      const w = window as unknown as { __n6: Script };
      w.__n6 = { armed: armNow, responses, afterRender, cursor: 0, log: [] };
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const { pathname } = new URL(url, location.href);
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const state = w.__n6;
        if (method === 'POST' && pathname.endsWith('/render')) {
          state.log.push('POST render');
          if (state.afterRender) {
            state.responses = state.afterRender;
            state.cursor = 0;
          }
        }
        if (method === 'POST' && pathname.endsWith('/confirm')) {
          const response = await original(input, init);
          if (response.ok) state.armed = true;
          return response;
        }
        if (method === 'GET' && pathname.endsWith('/tasks') && state.armed) {
          await original(input, init); // Mock 렌더 진행 상태만 앞으로 보낸다
          const items = state.responses[Math.min(state.cursor, state.responses.length - 1)];
          state.cursor += 1;
          state.log.push(`GET tasks [${items.map((item) => `${item.unitType}/${item.taskId}/${item.status}`).join(',')}]`);
          const body = { jobStatus: 'running', currentStep: 'N6', userFacingStatus: 'reviewing', items };
          return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return original(input, init);
      };
    },
    { responses, afterRender: options.afterRender ?? null, armNow: options.armNow ?? false },
  );
}

const log = (page: Page) => page.evaluate(() => (window as unknown as { __n6: Script }).__n6.log);
const renderPosts = async (page: Page) => (await log(page)).filter((entry) => entry === 'POST render').length;
const taskGets = async (page: Page) => (await log(page)).filter((entry) => entry.startsWith('GET tasks')).length;

async function confirmToN6(page: Page) {
  await reachN5(page, { mockScenario: 'n5-clean' });
  await page.getByTestId('n5-confirm-button').click();
}

test('A. 후보 0건 → 다음 polling 에서 1건(101) — 그 사이 POST /render 0회, 최종적으로 101 사용', async ({ page }) => {
  await scriptTasks(page, [[], [job(101, 'running')], [job(101, 'done')]]);
  await confirmToN6(page);
  await expect(page.getByTestId('n6-export-panel')).toBeVisible({ timeout: 15_000 });
  const entries = await log(page);
  expect(entries.filter((entry) => entry.startsWith('GET tasks')).slice(0, 3)).toEqual([
    'GET tasks []',
    'GET tasks [job/101/running]',
    'GET tasks [job/101/done]',
  ]);
  expect(await renderPosts(page)).toBe(0);
});

test('B. 같은 job 후보 2건 — 어느 것도 고르지 않고 POST /render 0회 · polling 유지', async ({ page }) => {
  await scriptTasks(page, [[job(100, 'done'), job(101, 'running')]]);
  await confirmToN6(page);
  await expect(page.getByTestId('n6-render-ambiguous')).toBeVisible({ timeout: 10_000 });
  // 완료 결과도, 진행 표시도 띄우지 않는다(done 100 · running 101 어느 쪽도 선택하지 않음)
  await expect(page.getByTestId('n6-export-panel')).toHaveCount(0);
  await expect(page.getByTestId('n6-render-progress')).toHaveCount(0);
  const before = await taskGets(page);
  await expect.poll(() => taskGets(page), { timeout: 8_000 }).toBeGreaterThan(before);
  expect(await renderPosts(page)).toBe(0);
});

test('C. 완료된 N6 — 최초 진입과 새로고침 모두 POST /render 0회 · 기존 완료 결과 사용', async ({ page }) => {
  // 최초 진입: confirm 직후부터 현재 최종 렌더 101 이 done 으로 보인다
  await scriptTasks(page, [[job(101, 'done')]]);
  await page.addInitScript(() => {
    // 새로고침 뒤에는 confirm 없이 바로 N6 응답을 받는다(MSW 상태는 새로고침으로 초기화되므로 /tasks 만 완료 상태로 둔다)
    if (sessionStorage.getItem('__n6Reload') === '1') (window as unknown as { __n6: Script }).__n6.armed = true;
  });
  await reachN6(page);
  expect(await renderPosts(page)).toBe(0);

  await page.evaluate(() => sessionStorage.setItem('__n6Reload', '1'));
  await page.reload();
  await expect(page.getByTestId('n6-export-panel')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('n6-render-progress')).toHaveCount(0);
  // 진행 중 task 가 없으니 polling 도 멈춘다 — 그 뒤로도 render 요청 0
  await page.waitForTimeout(4_500);
  expect(await renderPosts(page)).toBe(0);
});

test('D·E. failed 관측 — 사용자 동작 전 POST /render 0회 · [다시 렌더링] 클릭 시 1회 · 새 taskId 108 을 따라간다', async ({ page }) => {
  await scriptTasks(page, [[job(100, 'failed')]], { afterRender: [[job(108, 'running')], [job(108, 'done')]] });
  await confirmToN6(page);
  await expect(page.getByTestId('n6-render-error')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(4_500); // failed 를 본 뒤에도 자동 재시도가 없다
  expect(await renderPosts(page)).toBe(0);

  await page.getByRole('button', { name: '다시 렌더링' }).click();
  await expect(page.getByTestId('n6-export-panel')).toBeVisible({ timeout: 15_000 });
  expect(await renderPosts(page)).toBe(1);
  const gets = (await log(page)).filter((entry) => entry.startsWith('GET tasks'));
  expect(gets).toContain('GET tasks [job/108/running]');
  expect(gets.at(-1)).toBe('GET tasks [job/108/done]');
});

test('F. 0건이 상한을 넘게 이어지면 상태 확인 불가 · polling 중단 · [다시 확인]은 /tasks 재조회만(POST /render 0회)', async ({ page }) => {
  await page.clock.install();
  await scriptTasks(page, [[{ taskId: 999, taskType: 'render', unitType: 'section', unitId: 3, status: 'done' }]]);
  await confirmToN6(page);
  await expect.poll(() => taskGets(page), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('n6-render-status-unknown')).toHaveCount(0);

  await page.clock.fastForward(N6_TASK_UNRESOLVED_LIMIT_MS + 2_000);
  await page.clock.fastForward(2_000);
  await expect(page.getByTestId('n6-render-status-unknown')).toBeVisible({ timeout: 10_000 });

  // polling 중단 — page.tsx·N6 화면 어느 구독도 2초마다 다시 묻지 않는다
  await page.waitForTimeout(500); // 이미 출발한 요청이 끝나기를 기다린다
  const stopped = await taskGets(page);
  for (let i = 0; i < 5; i += 1) {
    await page.clock.fastForward(2_000);
    await page.waitForTimeout(200);
  }
  expect(await taskGets(page)).toBe(stopped);

  await page.getByTestId('n6-render-recheck').click();
  await expect.poll(() => taskGets(page), { timeout: 5_000 }).toBe(stopped + 1);
  await expect(page.getByTestId('n6-render-status-unknown')).toBeVisible();
  expect(await renderPosts(page)).toBe(0);
});
