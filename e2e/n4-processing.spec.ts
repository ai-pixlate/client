import { test, expect, type Page } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

import {
  expectCompletionCopy,
  expectCompletionPresentation,
  expectSmoothProcessing,
  formatTimeline,
  onScreen,
  processingSnaps,
  recordProcessing,
  type DomSnap,
} from './helpers/processing-recorder';

// ─────────────────────────────────────────────────────────────────
// N4 — "번역 중" 5단계 표시 회귀 검증 (Figma 660:4221).
//
// 세 가지를 따로 본다.
// - 서버에서 관측한 N4 상태(stages: inpaint→translate→verify→render) → 이번 poll 의 행·caption
// - 화면의 5개 설명 행 — render 하나를 04·05 두 행이 함께 설명한다(서버에 04/05 substage 가 없어
//   둘 중 하나만 고르거나 04 → 05 순서를 만들지 않는다)
// - 표시 progress 숫자 — 관측 단계는 상한만 열고, 숫자는 점프·감소 없이 오르며 currentStep=N4 동안 100 이
//   되지 않는다
// N4 전체 완료는 서버 currentStep=N5 뿐이다. render=done·progress=1 만으로 완료로 보지 않는다. N5 응답을
// 받은 뒤에만 N4 화면이 100% 와 5행 완료를 잠깐 보여 주고 N5 로 넘어간다.
// 섹션마다 단계가 다른 응답은 lib/msw/handlers.ts __pixlateMockN4Script 로 poll 마다 지정한다.
// ─────────────────────────────────────────────────────────────────

async function selectFirstValidOption(page: Page, index: number) {
  const select = page.getByRole('combobox').nth(index);
  const firstRealOption = select.locator('option').nth(1);
  const value = await firstRealOption.getAttribute('value');
  if (!value) throw new Error(`combobox[${index}]에 선택 가능한 option이 없습니다`);
  await select.selectOption(value);
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** N1 진입부터 N4("번역 중") 화면 도달까지 이동한다. */
async function reachN4(page: Page): Promise<void> {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('N4 stage mapping 검증');
  await selectFirstValidOption(page, 0);
  await selectFirstValidOption(page, 1);
  await page.getByRole('button', { name: '선택하기' }).click();
  await page.getByRole('dialog', { name: '카테고리 선택' }).getByRole('button', { name: '바디/헤어' }).click();
  await selectFirstValidOption(page, 2);
  await page.getByLabel('파일 선택').setInputFiles({
    name: 'n4-processing.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await page.getByRole('button', { name: '다음' }).click();
  await page.waitForURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  // 기본 mock N2 는 analyze → finalize → judge 를 poll 마다 보여 준 뒤 N3 로 간다(약 11초)
  await page.getByRole('button', { name: '이대로 진행' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: '이대로 진행' }).click();
}

async function readProgress(page: Page): Promise<number> {
  return Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'));
}

const P = '대기';
const A = '진행 중';
const D = '완료';
const rowsOf = (...states: string[]) => Object.fromEntries(states.map((state, i) => [`0${i + 1}`, state]));
const RENDER_CAPTION = '번역 결과 이미지 적용 중';
const TRANSLATE_CAPTION = '번역·용어 맞춤 중';

type N4Snapshot = { rows: Record<string, string>; progress: number; caption: string };

/**
 * N4 화면의 5단계 행·표시 progress·GIF caption 을 DOM 변화마다 기록한다(연속 중복 제거).
 * N4 heading 이 보이는 동안만 기록한다 — N5 로 넘어간 뒤 값은 섞지 않는다.
 */
async function recordN4Snapshots(page: Page) {
  await page.addInitScript(
    ({ captions }) => {
      const w = window as unknown as { __n4Log: N4Snapshot[] };
      w.__n4Log = [];
      const snapshot = () => {
        const onN4 = Array.from(document.querySelectorAll('h1, h2, h3')).some((h) => h.textContent?.trim() === '번역 중');
        const bar = document.querySelector('[role="progressbar"]');
        const rowEls = Array.from(document.querySelectorAll('p')).filter((p) => /^0[1-5]\s/.test(p.textContent ?? ''));
        if (!onN4 || !bar || rowEls.length !== 5) return;
        const rows: Record<string, string> = {};
        for (const p of rowEls) rows[(p.textContent ?? '').trim().slice(0, 2)] = (p.nextElementSibling?.textContent ?? '').trim();
        const text = document.body.textContent ?? '';
        const caption = captions.find((c) => text.includes(c)) ?? '';
        const entry = { rows, progress: Number(bar.getAttribute('aria-valuenow')), caption };
        const last = w.__n4Log[w.__n4Log.length - 1];
        if (!last || JSON.stringify(last) !== JSON.stringify(entry)) w.__n4Log.push(entry);
      };
      const start = () =>
        new MutationObserver(snapshot).observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['aria-valuenow'],
        });
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
    },
    {
      captions: ['원문 제거·배경 복원 중', TRANSLATE_CAPTION, '규제 기준 확인 중', RENDER_CAPTION],
    },
  );
}

const n4Log = (page: Page) => page.evaluate(() => (window as unknown as { __n4Log: N4Snapshot[] }).__n4Log);
const allDone = (rows: Record<string, string>) => Object.values(rows).every((v) => v === D);

/** N4 동안 공통으로 지켜야 하는 것: 100% 없음 · 5행 전부 완료 없음 · 숫자 감소 없음 */
function expectN4Invariants(log: N4Snapshot[]) {
  const dump = JSON.stringify(log);
  expect(log.length, dump).toBeGreaterThan(0);
  for (const entry of log) {
    expect(entry.progress, `N4 동안 100% 금지: ${dump}`).toBeLessThan(100);
    expect(allDone(entry.rows), `N4 동안 5행 전부 완료 금지: ${dump}`).toBe(false);
  }
  for (let i = 1; i < log.length; i += 1) {
    expect(log[i].progress, `표시 progress 감소: ${log.map((e) => e.progress).join(' → ')}`).toBeGreaterThanOrEqual(log[i - 1].progress);
  }
}

const n4Stage = (key: string, status: 'pending' | 'running' | 'done' | 'failed') => ({ key, label: key, status });

/** 섹션마다 단계가 다른 응답 — A 섹션 render 완료, B 섹션은 아직 번역 중(render 시도 없음) */
const PARTIAL_RENDER_DONE = { progress: 0.65, stages: [n4Stage('translate', 'running'), n4Stage('render', 'done')] };
/** 그 다음 B 섹션 render 시도가 생겨 running — 서버 global progress 는 오히려 내려간다 */
const LATER_RENDER_RUNNING = { progress: 0.6, stages: [n4Stage('render', 'running')] };

async function setN4Script(page: Page, script: unknown[]) {
  await page.addInitScript((s) => {
    (globalThis as Record<string, unknown>).__pixlateMockN4Script = s;
  }, script);
}

test('N4 — stage 실패를 받으면 기존 실패 안내가 뜨고 표시 progress 는 시간이 지나도 오르지 않는다', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.clock.install();
  await reachN4(page);
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible({ timeout: 5_000 });

  await page.evaluate(() => {
    (globalThis as Record<string, unknown>).__pixlateMockN4Fail = true;
  });
  await expect(page.getByText('일부 항목을 처리하지 못했습니다')).toBeVisible({ timeout: 10_000 });
  const atFailure = await readProgress(page);

  await page.clock.fastForward('05:00');
  await page.clock.fastForward('00:05');
  expect(await readProgress(page)).toBe(atFailure);
  // 실패를 완료처럼 처리하지 않는다 — N4 화면에 그대로 남는다
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible();
  expect(atFailure).toBeLessThan(100);
});

test('N4 A — 일부 섹션 render=done 이어도 translate 가 running 이면 완료가 아니고, 다음 render running 에서도 100% 가 아니다', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await setN4Script(page, [PARTIAL_RENDER_DONE, PARTIAL_RENDER_DONE, LATER_RENDER_RUNNING]);
  await recordN4Snapshots(page);
  await reachN4(page);
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible({ timeout: 5_000 });

  // tick 1: 현재 관측 가능한 running 은 translate — render=done 을 우선하지 않는다. 응답에 없는 inpaint 는 완료가 아니다
  await expect.poll(async () => (await n4Log(page)).at(-1)?.rows, { timeout: 10_000 }).toEqual(rowsOf(P, A, P, P, P));
  await expect(page.getByText(TRANSLATE_CAPTION, { exact: true })).toBeVisible();
  const atTranslate = await readProgress(page);
  expect(atTranslate).toBeLessThan(100);

  // tick 2: render running(서버 progress 0.65 → 0.60) — 여전히 N4, 100% 아님, render 표시
  await expect.poll(async () => (await n4Log(page)).at(-1)?.rows, { timeout: 10_000 }).toEqual(rowsOf(D, D, D, A, A));
  await expect(page.getByText(RENDER_CAPTION, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible();
  const atRender = await readProgress(page);
  expect(atRender).toBeLessThan(100);
  // 숫자는 서버 progress 가 내려가도 tick 1 보다 내려가지 않는다(행 상태와 별개인 UX 규칙)
  expect(atRender).toBeGreaterThanOrEqual(atTranslate);

  const log = await n4Log(page);
  expectN4Invariants(log);
  await expect(page.locator('[data-testid="n5-panel"]')).toHaveCount(0);
});

test('N4 B — render=done 이 아니라 서버 currentStep=N5 가 와야 N5 로 이동한다', async ({ page }) => {
  test.setTimeout(60_000);
  const rec = await recordProcessing(page);
  await setN4Script(page, [
    PARTIAL_RENDER_DONE,
    PARTIAL_RENDER_DONE,
    LATER_RENDER_RUNNING,
    LATER_RENDER_RUNNING,
    { progress: 1, stages: [n4Stage('render', 'done')], advance: true },
  ]);
  await reachN4(page);
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible({ timeout: 5_000 });

  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 20_000 });
  // N5 응답 전까지 N4 화면은 100%·전부 완료를 그리지 않았다 — 그 뒤에만 완료 표시를 하고 넘어간다
  const timeline = formatTimeline(rec);
  const snaps = processingSnaps(rec, '번역 중', 'N5');
  expectSmoothProcessing(snaps, timeline);
  expect(snaps.some((s) => s.rows === 'DDDDD'), timeline).toBe(false);
  expect(snaps.some((s) => s.rows === 'PAPPP'), timeline).toBe(true);
  expect(snaps.some((s) => s.rows === 'DDDAA'), timeline).toBe(true);
  expectCompletionPresentation(rec, '번역 중', 'N5', timeline);
  const steps = rec.polls.map((p) => p.currentStep);
  expect(steps.filter((s) => s === 'N4').length, steps.join(',')).toBeGreaterThanOrEqual(4);
  expect(steps.at(-1)).toBe('N5');
});

test('N4 C — 첫 render 관측이 progress=0.9 여도 04·05 를 함께 render 로 보이고, 보지 않은 04 단독 단계를 만들지 않는다', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.clock.install();
  await setN4Script(page, [{ progress: 0.9, stages: [n4Stage('render', 'running')] }]);
  await recordN4Snapshots(page);
  await reachN4(page);
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible({ timeout: 5_000 });

  await expect.poll(async () => (await n4Log(page)).at(-1)?.rows, { timeout: 10_000 }).toEqual(rowsOf(D, D, D, A, A));
  await expect(page.getByText(RENDER_CAPTION, { exact: true })).toBeVisible();
  // 시간이 지나도 04 → 05 로 넘어가는 최소 체류·자동 전환이 없다
  await page.clock.fastForward('05:00');
  await expect.poll(async () => (await n4Log(page)).at(-1)?.rows).toEqual(rowsOf(D, D, D, A, A));

  const log = await n4Log(page);
  expectN4Invariants(log);
  // 서버가 준 적 없는 "04 만 진행 중"·"05 만 진행 중" 상태가 한 번도 그려지지 않았다
  for (const e of log) {
    expect(e.rows['04'], JSON.stringify(log)).toBe(e.rows['05']);
  }
  expect(log.every((e) => JSON.stringify(e.rows) === JSON.stringify(rowsOf(D, D, D, A, A))), JSON.stringify(log)).toBe(true);
});

test('N4 D — jobStatus=failed·render=done·progress=1 이어도 완료가 아니고 N4 실패 안내에 머문다', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install();
  await setN4Script(page, [
    {
      progress: 1,
      stages: [n4Stage('render', 'done')],
      items: [
        {
          taskId: 9301,
          taskType: 'render',
          unitType: 'section',
          unitId: 9301,
          status: 'failed',
          uiStatus: 'failed',
          retryCount: 3,
          maxRetry: 3,
          retryable: false,
          errorCode: 'RENDER_FAILED',
          revision: null,
        },
      ],
      fail: true,
    },
  ]);
  await recordN4Snapshots(page);
  await reachN4(page);
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible({ timeout: 5_000 });

  await expect(page.getByText('일부 항목을 처리하지 못했습니다')).toBeVisible({ timeout: 10_000 });
  const atFailure = await readProgress(page);
  expect(atFailure).toBeLessThan(100);

  await page.clock.fastForward('05:00');
  await page.clock.fastForward('00:05');
  expect(await readProgress(page)).toBe(atFailure);
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible();
  await expect(page.locator('[data-testid="n5-panel"]')).toHaveCount(0);
  expectN4Invariants(await n4Log(page));
});

// ── 로딩 표현 안정화: 서버 관측 단계 · 표시 % · 실제 완료(N5) 를 분리 ──
const N4_TITLE = '번역 중';
const N4_PARALLEL_CAPTION = '여러 번역 작업을 함께 처리 중';
const N4_COMPLETION_COPY = {
  headline: '번역 작업이 완료되었습니다.',
  visualDescription: '번역 결과를 반영해 검수 화면으로 이동합니다.',
  heading: '번역 완료',
  line: '번역과 이미지 적용이 완료되었습니다.',
  hint: '검수 화면으로 이동합니다.',
};

/** 같은 실행 안에서 행 상태가 바뀐 순서(연속 중복 제거) */
const rowSequence = (snaps: DomSnap[]) => snaps.map((s) => s.rows).filter((r, i, arr) => r !== arr[i - 1]);

test('N4 E-1 — 빠른 서버(inpaint → render → N5)면 보지 않은 단계를 재생하지 않고, % 는 점프 없이 오르며 N5 응답 뒤에만 100 을 보여 준다', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const rec = await recordProcessing(page);
  await setN4Script(page, [
    { progress: 0.1, stages: [n4Stage('inpaint', 'running')] },
    { progress: 0.1, stages: [n4Stage('inpaint', 'running')] },
    { progress: 0.8, stages: [n4Stage('render', 'running')] },
    { progress: 0.8, stages: [n4Stage('render', 'running')] },
    { progress: 1, stages: [n4Stage('render', 'done')], advance: true },
  ]);
  await reachN4(page);
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 30_000 });

  const timeline = formatTimeline(rec);
  const snaps = processingSnaps(rec, N4_TITLE, 'N5');
  // 관측하지 않은 translate(02)·verify(03) 진행 중을 만들지 않는다
  expect(rowSequence(snaps), timeline).toEqual(['APPPP', 'DDDAA']);
  expectSmoothProcessing(snaps, timeline);
  expectCompletionPresentation(rec, N4_TITLE, 'N5', timeline);
});

test('N4 E-2 — 기본 순차 mock: 행은 서버 단계 순서대로, % 는 단계 전환 순간에도 점프·감소 없이, N5 응답 뒤 100 을 보고 N5 로 간다', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const rec = await recordProcessing(page);
  await reachN4(page);
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 40_000 });

  const timeline = formatTimeline(rec);
  const snaps = processingSnaps(rec, N4_TITLE, 'N5');
  const seq = rowSequence(snaps);
  // 2초 polling 이 놓친 단계는 건너뛸 수 있지만, 순서가 뒤로 가지 않는다
  const order = ['APPPP', 'DAPPP', 'DDAPP', 'DDDAA'];
  for (let i = 1; i < seq.length; i += 1) expect(order.indexOf(seq[i]), timeline).toBeGreaterThan(order.indexOf(seq[i - 1]));
  expect(seq.at(-1), timeline).toBe('DDDAA');
  // 04·05 는 render 하나를 함께 설명한다
  for (const s of snaps) expect(s.rows[3], timeline).toBe(s.rows[4]);
  expectSmoothProcessing(snaps, timeline);
  expectCompletionPresentation(rec, N4_TITLE, 'N5', timeline);
});

test('N4 E-3 — 섹션 병렬: 네 단계가 함께 running 이면 01~05 를 함께 진행 중으로 보이고 % 가 01 구간에 묶이지 않는다', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const rec = await recordProcessing(page);
  // 실제 서버 stages 는 task_type 집계라(하나라도 running → running) 여러 단계가 함께 running 일 수 있다
  const parallel = (progress: number) => ({
    progress,
    stages: [n4Stage('inpaint', 'running'), n4Stage('translate', 'running'), n4Stage('verify', 'running'), n4Stage('render', 'running')],
  });
  await setN4Script(page, [{ progress: 0.02, stages: [n4Stage('inpaint', 'running')] }, parallel(0.3), parallel(0.5), parallel(0.7)]);
  await reachN4(page);
  await expect(page.getByRole('heading', { name: N4_TITLE })).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(12_000);

  const timeline = formatTimeline(rec);
  const snaps = processingSnaps(rec, N4_TITLE, 'N5');
  // 처음 poll 은 inpaint 하나만 running, 그 뒤에는 서버가 running 이라고 한 단계를 모두 진행 중으로 보인다
  expect(rowSequence(snaps), timeline).toEqual(['APPPP', 'AAAAA']);
  expect(snaps.at(-1)!.cap, timeline).toBe(N4_PARALLEL_CAPTION);
  expectSmoothProcessing(snaps, timeline);
  expect(snaps.at(-1)!.pct!, `inpaint 구간(19)에 묶이지 않는다\n${timeline}`).toBeGreaterThan(25);
});

test('N4 E-4 — 같은 브라우저 context 에서 N1 → N5 를 두 번 실행해도 두 실행이 같은 정책으로 보인다', async ({ page }) => {
  test.setTimeout(150_000);
  const rec = await recordProcessing(page);
  const runs: { from: number; until: number }[] = [];
  for (let run = 0; run < 2; run += 1) {
    const from = Date.now();
    await reachN4(page);
    await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 40_000 });
    runs.push({ from, until: Date.now() });
  }

  const views = runs.map(({ from, until }) => {
    const polls = rec.polls.filter((p) => p.t >= from && p.t <= until && (p.currentStep === 'N4' || p.currentStep === 'N5'));
    const snaps = processingSnaps(rec, N4_TITLE, 'N5', from).filter((s) => s.t <= until);
    return { polls: polls.map((p) => `${p.currentStep} ${p.stages}`), snaps, timeline: formatTimeline(rec, from, until) };
  });
  const both = views.map((v, i) => `── run ${i + 1}\n${v.timeline}`).join('\n');
  for (const [i, v] of views.entries()) {
    // 매 실행은 처음(0 근처)에서 시작한다 — 이전 실행의 표시 % 를 이어받지 않는다
    expect(v.snaps[0].pct!, `run ${i + 1} 첫 표시 %\n${both}`).toBeLessThanOrEqual(5);
    expect(v.snaps[0].rows, `run ${i + 1} 첫 행\n${both}`).toBe('APPPP');
    expectSmoothProcessing(v.snaps, both);
    expectCompletionPresentation(rec, N4_TITLE, 'N5', both, runs[i].from);
  }
  // 서버(mock) poll 순서와 화면 행 순서가 두 실행에서 같다
  expect(views[1].polls, both).toEqual(views[0].polls);
  expect(rowSequence(views[1].snaps), both).toEqual(rowSequence(views[0].snaps));
});

test('N4 E-5 — N4 도중 새로 시작(페이지 이동)한 다음 실행이 이전 실행의 표시 % 에서 시작하지 않는다', async ({ page }) => {
  test.setTimeout(150_000);
  const rec = await recordProcessing(page);
  await reachN4(page);
  // 첫 실행을 verify(03) 진행 중에 끊는다 — 화면 unmount 정리 없이 페이지가 바뀐다
  await expect.poll(() => onScreen(rec.dom, N4_TITLE).at(-1)?.rows, { timeout: 30_000 }).toBe('DDAPP');
  const secondFrom = Date.now();
  await reachN4(page);
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 40_000 });

  const timeline = formatTimeline(rec, secondFrom);
  const snaps = processingSnaps(rec, N4_TITLE, 'N5', secondFrom);
  expect(snaps[0].rows, timeline).toBe('APPPP');
  expect(snaps[0].pct!, `두 번째 실행 첫 표시 %\n${timeline}`).toBeLessThanOrEqual(5);
  expectSmoothProcessing(snaps, timeline);
  expectCompletionPresentation(rec, N4_TITLE, 'N5', timeline, secondFrom);
});

test('N4 E-6 — N5 응답 뒤 완료 표시 동안 상태 태그·LOG·안내가 모두 완료를 말하고, 그 전에는 완료라고 하지 않는다', async ({ page }) => {
  test.setTimeout(90_000);
  const rec = await recordProcessing(page);
  await setN4Script(page, [
    { progress: 0.8, stages: [n4Stage('render', 'running')] },
    { progress: 0.8, stages: [n4Stage('render', 'running')] },
    { progress: 1, stages: [n4Stage('render', 'done')], advance: true },
  ]);
  await reachN4(page);
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 30_000 });

  const timeline = formatTimeline(rec);
  const { first100At, leftAt } = expectCompletionPresentation(rec, N4_TITLE, 'N5', timeline);
  expectCompletionCopy(rec, N4_TITLE, 'N5', N4_COMPLETION_COPY, timeline);
  const processing = processingSnaps(rec, N4_TITLE, 'N5');
  expect(new Set(processing.map((d) => d.tag)), timeline).toEqual(new Set(['진행중']));
  expect(new Set(processing.map((d) => d.heading)), timeline).toEqual(new Set(['지금 처리하는 일']));
  expect(new Set(processing.map((d) => d.hint)), timeline).toEqual(new Set(['완료되면 검수 화면으로 자동 이동합니다.']));
  expect(new Set(processing.map((d) => d.headline)), timeline).toEqual(new Set(['번역과 배경 복원을 함께 진행하고 있습니다.']));
  console.log(`N4 100% 노출 ${leftAt - first100At}ms`);
});

test('N4 E-7 — 병렬 running 은 해당 행을 모두 진행 중으로, render=done 은 완료·상한으로 쓰지 않고, 상한은 running 인 가장 뒤 단계로 연다', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const rec = await recordProcessing(page);
  const A = { progress: 0.3, stages: [n4Stage('inpaint', 'running'), n4Stage('translate', 'running'), n4Stage('verify', 'running')] };
  const B = { progress: 0.65, stages: [n4Stage('translate', 'running'), n4Stage('render', 'done')] };
  const C = { progress: 0.6, stages: [n4Stage('render', 'running')] };
  await setN4Script(page, [A, A, A, B, B, C, C, { progress: 1, stages: [n4Stage('render', 'done')], advance: true }]);
  await reachN4(page);
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 40_000 });

  const timeline = formatTimeline(rec);
  const snaps = processingSnaps(rec, N4_TITLE, 'N5');
  // A → B → C: 서버가 running 이라고 한 단계만 진행 중. render=done 은 04·05 완료가 아니다
  // B 에는 inpaint key 가 없다 — 응답에 없는 단계를 완료로 그리지 않는다
  expect(rowSequence(snaps), timeline).toEqual(['AAAPP', 'PAPPP', 'DDDAA']);
  const a = snaps.filter((d) => d.rows === 'AAAPP');
  const b = snaps.filter((d) => d.rows === 'PAPPP');
  const c = snaps.filter((d) => d.rows === 'DDDAA');
  // A: 하나의 단계만 지금 작업이라고 말하지 않는다. 01 구간(19)에 묶이지 않는다
  expect(new Set(a.map((d) => d.cap)), timeline).toEqual(new Set([N4_PARALLEL_CAPTION]));
  expect(a.at(-1)!.pct!, timeline).toBeGreaterThan(19);
  // B: translate 만 running — render=done 으로 99 상한을 열지 않는다(02 상한 39 안에 머문다)
  expect(new Set(b.map((d) => d.cap)), timeline).toEqual(new Set(['번역·용어 맞춤 중']));
  for (const d of b) expect(d.pct!, timeline).toBeLessThanOrEqual(Math.max(39, b[0].pct!));
  // C: render running 에서 상한이 열려 계속 오르되, render 하한(60)으로 뛰지 않는다
  expect(c[0].pct!, timeline).toBeGreaterThanOrEqual(b.at(-1)!.pct!);
  expect(c[0].pct!, timeline).toBeLessThan(60);
  expect(c.at(-1)!.pct!, timeline).toBeGreaterThan(c[0].pct!);
  expectSmoothProcessing(snaps, timeline);
  // D: N5 응답 뒤에만 100 · 완료 표시
  expectCompletionPresentation(rec, N4_TITLE, 'N5', timeline);
  expectCompletionCopy(rec, N4_TITLE, 'N5', N4_COMPLETION_COPY, timeline);
});

test('N4 E-8 — translate running · render done(inpaint key 없음)이면 01 을 완료로 추정하지 않고, render=done 으로 상한을 열지 않는다(02 상한 39)', async ({ page }) => {
  test.setTimeout(90_000);
  const rec = await recordProcessing(page);
  await setN4Script(page, [PARTIAL_RENDER_DONE]);
  await reachN4(page);
  await expect(page.getByRole('heading', { name: N4_TITLE })).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(12_000);

  const timeline = formatTimeline(rec);
  const snaps = processingSnaps(rec, N4_TITLE, 'N5');
  // inpaint key 가 응답에 없으므로 01 은 완료가 아니다. render=done 으로 04·05 완료도 아니다
  expect(new Set(snaps.map((d) => d.rows)), timeline).toEqual(new Set(['PAPPP']));
  for (const d of snaps) expect(d.pct!, timeline).toBeLessThanOrEqual(39);
  expectSmoothProcessing(snaps, timeline);
});

test('N4 E-9 — inpaint=done 이 명시된 응답에서만 01 을 완료로 그린다', async ({ page }) => {
  test.setTimeout(90_000);
  const rec = await recordProcessing(page);
  await setN4Script(page, [
    { progress: 0.65, stages: [n4Stage('inpaint', 'done'), n4Stage('translate', 'running'), n4Stage('render', 'done')] },
  ]);
  await reachN4(page);
  await expect(page.getByRole('heading', { name: N4_TITLE })).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(4_000);

  const timeline = formatTimeline(rec);
  const snaps = processingSnaps(rec, N4_TITLE, 'N5');
  expect(new Set(snaps.map((d) => d.rows)), timeline).toEqual(new Set(['DAPPP']));
  for (const d of snaps) expect(d.pct!, timeline).toBeLessThanOrEqual(39);
});
