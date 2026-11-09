import { expect, test, type Locator } from '@playwright/test';

import { reachN3 } from './helpers/reach-n3';

// ─────────────────────────────────────────────────────────────────
// N3 카드 7종(Figma 1416:12943) · 상세 상태 표시 · [이대로 진행] 안내.
// mockScenario=n3-card-variants 로 서버 상태를 맞춘다(기본 fixture는 그대로).
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const WHITE = 'rgb(255, 255, 255)';
const GRAY = 'rgb(245, 245, 245)';
const NEUTRAL = 'rgb(234, 234, 234)';
// 선택 테두리 — 판정 배지·CTA보다 위계가 높아지지 않게 회색(#707070). 주황은 CTA·의미 상태에만 남긴다
const SELECTED = 'rgb(112, 112, 112)';

async function expectCard(
  card: Locator,
  e: { variant: string; bg: string; border: string; opacity: string; height?: number; chip?: string; noChip?: string; action: string; badges: boolean },
) {
  await expect(card).toHaveAttribute('data-variant', e.variant);
  await expect(card).toHaveCSS('background-color', e.bg);
  await expect(card).toHaveCSS('border-top-color', e.border);
  await expect(card).toHaveCSS('opacity', e.opacity);
  const box = (await card.boundingBox())!;
  if (e.height) expect(Math.round(box.height)).toBe(e.height);
  if (e.chip) await expect(card).toContainText(e.chip);
  if (e.noChip) await expect(card).not.toContainText(e.noChip);
  await expect(card.getByRole('button').last()).toHaveText(e.action);
  const badge = card.locator('span.size-\\[6px\\]');
  if (e.badges) expect(await badge.count()).toBeGreaterThan(0);
  else await expect(badge).toHaveCount(0);
}

test('카드 7종이 서버 상태와 선택에 따라 나오고, 상세에도 같은 상태가 보인다', async ({ page }) => {
  await reachN3(page, { mockScenario: 'n3-card-variants' });
  const card = (id: number) => page.getByTestId(`n3-section-card-${id}`);
  const status = page.getByTestId('n3-detail-status');

  // 첫 제외 섹션(2)이 기본 선택이다 — 제외 선택
  await expectCard(card(2), { variant: 'exclusion-selected', bg: GRAY, border: SELECTED, opacity: '1', action: '그래도 번역하기', badges: true });
  expect(Math.round((await card(2).boundingBox())!.height)).toBeGreaterThanOrEqual(161);
  await expect(status).toHaveCount(0); // 자동 제외는 칩이 없다

  // 선택되지 않은 나머지
  await expectCard(card(1), { variant: 'translation-pending', bg: WHITE, border: NEUTRAL, opacity: '1', height: 160, chip: '번역 예정', action: '제외하기', badges: false });
  await expectCard(card(3), { variant: 'excluded', bg: GRAY, border: NEUTRAL, opacity: '1', height: 160, chip: '직접 제외', action: '번역하기', badges: false });
  await expectCard(card(4), { variant: 'judgement-failed', bg: GRAY, border: NEUTRAL, opacity: '0.5', height: 160, chip: '판정 실패', noChip: '번역 예정', action: '그래도 번역하기', badges: false });
  await expectCard(card(5), { variant: 'restored', bg: WHITE, border: NEUTRAL, opacity: '1', chip: '직접 되살림', action: '제외하기', badges: true });
  const restored = (await card(5).boundingBox())!;
  expect(restored.height).toBeGreaterThanOrEqual(161);

  // 이미지도 판정실패에서 함께 흐려진다
  await expect(page.getByTestId('n3-section-thumb-4')).toHaveCSS('opacity', '0.5');

  await page.screenshot({ path: test.info().outputPath('n3-variants.png'), fullPage: false });

  // 번역 선택 + 상세 상태
  await card(1).click({ position: { x: 300, y: 20 } });
  await expectCard(card(1), { variant: 'translation-selected', bg: WHITE, border: SELECTED, opacity: '1', height: 160, chip: '번역 예정', action: '제외하기', badges: false });
  await expect(status).toHaveText('번역 예정');
  await expect(page.getByTestId('n3-detail-title')).toHaveText('SECTION 01');
  await expect(page.getByTestId('n3-verdict-empty')).toHaveText('걸린 판정이 없어요');

  // 제외 판정(선택 해제)
  await expectCard(card(2), { variant: 'exclusion-verdict', bg: GRAY, border: NEUTRAL, opacity: '1', action: '그래도 번역하기', badges: true });

  // 직접 되살림 · 직접 제외 상세
  await card(5).click({ position: { x: 300, y: 20 } });
  await expect(status).toHaveText('직접 되살림');
  await card(3).click({ position: { x: 300, y: 20 } });
  await expect(status).toHaveText('직접 제외');
  // 직접 제외는 선택돼도 칸 높이가 그대로라 목록이 밀리지 않는다
  await expect(card(3)).toHaveAttribute('data-variant', 'exclusion-selected');
  expect(Math.round((await card(3).boundingBox())!.height)).toBe(160);

  // 판정실패 선택 — 테두리만 바뀐다
  await card(4).click({ position: { x: 300, y: 20 } });
  await expect(card(4)).toHaveCSS('border-top-color', SELECTED);
  await expect(card(4)).toHaveAttribute('data-variant', 'judgement-failed');
  await expect(page.getByTestId('n3-verdict-judge-failed')).toHaveText('판정 실패');
  await expect(page.getByTestId('n3-verdict-empty')).toHaveCount(0);
  await expect(page.getByTestId('n3-detail-action')).toHaveText('그래도 번역하기');
  await expect(card(4)).toHaveAttribute('data-bucket', 'exclude');
});

test('선택 테두리는 #707070 — 판정 배지·CTA 색은 선택과 무관하고, 키보드 focus 표시는 남는다', async ({ page }) => {
  await reachN3(page, { mockScenario: 'n3-card-variants' });
  const card = (id: number) => page.getByTestId(`n3-section-card-${id}`);
  const dotColors = (id: number) => card(id).locator('span.size-\\[6px\\]').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  const ctaBg = () => page.getByTestId('n3-proceed').evaluate((el) => getComputedStyle(el).backgroundColor);

  // 2 = 기본 선택(제외 선택) · 5 = 되살림(배지 있음, 선택 안 됨)
  await expect(card(2)).toHaveCSS('border-top-color', SELECTED);
  const badgeWhenSelected = await dotColors(2);
  const badgeOther = await dotColors(5);
  const ctaBefore = await ctaBg();
  expect(badgeWhenSelected.length).toBeGreaterThan(0);
  // 선택 테두리 색이 배지 점 색으로 번지지 않는다
  expect(badgeWhenSelected).not.toContain(SELECTED);

  await card(5).click({ position: { x: 300, y: 20 } });
  await expect(card(5)).toHaveCSS('border-top-color', SELECTED);
  await expect(card(2)).toHaveCSS('border-top-color', NEUTRAL);
  expect(await dotColors(2)).toEqual(badgeWhenSelected); // 선택이 풀려도 배지 색 그대로
  expect(await dotColors(5)).toEqual(badgeOther); // 선택돼도 배지 색 그대로
  expect(await ctaBg()).toBe(ctaBefore);

  // 키보드 focus — 선택 테두리와 별개로 브라우저 focus outline 이 보인다(선택 색으로 덮지 않는다)
  await card(5).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(card(5)).toBeFocused();
  const outline = await card(5).evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: parseFloat(getComputedStyle(el).outlineWidth) }));
  expect(outline.style).not.toBe('none');
  expect(outline.width).toBeGreaterThan(0);
});

test('기본 Mock — 판정 없는 정상 섹션은 번역 예정이고, 자동 제외에는 근거 판정이 있다', async ({ page }) => {
  await reachN3(page);
  const inconsistent = page.locator('[data-contract-inconsistent]');

  // 무판정 정상 — include · 번역 예정 · 걸린 판정이 없어요
  const noVerdict = page.getByTestId('n3-section-card-1');
  await noVerdict.click({ position: { x: 300, y: 20 } });
  await expect(noVerdict).toHaveAttribute('data-bucket', 'include');
  await expect(noVerdict).toContainText('번역 예정');
  await expect(noVerdict.getByRole('button').last()).toHaveText('제외하기');
  await expect(page.getByTestId('n3-detail-status')).toHaveText('번역 예정');
  await expect(page.getByTestId('n3-verdict-empty')).toHaveText('걸린 판정이 없어요');
  await expect(page.getByTestId('n3-verdict-judge-failed')).toHaveCount(0);
  await expect(page.getByTestId('n3-detail-action')).toHaveText('제외하기');

  // 예전 fixture 모순(auto_local + 판정 없음) — 이제 근거 판정이 보이고 「걸린 판정이 없어요」가 없다
  await page.getByTestId('n3-section-card-3').click({ position: { x: 300, y: 20 } });
  await expect(page.getByTestId('n3-detail-title')).toHaveText('SECTION 03');
  await expect(page.getByTestId('n3-detail-panel')).toContainText('현지 수정 필수');
  await expect(page.getByTestId('n3-verdict-empty')).toHaveCount(0);
  await expect(inconsistent).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('n3-normal.png') });
});

test('전 섹션 제외 — 안내는 hover·focus에만 보이고 눌러도 요청이 없다', async ({ page }) => {
  await reachN3(page);
  const cta = page.getByTestId('n3-proceed');
  const tooltip = page.getByTestId('n3-proceed-tooltip');
  for (const id of [1, 4]) {
    await page.getByTestId(`n3-section-action-${id}`).click();
    await expect(page.getByTestId(`n3-section-card-${id}`)).toHaveAttribute('data-bucket', 'exclude');
  }
  await page.mouse.move(5, 5);

  // 기본 숨김
  await expect(cta).toHaveAttribute('aria-disabled', 'true');
  await expect(tooltip).toBeHidden();

  // hover
  await cta.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText('번역 가능한 섹션이 있어야 진행 가능합니다');
  await page.mouse.move(5, 5);
  await expect(tooltip).toBeHidden();

  // keyboard focus
  await cta.focus();
  await expect(tooltip).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await expect(tooltip).toBeHidden();

  // click — 요청 없음, 화면 유지
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  await cta.click({ force: true }); // aria-disabled라 Playwright 기본 대기를 건너뛴다(실제 사용자는 누를 수 있다)
  await page.waitForTimeout(200);
  expect(posts).toEqual([]);
  await expect(page.getByRole('heading', { level: 1, name: '섹션 확인' })).toBeVisible();

  // 하나를 되살리면 안내가 사라지고 활성이다
  await page.getByTestId('n3-section-action-1').click();
  await expect(cta).toHaveAttribute('aria-disabled', 'false');
  await cta.hover();
  await expect(tooltip).toHaveCount(0);
});
