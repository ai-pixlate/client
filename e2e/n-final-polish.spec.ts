import { type Page, expect, test } from '@playwright/test';

import { reachN3 } from './helpers/reach-n3';
import { reachN5 } from './helpers/reach-n5';
import { reachN6 } from './helpers/reach-n6';

// ─────────────────────────────────────────────────────────────────
// N 화면 최종 보정 — N3 배치(Figma 1759:11529 — 이전 1422:10176 3열은 대체됨), N5 확인창(1313:12384 + 항목 수 기준 스크롤 a56dcca),
// N6 동작 칸·렌더 중(1262:7603), Mock 오류 URL.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '화면 수치 검증은 Chromium 기준이다');

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;
const LAPTOPS = [[1728, 885], [1512, 860], [1440, 900]] as const;

function recordWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return writes;
}

test.describe('N3 배치', () => {
  // Figma 1759:11529 — 작업 영역 x200·y112·1600×920. 오른쪽 목록 688×863 · gap 12 · CTA 688×45(아래 끝 1032).
  // 왼쪽 묶음(이미지 404 · gap 24 · 상세 404)은 높이 863 으로 작업 영역 세로 가운데(y140.5)라 이미지 아래 끝은 CTA 아래 끝과 같지 않다.
  test('1920×1080 — Figma 수치와 같다', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await reachN3(page);
    await expect(page.getByTestId('n3-proceed')).toBeVisible();
    const list = await box(page, 'n3-section-list');
    const cta = await box(page, 'n3-proceed');
    const image = await box(page, 'n3-section-image');
    const action = await box(page, 'n3-detail-action');
    const near = (a: number, b: number, label: string) => expect(Math.abs(a - b), `${label}: ${a} ≈ ${b}`).toBeLessThanOrEqual(1);
    near(list.x, 1112, 'list x');
    near(list.y, 112, 'list y');
    near(list.width, 688, 'list w');
    near(list.height, 863, 'list h');
    near(cta.x, 1112, 'cta x');
    near(cta.y, 987, 'cta y');
    near(cta.width, 688, 'cta w');
    near(cta.height, 45, 'cta h');
    near(list.y + list.height + 12, cta.y, 'list + 12');
    near(cta.y + cta.height, 1032, 'cta bottom');
    near(image.x, 200, 'image x');
    near(image.y, 140.5, 'image y');
    near(image.width, 404, 'image w');
    near(image.height, 863, 'image h');
    near(image.y + image.height / 2, 112 + 920 / 2, 'image 세로 가운데');
    near(action.x, 636, 'detail action x');
    near(action.width, 384, 'detail action w');
  });

  for (const [width, height] of LAPTOPS) {
    test(`${width}×${height} — 가로 구조 그대로 CTA·상세 버튼·이미지가 보이고 가로 넘침이 없다`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await reachN3(page);
      const list = await box(page, 'n3-section-list');
      const cta = await box(page, 'n3-proceed');
      const image = await box(page, 'n3-section-image');
      const action = await box(page, 'n3-detail-action');
      // 왼쪽 묶음은 작업 영역(목록 위 ~ CTA 아래) 세로 가운데, 목록과 같은 높이
      expect(Math.abs(image.y + image.height / 2 - (list.y + cta.y + cta.height) / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(image.height - list.height)).toBeLessThanOrEqual(1);
      expect(image.x + image.width).toBeLessThan(list.x); // 이미지 | 상세 | 목록 가로 순서
      for (const b of [cta, action, image]) {
        expect(b.y + b.height).toBeLessThanOrEqual(height);
        expect(b.height).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test.describe('N5 확인창', () => {
  async function openDialog(page: Page, width: number, height: number, mockScenario?: string) {
    await page.setViewportSize({ width, height });
    await reachN5(page, mockScenario ? { mockScenario } : {});
    await page.getByTestId('n5-confirm-button').click();
    await expect(page.getByTestId('n5-review-dialog')).toBeVisible();
  }

  // 높이는 항목 수 기준이다(a56dcca) — 1~5건은 내용에 맞추고(HUG), 6건 이상은 목록을 5번째 항목까지로 줄여 목록만 스크롤한다. 최대 710
  test('1920×1080 — 폭 518 · 높이는 내용에 맞추고 710 이하 · 버튼 크기·간격이 Figma와 같다', async ({ page }) => {
    await openDialog(page, 1920, 1080);
    const dialog = await box(page, 'n5-review-dialog');
    expect(dialog.width).toBe(518);
    expect(dialog.height).toBeLessThanOrEqual(710);
    expect(await page.getByTestId('n5-review-dialog').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    expect(dialog.x).toBe((1920 - 518) / 2);
    const cancel = await box(page, 'n5-review-cancel');
    const proceed = await box(page, 'n5-review-continue');
    expect(cancel.height).toBe(45);
    expect(proceed.x - (cancel.x + cancel.width)).toBe(12);
    expect(Math.abs(cancel.width - proceed.width)).toBeLessThanOrEqual(2);
    // 내용이 적어도 버튼은 창 아래에 있다(padding 32)
    expect(dialog.y + dialog.height - (proceed.y + proceed.height)).toBe(32);
  });

  test('항목이 많은(6건 이상) 시나리오는 710 이하이고 목록만 스크롤한다', async ({ page }) => {
    await openDialog(page, 1440, 900, 'n5-errors');
    const dialog = await box(page, 'n5-review-dialog');
    expect(dialog.height).toBeLessThanOrEqual(710);
    expect(Number((await page.getByTestId('n5-review-total').innerText()).replace('건', ''))).toBeGreaterThan(5);
    expect(await page.getByTestId('n5-review-list').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const scroll = await page.getByTestId('n5-review-dialog').evaluate((el) => el.scrollHeight <= el.clientHeight);
    expect(scroll).toBe(true);
    const list = page.getByTestId('n5-review-list');
    expect(await list.evaluate((el) => getComputedStyle(el).overflowY)).toMatch(/auto|scroll/);
    await expect(page.getByTestId('n5-review-dim')).toBeVisible();
  });

  for (const [width, height] of [[1512, 860], [1440, 900], [1440, 640]] as const) {
    test(`${width}×${height} — 화면 안에 있고 버튼이 보이며 Esc·포커스 복귀가 동작한다`, async ({ page }) => {
      await openDialog(page, width, height);
      const dialog = await box(page, 'n5-review-dialog');
      // 내용에 맞춘 높이 — 최대 min(710, 화면 − 32)
      expect(dialog.height).toBeLessThanOrEqual(Math.min(710, height - 32));
      expect(dialog.y).toBeGreaterThanOrEqual(0);
      expect(dialog.y + dialog.height).toBeLessThanOrEqual(height);
      const proceed = await box(page, 'n5-review-continue');
      expect(proceed.y + proceed.height).toBeLessThanOrEqual(dialog.y + dialog.height);
      // focus trap — Tab 은 창 안에서만 돈다
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="n5-review-dialog"]'))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('n5-review-dialog')).toHaveCount(0);
      await expect(page.getByTestId('n5-confirm-button')).toBeFocused();
    });
  }
});

test.describe('Mock 오류 URL', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const [scenario, title, step] of [
    ['n2-error', '분석이 중단되었습니다', '분석중'],
    ['n4-error', '번역을 완료하지 못했습니다', '번역 중'],
  ] as const) {
    test(`?scenario=${scenario} — 오류 화면에 고정되고 다음 단계로 넘어가지 않는다`, async ({ page }) => {
      const writes = recordWrites(page);
      await page.goto(`/jobs/1?scenario=${scenario}`);
      await expect(page.getByTestId('processing-error')).toBeVisible();
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expect(page.getByRole('navigation', { name: '작업 진행 단계' }).locator('[aria-current="step"]')).toContainText(step);
      // 폴링 주기(2초)를 넘겨도 그대로다
      await page.waitForTimeout(5000);
      await expect(page.getByTestId('processing-error')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`scenario=${scenario}`));
      expect(writes).toEqual([]);
    });
  }

  test('모르는 scenario 값은 무시하고 정상 처리 화면을 보인다', async ({ page }) => {
    await page.goto('/jobs/1?scenario=unknown');
    await expect(page.getByTestId('s0-exit')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('processing-error')).toHaveCount(0);
  });
});

test.describe('N6', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  async function confirmToN6(page: Page) {
    await reachN5(page);
    await page.getByTestId('n5-confirm-button').click();
    await page.getByTestId('n5-review-continue').click();
  }

  test('렌더 중 — dim·진행 모달과 비활성 패널이 보이고, 끝나면 완료 화면으로 바뀐다', async ({ page }) => {
    await confirmToN6(page);
    const dialog = page.getByTestId('n6-render-progress');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const writes = recordWrites(page);

    const rect = await box(page, 'n6-render-progress');
    expect(rect.width).toBe(460);
    expect(Math.abs(rect.x + rect.width / 2 - 960)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.y + rect.height / 2 - 540)).toBeLessThanOrEqual(1);
    await expect(dialog).toContainText('최종 렌더 중');
    await expect(dialog).toContainText('창을 닫아도 렌더는 계속 됩니다');
    await expect(page.getByTestId('n6-render-dim')).toBeVisible();
    await expect(page.getByTestId('n6-preparing-banner')).toContainText('최종 결과물을 만들고 있습니다.');
    await expect(page.getByRole('heading', { name: '저장 및 내보내기' })).toBeVisible();
    await expect(page.getByTestId('s0-exit')).toBeVisible();
    // 렌더 전 샘플 숫자를 쓰지 않는다
    await expect(page.getByTestId('n6-render-percent')).not.toHaveText('72');

    for (const id of ['n6-pending-download-images', 'n6-pending-download-csv', 'n6-pending-export', 'n6-pending-save']) {
      await expect(page.getByTestId(id)).toBeDisabled();
    }
    await page.screenshot({ path: test.info().outputPath('n6-render-running.png') });

    await expect(page.getByTestId('n6-export-panel')).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('n6-render-dim')).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test('닫기 — 모달만 닫히고 렌더는 계속되어 완료 화면으로 바뀌며, 그동안 다운로드는 막혀 있다', async ({ page }) => {
    await confirmToN6(page);
    await expect(page.getByTestId('n6-render-progress')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('n6-render-close').click();
    await expect(page.getByTestId('n6-render-progress')).toHaveCount(0);
    await expect(page.getByTestId('n6-export-panel-pending')).toBeVisible();
    await expect(page.getByTestId('n6-pending-export')).toBeDisabled();
    await expect(page.getByRole('heading', { name: '저장 및 내보내기' })).toBeFocused();
    await expect(page.getByTestId('n6-export-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('n6-render-progress')).toHaveCount(0);
  });

  test('progress 가 없으면 숫자를 만들지 않고 진행 중으로만 보인다', async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!new URL(url, location.href).pathname.endsWith('/tasks') || !response.ok) return response;
        const body = await response.json();
        if (body.currentStep !== 'N6') return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        delete body.progress;
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    });
    await confirmToN6(page);
    await expect(page.getByTestId('n6-render-progress')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('n6-render-percent')).toHaveCount(0);
    await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  test('완료 화면 — 네 행의 동작 칸이 같은 가운데 축이고 폭이 97이다', async ({ page }) => {
    await reachN6(page);
    await expect(page.getByTestId('n6-export-panel')).toBeVisible({ timeout: 20_000 });
    const centers: number[] = [];
    for (const type of ['images', 'html', 'csv', 'psd']) {
      const slot = await box(page, `n6-action-slot-${type}`);
      expect(slot.width).toBe(97);
      const content = (await page.getByTestId(`n6-action-slot-${type}`).locator('> *').boundingBox())!;
      centers.push(content.x + content.width / 2);
    }
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
  });
});
