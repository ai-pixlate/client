import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// S0 진행단계 위치·상호작용 — 최신 Figma 525:3023 / 진행단계 instance 608:1440(1920×1080: x48 y96 44×924),
// 실행계획 v3.6.4(단계 이동 안내 툴팁 제거 · cursor pointer · hover 강조 없음 · 이동 기능 없음).
// ✕ 버튼(x40 y40 40×40)과 rail 레이아웃은 그대로여야 한다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '화면 수치 검증은 Chromium 기준이다');

const STEPS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'] as const;
const FIGMA_ITEM_Y = [96, 270.4, 444.8, 619.2, 793.6, 968];

async function openStep(page: Page, step: (typeof STEPS)[number]) {
  if (step === 'N1') {
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  } else {
    await page.addInitScript(
      ({ forced, jobId }) => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await original(input, init);
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (new URL(url, location.href).pathname !== `/jobs/${jobId}/tasks` || !response.ok) return response;
          const body = await response.json();
          // N6 는 confirm 이 등록한 최종 렌더 task 를 따라간다 — 강제로 들어갈 때도 완료된 job 단위 render task 를 준다
          const items =
            forced === 'N6'
              ? [...(body.items ?? []), { taskId: 990001, taskType: 'render', unitType: 'job', unitId: Number(jobId), status: 'done' }]
              : body.items;
          return new Response(JSON.stringify({ ...body, items, currentStep: forced, jobStatus: 'running' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        };
      },
      { forced: step, jobId: MOCK_JOB_ID },
    );
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
  }
  await expect(page.getByTestId('s0-exit')).toBeVisible();
  await expect(stepButtons(page).first()).toBeVisible();
}

const nav = (page: Page) => page.getByRole('navigation', { name: '작업 진행 단계' });
const stepButtons = (page: Page) => nav(page).getByRole('button');
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;
const near = (actual: number, expected: number, label: string, tolerance = 1) =>
  expect(Math.abs(actual - expected), `${label}: ${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);

test.describe('1920×1080 — Figma 608:1440', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const step of STEPS) {
    test(`${step} — 진행단계 bbox 48/96/44/924 · 단계 6개 y · ✕ 위치 유지`, async ({ page }) => {
      await openStep(page, step);
      const steps = await box(page, 's0-steps');
      console.log(`[${step}] s0-steps`, JSON.stringify(steps));
      near(steps.x, 48, 'steps x');
      near(steps.y, 96, 'steps y');
      near(steps.width, 44, 'steps w');
      near(steps.height, 924, 'steps h');

      const buttons = stepButtons(page);
      await expect(buttons).toHaveCount(6);
      for (let i = 0; i < 6; i++) {
        const item = (await buttons.nth(i).boundingBox())!;
        console.log(`[${step}] item ${i + 1}`, JSON.stringify(item));
        near(item.x, 48, `item ${i + 1} x`);
        near(item.width, 44, `item ${i + 1} w`);
        near(item.height, 52, `item ${i + 1} h`);
        near(item.y, FIGMA_ITEM_Y[i], `item ${i + 1} y`);
      }

      // ✕ 버튼은 이번 변경과 무관하게 그대로다(rail root ml-9 · ✕ left-1 top-10)
      const exit = await box(page, 's0-exit');
      near(exit.x, 40, 'exit x');
      near(exit.y, 40, 'exit y');
      near(exit.width, 40, 'exit w');
      near(exit.height, 40, 'exit h');
      expect(exit.y + exit.height).toBeLessThan(steps.y);

      // 잘리지 않고 가로 넘침이 없다
      expect(steps.y + steps.height).toBeLessThanOrEqual(1080);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test('N1 — 진행단계 오른쪽(92)과 본문 시작 사이에 간격이 있다', async ({ page }) => {
    await openStep(page, 'N1');
    const steps = await box(page, 's0-steps');
    near(steps.x + steps.width, 92, 'steps right');
    // 본문 첫 heading 이 진행단계 오른쪽보다 충분히 오른쪽에서 시작한다(Figma 본문 시작 ≈140)
    const heading = (await page.getByRole('heading').first().boundingBox())!;
    console.log('[N1] heading', JSON.stringify(heading));
    expect(heading.x - (steps.x + steps.width)).toBeGreaterThanOrEqual(40);
  });
});

test.describe('상호작용 — 실행계획 v3.6.4', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const step of ['N1', 'N3'] as const) {
    test(`${step} — 툴팁 없음 · cursor pointer · hover 강조 없음 · 클릭해도 이동·요청 없음`, async ({ page }) => {
      await openStep(page, step);
      const requests: string[] = [];
      page.on('request', (r) => {
        if (r.method() !== 'GET') requests.push(`${r.method()} ${new URL(r.url()).pathname}`);
      });
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) requests.push(`navigate ${frame.url()}`);
      });
      const urlBefore = page.url();
      const currentBefore = await nav(page).locator('[aria-current="step"]').textContent();

      await expect(nav(page).getByRole('tooltip')).toHaveCount(0);
      await expect(page.getByText('단계 이동은 12월 구현 예정입니다.')).toHaveCount(0);

      const buttons = stepButtons(page);
      const styleOf = (index: number) =>
        buttons.nth(index).evaluate((el) => {
          const pick = (node: Element) => {
            const s = getComputedStyle(node);
            return [s.backgroundColor, s.color, s.borderColor, s.opacity, s.boxShadow].join('|');
          };
          return [el, ...Array.from(el.querySelectorAll('*'))].map(pick).join(';');
        });

      for (let i = 0; i < 6; i++) {
        expect(await buttons.nth(i).evaluate((el) => getComputedStyle(el).cursor), `step ${i + 1} cursor`).toBe('pointer');
        const before = await styleOf(i);
        await buttons.nth(i).hover();
        await page.waitForTimeout(250);
        expect(await styleOf(i), `step ${i + 1} hover 전후 시각 상태`).toBe(before);
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        // aria-disabled 버튼이라 locator.click 은 actionability 에서 기다린다 — 실제 마우스 클릭으로 누른다
        const target = (await buttons.nth(i).boundingBox())!;
        await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
        await buttons.nth(i).focus();
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await expect(buttons.nth(i)).not.toHaveAttribute('aria-describedby');
      }

      await page.waitForTimeout(500);
      expect(page.url()).toBe(urlBefore);
      expect(await nav(page).locator('[aria-current="step"]').textContent()).toBe(currentBefore);
      expect(requests).toEqual([]);
    });
  }
});

test.describe('낮은 화면 — 최소 높이·breakpoint 없이 진행단계 높이만 줄어든다', () => {
  for (const [width, height] of [[1728, 885], [1512, 860], [1440, 900], [1280, 720]] as const) {
    test(`${width}×${height} — top 96 · bottom 60 · ✕ 와 겹치지 않음`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openStep(page, 'N3');
      const steps = await box(page, 's0-steps');
      const exit = await box(page, 's0-exit');
      near(steps.x, 48, 'steps x');
      near(steps.y, 96, 'steps y');
      near(steps.height, height - 96 - 60, 'steps h');
      near(exit.x, 40, 'exit x');
      near(exit.y, 40, 'exit y');
      expect(exit.y + exit.height).toBeLessThan(steps.y);
      const buttons = stepButtons(page);
      for (let i = 0; i < 6; i++) {
        const item = (await buttons.nth(i).boundingBox())!;
        near(item.height, 52, `item ${i + 1} h`);
        expect(item.y + item.height).toBeLessThanOrEqual(height - 60 + 1);
        if (i > 0) {
          const prev = (await buttons.nth(i - 1).boundingBox())!;
          expect(item.y).toBeGreaterThan(prev.y + prev.height);
        }
      }
    });
  }
});
