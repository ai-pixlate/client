import { test, expect, type Page } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N4 — "번역 중" 5단계 표시 회귀 검증 (Figma 660:4221).
//
// 세 가지를 따로 본다.
// - 서버에서 관측한 N4 상태(stages: inpaint→translate→verify→render) → 이번 poll 의 행·caption
// - 화면의 5개 설명 행 — render 하나를 04·05 두 행이 함께 설명한다(서버에 04/05 substage 가 없어
//   둘 중 하나만 고르거나 04 → 05 순서를 만들지 않는다)
// - 표시 progress 숫자 — 뒤로 가지 않게 유지하되 currentStep=N4 동안 100 이 되지 않는다
// N4 전체 완료는 서버 currentStep=N5 뿐이다. render=done·progress=1 만으로 완료로 보지 않는다.
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
  await page.getByRole('button', { name: '번역 시작' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: '번역 시작' }).click();
}

type StepStatusLabel = '완료' | '진행 중' | '대기';

interface StepSnapshot {
  no: string;
  label: string;
  status: StepStatusLabel;
}

/** 화면에 그려진 5단계(01~05) 행을 읽는다 — "01  라벨" + 캡션(완료/진행 중/대기) 구조. */
async function readSteps(page: Page): Promise<StepSnapshot[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('p')).filter((p) => /^\d\d\s/.test(p.textContent ?? ''));
    return rows.map((p) => {
      const text = p.textContent ?? '';
      const [no, ...rest] = text.trim().split(/\s+/);
      const caption = (p.nextElementSibling?.textContent ?? '').trim();
      return { no, label: rest.join(' '), status: caption as StepStatusLabel };
    });
  });
}

async function readProgress(page: Page): Promise<number> {
  return Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'));
}

/**
 * 표시 progress 구간(n4-processing-view.tsx DISPLAY_BAND_BY_N4_STAGE) — 첫 active 행 기준.
 * render 는 04·05 를 함께 설명하므로 한 구간(60~99)이다. N4 동안 100 은 없다.
 */
const DISPLAY_BAND_BY_FIRST_ACTIVE_STEP: Record<string, { floor: number; ceiling: number }> = {
  '01': { floor: 0, ceiling: 19 },
  '02': { floor: 20, ceiling: 39 },
  '03': { floor: 40, ceiling: 59 },
  '04': { floor: 60, ceiling: 99 },
};

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

test('N4 — 기본 순차 mock: 서버 단계대로 행이 바뀌고, render 는 04·05 를 함께 진행 중으로 두며, N5 에서만 끝난다', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await recordN4Snapshots(page);
  await reachN4(page);
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible({ timeout: 5_000 });
  const seenBands = new Set<string>();

  // mock은 2초 polling으로 9번(inpaint×2, translate×2, verify×2, render×3) 만에 N5로 전환한다.
  for (let tick = 0; tick < 15; tick += 1) {
    const stillOnN4 = await page
      .getByRole('heading', { name: '번역 중' })
      .isVisible()
      .catch(() => false);
    if (!stillOnN4) break;

    const steps = await readSteps(page);
    expect(steps, `tick ${tick}: 5단계가 전부 렌더돼야 한다`).toHaveLength(5);

    // 04·05 는 render 하나를 함께 설명한다 — 둘 중 하나만 진행 중이거나 완료인 상태는 없다
    const step04 = steps.find((s) => s.no === '04');
    const step05 = steps.find((s) => s.no === '05');
    expect(step04?.status, `tick ${tick}: 04·05 는 같은 상태여야 한다(${JSON.stringify(steps)})`).toBe(step05?.status);

    const firstActive = steps.find((s) => s.status === '진행 중');
    if (firstActive) {
      const band = DISPLAY_BAND_BY_FIRST_ACTIVE_STEP[firstActive.no];
      const shown = await readProgress(page);
      const stillSame = (await readSteps(page)).find((s) => s.status === '진행 중')?.no === firstActive.no;
      if (stillSame && band) {
        seenBands.add(firstActive.no);
        expect(shown, `tick ${tick}: ${firstActive.no} 진행 중 표시 progress`).toBeGreaterThanOrEqual(band.floor);
        expect(shown, `tick ${tick}: ${firstActive.no} 진행 중 표시 progress`).toBeLessThanOrEqual(band.ceiling);
      }
    }
    await page.waitForTimeout(1900);
  }

  expect(seenBands.size, `구간 검증한 단계: ${[...seenBands].join(',')}`).toBeGreaterThanOrEqual(4);
  const log = await n4Log(page);
  expectN4Invariants(log);
  expect(log.some((e) => JSON.stringify(e.rows) === JSON.stringify(rowsOf(D, D, D, A, A))), JSON.stringify(log)).toBe(true);
  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 10_000 });
});

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

  // tick 1: 현재 관측 가능한 running 은 translate — render=done 을 우선하지 않는다
  await expect.poll(async () => (await n4Log(page)).at(-1)?.rows, { timeout: 10_000 }).toEqual(rowsOf(D, A, P, P, P));
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
  const steps: string[] = [];
  page.on('response', async (res) => {
    if (res.request().method() === 'GET' && new URL(res.url()).pathname === `/jobs/${MOCK_JOB_ID}/tasks`) {
      const body = await res.json().catch(() => null);
      if (body?.currentStep) steps.push(body.currentStep);
    }
  });
  await setN4Script(page, [
    PARTIAL_RENDER_DONE,
    PARTIAL_RENDER_DONE,
    LATER_RENDER_RUNNING,
    LATER_RENDER_RUNNING,
    { progress: 1, stages: [n4Stage('render', 'done')], advance: true },
  ]);
  await recordN4Snapshots(page);
  await reachN4(page);
  await expect(page.getByRole('heading', { name: '번역 중' })).toBeVisible({ timeout: 5_000 });

  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 20_000 });
  // N5 응답 전까지 N4 화면은 100%·전부 완료를 그리지 않았다(완료 dwell 없음)
  const log = await n4Log(page);
  expectN4Invariants(log);
  expect(log.some((e) => JSON.stringify(e.rows) === JSON.stringify(rowsOf(D, A, P, P, P))), JSON.stringify(log)).toBe(true);
  expect(log.some((e) => JSON.stringify(e.rows) === JSON.stringify(rowsOf(D, D, D, A, A))), JSON.stringify(log)).toBe(true);
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
