import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// M1 보관함 (Figma 719:7428) — MSW mock(GET /library, GET /master/*) 기준.
//
// lib/mock-api/library-fixtures.ts:
//   9001 비타민C 세럼 / US·en / original / 2026-10-07 02:45Z
//   9002 비타민C 세럼 / JP·ja / original / 2026-10-07 08:10Z
//   9003 비타민C 세럼 / US·en / site     / 2026-10-12
//   9004 히알루론산 토너 / AE·ar / original / 2026-09-19 / thumbnailUrl 있음
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
  await expect(c.getByTestId('library-card-date-9002')).toHaveText('2026.10.07');
  // 카드마다 저장일이 다르게 보인다(같은 날 저장된 9001·9002는 같은 날짜)
  await expect(page.getByTestId('library-card-date-9001')).toHaveText('2026.10.07');
  await expect(page.getByTestId('library-card-date-9003')).toHaveText('2026.10.12');
  await expect(page.getByTestId('library-card-date-9004')).toHaveText('2026.09.19');
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
});

test('규격 표시 — N1과 같은 명칭(원본 유지·판매처 맞춤), 날짜 앞에 Figma "M1 카드 사이즈" 순서·간격', async ({ page }) => {
  await expect(page.getByTestId('library-card-spec-9001')).toHaveText('원본 유지');
  await expect(page.getByTestId('library-card-spec-9003')).toHaveText('판매처 맞춤');
  await expect(page.getByTestId('library-card-spec-9003')).toHaveCSS('color', 'rgb(112, 112, 112)');
  await expect(page.getByTestId('library-card-spec-9003')).toHaveCSS('font-size', '12px');
  // 1211:6585 — 규격 + gap 12 + 날짜 + gap 4 + 완료
  const spec = await box(page.getByTestId('library-card-spec-9003'));
  const date = await box(page.getByTestId('library-card-date-9003'));
  const done = await box(card(page, 9003).getByText('완료', { exact: true }));
  expect(spec.x).toBe(120 + 13);
  near(date.x - (spec.x + spec.width), 12);
  near(done.x - (date.x + date.width), 4);
});

test('검색·필터 결과 0건이면 Empty State, "+" 카드는 숨김 — 조건을 되돌리면 목록 복귀', async ({ page }) => {
  const empty = page.getByTestId('library-filtered-empty');
  await expect(empty).toHaveCount(0);

  // 검색 0건
  await page.getByTestId('library-search').fill('없는상품');
  await expect(empty).toBeVisible();
  await expect(empty.getByText('검색 결과가 없습니다.')).toBeVisible();
  await expect(empty.getByText('검색어나 필터 조건을 변경해 보세요.')).toBeVisible();
  await expect(page.getByTestId('library-grid')).toHaveCount(0);
  await expect(page.getByTestId('library-add-card')).toHaveCount(0);
  await page.getByTestId('library-search').fill('');
  await expect(empty).toHaveCount(0);
  expect(await cardOrder(page)).toHaveLength(4);

  // 필터 조합 0건(토너는 AE만 있다)
  await page.getByTestId('library-search').fill('토너');
  await page.getByTestId('library-country-filter').selectOption('US');
  await expect(empty).toBeVisible();
  await expect(page.getByTestId('library-add-card')).toHaveCount(0);
  await page.getByTestId('library-country-filter').selectOption('AE');
  await expect(empty).toHaveCount(0);
  expect(await cardOrder(page)).toEqual([9004]);
  await expect(page.getByTestId('library-add-card')).toBeVisible();
});

test('국가 필터 옵션은 실제 카드의 국가만, 표시 이름으로', async ({ page }) => {
  // master 응답 전에는 code가 먼저 보일 수 있어 재시도되는 단언을 쓴다
  await expect(page.getByTestId('library-country-filter').locator('option')).toHaveText(['국가', '미국', '일본', '아랍에미리트']);
});

test('개별·복수 선택, 전체선택/해제 — 다운로드는 선택 1건 이상이면 활성, 삭제는 계약 확정 전까지 비활성', async ({ page }) => {
  const download = page.getByTestId('library-download');
  const del = page.getByTestId('library-delete');
  const count = page.getByTestId('library-selected-count');
  await expect(download).toBeDisabled();
  await expect(del).toBeDisabled();
  await expect(count).toHaveText('');

  await page.getByTestId('library-card-select-9001').check();
  await expect(count).toHaveText('1개 선택');
  await expect(page.getByTestId('library-card-select-9001')).toBeChecked();
  await expect(download).toBeEnabled();
  await expect(del).toBeDisabled();

  await page.getByTestId('library-card-select-9002').check();
  await expect(page.getByTestId('library-card-select-9001')).toBeChecked();
  await expect(page.getByTestId('library-card-select-9002')).toBeChecked();
  await expect(page.getByTestId('library-select-all')).not.toBeChecked();
  await expect(count).toHaveText('2개 선택');

  await page.getByTestId('library-card-select-9001').uncheck();
  await expect(count).toHaveText('1개 선택');
  await page.getByTestId('library-card-select-9001').check();

  await page.getByTestId('library-select-all').check();
  for (const id of [9001, 9002, 9003, 9004]) {
    await expect(page.getByTestId(`library-card-select-${id}`)).toBeChecked();
  }
  await expect(count).toHaveText('4개 선택');
  await expect(download).toBeEnabled();
  await expect(del).toBeDisabled();

  await page.getByTestId('library-select-all').uncheck();
  for (const id of [9001, 9002, 9003, 9004]) {
    await expect(page.getByTestId(`library-card-select-${id}`)).not.toBeChecked();
  }
  await expect(count).toHaveText('');
  await expect(download).toBeDisabled();
});

test('전체선택은 현재 검색·필터 결과에만 적용되고, 선택 개수와 전체선택 상태가 일치한다', async ({ page }) => {
  const count = page.getByTestId('library-selected-count');
  const selectAll = page.getByTestId('library-select-all');

  await page.getByTestId('library-country-filter').selectOption('US');
  expect(await cardOrder(page)).toEqual([9003, 9001]);
  await selectAll.check();
  await expect(count).toHaveText('2개 선택');
  await expect(selectAll).toBeChecked();

  // 필터를 풀면 결과 밖(9002·9004)은 선택되지 않았고, 전체선택은 해제 상태로 보인다
  await page.getByTestId('library-country-filter').selectOption('');
  for (const id of [9001, 9003]) await expect(page.getByTestId(`library-card-select-${id}`)).toBeChecked();
  for (const id of [9002, 9004]) await expect(page.getByTestId(`library-card-select-${id}`)).not.toBeChecked();
  await expect(count).toHaveText('2개 선택');
  await expect(selectAll).not.toBeChecked();
});

test('다른 버전 만들기 버튼은 접근성 이름을 갖고, 계약 확정 전에는 Icon Button Circle/XXS Disabled(285:2116)', async ({ page }) => {
  const btn = page.getByRole('button', { name: '비타민C 세럼 다른 버전 만들기' }).first();
  await expect(btn).toBeVisible();
  await expect(btn).toBeDisabled();
  // Disabled: bg #F5F5F5, border 없음, glyph #999 — opacity로 흐리게 하지 않는다
  await expect(btn).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(btn).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  await expect(btn).toHaveCSS('color', 'rgb(153, 153, 153)');
  await expect(btn).toHaveCSS('opacity', '1');
  await expect(btn).toHaveCSS('cursor', 'not-allowed');
  // Plus 12 glyph(53:1124) — 12 frame 안 inset 20%, 원본 SVG를 mask로 쓰고 색은 currentColor
  const glyph = btn.locator('[data-glyph-src="/library/icons/plus-12-secondary.svg"]');
  await expect(glyph).toHaveCSS('background-color', 'rgb(153, 153, 153)');
  const b = await box(btn);
  const g = await box(glyph);
  near(g.x + g.width / 2, b.x + b.width / 2);
  near(g.y + g.height / 2, b.y + b.height / 2);
});

test('검색·국가·정렬 glyph(14) — Select / Dropdown(28:142) border 1 + px 14: 오른쪽 끝이 테두리 바깥에서 15px, 세로 중앙', async ({ page }) => {
  for (const [testId, src] of [
    ['library-search', '/library/icons/search-14.svg'],
    ['library-country-filter', '/library/icons/chevron-down-14.svg'],
    ['library-sort', '/library/icons/chevron-down-14.svg'],
  ] as const) {
    const control = await box(page.getByTestId(testId));
    const glyph = await box(page.getByTestId(testId).locator('xpath=..').locator(`img[src="${src}"]`).locator('xpath=../../..'));
    expect([glyph.width, glyph.height]).toEqual([14, 14]);
    expect(control.x + control.width - (glyph.x + glyph.width)).toBe(15);
    near(glyph.y + glyph.height / 2, control.y + control.height / 2);
  }
});

test('좌측 상단 뒤로가기 버튼은 보이지 않고 키보드 포커스도 받지 않는다', async ({ page }) => {
  await expect(page.getByRole('button', { name: '뒤로 가기' })).toHaveCount(0);
  // 검색창에 닿을 때까지 Tab 순서를 따라가도 뒤로가기 버튼은 없다(dev 도구 버튼이 먼저 올 수 있어 몇 번 허용)
  const visited: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { testId: el?.dataset.testid ?? '', label: el?.getAttribute('aria-label') ?? '' };
    });
    visited.push(focused.label);
    if (focused.testId === 'library-search') break;
  }
  await expect(page.getByTestId('library-search')).toBeFocused();
  expect(visited).not.toContain('뒤로 가기');
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

  // back Icon Button(721:7743)은 12월 M0 연결 전까지 렌더하지 않는다(별도 테스트).

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

    // 카드 내부가 카드 밖으로 넘치지 않는다
    const overflowing = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="library-grid"] > *')].filter((el) => el.scrollWidth > el.clientWidth).length,
    );
    expect(overflowing).toBe(0);

    // 4건(1페이지)은 pagination 없음. 여러 페이지일 때 pagination도 가로로 viewport 안, 중앙 정렬
    await expect(page.getByTestId('library-pagination')).toHaveCount(0);
    await openWithLibraryCards(page, 7 * 7);
    const pag = await box(page.getByTestId('library-pagination'));
    expect(pag.x).toBeGreaterThanOrEqual(0);
    expect(pag.x + pag.width).toBeLessThanOrEqual(width);
    near(pag.x + pag.width / 2, width / 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
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
// Pagination — Figma Frame 477(832:6472). GET /library에 page 계약이 없어 FE에서 나눈다:
// 한 페이지 = 결과 카드 7장 + 추가 생성 카드. 2페이지 이상일 때만 보인다.
//
// 기본 mock은 4건이라 여러 페이지 상황은 이 테스트 안에서만 만든다 — MSW(Service Worker)는
// page.route로 가로챌 수 없어(e2e/n5-confirm.spec.ts 참고) 페이지 스크립트보다 먼저 window.fetch를
// 감싸 GET /library 응답만 N건으로 바꾼다. 실제 mock fixture는 늘리지 않는다.
// ─────────────────────────────────────────────────────────────────

/** jobId 1000부터, savedAt이 1시간씩 과거로 — 최신순 = jobId 오름차순. 짝수 US, 홀수 JP. */
async function openWithLibraryCards(page: import('@playwright/test').Page, count: number) {
  await page.addInitScript((n) => {
    const cards = Array.from({ length: n }, (_, i) => ({
      jobId: 1000 + i,
      productName: `테스트 상품 ${i + 1}`,
      brandName: null,
      targetCountry: i % 2 === 0 ? 'US' : 'JP',
      targetLanguage: i % 2 === 0 ? 'en' : 'ja',
      specType: 'original',
      thumbnailUrl: null,
      savedAt: new Date(Date.UTC(2026, 9, 1) - i * 3_600_000).toISOString(),
    }));
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (new URL(url, window.location.href).pathname === '/library') {
        return Promise.resolve(new Response(JSON.stringify(cards), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return originalFetch(input, init);
    };
  }, count);
  await page.goto('/');
  if (count > 0) await expect(card(page, 1000)).toBeVisible();
}

const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => 1000 + from + i);
const pageButtons = (page: import('@playwright/test').Page) =>
  page.getByTestId('library-pagination').locator('[data-testid^="library-page-"]:not([data-testid="library-page-prev"]):not([data-testid="library-page-next"])');
const pageLabels = async (page: import('@playwright/test').Page) =>
  (await pageButtons(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!.replace('library-page-', ''))));

test('카드 4건(1페이지)이면 pagination을 숨기고, 아래에 빈 자리를 남기지 않는다', async ({ page }) => {
  await expect(page.getByTestId('library-pagination')).toHaveCount(0);
  expect(await cardOrder(page)).toHaveLength(4);
  await expect(page.getByTestId('library-add-card')).toBeVisible();
  // 1080 높이에 내용이 들어가 세로 스크롤이 생기지 않는다(숨긴 pagination 자리 없음)
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1080);
});

test('정확히 1페이지(7건)면 숨김, 8건이면 2페이지로 표시 — 2페이지에는 1건 + 추가 생성 카드', async ({ page }) => {
  await openWithLibraryCards(page, 7);
  expect(await cardOrder(page)).toEqual(ids(0, 6));
  await expect(page.getByTestId('library-add-card')).toBeVisible();
  await expect(page.getByTestId('library-pagination')).toHaveCount(0);

  // 같은 탭에서 8건으로 다시 연다 — 나중에 추가한 fetch 대체가 바깥에서 먼저 응답한다
  await openWithLibraryCards(page, 8);
  await expect(page.getByTestId('library-pagination')).toBeVisible();
  expect(await pageLabels(page)).toEqual(['1', '2']);
  expect(await cardOrder(page)).toEqual(ids(0, 6));
  await page.getByTestId('library-page-2').click();
  expect(await cardOrder(page)).toEqual([1007]);
  await expect(page.getByTestId('library-add-card')).toBeVisible();
});

test('페이지 이동 — 번호·이전·다음, 현재 페이지 표시, 처음/끝에서 이전/다음은 Disabled(116:982)', async ({ page }) => {
  await openWithLibraryCards(page, 17); // 7 + 7 + 3 → 3페이지
  const prev = page.getByTestId('library-page-prev');
  const next = page.getByTestId('library-page-next');
  expect(await pageLabels(page)).toEqual(['1', '2', '3']);
  await expect(page.getByTestId('library-page-1')).toHaveAttribute('aria-current', 'page');
  await expect(prev).toBeDisabled();
  await expect(prev).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(prev).toHaveCSS('color', 'rgb(153, 153, 153)');
  await expect(next).toBeEnabled();
  await expect(next).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(next).toHaveCSS('color', 'rgb(23, 23, 23)');

  await next.click();
  await expect(page.getByTestId('library-page-2')).toHaveAttribute('aria-current', 'page');
  expect(await cardOrder(page)).toEqual(ids(7, 13));
  await page.getByTestId('library-page-3').click();
  expect(await cardOrder(page)).toEqual(ids(14, 16));
  await expect(next).toBeDisabled();
  await prev.click();
  expect(await cardOrder(page)).toEqual(ids(7, 13));
  await page.getByTestId('library-page-1').click();
  expect(await cardOrder(page)).toEqual(ids(0, 6));
});

test('pagination 상태 색 — 현재 #171717 배경 + 흰 glyph, 나머지 white + #171717 glyph, Hover는 #F5F5F5(116:980)', async ({ page }) => {
  await openWithLibraryCards(page, 17);
  const one = page.getByTestId('library-page-1');
  const two = page.getByTestId('library-page-2');
  await expect(one).toHaveCSS('background-color', 'rgb(23, 23, 23)');
  await expect(one.locator('[data-glyph-src="/library/icons/number-1-12.svg"]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(two).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(two.locator('[data-glyph-src="/library/icons/number-2-12.svg"]')).toHaveCSS('background-color', 'rgb(23, 23, 23)');
  await two.hover();
  await expect(two).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  // opacity로 흐리게 하지 않는다(이전 visual shell의 opacity-40 제거)
  await expect(page.getByTestId('library-pagination')).toHaveCSS('opacity', '1');
});

test('페이지가 많으면 번호 칸 5개 — 1 2 3 … N / 1 … 현재 … N / 1 … N−2 N−1 N', async ({ page }) => {
  await openWithLibraryCards(page, 7 * 7 + 1); // 8페이지
  expect(await pageLabels(page)).toEqual(['1', '2', '3', 'more', '8']);
  await page.getByTestId('library-page-3').click();
  await page.getByTestId('library-page-next').click(); // 4
  expect(await pageLabels(page)).toEqual(['1', 'more', '4', 'more', '8']);
  await expect(page.getByTestId('library-page-4')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('library-page-8').click();
  expect(await pageLabels(page)).toEqual(['1', 'more', '6', '7', '8']);
  expect(await cardOrder(page)).toEqual([1049]);
});

test('pagination — 1920×1080에서 Figma 위치(하단 60, 가로 중앙)와 크기(7페이지 = Frame 477 구성)', async ({ page }) => {
  await openWithLibraryCards(page, 7 * 7);
  expect(await pageLabels(page)).toEqual(['1', '2', '3', 'more', '7']);
  const pag = await box(page.getByTestId('library-pagination'));
  expect([pag.x, pag.y, pag.width, pag.height]).toEqual([838, 992, 244, 28]);
  const one = await box(page.getByTestId('library-page-1'));
  const two = await box(page.getByTestId('library-page-2'));
  expect([one.width, one.height]).toEqual([28, 28]);
  expect(two.x - one.x).toBe(36); // 28 + gap 8
  // 12px glyph가 28 버튼 가운데
  const glyph = await box(page.getByTestId('library-page-2').locator('span').first());
  expect([glyph.width, glyph.height]).toEqual([12, 12]);
  expect([glyph.x - two.x, glyph.y - two.y]).toEqual([8, 8]);
});

test('검색·필터를 바꾸면 페이지 수를 다시 계산하고, 사라진 페이지에 있었다면 마지막 페이지로 이동', async ({ page }) => {
  await openWithLibraryCards(page, 17); // US 9건(짝수), JP 8건
  await page.getByTestId('library-page-3').click();
  expect(await cardOrder(page)).toEqual(ids(14, 16));

  // US만 9건 → 2페이지. 3페이지는 없어졌으므로 2페이지(마지막)를 보여준다
  await page.getByTestId('library-country-filter').selectOption('US');
  expect(await pageLabels(page)).toEqual(['1', '2']);
  await expect(page.getByTestId('library-page-2')).toHaveAttribute('aria-current', 'page');
  expect(await cardOrder(page)).toEqual([1014, 1016]);

  // 검색으로 7건 이하 → 숨김("상품 1" = 상품 1·10~17, 그중 US는 1·11·13·15·17 = jobId 1000·1010·1012·1014·1016)
  await page.getByTestId('library-search').fill('상품 1');
  await expect(page.getByTestId('library-pagination')).toHaveCount(0);
  expect(await cardOrder(page)).toEqual([1000, 1010, 1012, 1014, 1016]);

  // 0건 → 숨김 + Empty State
  await page.getByTestId('library-search').fill('없는상품');
  await expect(page.getByTestId('library-filtered-empty')).toBeVisible();
  await expect(page.getByTestId('library-pagination')).toHaveCount(0);

  // 조건을 풀면 다시 3페이지
  await page.getByTestId('library-search').fill('');
  await page.getByTestId('library-country-filter').selectOption('');
  expect(await pageLabels(page)).toEqual(['1', '2', '3']);
});

test('pagination이 있어도 전체선택은 검색·필터 결과 전체, 페이지를 옮겨도 선택 유지', async ({ page }) => {
  await openWithLibraryCards(page, 17);
  const count = page.getByTestId('library-selected-count');

  await page.getByTestId('library-card-select-1001').check();
  await page.getByTestId('library-page-2').click();
  await page.getByTestId('library-card-select-1008').check();
  await expect(count).toHaveText('2개 선택');
  await page.getByTestId('library-page-1').click();
  await expect(page.getByTestId('library-card-select-1001')).toBeChecked();

  // 전체선택 = 결과 17건 전체(현재 페이지 7건만이 아님)
  await page.getByTestId('library-select-all').check();
  await expect(count).toHaveText('17개 선택');
  await page.getByTestId('library-page-3').click();
  for (const id of ids(14, 16)) await expect(page.getByTestId(`library-card-select-${id}`)).toBeChecked();
  await expect(page.getByTestId('library-select-all')).toBeChecked();

  // 필터 결과(JP 8건) 기준 개수·전체선택 상태. 전체해제는 필터 결과에만 적용 — 가려진 US 9건은 선택 유지.
  await page.getByTestId('library-country-filter').selectOption('JP');
  await expect(count).toHaveText('8개 선택 · 다른 조건에서 9개 선택됨');
  await expect(page.getByTestId('library-select-all')).toBeChecked();
  await page.getByTestId('library-select-all').uncheck();
  await expect(count).toHaveText('다른 조건에서 9개 선택됨');
  await expect(page.getByTestId('library-download')).toBeDisabled();
  await page.getByTestId('library-country-filter').selectOption('');
  await expect(count).toHaveText('9개 선택');
  await expect(page.getByTestId('library-select-all')).not.toBeChecked();
  await page.getByTestId('library-page-1').click();
  await expect(page.getByTestId('library-card-select-1000')).toBeChecked();
  await expect(page.getByTestId('library-card-select-1001')).not.toBeChecked();
});

test('전체선택·전체해제는 현재 검색·필터 결과에만 적용되고, 결과 밖 선택은 유지된다', async ({ page }) => {
  await openWithLibraryCards(page, 17);
  const count = page.getByTestId('library-selected-count');
  const download = page.getByTestId('library-download');
  const selectAll = page.getByTestId('library-select-all');

  // 결과 밖이 될 US 카드 1건(1000)을 먼저 선택
  await page.getByTestId('library-card-select-1000').check();
  await expect(count).toHaveText('1개 선택');

  // JP 결과(8건)로 바꾸면 1000은 가려져 개수·다운로드에서 빠진다(선택 자체는 유지)
  await page.getByTestId('library-country-filter').selectOption('JP');
  await expect(count).toHaveText('다른 조건에서 1개 선택됨');
  await expect(download).toBeDisabled();
  await expect(selectAll).not.toBeChecked();

  // JP 전체선택 → 8건만 더해진다
  await selectAll.check();
  await expect(count).toHaveText('8개 선택 · 다른 조건에서 1개 선택됨');
  await expect(download).toBeEnabled();

  // 조건을 풀면 가려졌던 1000까지 9건, 전체(17건)가 아니라 전체선택은 꺼져 있다
  await page.getByTestId('library-country-filter').selectOption('');
  await expect(count).toHaveText('9개 선택');
  await expect(selectAll).not.toBeChecked();
  await expect(page.getByTestId('library-card-select-1000')).toBeChecked();

  // 검색 결과(상품 1x — 1·10~17, 9건) 안에서 전체해제 → 결과 9건만 해제
  await page.getByTestId('library-search').fill('상품 1');
  await expect(count).toHaveText('5개 선택 · 다른 조건에서 4개 선택됨'); // 1000·1009·1011·1013·1015 / 1001·1003·1005·1007
  await selectAll.check();
  await expect(count).toHaveText('9개 선택 · 다른 조건에서 4개 선택됨');
  await selectAll.uncheck();
  await expect(count).toHaveText('다른 조건에서 4개 선택됨');
  await expect(download).toBeDisabled();

  // 검색을 지우면 결과 밖이던 JP 1001·1003·1005·1007 4건은 그대로 선택돼 있다
  await page.getByTestId('library-search').fill('');
  await expect(count).toHaveText('4개 선택');
  for (const id of [1001, 1003, 1005]) await expect(page.getByTestId(`library-card-select-${id}`)).toBeChecked();
  await expect(page.getByTestId('library-card-select-1000')).not.toBeChecked();
  await page.getByTestId('library-page-2').click();
  await expect(page.getByTestId('library-card-select-1007')).toBeChecked();
  await expect(download).toBeEnabled();
});

test('선택 개수 — 현재 결과 선택과 다른 조건의 선택을 나눠 표시하고, 선택이 없으면 숨긴다', async ({ page }) => {
  const count = page.getByTestId('library-selected-count');
  const visible = page.getByTestId('library-selected-count-visible');
  const hidden = page.getByTestId('library-selected-count-hidden');
  const download = page.getByTestId('library-download');

  // 4. 선택 없음 → 숨김
  await expect(count).toHaveText('');
  await expect(visible).toHaveCount(0);
  await expect(hidden).toHaveCount(0);

  // 1. 현재 결과에서만 선택 → "N개 선택"(#707070, Label/LM_pt_rg_12 = 12 Regular −0.24)
  await page.getByTestId('library-card-select-9001').check();
  await page.getByTestId('library-card-select-9002').check();
  await page.getByTestId('library-card-select-9004').check();
  await expect(count).toHaveText('3개 선택');
  await expect(hidden).toHaveCount(0);
  await expect(visible).toHaveCSS('color', 'rgb(112, 112, 112)');
  await expect(visible).toHaveCSS('font-size', '12px');
  await expect(visible).toHaveCSS('font-weight', '400');
  await expect(visible).toHaveCSS('letter-spacing', '-0.24px');

  // 2. 미국(9003·9001) 결과 — 9001 1개 + 다른 조건 2개(9002·9004). 보조 문구도 text/secondary #707070
  //    (흰 배경 4.95:1, #999는 2.85:1로 AA 미달), 같은 Caption 12 Light
  await page.getByTestId('library-country-filter').selectOption('US');
  await expect(count).toHaveText('1개 선택 · 다른 조건에서 2개 선택됨');
  await expect(visible).toHaveText('1개 선택');
  await expect(hidden).toHaveText('다른 조건에서 2개 선택됨');
  await expect(hidden).toHaveCSS('color', 'rgb(112, 112, 112)');
  await expect(hidden).toHaveCSS('font-size', '12px');
  await expect(hidden).toHaveCSS('font-weight', '300');
  await expect(hidden).toHaveCSS('letter-spacing', '-0.48px');
  await expect(visible).toHaveCSS('font-weight', '400'); // 함께 보일 때도 현재 결과 선택 수는 Regular
  await expect(download).toBeEnabled();

  // 3. 현재 결과 선택 0 → 보조 문구만, 다운로드는 기존 정책대로 비활성
  await page.getByTestId('library-card-select-9001').uncheck();
  await expect(count).toHaveText('다른 조건에서 2개 선택됨');
  await expect(visible).toHaveCount(0);
  await expect(download).toBeDisabled();

  // 검색까지 겹쳐도 정확 — 결과 0건이면 전부 다른 조건
  await page.getByTestId('library-search').fill('없는 상품');
  await expect(page.getByTestId('library-filtered-empty')).toBeVisible();
  await expect(count).toHaveText('다른 조건에서 2개 선택됨');

  // 조건을 풀면 다시 현재 결과 2개, 보조 문구 사라짐
  await page.getByTestId('library-search').fill('');
  await page.getByTestId('library-country-filter').selectOption('');
  await expect(count).toHaveText('2개 선택');
  await expect(hidden).toHaveCount(0);
  await expect(download).toBeEnabled();
});

test('검색·필터 결과 0건이면 전체선택은 Disabled(Checkbox 28:74) — 클릭·키보드로 바뀌지 않고, 결과 밖 선택은 유지된다', async ({ page }) => {
  const selectAll = page.getByTestId('library-select-all');
  const selectAllLabel = page.getByTestId('library-select-all-label');
  const visual = page.locator('[data-testid="library-select-all"] + [data-checkbox-visual]');
  const count = page.getByTestId('library-selected-count');
  const download = page.getByTestId('library-download');

  await page.getByTestId('library-card-select-9002').check();
  await page.getByTestId('library-card-select-9004').check();
  await expect(selectAll).toBeEnabled();
  await expect(selectAllLabel).toHaveCSS('color', 'rgb(23, 23, 23)');

  // 결과 0건 → Disabled: box #F5F5F5 · border #EAEAEA, label #999
  await page.getByTestId('library-search').fill('없는 상품');
  await expect(page.getByTestId('library-filtered-empty')).toBeVisible();
  await expect(selectAll).toBeDisabled();
  await expect(selectAll).not.toBeChecked();
  await expect(visual).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(visual).toHaveCSS('border-top-color', 'rgb(234, 234, 234)');
  await expect(selectAllLabel).toHaveCSS('color', 'rgb(153, 153, 153)');
  await expect(count).toHaveText('다른 조건에서 2개 선택됨');
  await expect(download).toBeDisabled();

  // 클릭(체크박스·label)과 키보드로 바뀌지 않는다 — disabled라 Tab 순서에서도 빠진다
  await selectAll.click({ force: true });
  await selectAllLabel.click({ force: true });
  await expect(selectAll).not.toBeChecked();
  await page.getByTestId('library-search').focus();
  await page.keyboard.press('Space');
  await expect(selectAll).not.toBeFocused();
  await expect(selectAll).not.toBeChecked();
  await expect(count).toHaveText('다른 조건에서 2개 선택됨');

  // 조건을 풀면 전체선택은 다시 활성, 기존 선택이 그대로 보이고 선택 개수 = 다운로드 대상
  await page.getByTestId('library-search').fill('');
  await expect(selectAll).toBeEnabled();
  await expect(selectAllLabel).toHaveCSS('color', 'rgb(23, 23, 23)');
  await expect(page.getByTestId('library-card-select-9002')).toBeChecked();
  await expect(page.getByTestId('library-card-select-9004')).toBeChecked();
  await expect(page.getByTestId('library-card-select-9001')).not.toBeChecked();
  await expect(count).toHaveText('2개 선택');
  await expect(download).toBeEnabled();

  // 결과가 1건 이상이면 기존 전체선택·전체해제 그대로(현재 결과 전체 대상)
  await selectAll.check();
  await expect(count).toHaveText('4개 선택');
  await selectAll.uncheck();
  await expect(count).toHaveText('');
});

test('선택 개수에 다른 조건 문구가 붙어도 우측 action 위치와 필터 높이는 그대로다', async ({ page }) => {
  const actions = async () =>
    Promise.all(['library-select-all', 'library-download', 'library-delete'].map((id) => box(page.getByTestId(id))));
  const before = await actions();
  const searchBefore = await box(page.getByTestId('library-search'));

  await page.getByTestId('library-card-select-9002').check();
  await page.getByTestId('library-card-select-9004').check();
  await page.getByTestId('library-card-select-9001').check();
  await page.getByTestId('library-country-filter').selectOption('US');
  await expect(page.getByTestId('library-selected-count')).toHaveText('1개 선택 · 다른 조건에서 2개 선택됨');

  const after = await actions();
  for (let i = 0; i < before.length; i++) {
    near(after[i].x, before[i].x);
    near(after[i].y, before[i].y);
  }
  const searchAfter = await box(page.getByTestId('library-search'));
  expect(searchAfter.width).toBe(searchBefore.width); // 1920에서는 검색 폭도 줄지 않는다
  expect(searchAfter.height).toBe(searchBefore.height);
  const status = await box(page.getByTestId('library-selected-count'));
  expect(status.x + status.width).toBeLessThan(after[0].x); // 전체선택과 겹치지 않는다
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1920);
});

test('10페이지 이상이면 두 자리 번호를 이어 붙여도 pagination이 한 줄로 유지된다', async ({ page }) => {
  await openWithLibraryCards(page, 7 * 12 - 3); // 81건 → 12페이지
  const pag = page.getByTestId('library-pagination');
  expect(await pageLabels(page)).toEqual(['1', '2', '3', 'more', '12']);

  const layout = async () => {
    const nav = await box(pag);
    const buttons = await pag.locator('button, [data-testid="library-page-more"]').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { y: r.y, h: r.height, w: r.width, sw: el.scrollWidth, cw: el.clientWidth };
      }),
    );
    return { nav, buttons };
  };
  const check = async () => {
    const { nav, buttons } = await layout();
    expect(nav.height).toBe(28); // 한 줄
    for (const b of buttons) {
      expect(b.y).toBe(buttons[0].y);
      expect(b.h).toBe(28);
      expect(b.w).toBeGreaterThanOrEqual(28);
      expect(b.sw).toBeLessThanOrEqual(b.cw); // 숫자가 버튼 밖으로 넘치지 않는다
    }
    near(nav.x + nav.width / 2, 1920 / 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1920);
  };
  await check();
  // 두 자리 번호 버튼은 Glyph 2개(12×2) — 폭 28 안에 들어간다
  const twelve = await box(page.getByTestId('library-page-12'));
  expect(twelve.width).toBe(28);
  await expect(page.getByTestId('library-page-12').locator('[data-glyph-src]')).toHaveCount(2);

  // 가운데(1 … 10 … 12)와 마지막(1 … 10 11 12)
  await page.getByTestId('library-page-12').click();
  expect(await pageLabels(page)).toEqual(['1', 'more', '10', '11', '12']);
  await expect(page.getByTestId('library-page-12')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('library-page-next')).toBeDisabled();
  expect(await cardOrder(page)).toEqual(ids(77, 80));
  await check();
  await page.getByTestId('library-page-10').click();
  await page.getByTestId('library-page-prev').click();
  expect(await pageLabels(page)).toEqual(['1', 'more', '9', 'more', '12']);
  await check();
});

// ─────────────────────────────────────────────────────────────────
// 선택 visual — Checkbox/Compact Checked(1063:5146) + 선택된 카드 stroke(1056:9759)
// ─────────────────────────────────────────────────────────────────

const ORANGE = 'rgb(255, 106, 56)';
const GRAY = 'rgb(234, 234, 234)';
const checkboxVisual = (page: import('@playwright/test').Page, testId: string) =>
  page.getByTestId(testId).locator('xpath=following-sibling::span[1]');

test('카드 선택 시 checkbox와 카드 border가 #FF6A38, check glyph 표시 — 해제하면 #EAEAEA로 복귀', async ({ page }) => {
  const visual = checkboxVisual(page, 'library-card-select-9003');
  await expect(visual).toHaveCSS('border-top-color', GRAY);
  await expect(card(page, 9003)).toHaveCSS('border-top-color', GRAY);
  await expect(visual.getByTestId('checkbox-check-glyph')).toHaveCount(0);

  await page.getByTestId('library-card-select-9003').check();
  await expect(visual).toHaveCSS('border-top-color', ORANGE);
  await expect(visual.getByTestId('checkbox-check-glyph')).toBeVisible();
  const glyph = await box(visual.getByTestId('checkbox-check-glyph'));
  expect([glyph.width, glyph.height]).toEqual([16, 16]);
  await expect(card(page, 9003)).toHaveCSS('border-top-color', ORANGE);
  await expect(card(page, 9002)).toHaveCSS('border-top-color', GRAY);

  await page.getByTestId('library-card-select-9003').uncheck();
  await expect(visual).toHaveCSS('border-top-color', GRAY);
  await expect(card(page, 9003)).toHaveCSS('border-top-color', GRAY);
});

test('전체선택 시 전체선택 checkbox와 대상 카드 전부 #FF6A38', async ({ page }) => {
  await page.getByTestId('library-select-all').check();
  await expect(checkboxVisual(page, 'library-select-all')).toHaveCSS('border-top-color', ORANGE);
  await expect(checkboxVisual(page, 'library-select-all').getByTestId('checkbox-check-glyph')).toBeVisible();
  for (const id of [9001, 9002, 9003, 9004]) {
    await expect(card(page, id)).toHaveCSS('border-top-color', ORANGE);
  }
});

// ─────────────────────────────────────────────────────────────────
// 다운로드 모달 — Figma 1056:9744 / Modal 1069:11251. 묶음 다운로드 계약이 없어 모달 열고 닫기와
// 산출물 체크 선택까지만 검증한다(Footer 다운로드·개별 다운로드는 disabled).
// ─────────────────────────────────────────────────────────────────

test('다운로드 모달 — 열기, dim, 크기, 문구, 산출물 4행과 초기 선택, 토글, 취소/Escape 닫기, 선택 유지', async ({ page }) => {
  const download = page.getByTestId('library-download');
  await expect(download).toBeDisabled();
  await page.getByTestId('library-card-select-9003').check();
  await expect(download).toBeEnabled();

  await download.click();
  const modal = page.getByRole('dialog', { name: '해당 작업을 다운로드할까요?' });
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('library-download-dim')).toHaveCSS('background-color', 'rgba(23, 23, 23, 0.4)');
  const m = await box(modal);
  expect([m.width, m.height]).toEqual([420, 505]);
  await expect(modal.getByText('선택된 산출물을 다운로드 합니다.')).toBeVisible();

  const rows = [
    ['images', 'images/', true],
    ['html', 'HTML', true],
    ['csv', 'content.csv', false],
    ['psd', 'PSD', false],
  ] as const;
  // PSD는 N6와 같이 항상 비활성 — 선택할 수 없다
  await expect(page.getByTestId('library-download-output-psd')).toBeDisabled();
  await page.getByTestId('library-download-output-psd').click({ force: true });
  await expect(page.getByTestId('library-download-output-psd')).not.toBeChecked();
  await page.getByTestId('library-download-row-psd').getByText('PSD', { exact: true }).click({ force: true });
  await expect(page.getByTestId('library-download-output-psd')).not.toBeChecked();
  await expect(page.getByTestId('library-download-row-psd').getByText('PSD', { exact: true })).toHaveCSS('color', 'rgb(153, 153, 153)');
  for (const [key, name, initiallyChecked] of rows) {
    await expect(page.getByTestId(`library-download-row-${key}`)).toContainText(name);
    const input = page.getByTestId(`library-download-output-${key}`);
    if (initiallyChecked) await expect(input).toBeChecked();
    else await expect(input).not.toBeChecked();
    await expect(page.getByTestId(`library-download-single-${key}`)).toBeDisabled();
  }
  await expect(page.getByTestId('library-download-confirm')).toBeDisabled();

  // 산출물 체크는 FE local state로 토글된다
  await page.getByTestId('library-download-output-csv').check();
  await expect(page.getByTestId('library-download-output-csv')).toBeChecked();
  await expect(checkboxVisual(page, 'library-download-output-csv')).toHaveCSS('border-top-color', ORANGE);
  await page.getByTestId('library-download-output-images').uncheck();
  await expect(page.getByTestId('library-download-output-images')).not.toBeChecked();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1920);

  // 취소 → 닫힘, 카드 선택 유지
  await page.getByTestId('library-download-cancel').click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId('library-card-select-9003')).toBeChecked();
  await expect(card(page, 9003)).toHaveCSS('border-top-color', ORANGE);

  // Escape → 닫힘
  await download.click();
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId('library-card-select-9003')).toBeChecked();
});

test('다운로드 모달 — 1920은 Figma 위치(750, 287), 1600에서도 중앙이고 viewport 안', async ({ page }) => {
  await page.getByTestId('library-card-select-9003').check();
  await page.getByTestId('library-download').click();
  const m1920 = await box(page.getByTestId('library-download-modal'));
  near(m1920.x, 750);
  near(m1920.y, 287);

  await page.setViewportSize({ width: 1600, height: 900 });
  const m = await box(page.getByTestId('library-download-modal'));
  near(m.x + m.width / 2, 800);
  near(m.y + m.height / 2, 450);
  expect(m.y).toBeGreaterThanOrEqual(0);
  expect(m.y + m.height).toBeLessThanOrEqual(900);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1600);
});

test('다운로드 모달 접근성 — dialog 의미, 이름·설명, 열릴 때 포커스, Tab/Shift+Tab trap, 닫힌 뒤 포커스 복귀', async ({ page }) => {
  await page.getByTestId('library-card-select-9003').check();
  const download = page.getByTestId('library-download');
  await download.click();

  const dialog = page.getByRole('dialog', { name: '해당 작업을 다운로드할까요?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveAccessibleDescription('선택된 산출물을 다운로드 합니다.');

  const focusInsideDialog = () =>
    page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!d && d.contains(document.activeElement);
    });
  expect(await focusInsideDialog()).toBe(true);

  // 활성 control(체크 4개 + 취소)을 넘어서 여러 번 Tab/Shift+Tab 해도 배경으로 빠지지 않는다
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    expect(await focusInsideDialog()).toBe(true);
  }
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInsideDialog()).toBe(true);
  }

  // Escape → 닫힘 → 상단 다운로드로 포커스 복귀
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(download).toBeFocused();

  // 취소 → 닫힘 → 상단 다운로드로 포커스 복귀
  await download.click();
  await expect(dialog).toBeVisible();
  await page.getByTestId('library-download-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(download).toBeFocused();
});

test('다운로드 모달 키보드 — 브라우저 기본 Tab과 무관하게 같은 순서로 순환(PSD·비활성 버튼 제외), 배경 inert, 반복 열기/닫기', async ({ page }) => {
  await page.getByTestId('library-card-select-9003').check();
  const download = page.getByTestId('library-download');
  const dialog = page.getByRole('dialog', { name: '해당 작업을 다운로드할까요?' });
  const active = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? document.activeElement?.tagName);
  // 활성 control = 체크 3개(images/·HTML·content.csv) + 취소. PSD·다운로드·개별 다운로드는 disabled라 빠진다.
  const order = ['library-download-output-images', 'library-download-output-html', 'library-download-output-csv', 'library-download-cancel'];

  for (let round = 0; round < 3; round += 1) {
    await download.click();
    await expect(dialog).toBeVisible();

    // 배경은 inert — 검색·필터·카드·전체선택이 inert 영역 안, 모달은 밖
    for (const id of ['library-search', 'library-country-filter', 'library-select-all', 'library-card-select-9003', 'library-download']) {
      expect(await page.getByTestId(id).evaluate((el) => !!el.closest('[inert]'))).toBe(true);
    }
    expect(await page.getByTestId('library-download-modal').evaluate((el) => !!el.closest('[inert]'))).toBe(false);

    // Tab: 첫 control부터 끝까지, 마지막에서 처음으로
    const forward: (string | undefined)[] = [];
    for (let i = 0; i < order.length * 2; i += 1) {
      await page.keyboard.press('Tab');
      forward.push(await active());
    }
    expect(forward).toEqual([...order, ...order]);

    // Shift+Tab: 처음(images/)에서 마지막(취소)으로, 역순
    await page.getByTestId(order[0]).focus();
    const backward: (string | undefined)[] = [];
    for (let i = 0; i < order.length; i += 1) {
      await page.keyboard.press('Shift+Tab');
      backward.push(await active());
    }
    expect(backward).toEqual([...order].reverse());
    expect(backward).not.toContain('library-download-output-psd');

    // 닫기: 홀수 회차는 Escape, 짝수 회차는 취소 — 어느 쪽이든 다운로드 버튼으로 복귀, inert 해제
    if (round % 2 === 0) await page.keyboard.press('Escape');
    else await page.getByTestId('library-download-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(download).toBeFocused();
    expect(await page.locator('[inert]').count()).toBe(0);
  }

  // 닫힌 뒤 배경 키보드 조작 복구 — 검색에 입력하고, 카드 checkbox를 Space로 토글
  await page.getByTestId('library-search').focus();
  await page.keyboard.type('토너');
  await expect(page.getByTestId('library-search')).toHaveValue('토너');
  await page.getByTestId('library-card-select-9004').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('library-card-select-9004')).toBeChecked();
  // 선택 상태·선택 개수는 모달 열기/닫기 전후로 그대로(9003은 결과 밖으로 가려졌을 뿐 유지)
  await expect(page.getByTestId('library-selected-count')).toHaveText('1개 선택 · 다른 조건에서 1개 선택됨');
});

test('다운로드 모달 — 연 버튼이 닫힐 때 비활성이면 화면 제목으로 포커스가 간다', async ({ page }) => {
  await page.getByTestId('library-card-select-9003').check();
  const download = page.getByTestId('library-download');
  await download.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // 정상 UI로는 모달이 열린 동안 선택을 바꿀 수 없어(배경 inert) DOM에서 직접 비활성으로 만든다
  await download.evaluate((el) => el.setAttribute('disabled', ''));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '보관함' })).toBeFocused();
});

test('다운로드 모달 — 열린 동안 배경 스크롤 잠금, 닫으면 원래 overflow 복구, dim 클릭으로는 닫히지 않음', async ({ page }) => {
  // 1600×700은 내용(카드 2줄 + 아래 여백)이 viewport보다 길어 실제로 세로 스크롤이 생긴다
  // (4건은 pagination이 없어 1600×900에서는 스크롤이 생기지 않는다)
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.getByTestId('library-card-select-9003').check();
  const before = await page.evaluate(() => document.body.style.overflow);

  await page.getByTestId('library-download').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(100, 800);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // dim(모달 바깥) 클릭 — Figma에 닫기 동작이 없어 그대로 열려 있다
  await page.mouse.click(40, 450);
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(before);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
});
