import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 저장 전 확인창(Figma 1313:12384 · F-CFM-09) · 렌더 안 된 section 선택 · 겹침 진단(Mock 전용).
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;

const confirmPosts = (page: Page) => {
  const list: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/confirm')) list.push(r.url());
  });
  return list;
};

test('확인 항목이 없으면 확인창 없이 바로 확정한다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-clean' });
  const posts = confirmPosts(page);
  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByTestId('n5-review-dialog')).toHaveCount(0);
  await expect.poll(() => posts.length).toBe(1);
});

test('확인창 — Figma 구조·실제 데이터 집계, 돌아가기는 요청 없음, 확인하고 저장은 confirm 1회', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-errors' });
  const posts = confirmPosts(page);
  const button = page.getByTestId('n5-confirm-button');
  await button.click();

  const dialog = page.getByTestId('n5-review-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('heading', { name: '확인할 항목이 있습니다' })).toBeVisible();
  await expect(dialog).toContainText('해결되지 않은 항목이 남아 있습니다.');
  await expect(dialog).toContainText('확인하고 저장하면 그대로 최종 렌더링 단계로 이동합니다.');

  // geometry
  const d = await box(page, 'n5-review-dialog');
  expect([Math.round(d.x), Math.round(d.y), Math.round(d.width), Math.round(d.height)]).toEqual([701, 185, 518, 710]);
  const cancelBox = await box(page, 'n5-review-cancel');
  const continueBox = await box(page, 'n5-review-continue');
  expect(Math.round(cancelBox.height)).toBe(45);
  expect(Math.round(continueBox.x - (cancelBox.x + cancelBox.width))).toBe(12);
  expect(Math.round(cancelBox.width + continueBox.width + 12)).toBe(454);
  await page.screenshot({ path: test.info().outputPath('n5-review-dialog.png') });

  // 집계 — fixture: 금지 3(9101 둘 + 기본 9112), 검사 실패 2(9111·9103), 번역 실패 2(9111 + 기본 9107), 실행 실패 3(501 렌더·인페인팅, 505 렌더). 강제 용어(9102)는 세지 않는다
  await expect(page.getByTestId('n5-review-count-regulatory-warning')).toHaveText('3건');
  await expect(page.getByTestId('n5-review-count-verification-failed')).toHaveText('2건');
  await expect(page.getByTestId('n5-review-count-empty-translation')).toHaveText('2건');
  await expect(page.getByTestId('n5-review-count-execution-failed')).toHaveText('3건');
  await expect(page.getByTestId('n5-review-total')).toHaveText('10건');
  const regulatory = page.getByTestId('n5-review-group-regulatory-warning');
  await expect(regulatory).toContainText('Section 1 - Block 01');
  await expect(regulatory).toContainText('번역문의 표현이 금지 표현 목록에 있습니다');
  await expect(regulatory.locator('h3')).toHaveCSS('color', 'rgb(255, 106, 56)');
  await expect(page.getByTestId('n5-review-group-empty-translation')).toContainText('Section 1 - Block 03');
  await expect(page.getByTestId('n5-review-group-execution-failed')).toContainText('Section 1 렌더링');
  await expect(page.getByTestId('n5-review-group-execution-failed')).toContainText('Section 5 렌더링');

  // 돌아가기
  await page.getByTestId('n5-review-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(posts).toEqual([]);

  // 확인하고 저장
  await button.click();
  await page.getByTestId('n5-review-continue').click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 10_000 });
});

test('렌더 대기 section을 누르면 우측이 같은 section으로 이동해 상태를 보인다', async ({ page }) => {
  await reachN5(page);
  await page.getByTestId('n5-fit-height').click();
  const slice = await box(page, 'n5-slice-translated-504');
  await page.mouse.click(slice.x + slice.width * 0.8, slice.y + slice.height * 0.9);

  await expect(page.getByTestId('n5-section-selected-tag')).toHaveText('Section4');
  await expect(page.getByTestId('n5-section-tag-4')).toHaveAttribute('aria-pressed', 'true');
  const progress = page.getByTestId('n5-section-status-4-progress');
  await expect(progress).toHaveText('렌더 대기 중');
  await expect(progress).toBeInViewport();
  await expect(progress.locator('span')).toHaveCSS('color', 'rgb(23, 23, 23)'); // 오류 색이 아니다
  await expect(page.getByTestId('n5-section-status-4-failed')).toHaveCount(0);
});

test('렌더 진행·실패·제외 section도 우측에 각자 상태가 보이고, 실패는 원본을 보인다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-errors' });
  await page.getByTestId('n5-fit-height').click();

  const click = async (id: number) => {
    const s = await box(page, `n5-slice-translated-${id}`);
    await page.mouse.click(s.x + s.width * 0.8, s.y + s.height * 0.95);
  };

  await click(504);
  await expect(page.getByTestId('n5-section-status-4-progress')).toHaveText('렌더링 중');
  await expect(page.getByTestId('n5-section-status-4-progress')).toBeInViewport();

  await click(505);
  await expect(page.getByTestId('n5-section-tag-5')).toHaveAttribute('aria-pressed', 'true');
  const failed = page.getByTestId('n5-section-status-5-failed');
  await expect(failed).toContainText('실행 실패');
  await expect(failed).toContainText('렌더링');
  await expect(failed).toBeInViewport();
  await expect(page.getByTestId('n5-section-status-5-render-retry')).toBeDisabled();
  await expect(page.getByTestId('n5-slice-translated-505')).toHaveCSS('background-image', /505-original/);

  await click(503);
  await expect(page.getByTestId('n5-section-tag-3')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-section-status-3-progress')).toHaveText('제외된 섹션');
  await expect(page.getByTestId('n5-section-status-3-progress')).toBeInViewport();
});

test('겹침 진단 — 어떤 block이 어디서 겹치는지 보이고 실제 선택은 바뀌지 않는다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-overlap' });
  const hud = page.getByTestId('n5-overlap-hud');
  await expect(hud).toContainText('block을 선택하세요');

  await page.getByTestId('n5-block-pin-9102').click();
  const label = page.getByTestId('n5-overlap-label-9111');
  await expect(label).toContainText('Block 2 ↔ Block 3');
  await expect(label).toContainText('겹침 300 × 80 px');
  await expect(page.getByTestId('n5-overlap-block-9111')).toHaveCSS('border-top-style', 'dashed');
  await expect(page.getByTestId('n5-overlap-block-9111')).toHaveCSS('pointer-events', 'none');

  const area = await box(page, 'n5-overlap-area-9111');
  const selected = await box(page, 'n5-block-overlay-9102');
  const other = await box(page, 'n5-block-overlay-9111');
  expect(Math.round(area.x)).toBe(Math.round(Math.max(selected.x, other.x)));
  expect(Math.round(area.y)).toBe(Math.round(Math.max(selected.y, other.y)));
  expect(Math.round(area.width)).toBe(Math.round(other.width));
  expect(Math.abs(area.height - (Math.min(selected.y + selected.height, other.y + other.height) - other.y))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('n5-overlap.png') });

  // hit testing은 그대로 — 겹친 영역을 누르면 DOM 순서대로 위에 있는 block이 잡힌다
  await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
  await expect(page.getByTestId('n5-block-row-9111')).toHaveAttribute('aria-pressed', 'true');
});

test('겹침 진단은 Mock 시나리오 없이는 보이지 않는다', async ({ page }) => {
  await reachN5(page);
  await page.getByTestId('n5-block-pin-9102').click();
  await expect(page.getByTestId('n5-overlap-hud')).toHaveCount(0);
});
