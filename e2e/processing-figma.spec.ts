import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N2·N4 정상 화면 글자·위치 (Figma 1821:46419 「N2 분석중」 · 1821:48003 「N4 번역중」) — Chromium, 1920×1080.
// 없는 글꼴 이름이 들어가면 브라우저 기본 글꼴로 그려지고 줄 높이까지 달라져 아래 요소가 밀린다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Figma 수치 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

async function openStep(page: Page, currentStep: 'N2' | 'N4') {
  await page.addInitScript(
    ({ step, jobId }) => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url, location.href).pathname !== `/jobs/${jobId}/tasks` || !response.ok) return response;
        const body = await response.json();
        return new Response(JSON.stringify({ ...body, currentStep: step, jobStatus: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    },
    { step: currentStep, jobId: MOCK_JOB_ID },
  );
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
}

const near = (actual: number, expected: number, label: string, tolerance = 1) =>
  expect(Math.abs(actual - expected), `${label}: ${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
const nearBox = (box: { x: number; y: number; width: number; height: number }, expected: readonly number[], label: string) =>
  [box.x, box.y, box.width, box.height].forEach((v, i) => near(v, expected[i], `${label} [x,y,w,h][${i}]`));

for (const c of [
  // Figma x/y/w/h. 로그(「Frame 300」)는 두 화면 모두 패널 세로 가운데(중심 y 558.5)라 높이만 다르다.
  // groupHeights: 「N2 / Step List」 Step 칸 높이(위아래 12 + 번호·label·상태 줄, 세로 gap 4)
  { step: 'N2', title: '이미지 분석', logLabel: 'ANALYSIS LOG', log: [1397, 273, 403, 571], groupHeights: [122, 80, 80] },
  { step: 'N4', title: '번역 중', logLabel: 'TRANSLATION LOG', log: [1397, 243.5, 403, 630], groupHeights: [101, 80, 80, 80] },
] as const) {
  test(`${c.step} — Pretendard 굵기와 패널·비주얼·구분선·로그 위치가 Figma와 같다`, async ({ page }) => {
    await openStep(page, c.step);
    // 화면별 제목 행은 최신 Figma 에서 빠졌다 — 화면명은 작업용 공통 헤더가 보이고, h1 은 화면 읽기용으로만 남는다
    await expect(page.getByTestId('job-header-title')).toHaveText(c.title);
    await expect(page.getByRole('heading', { name: c.title, exact: true })).toHaveClass(/sr-only/);
    const log = page.getByRole('heading', { name: '지금 처리하는 일' });
    await expect(log).toBeVisible();
    const font = await log.evaluate((el) => ({ family: getComputedStyle(el).fontFamily, weight: getComputedStyle(el).fontWeight }));
    expect(font.family).toContain('Pretendard,');
    expect(font.weight).toBe('600');
    await expect(page.getByText(c.logLabel, { exact: true })).toBeVisible();
    // 최신 Figma 에 없는 예전 표시(상태 칩·큰 제목·「전체 분석」 라벨·비주얼 하단 caption)는 그리지 않는다
    await expect(page.getByText('전체 분석', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('processing-visual').locator('p')).toHaveCount(1);

    nearBox((await page.getByTestId('processing-panel').boundingBox())!, [120, 96, 1740, 924], 'panel');
    nearBox((await page.getByTestId('processing-visual').boundingBox())!, [188, 266, 1044, 589], 'visual');
    nearBox((await page.getByTestId('processing-divider').boundingBox())!, [1316, 266, 1, 589], 'divider');
    nearBox((await page.getByTestId('processing-log').boundingBox())!, c.log, 'log');

    // 단계 목록(Figma 1821:46431 · 1821:48015) — 묶음 개수·높이, 목록 → 진행률 숫자 간격(54)
    const groups = page.getByTestId('processing-step');
    await expect(groups).toHaveCount(c.groupHeights.length);
    const heights = await groups.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    heights.forEach((height, i) => near(height, c.groupHeights[i], `step group ${i + 1} h`));
    const list = (await page.getByTestId('processing-step-list').boundingBox())!;
    const bar = page.getByRole('progressbar');
    const percent = (await bar.locator('xpath=preceding-sibling::*[1]').boundingBox())!;
    near(percent.y - (list.y + list.height), 54, 'step list → progress gap');
    // 「Frame 999」 — 숫자 줄 64 · 24 · 막대 3(폭 396) · 8 · 안내
    const barBox = (await bar.boundingBox())!;
    near(percent.height, 64, 'progress row h');
    near(barBox.y - (percent.y + percent.height), 24, 'progress row → bar gap');
    nearBox(barBox, [1397, barBox.y, 396, 3], 'bar');
    await expect(bar).toHaveAttribute('aria-label', '전체 진행률');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });
}
