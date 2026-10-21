import { test, expect, type Page } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N2 analysisProgress(선택 속성) 상세 진행 — server commit 315816e docs/openapi.yaml 기준.
//
// lib/msw/handlers.ts __pixlateMockN2Script 로 poll 마다 응답을 하나씩 정한다(값은 OpenAPI 의
// JobTasksN2* 예시를 따른다). 확인하는 것:
// - analysisProgress 유무와 관계없이 Figma 660:4139 의 5단계 목록(순서 고정)이 항상 있고,
//   상세 값은 기존 동적 문구(GIF 하단 caption·ANALYSIS LOG 설명 줄)에만 들어감 — 별도 상세 패널 없음
// - null 은 정보 없음(0·완료·이전 값으로 채우지 않음), 재시도 때 이전 시도 detail 이 남지 않음
// - 원본마다 split → ocr → merge 가 반복돼도 지금 poll 의 서버 값만 보임
// - 전체 실패는 currentStep=N2 && jobStatus=failed 뿐, LOCAL_JUDGE_FAILED 부분 제외는 N3 정상 전환
// - N2 → N3 만 완료 표시, N2 → N1 은 완료 표시 없이 이동
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
  // ANALYSIS LOG 설명 줄과 5단계 행을 DOM 변화마다 기록한다(연속 중복 제거)
  await page.addInitScript(() => {
    const w = window as unknown as { __detailLog: string[]; __rowsLog: Record<string, string>[] };
    w.__detailLog = [];
    w.__rowsLog = [];
    const snapshot = () => {
      const caption = document.querySelector('[data-testid="processing-log-description"]');
      const text = caption ? (caption.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
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
const rowsLog = (page: Page) => page.evaluate(() => (window as unknown as { __rowsLog: Record<string, string>[] }).__rowsLog);
const allDone = (s: Record<string, string>) => ['01', '02', '03', '04', '05'].every((no) => s[no] === '완료');
const fiveStepRows = (page: Page) => page.locator('p').filter({ hasText: /^0[1-5]\s/ });
const logCaption = (page: Page) => page.getByTestId('processing-log-description');
const DEFAULT_LOG_CAPTION = '완료된 항목은 분리하고, 현재 판단만 선명하게 정리 중 입니다.';

/** Figma 660:4139 의 5단계 목록 — 항상 정확히 5개, 이 순서다. */
async function expectFigmaFiveRows(page: Page) {
  await expect(fiveStepRows(page)).toHaveText([
    /^01\s+콘텐츠 영역 나누기$/,
    /^02\s+전체 텍스트 인식$/,
    /^03\s+문단별 역할 파악$/,
    /^04\s+제품 라벨 자동 제외$/,
    /^05\s+규제 · 현지 적합성 확인$/,
  ]);
}

/** 순서대로 나타났는지(사이에 다른 상태가 끼어도 된다) */
function expectInOrder(log: string[], expected: string[]) {
  let from = 0;
  for (const needle of expected) {
    const idx = log.findIndex((t, i) => i >= from && t === needle);
    expect(idx, `"${needle}" 가 순서대로 나타나야 한다\n${log.join('\n')}`).toBeGreaterThanOrEqual(0);
    from = idx + 1;
  }
}

test.describe('N2 analysisProgress 상세 진행', () => {
  test.setTimeout(60_000);

  test('A·D. 있으면 기존 5단계 목록 안에서 동적 문구만 바뀌고, 원본마다 split → ocr → merge 가 반복돼도 지금 서버 값만 보인다', async ({ page }) => {
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

    // 기존 5단계 목록은 그대로 있고, 별도 상세 패널은 없다
    await expectFigmaFiveRows(page);
    await expect(page.getByTestId('n2-analysis-detail')).toHaveCount(0);
    await expect(logCaption(page)).toHaveText('원본 2장 중 1번째 · 영역을 나누는 중');
    await expect(page.getByText('영역 나누는 중', { exact: true })).toBeVisible();

    await expect(logCaption(page)).toHaveText('판정 대상 5개 · 완료 2 · 자동 제외 1 · 진행 중 1', { timeout: 20_000 });
    await expect(page.getByText('영역별 판정 중', { exact: true })).toBeVisible();
    await expectFigmaFiveRows(page);

    expectInOrder(await detailLog(page), [
      '원본 2장 중 1번째 · 영역을 나누는 중',
      '원본 2장 중 1번째 · 영역 3개 중 2번째 텍스트 추출 중',
      '원본 2장 중 1번째 · 영역 3개 중 3번째 병합·역할 분석 중',
      '원본 2장 중 2번째 · 영역을 나누는 중',
      '원본 2장 중 2번째 · 영역 2개 중 1번째 텍스트 추출 중',
      // finalize 는 current=null — 원본 위치를 쓰지 않는다
      '원본 2장 · 분석 결과를 정리하는 중',
      '판정 대상 5개 · 완료 2 · 자동 제외 1 · 진행 중 1',
    ]);
    // 상세 값으로 새 퍼센트를 만들지 않는다
    for (const t of await detailLog(page)) expect(t).not.toMatch(/%/);
    expect(responses.every((r) => r.hasAnalysisProgress)).toBe(true);
  });

  test('B. 없으면 같은 5단계 목록과 기존 문구를 그대로 쓴다', async ({ page }) => {
    await setup(page, [
      { progress: 0, stages: stages('running', 'pending', 'pending'), items: [item(9001, 'ocr', 'job', 'running')] },
    ]);
    await expectFigmaFiveRows(page);
    await expect(logCaption(page)).toHaveText(DEFAULT_LOG_CAPTION);
    await expect(page.getByText('텍스트 영역 인식 중', { exact: true })).toBeVisible();
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

    await expect(logCaption(page)).toHaveText('원본 2장 중 2번째 · 영역 4개 중 3번째 텍스트 추출 중', { timeout: 15_000 });

    // 재시도 대기: activity·current 가 null → 원본 위치·작업을 쓰지 않는다(이전 값 유지 금지)
    await expect(logCaption(page)).toHaveText('원본 2장 · 재시도 대기', { timeout: 10_000 });
    await expect(page.getByText('분석 재시도 대기 중', { exact: true })).toBeVisible();
    await expectFigmaFiveRows(page);

    // running 이지만 activity=null — 특정 작업을 한다고 추정하지 않는다
    await expect(logCaption(page)).toHaveText('원본 2장', { timeout: 10_000 });
    await expect(page.getByText('이미지 분석 중', { exact: true })).toBeVisible();

    // 새 시도: 첫 원본 split — 이전 시도의 2번째 원본·영역 4개가 남지 않는다
    await expect(logCaption(page)).toHaveText('원본 2장 중 1번째 · 영역을 나누는 중', { timeout: 10_000 });
    // regionCountInSource·regions=null 을 0개로 보이지 않는다
    for (const t of await detailLog(page)) expect(t).not.toMatch(/(^|\s)0개/);
  });

  test('F. LOCAL_JUDGE_FAILED 로 failedCount>0·section failed·progress<1 이어도 실패가 아니고 N3 로 정상 전환한다', async ({ page }) => {
    const judgeItems = [
      item(9001, 'ocr', 'job', 'done'),
      item(9002, 'section', 'section', 'done'),
      item(9004, 'section', 'section', 'failed', 'LOCAL_JUDGE_FAILED'),
      item(9005, 'section', 'section', 'running'),
    ];
    const judging = {
      progress: 0.5,
      stages: stages('done', 'failed', 'pending'),
      items: judgeItems,
      analysisProgress: judgePhase('running', { total: 5, done: 2, excluded: 1, running: 1, waiting: 1, retrying: 0, failed: 0, cancelled: 0 }),
    };
    const responses = await setup(page, [
      judging,
      judging,
      judging,
      judging,
      // N3 전환(OpenAPI JobTasksN3AfterPartialExclusion) — analysisProgress 는 생략된다
      {
        progress: 0.83,
        stages: stages('done', 'failed', 'done'),
        items: judgeItems.map((i) => (i.status === 'running' ? { ...i, status: 'done', uiStatus: 'done' } : i)),
        advance: true,
      },
    ]);

    await expect(logCaption(page)).toContainText('자동 제외 1');
    // 부분 실패 안내는 "일부 항목" 문구다 — 전체 실패 표시가 아니다
    await expect(page.getByText('일부 항목을 처리하지 못했습니다')).toBeVisible();
    await expect(page.getByText('분석 실패', { exact: true })).toHaveCount(0);
    await expect(page.getByText('이미지 분석에 실패했습니다')).toHaveCount(0);

    await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible({ timeout: 25_000 });
    const last = responses.at(-1)!;
    expect(last.currentStep).toBe('N3');
    expect(last.hasAnalysisProgress).toBe(false);
    expect(responses.some((r) => r.jobStatus === 'failed')).toBe(false);
  });

  test('G. 전체 분석 실패는 currentStep=N2 && jobStatus=failed 로만 보이고 폴링을 멈춘다', async ({ page }) => {
    const responses = await setup(page, [
      analyzingTick(analyze('running', 'ocr', { sourceIndex: 1, sourceImageId: 701, regionIndex: 1, regionCountInSource: 3 }, { done: 0, known: 3, totalFixed: false })),
      // OpenAPI JobTasksN2JudgeFailed — progress 0.75·stages.ocr=done 이어도 jobStatus=failed 면 실패
      {
        progress: 0.75,
        stages: stages('done', 'failed', 'pending'),
        items: [
          item(9001, 'ocr', 'job', 'done'),
          item(9002, 'section', 'section', 'done'),
          item(9104, 'section', 'section', 'failed', 'REGULATORY_JUDGE_FAILED'),
        ],
        analysisProgress: judgePhase('failed', { total: 5, done: 2, excluded: 0, running: 0, waiting: 0, retrying: 0, failed: 1, cancelled: 2 }),
        fail: true,
      },
    ]);

    await expect(page.getByText('분석 실패', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('이미지 분석에 실패했습니다')).toBeVisible();
    await expect(page.getByText('이미지 분석을 완료하지 못했습니다.', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('상세페이지의 구조와 문맥을 읽고 있습니다.')).toHaveCount(0);
    await expect(page.getByText('분석을 완료하지 못해 다음 단계로 자동 이동하지 않습니다.')).toBeVisible();
    await expect(page.getByText('분석이 끝나면 섹션 확인 단계로 자동 이동합니다.')).toHaveCount(0);
    // 서버가 준 판정 실패 값은 그대로 보인다
    await expect(logCaption(page)).toHaveText('판정 대상 5개 · 완료 2 · 자동 제외 0 · 진행 중 0 · 실패 1 · 취소 2');
    // 5단계 목록은 그대로 있고, 실패 상태에서 "진행 중" 행을 남기지 않는다
    await expectFigmaFiveRows(page);
    expect(Object.values((await rowsLog(page)).at(-1)!)).not.toContain('진행 중');
    // 화면은 N2 그대로(서버 currentStep 정본)
    await expect(page.getByRole('heading', { name: '이미지 분석' })).toBeVisible();

    const failedAt = responses.findIndex((r) => r.jobStatus === 'failed');
    expect(failedAt).toBeGreaterThanOrEqual(0);
    expect(responses[failedAt].currentStep).toBe('N2');
    const countAtFailure = responses.length;
    await page.waitForTimeout(5_000);
    expect(responses.length, '실패 응답 뒤 추가 polling 없음').toBe(countAtFailure);
  });

  test('G-2. analysisProgress 가 없는 레거시 실패 응답에서도 5단계 중 "진행 중" 행을 남기지 않는다', async ({ page }) => {
    await setup(page, [
      { progress: 0, stages: stages('running', 'pending', 'pending'), items: [item(9001, 'ocr', 'job', 'running')] },
      // OpenAPI JobTasksN2Failed 에서 analysisProgress 만 뺀 응답
      {
        progress: 0,
        stages: stages('failed', 'pending', 'pending'),
        items: [{ ...item(9013, 'ocr', 'job', 'failed', 'OCR_FAILED'), retryCount: 2 }],
        fail: true,
      },
    ]);

    await expect(page.getByText('이미지 분석에 실패했습니다')).toBeVisible({ timeout: 15_000 });
    await expectFigmaFiveRows(page);
    await expect(logCaption(page)).toHaveText(DEFAULT_LOG_CAPTION);
    const rows = await rowsLog(page);
    expect(rows.some((r) => Object.values(r).includes('진행 중')), '실패 전에는 진행 중 행이 있었다').toBe(true);
    expect(Object.values(rows.at(-1)!), JSON.stringify(rows)).not.toContain('진행 중');
  });

  test('H. analysisProgress 를 보이다 N3 로 넘어가면 600ms 완료 표시를 거쳐 N3 로 이동한다', async ({ page }) => {
    const judging = {
      progress: 0.5,
      stages: stages('done', 'running', 'pending'),
      items: [item(9001, 'ocr', 'job', 'done'), item(9002, 'section', 'section', 'running')],
      analysisProgress: judgePhase('running', { total: 3, done: 1, excluded: 0, running: 1, waiting: 1, retrying: 0, failed: 0, cancelled: 0 }),
    };
    // mock N2 최소 체류(7초)가 지난 뒤에 N3 응답이 오도록 poll 수를 잡는다
    const responses = await setup(page, [
      judging,
      judging,
      judging,
      judging,
      judging,
      { progress: 1, stages: stages('done', 'done', 'done'), items: [item(9001, 'ocr', 'job', 'done')], advance: true },
    ]);

    await expect(logCaption(page)).toHaveText('판정 대상 3개 · 완료 1 · 자동 제외 0 · 진행 중 1');
    await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible({ timeout: 25_000 });
    expect(responses.at(-1)?.currentStep).toBe('N3');
    // 마지막 poll 에 analysisProgress 가 없어도 N3 전환이면 완료 표시(5단계 전부 완료)를 그린 뒤 넘어간다
    const rows = await rowsLog(page);
    expect(rows.some((r) => !allDone(r)), JSON.stringify(rows)).toBe(true);
    expect(allDone(rows.at(-1)!), JSON.stringify(rows)).toBe(true);
  });

  test('I. analysisProgress 를 보이다 N1 로 돌아가면 완료 표시 없이 바로 N1 로 이동한다', async ({ page }) => {
    const responses = await setup(page, [
      analyzingTick(analyze('running', 'ocr', { sourceIndex: 1, sourceImageId: 701, regionIndex: 1, regionCountInSource: 2 }, { done: 0, known: 2, totalFixed: false })),
      analyzingTick(analyze('running', 'merge', { sourceIndex: 1, sourceImageId: 701, regionIndex: 1, regionCountInSource: 2 }, { done: 0, known: 2, totalFixed: false })),
      { ...analyzingTick(analyze('running', 'merge', { sourceIndex: 1, sourceImageId: 701, regionIndex: 1, regionCountInSource: 2 }, null)), advance: true, advanceTo: 'N1' },
    ]);

    await expect(logCaption(page)).toContainText('원본 2장 중 1번째');
    const n1Header = page.locator('header', { has: page.getByRole('link', { name: '← 뒤로' }) });
    await expect(n1Header).toBeVisible({ timeout: 8_000 });
    await expect(n1Header).toContainText('정보 입력');
    expect(responses.some((r) => r.currentStep === 'N1')).toBe(true);
    expect(responses.some((r) => r.currentStep === 'N3')).toBe(false);
    // N2 동안 5단계 행은 있었지만, 5단계 전부 완료 표시는 한 번도 그리지 않았다
    const rows = await rowsLog(page);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some(allDone), JSON.stringify(rows)).toBe(false);
  });

  test('J. 긴 judge 문구도 ANALYSIS LOG 설명을 한 줄로 두고, 아래 5단계·progress 위치를 밀지 않는다', async ({ page }) => {
    const judgeTick = (judge: Judge) => ({
      progress: 0.5,
      stages: stages('done', 'running', 'pending'),
      items: [item(9001, 'ocr', 'job', 'done'), item(9002, 'section', 'section', 'running')],
      analysisProgress: judgePhase('running', judge),
    });
    const normal = judgeTick({ total: 5, done: 2, excluded: 1, running: 1, waiting: 1, retrying: 0, failed: 0, cancelled: 0 });
    // 재시도·실패·취소까지 전부 0보다 커서 설명 줄에 모든 조각이 붙는 경우
    const long = judgeTick({ total: 120, done: 80, excluded: 12, running: 8, waiting: 10, retrying: 4, failed: 3, cancelled: 3 });
    const NORMAL_TEXT = '판정 대상 5개 · 완료 2 · 자동 제외 1 · 진행 중 1';
    const LONG_TEXT = '판정 대상 120개 · 완료 80 · 자동 제외 12 · 진행 중 8 · 재시도 대기 4 · 실패 3 · 취소 3';

    await page.setViewportSize({ width: 1920, height: 1080 });
    await setup(page, [normal, normal, long]);

    const measure = async () => {
      const box = async (locator: ReturnType<Page['locator']>) => {
        const b = await locator.boundingBox();
        expect(b).not.toBeNull();
        return b!;
      };
      const bar = page.getByRole('progressbar');
      return {
        caption: await box(logCaption(page)),
        firstRow: await box(fiveStepRows(page).first()),
        // progress 숫자는 bar 앞 블록 안의 숫자 span 이다
        percent: await box(page.locator('span').filter({ hasText: /^\d+$/ }).first()),
        bar: await box(bar),
        hint: await box(page.getByText('분석이 끝나면 섹션 확인 단계로 자동 이동합니다.', { exact: true })),
      };
    };

    await expect(logCaption(page)).toHaveText(NORMAL_TEXT);
    const before = await measure();

    await expect(logCaption(page)).toHaveText(LONG_TEXT, { timeout: 10_000 });
    await expectFigmaFiveRows(page);
    const after = await measure();

    // 1. 설명 줄은 한 줄 높이 그대로이고, 넘치는 부분은 말줄임으로 잘린다(다른 요소 위로 넘치지 않는다)
    expect(after.caption.height).toBe(before.caption.height);
    const clip = await logCaption(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { overflowed: el.scrollWidth > el.clientWidth, overflow: s.overflowX, textOverflow: s.textOverflow, whiteSpace: s.whiteSpace };
    });
    expect(clip).toEqual({ overflowed: true, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

    // 2~5. 아래 레이아웃은 일반 judge 와 같은 자리다
    expect(after.firstRow.y).toBe(before.firstRow.y);
    expect(after.percent.y).toBe(before.percent.y);
    expect(after.bar.y).toBe(before.bar.y);
    expect(after.hint.y).toBe(before.hint.y);

    // 6. 전체 문구는 잘리지 않은 채 DOM(보조기기)과 title(hover)에 남아 있다
    await expect(logCaption(page)).toHaveAttribute('title', LONG_TEXT);
    await expect(page.getByText(LONG_TEXT, { exact: true })).toHaveCount(1);
  });
});
