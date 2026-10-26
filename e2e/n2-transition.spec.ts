import { test, expect, type Page } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N2 → N3 전환 때 화면 5단계 중 마지막 항목(04·05)이 한 번도 보이지 않고 건너뛰어지는지 검증.
//
// 서버가 마지막 stage 를 끝낸 바로 그 poll 에서 currentStep=N3 를 돌려주면, page.tsx 는 N2 를
// 그 즉시 그리지 않는다. 그 전 poll 이 아직 앞 단계였다면 04·05 는 사용자에게 한 번도 보이지
// 않는다. 이 파일은 그 응답 순서를 mock 에서 그대로 만들고(lib/msw/handlers.ts
// __pixlateMockN2Script — stage key 는 이 테스트가 넘긴다), 실제 DOM 에 04·05 가 진행 중 또는
// 완료로 한 번이라도 그려졌는지를 MutationObserver 로 기록해 확인한다.
// N3 응답 뒤 완료 표시(100% 와 5단계 전부 완료)는 page.tsx 가 짧게 보여 준다 — 표시 % 흐름 자체는
// n2-analysis-progress.spec.ts 의 'N2 로딩 표현'에서 확인한다.
// ─────────────────────────────────────────────────────────────────

type StageStatus = 'pending' | 'running' | 'done';
const stage = (key: string, status: StageStatus) => ({ key, label: key, status });

/** 지금 계약(ocr/section/verify)의 key 를 쓰되, 마지막 stage 가 running 으로 한 번도 오지 않는다. */
const SCRIPT_SKIPPING_LAST_STAGE = [
  { progress: 0, stages: [stage('ocr', 'running'), stage('section', 'pending'), stage('verify', 'pending')] },
  { progress: 0.1, stages: [stage('ocr', 'running'), stage('section', 'pending'), stage('verify', 'pending')] },
  { progress: 0.34, stages: [stage('ocr', 'done'), stage('section', 'running'), stage('verify', 'pending')] },
  { progress: 0.5, stages: [stage('ocr', 'done'), stage('section', 'running'), stage('verify', 'pending')] },
  { progress: 0.6, stages: [stage('ocr', 'done'), stage('section', 'running'), stage('verify', 'pending')] },
  { progress: 1, stages: [stage('ocr', 'done'), stage('section', 'done'), stage('verify', 'done')], advance: true },
];

async function installStepRecorder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __n2StepLog: Record<string, string>[] };
    w.__n2StepLog = [];
    const snapshot = () => {
      const rows = Array.from(document.querySelectorAll('p')).filter((p) => /^0[1-5]\s/.test(p.textContent ?? ''));
      if (rows.length !== 5) return;
      const states: Record<string, string> = {};
      for (const p of rows) {
        const no = (p.textContent ?? '').trim().slice(0, 2);
        states[no] = (p.nextElementSibling?.textContent ?? '').trim();
      }
      const last = w.__n2StepLog[w.__n2StepLog.length - 1];
      if (!last || JSON.stringify(last) !== JSON.stringify(states)) w.__n2StepLog.push(states);
    };
    const start = () =>
      new MutationObserver(snapshot).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  });
}

test('N2 마지막 stage 가 끝나자마자 currentStep=N3 가 와도 04·05 가 화면에 한 번은 그려진 뒤 N3 로 넘어간다', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript((script) => {
    (globalThis as Record<string, unknown>).__pixlateMockN2Script = script;
  }, SCRIPT_SKIPPING_LAST_STAGE);
  await installStepRecorder(page);

  const steps: string[] = [];
  page.on('response', async (res) => {
    if (res.request().method() === 'GET' && new URL(res.url()).pathname === `/jobs/${MOCK_JOB_ID}/tasks`) {
      const body = await res.json().catch(() => null);
      if (body?.currentStep) steps.push(body.currentStep);
    }
  });

  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(page.getByRole('heading', { name: '이미지 분석' })).toBeVisible({ timeout: 15_000 });

  // 최종적으로는 서버 정본(currentStep=N3)대로 N3 에 들어간다
  await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible({ timeout: 25_000 });
  expect(steps.at(-1)).toBe('N3');
  expect(steps.filter((s) => s === 'N2').length).toBeGreaterThanOrEqual(5);

  const log = await page.evaluate(() => (window as unknown as { __n2StepLog: Record<string, string>[] }).__n2StepLog);
  // 단계별 상태 변화(연속 중복 제거) — 실제 DOM 기준
  const sequenceOf = (no: string) =>
    log.map((s) => s[no]).filter((v, i, arr) => v !== undefined && v !== arr[i - 1]);
  console.log(
    'N2 상태 시퀀스',
    JSON.stringify(Object.fromEntries(['01', '02', '03', '04', '05'].map((no) => [no, sequenceOf(no)]))),
  );

  // 마지막 stage 가 running 으로 한 번도 오지 않았으므로 04·05 는 "진행 중" 없이 대기 → 완료로 바뀐다.
  // N3 응답 뒤에 FE 가 진행 중 상태를 새로 만들지 않는다.
  expect(sequenceOf('04')).toEqual(['대기', '완료']);
  expect(sequenceOf('05')).toEqual(['대기', '완료']);
  // N3 로 넘어가기 직전 5단계 전부 완료 상태가 최소 한 번 그려졌다
  const allDone = (s: Record<string, string>) => ['01', '02', '03', '04', '05'].every((no) => s[no] === '완료');
  expect(log.some(allDone), JSON.stringify(log)).toBe(true);
  expect(allDone(log[log.length - 1]), '마지막으로 그린 N2 상태는 전부 완료').toBe(true);
  // 어느 단계도 뒤로 가지 않는다(진행 중을 반드시 거칠 필요는 없다 — 짧은 stage 는 polling 에 안 잡힐 수 있다)
  const rank: Record<string, number> = { 대기: 0, '진행 중': 1, 완료: 2 };
  for (const no of ['01', '02', '03', '04', '05']) {
    const seq = sequenceOf(no).map((v) => rank[v] ?? -1);
    for (let i = 1; i < seq.length; i += 1) expect(seq[i], `${no}: ${sequenceOf(no).join(' → ')}`).toBeGreaterThan(seq[i - 1]);
  }
});

/** N2 중간(02·03 진행 중)에 서버가 currentStep=N1 로 돌려보내는 중단/복귀 응답. */
const SCRIPT_RETURNING_TO_N1 = [
  { progress: 0, stages: [stage('ocr', 'running'), stage('section', 'pending'), stage('verify', 'pending')] },
  { progress: 0.34, stages: [stage('ocr', 'done'), stage('section', 'running'), stage('verify', 'pending')] },
  {
    progress: 0.34,
    stages: [stage('ocr', 'done'), stage('section', 'running'), stage('verify', 'pending')],
    advance: true,
    advanceTo: 'N1',
  },
];

test('N2 에서 currentStep=N1 로 돌아가면 5단계 완료 표시 없이 바로 N1 로 이동한다', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript((script) => {
    (globalThis as Record<string, unknown>).__pixlateMockN2Script = script;
  }, SCRIPT_RETURNING_TO_N1);
  await installStepRecorder(page);
  // N1 응답을 받은 시각과 N2 화면(5단계 행)이 사라진 시각을 같은 페이지 시계로 기록한다
  await page.addInitScript(() => {
    const w = window as unknown as { __n1ResponseAt?: number; __n2GoneAt?: number };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (w.__n1ResponseAt === undefined && /\/jobs\/[^/]+\/tasks(\?|$)/.test(url)) {
        const body = await res.clone().json().catch(() => null);
        if (body?.currentStep === 'N1') w.__n1ResponseAt = performance.now();
      }
      return res;
    };
    const start = () =>
      new MutationObserver(() => {
        if (w.__n1ResponseAt === undefined || w.__n2GoneAt !== undefined) return;
        const hasN2Rows = Array.from(document.querySelectorAll('p')).some((p) => /^0[1-5]\s/.test(p.textContent ?? ''));
        if (!hasN2Rows) w.__n2GoneAt = performance.now();
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  });

  const steps: string[] = [];
  page.on('response', async (res) => {
    if (res.request().method() === 'GET' && new URL(res.url()).pathname === `/jobs/${MOCK_JOB_ID}/tasks`) {
      const body = await res.json().catch(() => null);
      if (body?.currentStep) steps.push(body.currentStep);
    }
  });

  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(page.getByRole('heading', { name: '이미지 분석' })).toBeVisible({ timeout: 15_000 });

  // 최종 화면은 서버 정본(currentStep=N1)대로 N1 — 완료 표시로 붙잡지 않는다
  // (N2 의 StepNav 에도 "정보 입력"이 있으므로 N1 일 때만 그리는 페이지 공통 헤더로 확인한다)
  const n1Header = page.locator('header', { has: page.getByRole('link', { name: '← 뒤로' }) });
  await expect(n1Header).toBeVisible({ timeout: 6_000 });
  await expect(n1Header).toContainText('N1');
  await expect(n1Header).toContainText('정보 입력');
  await expect(page.getByRole('heading', { name: '이미지 분석' })).toBeHidden();
  expect(steps).toContain('N1');
  expect(steps).not.toContain('N3');

  const timing = await page.evaluate(() => {
    const w = window as unknown as { __n1ResponseAt?: number; __n2GoneAt?: number };
    return { n1ResponseAt: w.__n1ResponseAt, n2GoneAt: w.__n2GoneAt };
  });
  expect(timing.n1ResponseAt, 'N1 응답 수신 기록').toBeDefined();
  expect(timing.n2GoneAt, 'N2 화면 해제 기록').toBeDefined();
  // 성공 완료 표시(약 0.75초)를 거치지 않는다
  expect(timing.n2GoneAt! - timing.n1ResponseAt!).toBeLessThan(600);

  const log = await page.evaluate(() => (window as unknown as { __n2StepLog: Record<string, string>[] }).__n2StepLog);
  // 5단계 전체 완료 presentation 이 한 번도 그려지지 않았다
  const allDone = (s: Record<string, string>) => ['01', '02', '03', '04', '05'].every((no) => s[no] === '완료');
  expect(log.length).toBeGreaterThan(0);
  expect(log.some(allDone), JSON.stringify(log)).toBe(false);
  // 서버가 끝내지 않은 04·05 는 완료로 바뀌지 않았다
  expect(log.some((s) => s['04'] === '완료' || s['05'] === '완료'), JSON.stringify(log)).toBe(false);
});
