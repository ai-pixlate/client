import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N2·N4 전체 실패 화면 (Figma 793:4890 · 795:4820) — Chromium.
// 폴링 응답의 currentStep·jobStatus·items 만 고정한다. [다시 시도]·[중단]은 abort/resume API 전까지 동작이 없다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '처리 오류 화면 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

type Patch = { currentStep: string; jobStatus: string; items?: unknown[]; failedCount?: number };

async function openWith(page: Page, patch: Patch) {
  await page.addInitScript(
    ({ initial, jobId }) => {
      const w = window as unknown as { __patch: unknown; __tasksCalls: number };
      w.__patch = initial;
      w.__tasksCalls = 0;
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url, location.href).pathname !== `/jobs/${jobId}/tasks` || !response.ok) return response;
        w.__tasksCalls += 1;
        const body = await response.json();
        return new Response(JSON.stringify({ ...body, ...(w.__patch as object) }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    },
    { initial: patch, jobId: MOCK_JOB_ID },
  );
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
}

const setPatch = (page: Page, patch: Patch) =>
  page.evaluate((next) => {
    (window as unknown as { __patch: unknown }).__patch = next;
  }, patch);

const errorPanel = (page: Page) => page.getByTestId('processing-error');
const retry = (page: Page) => page.getByTestId('processing-error-retry');
const abort = (page: Page) => page.getByTestId('processing-error-abort');
const currentStep = (page: Page) => page.getByRole('navigation', { name: '작업 진행 단계' }).locator('[aria-current="step"]');

const CASES = [
  {
    step: 'N2',
    label: '분석중',
    heading: '이미지 분석',
    section: 'ANALYSIS STATUS',
    title: '분석이 중단되었습니다',
    description: '이미지 분석 중 오류가 발생했습니다.',
    visual: 'SCAN  ·  STRUCTURE  ·  CONTEXT',
    example: '제품 라벨 자동 제외',
  },
  {
    step: 'N4',
    label: '번역 중',
    heading: '번역 중',
    section: 'TRANSLATION STATUS',
    title: '번역을 완료하지 못했습니다',
    description: '번역 처리 중 오류가 발생했습니다.',
    visual: 'SOURCE  →  LOCALIZED',
    example: '글자 수, 줄바꿈 조정',
  },
] as const;

for (const c of CASES) {
  test(`${c.step} 전체 실패는 Figma 오류 화면과 [다시 시도]·[중단]만 보여 준다`, async ({ page }) => {
    await openWith(page, { currentStep: c.step, jobStatus: 'failed' });
    await expect(errorPanel(page)).toBeVisible();
    await expect(errorPanel(page).getByText('오류', { exact: true })).toBeVisible();
    await expect(errorPanel(page).getByText('ERROR!')).toBeVisible();
    await expect(errorPanel(page).getByText(c.section)).toBeVisible();
    await expect(errorPanel(page).getByRole('heading', { name: c.title })).toBeVisible();
    await expect(page.getByTestId('processing-error-description')).toHaveText(c.description);
    await expect(page.getByRole('heading', { name: c.heading, level: 1 })).toBeVisible();
    await expect(errorPanel(page).getByRole('button')).toHaveText(['다시 시도', '중단']);
    for (const old of ['일시 정지', '작업취소', c.example, '진행 중', '72%']) {
      await expect(errorPanel(page).getByText(old)).toHaveCount(0);
    }
    await expect(currentStep(page)).toContainText(c.label);

    // 값은 Figma 와 같다
    await expect(errorPanel(page).getByText('ERROR!')).toHaveCSS('font-size', '58px');
    await expect(errorPanel(page).getByText('ERROR!')).toHaveCSS('color', 'rgb(229, 72, 77)');
    await expect(errorPanel(page).getByText('오류', { exact: true })).toHaveCSS('color', 'rgb(229, 72, 77)');
    await expect(retry(page)).toHaveCSS('background-color', 'rgb(23, 23, 23)');
    await expect(abort(page)).toHaveCSS('border-color', 'rgb(234, 234, 234)');
    for (const button of [retry(page), abort(page)]) {
      await expect(button).toHaveCSS('opacity', '1');
      await expect(button).toHaveCSS('height', '37px');
    }
    // 실패 항목 배너를 겹쳐 그리지 않는다
    await expect(page.getByText('일부 항목을 처리하지 못했습니다')).toHaveCount(0);

    // 1920 위치
    const box = async (loc: ReturnType<Page['locator']>) => (await loc.boundingBox())!;
    const panelBox = await box(errorPanel(page).locator('xpath=..'));
    expect([panelBox.x, panelBox.y, panelBox.width, panelBox.height]).toEqual([120, 108, 1740, 892]);
    const image = await box(errorPanel(page).locator('img').first());
    expect(Math.abs(image.x - 188)).toBeLessThanOrEqual(1);
    expect(Math.abs(image.width - 1044)).toBeLessThanOrEqual(1);
    expect(Math.abs(image.height - 520)).toBeLessThanOrEqual(1);
    expect(Math.abs(image.y - (108 + 186))).toBeLessThanOrEqual(2);
    const retryBox = await box(retry(page));
    const abortBox = await box(abort(page));
    expect(Math.abs(retryBox.x - 1395)).toBeLessThanOrEqual(1);
    expect(Math.abs(abortBox.x + abortBox.width - 1800)).toBeLessThanOrEqual(1);
    expect(abortBox.x - (retryBox.x + retryBox.width)).toBe(20);
    // 오른쪽 상태 영역은 이미지와 위아래가 같다
    expect(Math.abs(retryBox.y + retryBox.height - (image.y + image.height))).toBeLessThanOrEqual(1);
    const hasImage = await errorPanel(page).locator('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
    expect(hasImage).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });

  test(`${c.step} [다시 시도]·[중단]은 요청과 이동 없이 화면을 그대로 둔다`, async ({ page }) => {
    await openWith(page, { currentStep: c.step, jobStatus: 'failed' });
    await expect(errorPanel(page)).toBeVisible();
    const url = page.url();
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    for (const button of [retry(page), abort(page)]) {
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      // Playwright 는 aria-disabled 도 비활성으로 보므로 네이티브 속성을 직접 본다
      expect(await button.evaluate((el: HTMLButtonElement) => el.disabled)).toBe(false);
      await button.click({ force: true });
    }
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    expect(page.url()).toBe(url);
    await expect(errorPanel(page)).toBeVisible();
    await expect(page.getByTestId('s0-exit-dialog')).toHaveCount(0);
    // 포커스는 받을 수 있다
    await abort(page).focus();
    await expect(abort(page)).toBeFocused();
  });

  test(`${c.step} 실패 뒤에도 S0 ✕ 는 기존 작업 취소로 동작한다`, async ({ page }) => {
    await openWith(page, { currentStep: c.step, jobStatus: 'failed' });
    await expect(errorPanel(page)).toBeVisible();
    const deletes: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'DELETE') deletes.push(new URL(r.url()).pathname);
    });
    await page.getByTestId('s0-exit').click();
    const dialog = page.getByTestId('s0-exit-dialog');
    await expect(dialog).toHaveAccessibleName('작업을 취소할까요?');
    await dialog.getByRole('button', { name: '작업 취소' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(deletes).toEqual([`/jobs/${MOCK_JOB_ID}`]);
  });

  test(`${c.step} 진행 중 실패하면 표시 진행률이 멈추고 폴링도 멈춘다`, async ({ page }) => {
    await openWith(page, { currentStep: c.step, jobStatus: 'processing' });
    const percent = page.getByRole('progressbar');
    await expect.poll(async () => Number(await percent.getAttribute('aria-valuenow')), { timeout: 15_000 }).toBeGreaterThan(0);
    await setPatch(page, { currentStep: c.step, jobStatus: 'failed' });
    await expect(errorPanel(page)).toBeVisible({ timeout: 6_000 });

    const value = await percent.getAttribute('aria-valuenow');
    await expect(page.getByTestId('processing-error-progress')).toHaveText(`진행율: ${value}%`);
    const calls = () => page.evaluate(() => (window as unknown as { __tasksCalls: number }).__tasksCalls);
    const before = await calls();
    await page.waitForTimeout(4_500);
    expect(await percent.getAttribute('aria-valuenow')).toBe(value);
    expect(await calls()).toBe(before);
  });

  test(`${c.step} items 에 실패가 있어도 job 이 진행 중이면 처리 화면을 유지한다`, async ({ page }) => {
    await openWith(page, {
      currentStep: c.step,
      jobStatus: 'processing',
      failedCount: 1,
      items: [{ taskId: 1, taskType: 'section', unitType: 'section', unitId: 7, status: 'failed', errorCode: 'SOME_FAILURE' }],
    });
    await expect(page.getByText('일부 항목을 처리하지 못했습니다')).toBeVisible();
    await expect(errorPanel(page)).toHaveCount(0);
    await expect(page.getByText('ERROR!')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: c.heading, level: 1 })).toBeVisible();
  });

  for (const [width, height] of [[1728, 885], [1440, 900]] as const) {
    test(`${c.step} ${width}×${height} 오류 화면이 넘치지 않는다`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openWith(page, { currentStep: c.step, jobStatus: 'failed' });
      await expect(errorPanel(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBe(0);
      const panel = errorPanel(page).locator('xpath=..');
      expect(await panel.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
      const abortBox = (await abort(page).boundingBox())!;
      const retryBox = (await retry(page).boundingBox())!;
      const panelBox = (await panel.boundingBox())!;
      expect(abortBox.x + abortBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
      expect(retryBox.y + retryBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
    });
  }
}
