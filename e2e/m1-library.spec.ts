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

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: import('@playwright/test').Locator): Promise<Box> => (await locator.boundingBox())!;
/** 글자 폭이 렌더러마다 소수점 단위로 달라지는 값은 ±1px 안에서 비교한다. */
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);

test('Figma 719:7428 — 1920×1080 위치·크기(제목/필터/action/grid/카드 내부)', async ({ page }) => {
  // 제목 영역(753:6374): 제목 32 Bold 높이 38, gap 12, 설명 14 Regular 높이 17
  const title = await box(page.getByRole('heading', { name: '보관함' }));
  expect([title.x, title.y, title.height]).toEqual([120, 80, 38]);
  const desc = await box(page.getByText('저장한 결과물과 진행 중인 작업을 한곳에서 관리합니다.'));
  expect([desc.x, desc.y, desc.height]).toEqual([120, 130, 17]);

  // back Icon Button(721:7743) 40×40, Arrow Left glyph 16
  const back = await box(page.getByRole('button', { name: '뒤로 가기' }));
  expect([back.x, back.y, back.width, back.height]).toEqual([40, 40, 40, 40]);
  const arrow = await box(page.getByRole('button', { name: '뒤로 가기' }).locator('span').first());
  expect([arrow.width, arrow.height]).toEqual([16, 16]);

  // 필터1(1069:11738): y187 높이 39, 검색 404 · 국가 124 · 정렬 124, gap 16
  const search = await box(page.getByTestId('library-search'));
  const country = await box(page.getByTestId('library-country-filter'));
  const sort = await box(page.getByTestId('library-sort'));
  expect([search.x, search.y, search.width, search.height]).toEqual([120, 187, 404, 39]);
  expect([country.x, country.width, country.height]).toEqual([540, 124, 39]);
  expect([sort.x, sort.width, sort.height]).toEqual([680, 124, 39]);

  // 우측 action(Frame 153): 전체선택 · 다운로드(Tertiary/SM 81×30) · 삭제(Danger/XS 45×24), gap 12, 우측 끝 1801
  const selectAllLabel = await box(page.getByText('전체선택', { exact: true }));
  const download = await box(page.getByTestId('library-download'));
  const del = await box(page.getByTestId('library-delete'));
  near(download.width, 81);
  expect(download.height).toBe(30);
  near(del.width, 45);
  expect(del.height).toBe(24);
  near(download.x - (selectAllLabel.x + selectAllLabel.width), 12);
  near(del.x - (download.x + download.width), 12);
  near(del.x + del.width, 1801);
  await expect(page.getByTestId('library-download')).toHaveCSS('font-size', '12px');

  // 카드 grid(721:7647): y250, 폭 1681, 4열 400, column gap 27, row gap 24
  const grid = await box(page.getByTestId('library-grid'));
  expect([grid.x, grid.y, grid.width]).toEqual([120, 250, 1681]);
  const first = await box(card(page, 9003));
  const fourth = await box(card(page, 9004));
  expect([first.x, first.y, first.width, first.height]).toEqual([120, 250, 400, 280]);
  expect([fourth.x, fourth.y]).toEqual([120 + 3 * (400 + 27), 250]);
  const add = await box(page.getByTestId('library-add-card'));
  expect([add.x, add.y, add.width, add.height]).toEqual([120, 250 + 280 + 24, 400, 280]);
  const addBtn = await box(page.getByTestId('library-add-card-link'));
  expect([addBtn.width, addBtn.height]).toEqual([107, 37]);

  // 카드 내부: 상단 row y+13, Slot y+49 374×192, placeholder 좌우 4px(366), 하단 row y+253 높이 14
  const version = await box(page.getByTestId('library-card-version-9003'));
  expect([version.x, version.y, version.width, version.height]).toEqual([120 + 13 + 374 - 24, 250 + 13, 24, 24]);
  const placeholder = await box(page.getByTestId('library-card-thumbnail-placeholder-9003'));
  expect([placeholder.x, placeholder.y, placeholder.width, placeholder.height]).toEqual([120 + 13 + 4, 250 + 49, 366, 192]);
  const footer = await box(page.getByTestId('library-card-date-9003'));
  expect([footer.y, footer.height]).toEqual([250 + 253, 14]);
});

for (const [width, height] of [
  [1920, 1080],
  [1600, 900],
  [1536, 864],
] as const) {
  test(`${width}×${height} — 가로 넘침 없음, 4열 전체·우측 action이 viewport 안`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await expect(card(page, 9004)).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);

    // 첫 줄 4장이 서로 다른 열에 있고 모두 viewport 안에 들어온다
    const row = await Promise.all([9003, 9002, 9001, 9004].map((id) => box(card(page, id))));
    expect(new Set(row.map((b) => b.y)).size).toBe(1);
    for (let i = 1; i < row.length; i += 1) expect(row[i].x).toBeGreaterThan(row[i - 1].x + row[i - 1].width);
    for (const b of row) expect(b.x + b.width).toBeLessThanOrEqual(width);

    for (const id of ['library-delete', 'library-download', 'library-select-all']) {
      const b = await box(page.getByTestId(id));
      expect(b.x + b.width).toBeLessThanOrEqual(width);
    }

    // pagination도 가로로 viewport 안, 중앙 정렬
    const pag = await box(page.getByTestId('library-pagination'));
    expect(pag.x).toBeGreaterThanOrEqual(0);
    expect(pag.x + pag.width).toBeLessThanOrEqual(width);
    near(pag.x + pag.width / 2, width / 2);

    // 카드 내부가 카드 밖으로 넘치지 않는다
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="library-grid"] > *')].filter((el) => el.scrollWidth > el.clientWidth).length,
    );
    expect(overflowing).toBe(0);
  });
}

test('긴 상품명은 카드 안에서 말줄임되고 다른 버전 버튼을 밀어내지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  const name = card(page, 9003).locator('p[title]');
  // 표시 검증 전용 — 렌더된 텍스트만 길게 바꿔 레이아웃을 확인한다(데이터는 바꾸지 않는다)
  await name.evaluate((el) => {
    el.textContent = '[케데헌 한정기획] 마스크팩 5매 8종 (+1매 추가 증정) 아주 긴 상품명 테스트 문자열';
  });
  const truncated = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(truncated).toBe(true);
  const c = await box(card(page, 9003));
  const v = await box(page.getByTestId('library-card-version-9003'));
  expect(v.width).toBe(24);
  expect(v.x + v.width).toBeLessThanOrEqual(c.x + c.width - 13);
});

// ─────────────────────────────────────────────────────────────────
// Pagination — Figma Frame 477(832:6472) visual shell. /library에 page·total 계약이 없어
// 모든 control은 disabled이고 실제 페이지 이동은 검증하지 않는다.
// ─────────────────────────────────────────────────────────────────

test('pagination visual shell — ← 1 2 3 … 7 →, 1번 선택 모습, 모든 control disabled, 흐린 비활성 표현', async ({ page }) => {
  const pagination = page.getByTestId('library-pagination');
  await expect(pagination).toBeVisible();

  const controls = ['library-page-prev', 'library-page-1', 'library-page-2', 'library-page-3', 'library-page-7', 'library-page-next'];
  for (const id of controls) {
    await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId(id)).toBeDisabled();
  }
  await expect(page.getByTestId('library-page-more')).toBeVisible();
  await expect(page.getByRole('button', { name: '이전 페이지' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '다음 페이지' })).toBeDisabled();

  // Figma 선택 모습: 1번만 #171717 배경
  await expect(page.getByTestId('library-page-1')).toHaveCSS('background-color', 'rgb(23, 23, 23)');
  await expect(page.getByTestId('library-page-1')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('library-page-2')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  // 다운로드·삭제 disabled와 같은 opacity-40, 안내 문구는 없다
  await expect(pagination).toHaveCSS('opacity', '0.4');
  await expect(page.getByText('Unavailable')).toHaveCount(0);

  // disabled라 눌러도 카드 목록이 바뀌지 않는다
  const before = await cardOrder(page);
  for (const id of controls) await page.getByTestId(id).click({ force: true });
  expect(await cardOrder(page)).toEqual(before);
});

test('pagination — 1920×1080에서 Figma 위치(하단 60, 가로 중앙)와 크기', async ({ page }) => {
  const pag = await box(page.getByTestId('library-pagination'));
  expect([pag.x, pag.y, pag.width, pag.height]).toEqual([838, 992, 244, 28]);
  const one = await box(page.getByTestId('library-page-1'));
  const two = await box(page.getByTestId('library-page-2'));
  expect([one.width, one.height]).toEqual([28, 28]);
  expect(two.x - one.x).toBe(36); // 28 + gap 8
});
