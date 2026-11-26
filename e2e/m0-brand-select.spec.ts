import { test, expect, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// M0 브랜드 선택 (Figma 1792:20008) — /brand/select. MSW mock(GET /brands · /brands/{id}/logos) 기준.
//
//   m2-multi-brand: 101 픽슬레이트(Pixlate, 로고 2개) · 102 두 번째 브랜드(Second, 로고 조회 404 → 워드마크)
//   m2-no-brand:    브랜드 0개
//
// 계약이 없어 연결하지 않은 것: 카드 본문 → 그 브랜드의 M1(브랜드별 보관함 조회 없음), 국가 필터(Brand 에 국가 없음),
// 브랜드 삭제·삭제 모달(DELETE /brands/{id} 없음). 화면 안 조작은 쓰기 요청을 만들지 않아야 한다.
// ─────────────────────────────────────────────────────────────────

const MULTI = '/brand/select?mockScenario=m2-multi-brand';
const ORANGE = 'rgb(255, 106, 56)';
const GRAY = 'rgb(234, 234, 234)';
const MUTATING = /^(POST|PUT|PATCH|DELETE)$/;

test.use({ viewport: { width: 1920, height: 1080 } });

const card = (page: Page, id: number) => page.getByTestId(`brand-card-${id}`);
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

function recordWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (MUTATING.test(r.method())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return writes;
}

test('Figma 1792:20008 — 1920×1080 헤더 · 필터 · 첫 칸 브랜드 추가 · 4열 카드', async ({ page }) => {
  await page.goto(MULTI);
  await expect(card(page, 101)).toBeVisible();

  const header = await box(page, 'app-header');
  expect([header.x, header.y, header.width, header.height]).toEqual([0, 0, 1920, 72]);
  await expect(page.getByTestId('app-header-title')).toHaveText('브랜드 선택');
  // M0 헤더에는 [브랜드 관리]가 없다(자기 자신)
  await expect(page.getByTestId('app-header-brand')).toHaveCount(0);
  const title = await box(page, 'app-header-title');
  expect([title.x]).toEqual([238]);

  const search = await box(page, 'm0-search');
  expect([search.x, search.y, search.width, search.height]).toEqual([120, 96, 404, 39]);
  const country = await box(page, 'm0-country-filter');
  const sort = await box(page, 'm0-sort');
  expect([country.x, country.width, sort.x, sort.width]).toEqual([540, 124, 680, 124]);
  await expect(page.getByTestId('m0-sort')).toHaveValue('newest');

  const grid = await box(page, 'm0-grid');
  expect([grid.x, grid.y, grid.width]).toEqual([120, 147, 1681]);
  const add = await box(page, 'brand-add-card');
  expect([add.x, add.y, add.width, add.height]).toEqual([120, 147, 400, 264]);
  const first = await box(page, 'brand-card-101');
  expect([first.x, first.y, first.width, first.height]).toEqual([547, 147, 400, 264]);

  // 카드 내부: padding 16 · 이미지 칸 #F5F5F5 radius 4 · 하단 행 브랜드명 16 · 정보 수정 12 Light
  const slot = await box(page, 'brand-card-slot-101');
  expect([slot.x - first.x, slot.y - first.y, slot.width]).toEqual([17, 17, 366]);
  await expect(page.getByTestId('brand-card-slot-101')).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(page.getByTestId('brand-card-name-101')).toHaveCSS('font-size', '16px');
  await expect(page.getByTestId('brand-card-edit-101')).toHaveCSS('font-size', '12px');
  await expect(page.getByTestId('brand-card-edit-101')).toHaveCSS('font-weight', '300');
  const edit = await box(page, 'brand-card-edit-101');
  expect(Math.round(first.x + first.width - (edit.x + edit.width))).toBe(21);
});

test('브랜드 데이터는 API 응답이다 — 로고는 첫 로고를 비율 그대로, 로고가 없으면 영문명 워드마크', async ({ page }) => {
  await page.goto(MULTI);
  await expect(page.getByTestId('brand-card-name-101')).toHaveText('픽슬레이트');
  await expect(page.getByTestId('brand-card-name-102')).toHaveText('두 번째 브랜드');
  const logo = page.getByTestId('brand-card-logo-101');
  await expect(logo).toHaveAttribute('src', '/brand/mock/wordmark.png');
  await expect(logo).toHaveCSS('object-fit', 'contain');
  await expect.poll(() => logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const ratio = await logo.evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    return { rendered: r.width / r.height, natural: el.naturalWidth / el.naturalHeight };
  });
  expect(Math.abs(ratio.rendered - ratio.natural)).toBeLessThan(0.05);

  await expect(page.getByTestId('brand-card-wordmark-102')).toHaveText('Second');
  await expect(page.getByTestId('brand-card-wordmark-102')).toHaveCSS('background-color', 'rgb(249, 249, 249)');
  // Figma 예시 브랜드(아누아·셀리맥스 …)를 하드코딩하지 않는다
  await expect(page.getByText(/아누아|셀리맥스|구달/)).toHaveCount(0);
});

test('검색 — 한글·영문명, 0건이면 Empty State · 조건을 지우면 복귀', async ({ page }) => {
  await page.goto(MULTI);
  await expect(card(page, 102)).toBeVisible();
  await page.getByTestId('m0-search').fill('second');
  await expect(card(page, 101)).toHaveCount(0);
  await expect(card(page, 102)).toBeVisible();
  await page.getByTestId('m0-search').fill('픽슬');
  await expect(card(page, 101)).toBeVisible();
  await expect(card(page, 102)).toHaveCount(0);
  await page.getByTestId('m0-search').fill('없는 브랜드');
  await expect(page.getByTestId('m0-filtered-empty')).toBeVisible();
  await expect(page.getByTestId('brand-add-card')).toHaveCount(0);
  await expect(page.getByTestId('m0-select-all')).toBeDisabled();
  await page.getByTestId('m0-search').fill('');
  await expect(card(page, 101)).toBeVisible();
  await expect(card(page, 102)).toBeVisible();
});

test('국가 필터는 Brand 계약에 국가가 없어 비활성이고 가짜 옵션이 없다', async ({ page }) => {
  await page.goto(MULTI);
  const country = page.getByTestId('m0-country-filter');
  await expect(country).toBeDisabled();
  await expect(country.locator('option')).toHaveText(['국가']);
});

test('선택 — checkbox 로만 바뀌고(주황 테두리), 전체선택은 현재 검색 결과에만 · 카드 본문은 이동하지 않는다', async ({ page }) => {
  const writes = recordWrites(page);
  await page.goto(MULTI);
  await expect(card(page, 101)).toHaveCSS('border-top-color', GRAY);

  // 카드 본문 클릭 — 그 브랜드의 M1 이동은 계약 대기라 아무 일도 없다(선택도 바뀌지 않는다)
  await page.getByTestId('brand-card-slot-101').click();
  await expect(page).toHaveURL(/\/brand\/select/);
  await expect(card(page, 101)).toHaveAttribute('data-selected', 'false');

  await page.getByTestId('brand-card-select-101').check();
  await expect(card(page, 101)).toHaveCSS('border-top-color', ORANGE);
  await expect(card(page, 101)).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('brand-card-select-101').uncheck();
  await expect(card(page, 101)).toHaveCSS('border-top-color', GRAY);

  // 검색으로 102 만 남긴 뒤 전체선택 → 102 만 선택, 검색을 풀면 101 은 그대로 미선택
  await page.getByTestId('m0-search').fill('second');
  await page.getByTestId('m0-select-all').check();
  await page.getByTestId('m0-search').fill('');
  await expect(card(page, 102)).toHaveAttribute('data-selected', 'true');
  await expect(card(page, 101)).toHaveAttribute('data-selected', 'false');
  await expect(page.getByTestId('m0-select-all')).not.toBeChecked();
  await page.getByTestId('m0-select-all').check();
  await expect(card(page, 101)).toHaveAttribute('data-selected', 'true');

  // 삭제 진입점·삭제 모달은 만들지 않는다
  await expect(page.getByRole('button', { name: /삭제/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('[정보 수정]은 그 브랜드의 M2 로 간다', async ({ page }) => {
  await page.goto(MULTI);
  const edit = page.getByTestId('brand-card-edit-101');
  await expect(edit).toHaveAttribute('href', '/brand?brandId=101');
  await expect(edit).toHaveAccessibleName('픽슬레이트 정보 수정');
  await edit.click();
  await expect(page).toHaveURL(/\/brand\?brandId=101$/);
  await expect(page.getByTestId('app-header-title')).toHaveText('브랜드 정보');
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('픽슬레이트');
});

test('브랜드 추가 — 브랜드가 있어도 없어도 M2 신규 등록으로 간다(1:N)', async ({ page }) => {
  await page.goto('/brand/select?mockScenario=m2-no-brand');
  const link = page.getByTestId('brand-add-card-link');
  await expect(link).toHaveAttribute('href', '/brand?mode=create&from=brands');
  await expect(page.getByTestId('brand-add-card-help')).toHaveText('추가하러 가기');
  await expect(page.getByTestId('m0-select-all')).toBeDisabled();
  await link.click();
  await expect(page).toHaveURL(/\/brand\?mode=create&from=brands$/);
  await expect(page.getByTestId('m2-brand')).toHaveAttribute('data-m2-status', 'create');

  await page.goto(MULTI);
  await expect(page.getByTestId('brand-add-card-link')).toHaveAttribute('href', '/brand?mode=create&from=brands');
});

test('브랜드 목록 조회 실패는 빈 목록이 아니라 오류로 보인다', async ({ page }) => {
  await page.goto('/brand/select?mockScenario=m2-list-fail');
  await expect(page.getByTestId('m0-error')).toHaveText('브랜드 목록을 불러오지 못했습니다.', { timeout: 15_000 });
  await expect(page.getByTestId('m0-grid')).toHaveCount(0);
});

for (const [width, height] of [[1728, 885], [1512, 860], [1440, 900], [1280, 720]] as const) {
  test(`${width}×${height} — 가로 넘침 없이 4열이 함께 줄고 로고 비율을 지킨다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(MULTI);
    await expect(page.getByTestId('brand-card-logo-101')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    const grid = await box(page, 'm0-grid');
    expect(grid.x).toBe(120);
    expect(grid.width).toBe(width - 239);
    const add = await box(page, 'brand-add-card');
    const first = await box(page, 'brand-card-101');
    expect(add.width).toBe(first.width);
    expect(first.height).toBe(264);
    const ratio = await page.getByTestId('brand-card-logo-101').evaluate((el: HTMLImageElement) => {
      const r = el.getBoundingClientRect();
      return Math.abs(r.width / r.height - el.naturalWidth / el.naturalHeight);
    });
    expect(ratio).toBeLessThan(0.05);
    const right = await box(page, 'm0-select-all');
    expect(right.x + right.width).toBeLessThanOrEqual(width);
  });
}
