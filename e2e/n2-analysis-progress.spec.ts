import { test, expect, type Page } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N2 analysisProgress(선택 속성) 상세 진행 — server commit 315816e docs/openapi.yaml 기준.
//
// lib/msw/handlers.ts __pixlateMockN2Script 로 poll 마다 응답을 하나씩 정한다(값은 OpenAPI 의
// JobTasksN2* 예시를 따른다). 확인하는 것:
// - analysisProgress 가 있으면 상세 표시, 없으면 기존 5단계 fallback
// - null 은 정보 없음(0·완료·이전 값으로 채우지 않음), 재시도 때 이전 시도 detail 이 남지 않음
// - 원본마다 split → ocr → merge 가 반복돼도 지금 poll 의 서버 값만 보임
// ─────────────────────────────────────────────────────────────────

type StageStatus = 'pending' | 'running' | 'done' | 'failed';
const stages = (ocr: StageStatus, section: StageStatus, verify: StageStatus) => [
  { key: 'ocr', label: 'ocr', status: ocr },
  { key: 'section', label: 'section', status: section },
  { key: 'verify', label: 'verify', status: verify },
];

type Current = { sourceIndex: number; sourceImageId: number; regionIndex: number | null; regionCountInSource: number | null };
type Regions = { done: number; known: number; totalFixed: boolean };
type Judge = { total: number; done: number; excluded: number; running: number; waiting: number; retrying: number; failed: number; cancelled: number };

const analyze = (
  status: 'waiting' | 'running' | 'retrying' | 'failed',
  activity: 'split' | 'ocr' | 'merge' | 'finalize' | null,
  current: Current | null,
  regions: Regions | null,
) => ({ phase: 'analyze', status, sourceTotal: 2, activity, current, regions, judge: null });

const judgePhase = (status: 'waiting' | 'running' | 'retrying' | 'failed', judge: Judge) => ({
  phase: 'judge',
  status,
  sourceTotal: 2,
  activity: null,
  current: null,
  regions: { done: 5, known: 5, totalFixed: true },
  judge,
});

const item = (taskId: number, taskType: string, unitType: string, status: string, errorCode: string | null = null) => ({
  taskId,
  taskType,
  unitType,
  unitId: taskId,
  status,
  uiStatus: status === 'pending' ? 'waiting' : status,
  retryCount: 0,
  maxRetry: 2,
  retryable: false,
  errorCode,
  revision: null,
});

const analyzingTick = (analysisProgress: unknown) => ({
  progress: 0,
  stages: stages('running', 'pending', 'pending'),
  items: [item(9001, 'ocr', 'job', 'running')],
  analysisProgress,
});

async function setup(page: Page, script: unknown[]) {
  await page.addInitScript((s) => {
    (globalThis as Record<string, unknown>).__pixlateMockN2Script = s;
  }, script);
  // 상세 영역 텍스트와 5단계 행을 DOM 변화마다 기록한다(연속 중복 제거)
  await page.addInitScript(() => {
    const w = window as unknown as { __detailLog: string[]; __rowsLog: Record<string, string>[] };
    w.__detailLog = [];
    w.__rowsLog = [];
    const snapshot = () => {
      const detail = document.querySelector('[data-testid="n2-analysis-detail"]');
      const text = detail ? (detail as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : '';
      if (text && w.__detailLog[w.__detailLog.length - 1] !== text) w.__detailLog.push(text);
      const rows = Array.from(document.querySelectorAll('p')).filter((p) => /^0[1-5]\s/.test(p.textContent ?? ''));
      if (rows.length === 5) {
        const states: Record<string, string> = {};
        for (const p of rows) states[(p.textContent ?? '').trim().slice(0, 2)] = (p.nextElementSibling?.textContent ?? '').trim();
        const last = w.__rowsLog[w.__rowsLog.length - 1];
        if (!last || JSON.stringify(last) !== JSON.stringify(states)) w.__rowsLog.push(states);
      }
    };
    const start = () =>
      new MutationObserver(snapshot).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  });

  const responses: { currentStep?: string; jobStatus?: string; hasAnalysisProgress: boolean }[] = [];
  page.on('response', async (res) => {
    if (res.request().method() === 'GET' && new URL(res.url()).pathname === `/jobs/${MOCK_JOB_ID}/tasks`) {
      const body = await res.json().catch(() => null);
      if (body) responses.push({ currentStep: body.currentStep, jobStatus: body.jobStatus, hasAnalysisProgress: 'analysisProgress' in body });
    }
  });

  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(page.getByRole('heading', { name: '이미지 분석' })).toBeVisible({ timeout: 15_000 });
  return responses;
}

const detailLog = (page: Page) => page.evaluate(() => (window as unknown as { __detailLog: string[] }).__detailLog);
const fiveStepRows = (page: Page) => page.locator('p').filter({ hasText: /^0[1-5]\s/ });

/** 순서대로 나타났는지(사이에 다른 상태가 끼어도 된다) */
function expectInOrder(log: string[], expected: string[]) {
  let from = 0;
  for (const needle of expected) {
    const idx = log.findIndex((t, i) => i >= from && t.includes(needle));
    expect(idx, `"${needle}" 가 순서대로 나타나야 한다\n${log.join('\n')}`).toBeGreaterThanOrEqual(0);
    from = idx + 1;
  }
}

test.describe('N2 analysisProgress 상세 진행', () => {
  test.setTimeout(60_000);

  test('A·D. 있으면 상세 표시를 쓰고, 원본마다 split → ocr → merge 가 반복돼도 지금 서버 값만 보인다', async ({ page }) => {
    const responses = await setup(page, [
      analyzingTick(analyze('running', 'split', { sourceIndex: 1, sourceImageId: 701, regionIndex: null, regionCountInSource: null }, null)),
      analyzingTick(analyze('running', 'ocr', { sourceIndex: 1, sourceImageId: 701, regionIndex: 2, regionCountInSource: 3 }, { done: 1, known: 3, totalFixed: false })),
      analyzingTick(analyze('running', 'merge', { sourceIndex: 1, sourceImageId: 701, regionIndex: 3, regionCountInSource: 3 }, { done: 2, known: 3, totalFixed: false })),
      analyzingTick(analyze('running', 'split', { sourceIndex: 2, sourceImageId: 702, regionIndex: null, regionCountInSource: null }, { done: 3, known: 3, totalFixed: false })),
      analyzingTick(analyze('running', 'ocr', { sourceIndex: 2, sourceImageId: 702, regionIndex: 1, regionCountInSource: 2 }, { done: 3, known: 5, totalFixed: true })),
      analyzingTick(analyze('running', 'finalize', null, { done: 5, known: 5, totalFixed: true })),
      {
        progress: 0.5,
        stages: stages('done', 'running', 'pending'),
        items: [item(9001, 'ocr', 'job', 'done'), item(9002, 'section', 'section', 'running')],
        analysisProgress: judgePhase('running', { total: 5, done: 2, excluded: 1, running: 1, waiting: 1, retrying: 0, failed: 0, cancelled: 0 }),
      },
    ]);

    const detail = page.getByTestId('n2-analysis-detail');
    await expect(detail).toBeVisible();
    // 상세 표시 중에는 고정 5단계 목록을 그리지 않는다
    await expect(fiveStepRows(page)).toHaveCount(0);

    await expect(page.getByTestId('n2-detail-judge')).toContainText('판정 대상 영역 5개', { timeout: 20_000 });
    await expect(page.getByTestId('n2-detail-judge')).toContainText('완료 2 · 자동 제외 1 · 진행 중 1 · 대기 1');
    await expect(page.getByTestId('n2-detail-phase')).toContainText('영역별 판정');
    // judge 단계에서 activity·current 는 null — 원본 위치·세부 작업을 그리지 않는다
    await expect(page.getByTestId('n2-detail-activity')).toHaveCount(0);
    await expect(page.getByTestId('n2-detail-source')).toHaveText('원본 2장');

    const log = await detailLog(page);
    expectInOrder(log, [
      '원본 2장 중 1번째 영역을 나누는 중',
      '원본 2장 중 1번째 영역 3개 중 2번째 텍스트 추출 중',
      '원본 2장 중 1번째 영역 3개 중 3번째 텍스트 병합·역할 분석 중',
      '원본 2장 중 2번째 영역을 나누는 중',
      '원본 2장 중 2번째 영역 2개 중 1번째 텍스트 추출 중',
      '분석 결과를 정리하는 중',
      '판정 대상 영역 5개',
    ]);
    // totalFixed=false 인 동안 known 을 전체 분모처럼 쓰지 않는다
    for (const t of log.filter((x) => x.includes('지금까지 나눈 영역'))) expect(t).not.toContain('전체 영역');
    // 상세 값으로 새 퍼센트를 만들지 않는다
    for (const t of log) expect(t).not.toMatch(/%/);
    expect(responses.every((r) => r.hasAnalysisProgress)).toBe(true);
  });

  test('B. 없으면 기존 5단계 N2 표시를 그대로 쓴다', async ({ page }) => {
    await setup(page, [
      { progress: 0, stages: stages('running', 'pending', 'pending'), items: [item(9001, 'ocr', 'job', 'running')] },
    ]);
    await expect(fiveStepRows(page)).toHaveCount(5);
    await expect(page.getByTestId('n2-analysis-detail')).toHaveCount(0);
    await expect(page.getByText('01  전체 텍스트 인식')).toBeVisible();
  });

  test('C·E. null 은 정보 없음으로 두고, 재시도 뒤에는 이전 시도 detail 이 남지 않는다', async ({ page }) => {
    await setup(page, [
      analyzingTick(analyze('running', 'ocr', { sourceIndex: 2, sourceImageId: 702, regionIndex: 3, regionCountInSource: 4 }, { done: 5, known: 7, totalFixed: false })),
      // 자동 재시도 대기 — 세부 값 전부 null (OpenAPI JobTasksN2AutoRetry)
      {
        progress: 0,
        stages: stages('pending', 'pending', 'pending'),
        items: [{ ...item(9011, 'ocr', 'job', 'pending'), uiStatus: 'retrying', retryCount: 1 }],
        analysisProgress: analyze('retrying', null, null, null),
      },
      analyzingTick(analyze('running', null, null, null)),
      // 새 시도 — 첫 원본 분해 중(regionCountInSource=null)
      analyzingTick(analyze('running', 'split', { sourceIndex: 1, sourceImageId: 701, regionIndex: null, regionCountInSource: null }, null)),
    ]);

    await expect(page.getByTestId('n2-detail-activity')).toHaveText('영역 4개 중 3번째 텍스트 추출 중', { timeout: 15_000 });

    // 재시도 대기: activity·current·regions 가 null → 줄 자체를 그리지 않는다(이전 값 유지 금지)
    await expect(page.getByTestId('n2-detail-phase')).toContainText('재시도 대기', { timeout: 10_000 });
    await expect(page.getByTestId('n2-detail-activity')).toHaveCount(0);
    await expect(page.getByTestId('n2-detail-regions')).toHaveCount(0);
    await expect(page.getByTestId('n2-detail-source')).toHaveText('원본 2장');
    await expect(page.getByText('분석 재시도 대기 중')).toBeVisible();

    // running 이지만 activity=null — 특정 작업을 한다고 추정하지 않는다
    await expect(page.getByTestId('n2-detail-phase')).toContainText('진행 중', { timeout: 10_000 });
    await expect(page.getByTestId('n2-detail-activity')).toHaveCount(0);
    await expect(page.getByText('이미지 분석 중', { exact: true })).toBeVisible();

    // 새 시도: 첫 원본 split — 이전 시도의 2번째 원본·영역 4개·영역 7개가 남지 않는다
    await expect(page.getByTestId('n2-detail-activity')).toHaveText('영역을 나누는 중', { timeout: 10_000 });
    const detail = page.getByTestId('n2-analysis-detail');
    await expect(page.getByTestId('n2-detail-source')).toHaveText('원본 2장 중 1번째');
    await expect(detail).not.toContainText('4개');
    await expect(detail).not.toContainText('7개');
    await expect(page.getByTestId('n2-detail-regions')).toHaveCount(0);
    // regionCountInSource=null 을 0개로 보이지 않는다
    for (const t of await detailLog(page)) expect(t).not.toMatch(/(^|\s)0개/);
  });
});
