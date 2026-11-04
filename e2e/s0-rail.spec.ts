import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

import { reachN3 } from './helpers/reach-n3';

// ─────────────────────────────────────────────────────────────────
// S0 전역 프로세스 바(PRD F-NAV-01 · F-JOB-07, Figma 298:2872) — Chromium.
// N2~N6 은 폴링 응답의 currentStep 만 고정해 바로 연다. 각 화면 본문·전환은 화면별 spec 이 맡는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'S0 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const STEPS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'] as const;
const LABELS = ['정보 입력', '분석중', '섹션 확인', '번역 중', '검수', '저장'];
const JOB_STEPS = ['N2', 'N3', 'N4', 'N5', 'N6'] as const;
const TOOLTIP = '단계 이동은 12월 구현 예정입니다.';

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
          return new Response(JSON.stringify({ ...body, currentStep: forced, jobStatus: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
        };
      },
      { forced: step, jobId: MOCK_JOB_ID },
    );
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
  }
  await expect(page.getByTestId('s0-exit')).toBeVisible();
  await expect(stepButton(page, 0)).toBeVisible();
}

const nav = (page: Page) => page.getByRole('navigation', { name: '작업 진행 단계' });
const stepButton = (page: Page, index: number) => nav(page).getByRole('button').nth(index);
const exit = (page: Page) => page.getByTestId('s0-exit');
const dialog = (page: Page) => page.getByTestId('s0-exit-dialog');
const visibleTooltip = (page: Page) => nav(page).getByRole('tooltip');

function recordWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.isNavigationRequest() === false) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return writes;
}

/** DELETE 를 실패시킨다. failures 만큼 실패한 뒤에는 원래대로 간다 */
async function failCancel(page: Page, failures = Number.POSITIVE_INFINITY) {
  await page.addInitScript((count) => {
    let left = count === null ? Number.POSITIVE_INFINITY : count;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'DELETE' && /^\/jobs\/[^/]+$/.test(new URL(url, location.href).pathname) && left > 0) {
        left -= 1;
        return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'fail', retryable: true, traceId: 't' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return original(input, init);
    };
  }, Number.isFinite(failures) ? failures : null);
}

for (const step of STEPS) {
  test(`${step} — 1920×1080 위치와 단계 상태가 Figma 와 같다`, async ({ page }) => {
    await openStep(page, step);
    expect(await exit(page).boundingBox()).toEqual({ x: 40, y: 40, width: 40, height: 40 });
    expect(await nav(page).boundingBox()).toEqual({ x: 36, y: 150, width: 44, height: 860 });

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
      const x = (await exit(page).boundingBox())!;
      const first = (await stepButton(page, 0).boundingBox())!;
      const last = (await stepButton(page, 5).boundingBox())!;
      const rail = (await page.getByTestId('s0-rail').boundingBox())!;
      expect([x.x, x.y, x.width, x.height]).toEqual([40, 40, 40, 40]);
      expect([rail.x, rail.width]).toEqual([36, 44]);
      expect(first.y).toBeGreaterThanOrEqual(x.y + x.height);
      expect(last.y + last.height).toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
      // rail 다음 본문은 rail 오른쪽에서 시작한다
      const bodyLeft = await page.getByTestId('s0-rail').evaluate((el) => el.nextElementSibling?.getBoundingClientRect().x ?? null);
      if (bodyLeft !== null) expect(bodyLeft).toBeGreaterThanOrEqual(rail.x + rail.width);
    });
  }
}

test('단계는 hover·focus·click 에 안내하고 이동하지 않는다', async ({ page }) => {
  const writes = recordWrites(page);
  await openStep(page, 'N3');
  const url = page.url();
  await expect(visibleTooltip(page)).toHaveCount(0);

  // hover
  await stepButton(page, 0).hover();
  await expect(visibleTooltip(page)).toHaveCount(1);
  await expect(visibleTooltip(page)).toHaveText(TOOLTIP);
  const hint = (await visibleTooltip(page).boundingBox())!;
  const step = (await stepButton(page, 0).boundingBox())!;
  expect(hint.x).toBeGreaterThanOrEqual(step.x + step.width);
  expect(hint.x + hint.width).toBeLessThanOrEqual(1920);
  await expect(visibleTooltip(page)).toHaveCSS('border-color', 'rgb(255, 106, 56)');
  await expect(stepButton(page, 0)).toHaveAccessibleDescription(TOOLTIP);
  await page.mouse.move(1000, 5);
  await expect(visibleTooltip(page)).toHaveCount(0);

  // 키보드 focus
  await exit(page).focus();
  await page.keyboard.press('Tab');
  await expect(stepButton(page, 0)).toBeFocused();
  await expect(visibleTooltip(page)).toHaveText(TOOLTIP);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(stepButton(page, 2)).toBeFocused();
  await expect(stepButton(page, 2).locator('..').getByRole('tooltip')).toHaveText(TOOLTIP);
  await page.keyboard.press('Escape');
  await expect(visibleTooltip(page)).toHaveCount(0);

  // 완료 단계 click — 포인터가 벗어나도 포커스로 남는다
  await stepButton(page, 0).click({ force: true });
  await page.mouse.move(1000, 5);
  await expect(stepButton(page, 0)).toBeFocused();
  await expect(visibleTooltip(page)).toHaveText(TOOLTIP);
  expect(page.url()).toBe(url);

  // 현재 단계·미도달 단계도 같다
  await stepButton(page, 2).click({ force: true });
  await stepButton(page, 5).click({ force: true });
  await page.waitForTimeout(200);
  expect(page.url()).toBe(url);
  await expect(stepButton(page, 2)).toHaveAttribute('aria-current', 'step');
  expect(writes).toEqual([]);
  await expect(dialog(page)).toHaveCount(0);
  // 페이지 이동 링크가 아니다
  await expect(nav(page).locator('a')).toHaveCount(0);
});

test('마지막 단계 안내도 화면 안에 있다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStep(page, 'N5');
  await stepButton(page, 5).hover();
  const hint = (await visibleTooltip(page).boundingBox())!;
  expect(hint.y + hint.height).toBeLessThanOrEqual(900);
  expect(hint.x + hint.width).toBeLessThanOrEqual(1440);
});

test('작업 없는 N1 ✕ — API 없이 나가기', async ({ page }) => {
  const writes = recordWrites(page);
  await openStep(page, 'N1');
  await expect(exit(page)).toHaveAccessibleName('보관함으로 나가기');
  await exit(page).click();
  await expect(dialog(page)).toHaveAccessibleName('작성을 그만두고 나갈까요?');
  await expect(dialog(page)).toContainText('입력한 정보와 선택한 이미지는 저장되지 않습니다.');
  await expect(dialog(page).getByRole('button')).toHaveText(['계속 작성', '나가기']);
  await dialog(page).getByRole('button', { name: '나가기' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(writes).toEqual([]);
});

for (const step of JOB_STEPS) {
  test(`${step} ✕ — 바로 나가지 않고 같은 작업 취소 확인창을 연다`, async ({ page }) => {
    const writes = recordWrites(page);
    await openStep(page, step);
    const url = page.url();
    await expect(exit(page)).toHaveAccessibleName('작업 취소');
    await expect(exit(page).locator('xpath=self::button')).toHaveCount(1);
    await exit(page).click();
    expect(page.url()).toBe(url);
    await expect(dialog(page)).toHaveAccessibleName('작업을 취소할까요?');
    for (const target of ['원본 이미지', '섹션 분해 결과', '인페인팅 결과', '번역문', '판정 근거', '수정 전후 문구', '되돌릴 수 없습니다']) {
      await expect(dialog(page)).toContainText(target);
    }
    await expect(dialog(page).getByRole('button')).toHaveText(['계속하기', '작업 취소']);
    // N6 직접 진입의 자동 렌더 요청은 ✕와 무관하다
    expect(writes.filter((w) => !w.endsWith('/render'))).toEqual([]);

    await dialog(page).getByRole('button', { name: '작업 취소' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(writes.filter((w) => w.startsWith('DELETE'))).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`]);
  });
}

test('실제 흐름의 N3 에서도 취소하면 보관함으로 간다', async ({ page }) => {
  await reachN3(page);
  await exit(page).click();
  await dialog(page).getByRole('button', { name: '작업 취소' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
});

test('취소 실패 — 화면과 확인창을 유지하고 다시 시도할 수 있다', async ({ page }) => {
  await failCancel(page, 1);
  const writes = recordWrites(page);
  await openStep(page, 'N5');
  const url = page.url();
  await exit(page).click();
  await dialog(page).getByRole('button', { name: '작업 취소' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText('작업을 취소하지 못했습니다. 다시 시도해 주세요.');
  expect(page.url()).toBe(url);
  await expect(dialog(page)).toBeVisible();

  await dialog(page).getByRole('button', { name: '작업 취소' }).click();
  await expect(page).toHaveURL(/\/$/);
  // 첫 실패는 페이지 안에서 만든 응답이라 네트워크에는 재시도 1건만 나간다
  expect(writes.filter((w) => w.startsWith('DELETE'))).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`]);
});

test('확인창 — focus trap·Esc·포커스 복귀·배경 비활성', async ({ page }) => {
  await openStep(page, 'N3');
  await exit(page).focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeFocused();
  await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
  await expect(dialog(page)).toHaveAccessibleDescription(/원본 이미지/);
  const buttons = dialog(page).getByRole('button');
  await page.keyboard.press('Tab');
  await expect(buttons.nth(0)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(buttons.nth(0)).toBeFocused();
  // 배경 단계 버튼은 inert 다
  expect(await page.getByTestId('s0-steps').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(exit(page)).toBeFocused();
  expect(await page.getByTestId('s0-steps').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
});

test('N2·N4 의 [중단] 은 S0 와 별개로 그대로다', async ({ page }) => {
  await openStep(page, 'N2');
  await exit(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  await expect(page.getByRole('heading', { name: '이미지 분석' })).toBeVisible();
});
