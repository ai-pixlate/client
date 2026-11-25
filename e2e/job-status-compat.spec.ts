import { type Page, expect, test } from '@playwright/test';

import type { ApiJobTaskStatus } from '@/lib/api/n5-schema';
import { isCancelledJob } from '@/lib/api/job-status';
import { isJobStateConflict, jobIdFromMutationRequest } from '@/lib/api/job-state-conflict';
import { resolveN6RenderPhase } from '@/lib/queries/n6-render-task';
import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { mockMasterCategories } from '@/lib/mock-api/category-fixtures';

import { pickRegulatoryClass } from './helpers/n1-regulatory-class';
import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// 작업 상태 호환 — 배포된 서버(3.5.10)와 server PR #157(README 7.8 · 미배포)의 응답을 함께 받는다.
// - 취소: 구 서버 archived · 새 서버 cancelled(200) 둘 다 「취소된 작업입니다」 · 편집 화면 · DELETE 없음
// - 변경 요청 409 INVALID_STATE · RETRY_NOT_ALLOWED → JOB-05 재조회 → 취소일 때만 안내. 정상 상태 · 재조회 실패는 기존 오류 처리 유지
// - N6: 구 서버 reviewing(task 로 판단) · 새 서버 rendering · awaiting_save · failed(retryable) · 상태 어긋남은 완료로 추정하지 않음
// - PROCESSING_TIMEOUT: task errorCode 일 뿐 — 서버가 failed 로 바꾼 상태만 따른다(N2 · N4 기존 오류 화면 · N6 은 retryable 그대로)
// 새 서버 응답은 Mock 을 바꾸지 않고 브라우저 fetch 에서 응답을 바꿔 만든다(구 서버 = 기존 Mock 그대로).
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '상태 호환 검증은 Chromium 기준이다');

type Item = NonNullable<ApiJobTaskStatus['items']>[number];
const JOB_NUM = Number(MOCK_JOB_ID);
const JOB_URL = `/jobs/${MOCK_JOB_ID}`;

function renderTask(over: Partial<Item> = {}): Item {
  return {
    taskId: 7001,
    taskType: 'render',
    unitType: 'job',
    unitId: JOB_NUM,
    status: 'running',
    retryCount: 0,
    maxRetry: 3,
    retryable: false,
    errorCode: null,
    revision: null,
    ...over,
  };
}

/** JOB-05 응답 — 새 값(cancelled · rendering · awaiting_save)은 generated 타입 밖이라 문자열로 받는다 */
function tasksBody(jobStatus: string, currentStep: string, userFacingStatus: string, items: Item[] = []) {
  return { jobStatus, currentStep, userFacingStatus, progress: 0.5, total: items.length, done: 0, failedCount: 0, stages: [], items };
}
const asTasks = (body: ReturnType<typeof tasksBody>) => body as unknown as ApiJobTaskStatus;

// ── 순수 함수(브라우저 없이) ────────────────────────────────────

test.describe('상태 판별 함수', () => {
  test('취소 — archived · cancelled 둘 다 취소다. 다른 값 · 응답 없음은 취소가 아니다', () => {
    expect(isCancelledJob(asTasks(tasksBody('archived', 'N3', 'archived')))).toBe(true);
    expect(isCancelledJob(asTasks(tasksBody('cancelled', 'N5', 'cancelled')))).toBe(true);
    // GET /jobs/{id} 는 status 필드다
    expect(isCancelledJob({ status: 'cancelled' })).toBe(true);
    for (const value of ['draft', 'processing', 'review', 'done', 'failed']) {
      expect(isCancelledJob({ jobStatus: value, userFacingStatus: value })).toBe(false);
    }
    expect(isCancelledJob(undefined)).toBe(false);
    expect(isCancelledJob(null)).toBe(false);
  });

  test('409 재확인 신호 — INVALID_STATE · RETRY_NOT_ALLOWED 만. 다른 409 · 다른 status 는 아니다', () => {
    const body = (code: string) => ({ error: { code, message: 'm', retryable: false, traceId: 't' } });
    expect(isJobStateConflict(409, body('INVALID_STATE'))).toBe(true);
    expect(isJobStateConflict(409, body('RETRY_NOT_ALLOWED'))).toBe(true);
    for (const code of ['REVISION_CONFLICT', 'ALL_SECTIONS_EXCLUDED', 'CONFLICT']) expect(isJobStateConflict(409, body(code))).toBe(false);
    expect(isJobStateConflict(400, body('INVALID_STATE'))).toBe(false);
    expect(isJobStateConflict(409, null)).toBe(false);
  });

  test('409 재확인 대상 경로 — /jobs/{id} 아래 GET 이 아닌 요청. 작업 취소(DELETE /jobs/{id}) · 조회는 아니다', () => {
    expect(jobIdFromMutationRequest('/jobs/12/sections/proceed', 'POST')).toBe('12');
    expect(jobIdFromMutationRequest('/jobs/12', 'PATCH')).toBe('12');
    expect(jobIdFromMutationRequest('/jobs/12/source-images/3', 'DELETE')).toBe('12');
    expect(jobIdFromMutationRequest('/jobs/12/tasks/9/retry', 'POST')).toBe('12');
    expect(jobIdFromMutationRequest('/jobs/12', 'DELETE')).toBeNull();
    expect(jobIdFromMutationRequest('/jobs/12/tasks', 'GET')).toBeNull();
    expect(jobIdFromMutationRequest('/jobs/12/tasks', undefined)).toBeNull();
    expect(jobIdFromMutationRequest('/brands/3', 'PATCH')).toBeNull();
  });

  test('N6 — 구 서버 reviewing 은 task 상태로 가른다', () => {
    const phase = (status: Item['status'], retryable = false) =>
      resolveN6RenderPhase(asTasks(tasksBody('review', 'N6', 'reviewing', [renderTask({ status, retryable })])), MOCK_JOB_ID).kind;
    expect(phase('running')).toBe('rendering');
    expect(phase('pending')).toBe('rendering');
    expect(phase('done')).toBe('ready');
    expect(phase('failed', true)).toBe('failed');
  });

  test('N6 — 새 서버 rendering · awaiting_save · done · failed', () => {
    const at = (jobStatus: string, ufs: string, over: Partial<Item>) =>
      resolveN6RenderPhase(asTasks(tasksBody(jobStatus, 'N6', ufs, [renderTask(over)])), MOCK_JOB_ID);
    expect(at('processing', 'rendering', { status: 'running' }).kind).toBe('rendering');
    expect(at('review', 'awaiting_save', { status: 'done' }).kind).toBe('ready');
    expect(at('done', 'done', { status: 'done' }).kind).toBe('ready');
    expect(at('failed', 'failed', { status: 'failed', retryable: true })).toMatchObject({ kind: 'failed', retryable: true });
    expect(at('failed', 'failed', { status: 'failed', retryable: false })).toMatchObject({ kind: 'failed', retryable: false });
  });

  test('N6 retryable — retryCount < maxRetry 로 추정하지 않는다(값이 true 일 때만)', () => {
    const failed = (over: Partial<Item>) =>
      resolveN6RenderPhase(asTasks(tasksBody('failed', 'N6', 'failed', [renderTask({ status: 'failed', ...over })])), MOCK_JOB_ID);
    // 시간 초과도 errorCode 가 아니라 retryable 을 따른다(server PR #157 211d1f2 · PM 11-25)
    expect(failed({ retryCount: 0, maxRetry: 3, retryable: true, errorCode: 'PROCESSING_TIMEOUT' })).toMatchObject({ retryable: true });
    expect(failed({ retryCount: 0, maxRetry: 3, retryable: false, errorCode: 'PROCESSING_TIMEOUT' })).toMatchObject({ retryable: false });
    expect(failed({ retryCount: 0, maxRetry: 3, retryable: undefined })).toMatchObject({ retryable: false });
    expect(failed({ retryCount: 3, maxRetry: 3, retryable: false })).toMatchObject({ retryable: false });
  });

  test('N6 — 작업 상태와 task 가 어긋나면 완료 · 실패로 추정하지 않는다', () => {
    const at = (jobStatus: string, ufs: string, status: Item['status']) =>
      resolveN6RenderPhase(asTasks(tasksBody(jobStatus, 'N6', ufs, [renderTask({ status })])), MOCK_JOB_ID);
    expect(at('processing', 'rendering', 'done')).toEqual({ kind: 'unresolved', reason: 'mismatch' });
    expect(at('failed', 'failed', 'done')).toEqual({ kind: 'unresolved', reason: 'mismatch' });
    expect(at('processing', 'rendering', 'failed')).toEqual({ kind: 'unresolved', reason: 'mismatch' });
    // 현재 task 0건 · 2건 — 판단하지 않는다(재시도 가능으로도 보지 않는다)
    expect(resolveN6RenderPhase(asTasks(tasksBody('failed', 'N6', 'failed')), MOCK_JOB_ID)).toEqual({ kind: 'unresolved', reason: 'none' });
    const two = [renderTask({ taskId: 1, status: 'failed', retryable: true }), renderTask({ taskId: 2, status: 'failed', retryable: true })];
    expect(resolveN6RenderPhase(asTasks(tasksBody('failed', 'N6', 'failed', two)), MOCK_JOB_ID)).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous',
    });
  });
});

// ── 브라우저 — 응답 대역 ────────────────────────────────────────

interface FakeServer {
  /** 있으면 GET /tasks 가 이 값을 그대로 돌려준다(없으면 Mock 응답) */
  tasks?: unknown;
  /** GET /tasks 를 500 으로 */
  tasksFail?: boolean;
  /** 새 서버 응답으로 바꾸기 — confirm 응답 · N6 /tasks 의 상태를 PR #157 표대로 */
  v157?: boolean;
  /** 지정 요청을 times 번 이 응답으로 */
  rules?: { method: string; path: string; status: number; body: unknown; times: number }[];
}

/** window.__srv 로 응답을 바꾼다. 문서가 바뀌면 처음 설정으로 돌아간다 */
async function installFakeServer(page: Page, initial: FakeServer = {}) {
  await page.addInitScript(
    ({ jobId, config }) => {
      type Rule = { method: string; path: string; status: number; body: unknown; times: number };
      type Body = { currentStep?: string; items?: { taskType?: string; unitType?: string; status?: string }[] };
      const w = window as unknown as {
        __srv: {
          tasks?: unknown;
          tasksFail?: boolean;
          v157?: boolean;
          rules: Rule[];
          saved: boolean;
          tasksCount: number;
          seen: string[];
          writes: string[];
        };
      };
      w.__srv = { rules: [], saved: false, tasksCount: 0, seen: [], writes: [], ...config };
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      const toV157 = (body: Body, saved: boolean) => {
        if (body.currentStep !== 'N6') return body;
        const task = (body.items ?? []).find((i) => i.taskType === 'render' && i.unitType === 'job');
        if (!task) return body;
        if (task.status === 'done') return saved ? { ...body, jobStatus: 'done', userFacingStatus: 'done' } : { ...body, jobStatus: 'review', userFacingStatus: 'awaiting_save' };
        if (task.status === 'failed') return { ...body, jobStatus: 'failed', userFacingStatus: 'failed' };
        return { ...body, jobStatus: 'processing', userFacingStatus: 'rendering' };
      };
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const path = new URL(url, location.href).pathname;
        const method = (init?.method ?? 'GET').toUpperCase();
        const srv = w.__srv;
        if (!new Headers(init?.headers).has('x-pixlate-api-proxy')) return original(input, init);
        if (method !== 'GET') srv.writes.push(`${method} ${path}`);
        const rule = srv.rules.find((r) => r.times > 0 && r.method === method && new RegExp(r.path).test(path));
        if (rule) {
          rule.times -= 1;
          return json(rule.body, rule.status);
        }
        if (method === 'GET' && path === `/jobs/${jobId}/tasks`) {
          srv.tasksCount += 1;
          if (srv.tasksFail) return json({ error: { code: 'INTERNAL_ERROR', message: 'fail', retryable: true, traceId: 't' } }, 500);
          if (srv.tasks) return json(srv.tasks);
          const res = await original(input, init);
          if (!srv.v157 || !res.ok) return res;
          const body = toV157((await res.json()) as Body, srv.saved) as { jobStatus?: string; userFacingStatus?: string; currentStep?: string };
          srv.seen.push(`${body.currentStep}:${body.jobStatus}:${body.userFacingStatus}`);
          return json(body);
        }
        const res = await original(input, init);
        if (srv.v157 && method === 'POST' && path === `/jobs/${jobId}/confirm` && res.ok) {
          const body = await res.json();
          return json({ ...body, status: 'processing', userFacingStatus: 'rendering' });
        }
        if (method === 'POST' && path === `/jobs/${jobId}/save` && res.ok) srv.saved = true;
        return res;
      };
    },
    { jobId: MOCK_JOB_ID, config: initial },
  );
}

type SrvState = { tasksCount: number; writes: string[]; seen: string[] };
const srv = <K extends keyof SrvState>(page: Page, key: K) =>
  page.evaluate((k) => (window as unknown as { __srv: SrvState }).__srv[k], key) as Promise<SrvState[K]>;
const setSrv = (page: Page, patch: FakeServer) =>
  page.evaluate((p) => Object.assign((window as unknown as { __srv: object }).__srv, p), patch);
const tasksCount = (page: Page) => srv(page, 'tasksCount');
const writes = (page: Page) => srv(page, 'writes');
const conflict = (code: string, message: string, details: unknown = null) => ({
  error: { code, message, retryable: false, details, traceId: 'mock-trace' },
});

const cancelledNotice = (page: Page) => page.getByTestId('job-archived');
const n3Heading = (page: Page) => page.getByRole('heading', { name: '섹션 확인' });

// ── 1 · 2 · 3 취소된 작업 ───────────────────────────────────────

for (const value of ['archived', 'cancelled'] as const) {
  for (const step of ['N3', 'N6'] as const) {
    test(`취소된 작업(${value} · ${step}) — 「취소된 작업입니다」, 편집 화면 · 작업 헤더 · DELETE 없음, 폴링도 멈춘다`, async ({ page }) => {
      await installFakeServer(page, { tasks: tasksBody(value, step, value) });
      await page.goto('/');
      await page.goto(JOB_URL);
      await expect(cancelledNotice(page)).toBeVisible({ timeout: 15_000 });
      await expect(cancelledNotice(page)).toContainText('취소된 작업입니다.');
      await expect(n3Heading(page)).toHaveCount(0);
      await expect(page.getByTestId('n6-export-panel')).toHaveCount(0);
      await expect(page.getByTestId('job-header')).toHaveCount(0);
      await expect(page.locator('[data-exit-guard]')).toHaveAttribute('data-exit-guard', 'off');
      // 폴링을 이어 가지 않는다(N6 에서도)
      const count = await tasksCount(page);
      await page.waitForTimeout(4_500);
      expect(await tasksCount(page)).toBe(count);
      // 보관함으로 — 묻지 않고, 쓰기 요청이 없다
      await page.getByTestId('job-archived-library').click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId('s0-exit-dialog')).toHaveCount(0);
      expect(await writes(page)).toEqual([]);
    });
  }
}

// ── 4 · 5 · 6 변경 요청 409 → 재조회 ─────────────────────────────

const N3_REVIEW = tasksBody('review', 'N3', 'section_review');
const PROCEED_PATH = `^/jobs/${MOCK_JOB_ID}/sections/proceed$`;
const STATE_MESSAGE = '작업 상태가 바뀌어 진행할 수 없습니다.';

async function openN3WithProceed409(page: Page, code = 'INVALID_STATE', message = STATE_MESSAGE) {
  await installFakeServer(page, {
    tasks: N3_REVIEW,
    rules: [{ method: 'POST', path: PROCEED_PATH, status: 409, body: conflict(code, message), times: 1 }],
  });
  await page.goto(JOB_URL);
  await expect(n3Heading(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('n3-proceed')).toBeEnabled({ timeout: 15_000 });
}

test('N3 [이대로 진행] 409 INVALID_STATE → 재조회가 cancelled → 취소 안내(DELETE 없음)', async ({ page }) => {
  await openN3WithProceed409(page);
  await setSrv(page, { tasks: tasksBody('cancelled', 'N3', 'cancelled') });
  await page.getByTestId('n3-proceed').click();
  await expect(cancelledNotice(page)).toBeVisible({ timeout: 10_000 });
  await expect(n3Heading(page)).toHaveCount(0);
  expect((await writes(page)).filter((w) => w.startsWith('DELETE'))).toEqual([]);
});

test('N3 [이대로 진행] 409 INVALID_STATE → 재조회가 정상 상태 → 기존 오류 문구 · N3 유지', async ({ page }) => {
  await openN3WithProceed409(page);
  const before = await tasksCount(page);
  await page.getByTestId('n3-proceed').click();
  await expect(page.getByText(STATE_MESSAGE)).toBeVisible();
  // 재조회는 한 번 했다
  await expect.poll(() => tasksCount(page)).toBe(before + 1);
  await expect(n3Heading(page)).toBeVisible();
  await expect(cancelledNotice(page)).toHaveCount(0);
});

test('N3 [이대로 진행] 409 INVALID_STATE → 재조회 실패 → 취소로 추정하지 않는다', async ({ page }) => {
  await openN3WithProceed409(page);
  await setSrv(page, { tasksFail: true });
  const before = await tasksCount(page);
  await page.getByTestId('n3-proceed').click();
  await expect(page.getByText(STATE_MESSAGE)).toBeVisible();
  await expect.poll(() => tasksCount(page)).toBeGreaterThan(before);
  await page.waitForTimeout(1_000);
  await expect(n3Heading(page)).toBeVisible();
  await expect(cancelledNotice(page)).toHaveCount(0);
});

test('N3 409 ALL_SECTIONS_EXCLUDED 는 상태 재조회 대상이 아니다 — 기존 안내 그대로', async ({ page }) => {
  await openN3WithProceed409(page, 'ALL_SECTIONS_EXCLUDED', '모든 섹션이 제외되어 진행할 수 없습니다.');
  const before = await tasksCount(page);
  await page.getByTestId('n3-proceed').click();
  await expect(page.getByText('번역 가능한 섹션이 있어야 진행 가능합니다').first()).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(await tasksCount(page)).toBe(before);
  await expect(cancelledNotice(page)).toHaveCount(0);
});

test('N1 [다음] analyze 409 INVALID_STATE → 재조회 cancelled → 작업 주소의 취소 안내로(DELETE 없음)', async ({ page }) => {
  await installFakeServer(page, {
    tasks: tasksBody('cancelled', 'N1', 'cancelled'),
    rules: [{ method: 'POST', path: `^/jobs/${MOCK_JOB_ID}/analyze$`, status: 409, body: conflict('INVALID_STATE', STATE_MESSAGE), times: 1 }],
  });
  await fillN1AndSubmit(page);
  await expect(page).toHaveURL(new RegExp(`${JOB_URL}$`), { timeout: 15_000 });
  await expect(cancelledNotice(page)).toBeVisible({ timeout: 15_000 });
  expect((await writes(page)).filter((w) => w.startsWith('DELETE'))).toEqual([]);
});

test('N1 [다음] analyze 409 INVALID_STATE → 재조회가 draft → N1 에 머물고 기존 오류 문구', async ({ page }) => {
  await installFakeServer(page, {
    tasks: tasksBody('draft', 'N1', 'draft'),
    rules: [{ method: 'POST', path: `^/jobs/${MOCK_JOB_ID}/analyze$`, status: 409, body: conflict('INVALID_STATE', STATE_MESSAGE), times: 1 }],
  });
  await fillN1AndSubmit(page);
  await expect(page.getByText(STATE_MESSAGE)).toBeVisible();
  await expect.poll(() => tasksCount(page)).toBe(1);
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/jobs\/new/);
});

const SUNSCREEN_CATEGORY = mockMasterCategories.find((c) => c.path === '선케어 > 선크림');

async function fillN1AndSubmit(page: Page) {
  expect(SUNSCREEN_CATEGORY).toBeTruthy();
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('상태 호환 상품');
  await page.getByRole('combobox').nth(0).selectOption('US');
  await page.getByRole('combobox').nth(1).selectOption('en');
  await pickRegulatoryClass(page, '화장품');
  await page.getByRole('button', { name: '선택하기' }).click();
  const categoryModal = page.getByRole('dialog', { name: '카테고리 선택' });
  await categoryModal.getByRole('button', { name: '선케어' }).click();
  await categoryModal.getByRole('button', { name: '선크림' }).click();
  await categoryModal.getByRole('button', { name: '확인' }).click();
  await page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ }).check();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await page.locator('#image-upload').setInputFiles([{ name: 'compat.png', mimeType: 'image/png', buffer: png }]);
  await expect(page.locator('img[alt="compat.png"]').first()).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();
}

// ── 7~12 N6 ─────────────────────────────────────────────────────

async function openN6(page: Page, body: unknown, extra: FakeServer = {}) {
  await installFakeServer(page, { tasks: body, ...extra });
  await page.goto(JOB_URL);
  await expect(page.getByRole('navigation', { name: '작업 진행 단계' }).locator('[aria-current="step"]')).toBeVisible({ timeout: 15_000 });
}

test('구 서버 N6 review · reviewing + task done → 내보내기 화면(기존 판단 유지)', async ({ page }) => {
  await openN6(page, tasksBody('review', 'N6', 'reviewing', [renderTask({ status: 'done' })]));
  await expect(page.getByTestId('n6-export-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('n6-render-progress')).toHaveCount(0);
});

test('구 서버 N6 review · reviewing + task running → 렌더 중(폴링 유지)', async ({ page }) => {
  await openN6(page, tasksBody('review', 'N6', 'reviewing', [renderTask({ status: 'running' })]));
  await expect(page.getByTestId('n6-render-progress')).toBeVisible({ timeout: 15_000 });
  const count = await tasksCount(page);
  await expect.poll(() => tasksCount(page), { timeout: 8_000 }).toBeGreaterThanOrEqual(count + 2);
});

test('새 서버 N6 processing · rendering → 렌더 중, 폴링을 이어 간다', async ({ page }) => {
  await openN6(page, tasksBody('processing', 'N6', 'rendering', [renderTask({ status: 'running' })]));
  await expect(page.getByTestId('n6-render-progress')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('n6-export-panel')).toHaveCount(0);
  const count = await tasksCount(page);
  await expect.poll(() => tasksCount(page), { timeout: 8_000 }).toBeGreaterThanOrEqual(count + 2);
});

test('새 서버 N6 review · awaiting_save + task done → 저장 대기(내보내기 · 저장 가능), 폴링 · 재렌더 요청 없음', async ({ page }) => {
  await openN6(page, tasksBody('review', 'N6', 'awaiting_save', [renderTask({ status: 'done' })]));
  await expect(page.getByTestId('n6-export-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '저장하고 보관함으로 가기' })).toBeEnabled();
  await expect(page.getByTestId('n6-render-retry')).toHaveCount(0);
  const count = await tasksCount(page);
  await page.waitForTimeout(4_500);
  expect(await tasksCount(page)).toBe(count);
  // 저장 대기의 POST /render 는 서버가 409 로 막는다(211d1f2) — FE 가 부르지 않는다
  expect(await writes(page)).toEqual([]);
});

test('새 서버 N6 상태 어긋남(processing · rendering + task done) → 완료로 추정하지 않는다', async ({ page }) => {
  await openN6(page, tasksBody('processing', 'N6', 'rendering', [renderTask({ status: 'done' })]));
  await expect(page.getByTestId('n6-render-ambiguous')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('n6-export-panel')).toHaveCount(0);
  // 다시 조회한다
  const count = await tasksCount(page);
  await expect.poll(() => tasksCount(page), { timeout: 8_000 }).toBeGreaterThanOrEqual(count + 1);
});

test('새 서버 N6 failed · PROCESSING_TIMEOUT · retryable=true → [다시 렌더링] 가능(기존 POST /render)', async ({ page }) => {
  await openN6(
    page,
    tasksBody('failed', 'N6', 'failed', [renderTask({ status: 'failed', retryable: true, retryCount: 1, errorCode: 'PROCESSING_TIMEOUT' })]),
  );
  await expect(page.getByTestId('n6-render-error')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('n6-render-retry').click();
  await expect.poll(() => writes(page)).toContain(`POST ${JOB_URL}/render`);
});

for (const [label, over] of [
  ['한도 소진', { retryCount: 3, maxRetry: 3, errorCode: 'RENDER_FAILED' }],
  ['PROCESSING_TIMEOUT · 서버가 재시도 불가로 판단', { retryCount: 0, maxRetry: 3, errorCode: 'PROCESSING_TIMEOUT' }],
] as const) {
  test(`새 서버 N6 failed · retryable=false(${label}) → 재시도 버튼 없음 · 안내`, async ({ page }) => {
    await openN6(page, tasksBody('failed', 'N6', 'failed', [renderTask({ status: 'failed', retryable: false, ...over })]));
    await expect(page.getByTestId('n6-render-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('n6-render-retry-unavailable')).toBeVisible();
    await expect(page.getByTestId('n6-render-retry')).toHaveCount(0);
    await expect(page.getByText('PROCESSING_TIMEOUT')).toHaveCount(0);
    expect(await writes(page)).toEqual([]);
  });
}

test('N6 [다시 렌더링] 409 RETRY_NOT_ALLOWED → 재조회 결과 retryable=false → 버튼이 사라진다(취소 안내 아님)', async ({ page }) => {
  await openN6(page, tasksBody('failed', 'N6', 'failed', [renderTask({ status: 'failed', retryable: true })]), {
    rules: [{ method: 'POST', path: `^${JOB_URL}/render$`, status: 409, body: conflict('RETRY_NOT_ALLOWED', 'no'), times: 1 }],
  });
  await page.getByTestId('n6-render-retry').click();
  await setSrv(page, { tasks: tasksBody('failed', 'N6', 'failed', [renderTask({ status: 'failed', retryable: false })]) });
  await expect(page.getByTestId('n6-render-retry-unavailable')).toBeVisible({ timeout: 10_000 });
  await expect(cancelledNotice(page)).toHaveCount(0);
});

test('N6 [다시 렌더링] 409 RETRY_NOT_ALLOWED → 재조회 cancelled → 취소 안내', async ({ page }) => {
  await openN6(page, tasksBody('failed', 'N6', 'failed', [renderTask({ status: 'failed', retryable: true })]), {
    rules: [{ method: 'POST', path: `^${JOB_URL}/render$`, status: 409, body: conflict('RETRY_NOT_ALLOWED', 'no'), times: 1 }],
  });
  await setSrv(page, { tasks: tasksBody('cancelled', 'N6', 'cancelled') });
  await page.getByTestId('n6-render-retry').click();
  await expect(cancelledNotice(page)).toBeVisible({ timeout: 10_000 });
  expect((await writes(page)).filter((w) => w.startsWith('DELETE'))).toEqual([]);
});

// ── 12 PROCESSING_TIMEOUT — N2 · N4 ─────────────────────────────

for (const [step, taskType, title] of [
  ['N2', 'ocr', '분석이 중단되었습니다'],
  ['N4', 'translate', '번역을 완료하지 못했습니다'],
] as const) {
  test(`${step} PROCESSING_TIMEOUT — 서버가 failed 로 바꾼 상태 그대로 기존 오류 화면`, async ({ page }) => {
    const item: Item = {
      taskId: 8001,
      taskType,
      unitType: 'job',
      unitId: JOB_NUM,
      status: 'failed',
      retryCount: 0,
      maxRetry: 3,
      retryable: false,
      errorCode: 'PROCESSING_TIMEOUT',
      revision: null,
    };
    await installFakeServer(page, { tasks: tasksBody('failed', step, 'failed', [item]) });
    await page.goto(JOB_URL);
    await expect(page.getByTestId('processing-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('PROCESSING_TIMEOUT')).toHaveCount(0);
    const count = await tasksCount(page);
    await page.waitForTimeout(4_500);
    expect(await tasksCount(page)).toBe(count);
  });
}

// ── 13 N5 확정 → 새 서버 processing · N6 · rendering ─────────────

test('새 서버 N5 확정 응답 processing · N6 · rendering → N6 진입 · 렌더 뒤 저장 대기 · 저장 후 완료', async ({ page }) => {
  await installFakeServer(page, { v157: true });
  await reachN5(page, { mockScenario: 'n5-clean' });
  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 15_000 });
  const seen = await srv(page, 'seen');
  expect(seen).toContain('N6:processing:rendering');
  expect(seen).toContain('N6:review:awaiting_save');
  await page.getByRole('button', { name: '저장하고 보관함으로 가기' }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
});
