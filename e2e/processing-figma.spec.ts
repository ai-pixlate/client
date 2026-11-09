import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N2·N4 정상 화면 글자·위치 (Figma 660:4139 · 660:4221) — Chromium, 1920×1080.
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

const near = (actual: number, expected: number, label: string) => expect(Math.abs(actual - expected), `${label}: ${actual} ≈ ${expected}`).toBeLessThanOrEqual(3); // 우측 열은 Figma(y60)와 좌측 열 padding(58)을 공유해 2px 차이가 있다

for (const c of [
  { step: 'N2', title: '이미지 분석', headline: '상세페이지의 구조와 문맥을 읽고 있습니다.', logHeadingY: 206, headlineY: 212 },
  { step: 'N4', title: '번역 중', headline: '번역과 배경 복원을 함께 진행하고 있습니다.', logHeadingY: 206, headlineY: 212 },
] as const) {
  test(`${c.step} — Pretendard 굵기와 헤더·헤드라인·이미지 위치가 Figma와 같다`, async ({ page }) => {
    await openStep(page, c.step);
    const title = page.getByRole('heading', { name: c.title, exact: true });
    const headline = page.getByText(c.headline, { exact: true });
    const log = page.getByRole('heading', { name: '지금 처리하는 일' });
    await expect(title).toBeVisible();
    await expect(headline).toBeVisible();

    for (const [locator, weight] of [[title, '600'], [headline, '600'], [log, '600']] as const) {
      const font = await locator.evaluate((el) => ({ family: getComputedStyle(el).fontFamily, weight: getComputedStyle(el).fontWeight }));
      expect(font.family).toContain('Pretendard,');
      expect(font.weight).toBe(weight);
    }

    const t = (await title.boundingBox())!;
    near(t.x, 140, 'title x');
    near(t.y, 60, 'title y');
    near(t.height, 24, 'title h');
    const h = (await headline.boundingBox())!;
    near(h.y, c.headlineY, 'headline y');
    near(h.height, 33, 'headline h');
    near((await log.boundingBox())!.y, c.logHeadingY, 'log heading y');
    const visual = (await page.locator('img[src*="ai-processing"]').locator('..').boundingBox())!;
    near(visual.y, 328, 'visual y');
    near(visual.height, 520, 'visual h');
    const bar = (await page.getByRole('progressbar').boundingBox())!;
    near(bar.y, 820, 'progress y');
  });
}
