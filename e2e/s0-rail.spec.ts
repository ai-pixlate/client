import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// S0 전역 프로세스 바(PRD F-NAV-01, Figma 525:3023 · 진행단계 instance 608:1440) — Chromium.
// 12월(PRD v3.6.4 F-JOB-07 · F-NAV-01, PM 11/18)에는 ✕ 가 없다 — 작업 나가기(뒤로 가기 · 상단 메뉴 · 작업 취소 확인)는
// job-exit.spec.ts 가 맡는다. 진행단계 위치 상세·툴팁 없음·커서·클릭 무동작(수용 ③)은 s0-steps-figma.spec.ts 가 맡는다.
// N2~N6 은 폴링 응답의 currentStep 만 고정해 바로 연다. 각 화면 본문·전환은 화면별 spec 이 맡는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'S0 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const STEPS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'] as const;
const LABELS = ['정보 입력', '분석중', '섹션 확인', '번역 중', '검수', '저장'];

async function openStep(page: Page, step: (typeof STEPS)[number]) {
  if (step === 'N1') {
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  } else {
    await page.addInitScript(
      ({ forced, jobId }) => {
        (window as unknown as { __s0Step: string }).__s0Step = forced;
        const original = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await original(input, init);
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (new URL(url, location.href).pathname !== `/jobs/${jobId}/tasks` || !response.ok) return response;
          const body = await response.json();
          const step = (window as unknown as { __s0Step: string }).__s0Step;
          // N6 는 confirm 이 등록한 현재 최종 렌더 task 를 따라간다(FE 가 POST /render 하지 않는다). 강제로 N6 에 들어갈 때도
          // confirm 을 거친 것과 같게 그 task(job 단위 · 완료)를 함께 준다 — 없으면 「최종 렌더 중」에서 계속 기다린다
          const items =
            step === 'N6'
              ? [...(body.items ?? []), { taskId: 990001, taskType: 'render', unitType: 'job', unitId: Number(jobId), status: 'done' }]
              : body.items;
          return new Response(JSON.stringify({ ...body, items, currentStep: step, jobStatus: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
        };
      },
      { forced: step, jobId: MOCK_JOB_ID },
    );
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
  }
  await expect(stepButton(page, 0)).toBeVisible();
}

const nav = (page: Page) => page.getByRole('navigation', { name: '작업 진행 단계' });
const stepButton = (page: Page, index: number) => nav(page).getByRole('button').nth(index);
for (const step of STEPS) {
  test(`${step} — 1920×1080 위치와 단계 상태가 Figma 와 같다`, async ({ page }) => {
    await openStep(page, step);
    await expect(page.getByTestId('s0-exit')).toHaveCount(0);
    expect(await nav(page).boundingBox()).toEqual({ x: 48, y: 96, width: 44, height: 924 });

    const current = STEPS.indexOf(step);
    for (let i = 0; i < STEPS.length; i += 1) {
      const button = stepButton(page, i);
      await expect(button).toContainText(LABELS[i]);
      const status = i < current ? 'done' : i === current ? 'current' : 'upcoming';
      await expect(button).toHaveAttribute('data-step-status', status);
      if (status === 'current') await expect(button).toHaveAttribute('aria-current', 'step');
      else await expect(button).not.toHaveAttribute('aria-current', 'step');
      const badge = button.locator('span').first();
      await expect(badge).toHaveCSS('width', '24px');
      await expect(badge).toHaveCSS('background-color', status === 'done' ? 'rgb(23, 23, 23)' : status === 'current' ? 'rgb(255, 106, 56)' : 'rgb(255, 255, 255)');
      if (status === 'done') await expect(badge.locator('svg')).toBeVisible();
      else await expect(badge).toHaveText(String(i + 1));
    }
  });
}

for (const [width, height] of [[1728, 885], [1512, 860], [1440, 900]] as const) {
  for (const step of STEPS) {
    test(`${step} — ${width}×${height} 겹침과 넘침이 없다`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openStep(page, step);
      const first = (await stepButton(page, 0).boundingBox())!;
      const last = (await stepButton(page, 5).boundingBox())!;
      const rail = (await page.getByTestId('s0-rail').boundingBox())!;
      const header = (await page.getByTestId('job-header').boundingBox())!;
      await expect(page.getByTestId('s0-exit')).toHaveCount(0);
      expect([rail.x, rail.width]).toEqual([36, 44]);
      expect(first.y).toBeGreaterThanOrEqual(header.y + header.height);
      expect(last.y + last.height).toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
      // rail 다음 본문은 rail 오른쪽에서 시작한다
      const bodyLeft = await page.getByTestId('s0-rail').evaluate((el) => el.nextElementSibling?.getBoundingClientRect().x ?? null);
      if (bodyLeft !== null) expect(bodyLeft).toBeGreaterThanOrEqual(rail.x + rail.width);
    });
  }
}

const LOADING_TEXT = '작업 상태를 확인하고 있습니다.';

/** tasks 첫 응답을 잡아 둔다. window.__releaseTasks() 로 푼다 */
async function holdTasks(page: Page) {
  await page.addInitScript((jobId) => {
    const w = window as unknown as { __releaseTasks: () => void };
    const gate = new Promise<void>((resolve) => {
      w.__releaseTasks = resolve;
    });
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === `/jobs/${jobId}/tasks`) await gate;
      return original(input, init);
    };
  }, MOCK_JOB_ID);
}

/** tasks 를 항상 500 으로 돌려준다 */
async function failTasks(page: Page) {
  await page.addInitScript((jobId) => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === `/jobs/${jobId}/tasks`) {
        return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '상태 조회 실패', retryable: true, traceId: 't' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return original(input, init);
    };
  }, MOCK_JOB_ID);
}

test('상태 조회 중 — ✕·진행단계·헤더 없이 단계를 추측하지 않으며 안내 위치는 그대로다', async ({ page }) => {
  await holdTasks(page);
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  const loading = page.getByText(LOADING_TEXT);
  await expect(loading).toBeVisible();
  await expect(page.getByTestId('s0-exit')).toHaveCount(0);
  await expect(nav(page)).toHaveCount(0);
  // 단계 라벨을 추측해 보이지 않는다
  await expect(page.locator('header')).toHaveCount(0);
  // 안내 문구는 기존처럼 헤더(56) 아래 영역 가운데다
  const box = (await loading.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 960)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height / 2 - (56 + 1024 / 2))).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);

  // 응답이 오면 진행단계가 나타난다
  await page.evaluate(() => (window as unknown as { __releaseTasks: () => void }).__releaseTasks());
  await expect(nav(page)).toBeVisible();
});

test('상태 조회 실패 — 오류만 보이고 단계를 추측하지 않는다', async ({ page }) => {
  await failTasks(page);
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(page.getByText('상태 조회 실패')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('s0-exit')).toHaveCount(0);
  await expect(nav(page)).toHaveCount(0);
  await expect(page.locator('header')).toHaveCount(0);
});

test('낮은 화면에서도 상태 조회 중 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await holdTasks(page);
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(page.getByText(LOADING_TEXT)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});
