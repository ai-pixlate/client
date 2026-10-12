import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// M1 보관함 (Figma 719:7428) — MSW mock(GET /library, GET /master/*) 기준.
//
// lib/mock-api/library-fixtures.ts:
//   9001 비타민C 세럼 / US·en / original / 2026-10-01
//   9002 비타민C 세럼 / JP·ja / original / 2026-10-02
//   9003 비타민C 세럼 / US·en / site     / 2026-10-03
//   9004 히알루론산 토너 / AE·ar / original / 2026-09-28 / thumbnailUrl 있음
//
// 삭제·다운로드·다른 버전 만들기는 계약 미확정이라 클릭 결과를 검증하지 않는다 —
// 다운로드·삭제는 API 계약 확정 전까지 항상 비활성인지만 본다.
// master 실패/빈 배열 시 code fallback은 MSW(Service Worker) 응답을 e2e에서 바꿀 수 없어
// scripts/verify-library-view.mjs의 getCodeLabel 검증으로 확인한다.
// ─────────────────────────────────────────────────────────────────

const card = (page: import('@playwright/test').Page, jobId: number) => page.getByTestId(`library-card-${jobId}`);

async function cardOrder(page: import('@playwright/test').Page) {
  return page
    .getByTestId('library-grid')
    .locator('article[data-testid^="library-card-"]')
    .evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-testid')!.replace('library-card-', ''))));
}

test.use({ viewport: { width: 1920, height: 1080 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
  await expect(card(page, 9001)).toBeVisible();
});

test('GET /library 카드 4건 + 추가 생성 카드, 같은 상품도 국가·언어·규격이 다르면 별도 카드', async ({ page }) => {
  expect(await cardOrder(page)).toHaveLength(4);
  await expect(page.getByTestId('library-add-card')).toBeVisible();
  await expect(page.getByTestId('library-grid').getByText('비타민C 세럼')).toHaveCount(3);
});

test('카드에 상품명·저장일·완료·국가/언어 표시 이름이 보인다', async ({ page }) => {
  const c = card(page, 9002);
  await expect(c.getByText('비타민C 세럼')).toBeVisible();
  await expect(c.getByTestId('library-card-date-9002')).toHaveText('2026.10.02');
  await expect(c.getByText('완료')).toBeVisible();
  // 코드값(JP/ja)이 아니라 GET /master/* 표시 이름
  await expect(c.getByTestId('library-card-locale-9002')).toHaveText('일본일본어');
  await expect(card(page, 9004).getByTestId('library-card-locale-9004')).toHaveText('아랍에미리트아랍어');
});

test('thumbnailUrl null이면 #F5F5F5 placeholder, 값이 있으면 이미지', async ({ page }) => {
  const placeholder = page.getByTestId('library-card-thumbnail-placeholder-9001');
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(page.getByTestId('library-card-thumbnail-9001')).toHaveCount(0);

  const img = page.getByTestId('library-card-thumbnail-9004');
  await expect(img).toHaveAttribute('src', '/mock/n5/sections/501-translated.png');
  await expect(page.getByTestId('library-card-thumbnail-placeholder-9004')).toHaveCount(0);
});

test('기본 정렬은 최신순(savedAt 내림차순)', async ({ page }) => {
  await expect(page.getByTestId('library-sort')).toHaveValue('newest');
  expect(await cardOrder(page)).toEqual([9003, 9002, 9001, 9004]);
});

test('상품명 검색 + 국가 필터(동시 적용)', async ({ page }) => {
  await page.getByTestId('library-search').fill('토너');
  expect(await cardOrder(page)).toEqual([9004]);

  await page.getByTestId('library-search').fill('세럼');
  expect(await cardOrder(page)).toEqual([9003, 9002, 9001]);

  await page.getByTestId('library-country-filter').selectOption('US');
  expect(await cardOrder(page)).toEqual([9003, 9001]);

  await page.getByTestId('library-search').fill('');
  await page.getByTestId('library-country-filter').selectOption('');
  expect(await cardOrder(page)).toHaveLength(4);
  // 검색 결과가 없어도 추가 생성 카드는 남는다
  await page.getByTestId('library-search').fill('없는상품');
  expect(await cardOrder(page)).toEqual([]);
  await expect(page.getByTestId('library-add-card')).toBeVisible();
});

test('국가 필터 옵션은 실제 카드의 국가만, 표시 이름으로', async ({ page }) => {
  // master 응답 전에는 code가 먼저 보일 수 있어 재시도되는 단언을 쓴다
  await expect(page.getByTestId('library-country-filter').locator('option')).toHaveText(['국가', '미국', '일본', '아랍에미리트']);
});

test('개별·복수 선택, 전체선택/해제 — 다운로드·삭제는 선택과 무관하게 비활성(API 계약 확정 전)', async ({ page }) => {
  const download = page.getByTestId('library-download');
  const del = page.getByTestId('library-delete');
  await expect(download).toBeDisabled();
  await expect(del).toBeDisabled();

  await page.getByTestId('library-card-select-9001').check();
  await expect(page.getByTestId('library-card-select-9001')).toBeChecked();
  // 카드를 선택해도 다운로드·삭제는 비활성 그대로다
  await expect(download).toBeDisabled();
  await expect(del).toBeDisabled();

  await page.getByTestId('library-card-select-9002').check();
  await expect(page.getByTestId('library-card-select-9001')).toBeChecked();
  await expect(page.getByTestId('library-card-select-9002')).toBeChecked();
  await expect(page.getByTestId('library-select-all')).not.toBeChecked();

  await page.getByTestId('library-select-all').check();
  for (const id of [9001, 9002, 9003, 9004]) {
    await expect(page.getByTestId(`library-card-select-${id}`)).toBeChecked();
  }
  await expect(download).toBeDisabled();
  await expect(del).toBeDisabled();

  await page.getByTestId('library-select-all').uncheck();
  for (const id of [9001, 9002, 9003, 9004]) {
    await expect(page.getByTestId(`library-card-select-${id}`)).not.toBeChecked();
  }
});

test('다른 버전 만들기 버튼은 접근성 이름을 갖고, 계약 확정 전에는 aria-disabled', async ({ page }) => {
  const btn = page.getByRole('button', { name: '비타민C 세럼 다른 버전 만들기' }).first();
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-disabled', 'true');
});

test('이미지 추가 생성 카드 → N1(/jobs/new)', async ({ page }) => {
  await expect(page.getByTestId('library-add-card-link')).toHaveAttribute('href', '/jobs/new');
  await page.getByTestId('library-add-card-link').click();
  await expect(page).toHaveURL(/\/jobs\/new$/);
});

test('Figma 1920×1080 위치·크기(제목/필터/grid/카드)', async ({ page }) => {
  const box = async (locator: import('@playwright/test').Locator) => (await locator.boundingBox())!;

  const title = await box(page.getByRole('heading', { name: '보관함' }));
  expect(title.x).toBe(120);
  expect(title.y).toBe(80);
  expect(title.height).toBe(38);
  const desc = await box(page.getByText('저장한 결과물과 진행 중인 작업을 한곳에서 관리합니다.'));
  expect(desc.x).toBe(120);
  expect(desc.y).toBe(130);

  const back = await box(page.getByRole('button', { name: '뒤로 가기' }));
  expect([back.x, back.y, back.width, back.height]).toEqual([40, 40, 40, 40]);
  const arrow = await box(page.getByRole('button', { name: '뒤로 가기' }).locator('svg'));
  expect([arrow.width, arrow.height]).toEqual([16, 16]);

  // 우측 action group(전체선택 / 다운로드 / 삭제) gap 12, 다운로드 Tertiary/SM 12px
  const selectAllLabel = await box(page.getByText('전체선택', { exact: true }));
  const download = await box(page.getByTestId('library-download'));
  const del = await box(page.getByTestId('library-delete'));
  expect(Math.round(download.x - (selectAllLabel.x + selectAllLabel.width))).toBe(12);
  expect(Math.round(del.x - (download.x + download.width))).toBe(12);
  expect(Math.round(del.x + del.width)).toBe(120 + 1681);
  await expect(page.getByTestId('library-download')).toHaveCSS('font-size', '12px');

  const search = await box(page.getByTestId('library-search'));
  expect(search.x).toBe(120);
  expect(search.y).toBe(187);
  expect(search.width).toBe(404);

  const grid = await box(page.getByTestId('library-grid'));
  expect(grid.x).toBe(120);
  expect(grid.y).toBe(250);
  expect(grid.width).toBe(1681);

  // 최신순 첫 줄: 9003, 9002, 9001, 9004 — 4열, column gap 27
  const first = await box(card(page, 9003));
  const fourth = await box(card(page, 9004));
  expect(first.width).toBe(400);
  expect(first.height).toBe(280);
  expect(first.x).toBe(120);
  expect(fourth.x).toBe(120 + 3 * (400 + 27));
  expect(fourth.y).toBe(250);

  // 추가 생성 카드는 두 번째 줄 첫 칸 — row gap 24
  const add = await box(page.getByTestId('library-add-card'));
  expect(add.x).toBe(120);
  expect(add.y).toBe(250 + 280 + 24);

  const addBtn = await box(page.getByTestId('library-add-card-link'));
  expect(addBtn.width).toBe(107);
  expect(addBtn.height).toBe(37);

  const thumb = await box(page.getByTestId('library-card-thumbnail-placeholder-9003'));
  expect(thumb.width).toBe(374);
  expect(thumb.height).toBe(192);
});
