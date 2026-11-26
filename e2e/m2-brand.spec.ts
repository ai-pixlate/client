import { test, expect, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// M2 브랜드 정보 (Figma 743:6039) — Brand API(GET·PATCH /brands/{brandId}, 로고 GET·POST·DELETE)를 MSW Mock 으로 탄다.
//
// ★ Mock 은 실제 계약 모양으로 응답하지만 실서버 검증이 아니다. 저장하지 않는 흐름에서는 쓰기 요청(PATCH·POST·DELETE)이
//   나가지 않아야 한다(allowWrites 를 켠 테스트만 쓴다). API 연결 동작 자체는 e2e/m2-brand-api.spec.ts 가 본다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

// 1×1 투명 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const pngFile = (name = 'new-logo.png') => ({ name, mimeType: 'image/png', buffer: PNG });

const status = (page: Page) => page.getByTestId('m2-brand');
const logoCards = (page: Page) => page.getByTestId('m2-logo-card');

/** 최신 Figma(2026-11)에는 [정보수정]이 없다 — M2 는 처음부터 편집 상태다. 진입 직후 깨끗한 편집 상태인지만 확인한다 */
async function enterEdit(page: Page) {
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
}

/** 브랜드·로고 쓰기 요청(PATCH·POST·DELETE). 조회(GET)는 화면 정본이라 늘 나간다 */
let brandApiRequests: string[];
let allowWrites: boolean;

test.beforeEach(async ({ page }) => {
  brandApiRequests = [];
  allowWrites = false;
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() !== 'GET' && /^\/(v1\/)?brands(\/|$)/.test(pathname)) brandApiRequests.push(`${request.method()} ${pathname}`);
  });
  await page.goto('/brand');
  await expect(page.getByRole('heading', { name: '브랜드 정보' })).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
});

test.afterEach(() => {
  if (!allowWrites) expect(brandApiRequests).toEqual([]);
});

test('처음부터 편집 상태로 저장된 Mock 값을 보여 준다 — 최신 Figma 에는 [정보수정]·읽기 전용 보기가 없다', async ({ page }) => {
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
  await expect(status(page)).toHaveAttribute('data-persistence', 'api');
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('픽슬레이트');
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate');
  await expect(page.getByTestId('m2-overview')).toHaveValue(/자연 유래 성분/);
  await expect(page.getByTestId('m2-target-customer')).toHaveValue(/20–30대/);

  for (const field of ['m2-name-ko', 'm2-name-en', 'm2-overview', 'm2-target-customer']) {
    await expect(page.getByTestId(field)).toBeEditable();
  }
  await expect(logoCards(page)).toHaveCount(2);
  for (const image of await page.getByTestId('m2-logo-image').all()) {
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByTestId('m2-logo-uploader')).toBeVisible();
  await expect(page.getByRole('button', { name: '브랜드 로고 1 삭제' })).toBeVisible();
  await expect(page.getByTestId('m2-save')).toBeDisabled();
  await expect(page.getByTestId('m2-cancel')).toBeEnabled();
  await expect(page.getByTestId('m2-apply-notice')).toHaveText(
    '변경한 브랜드 정보는 새로 시작하는 작업부터 적용되며, 이미 완료된 작업에는 자동 반영되지 않습니다.',
  );

  // 최신 Figma 에서 사라진 것
  for (const testId of ['m2-edit', 'm2-back', 'm2-new-brand', 'm2-header-divider']) {
    await expect(page.getByTestId(testId)).toHaveCount(0);
  }
  // 공통 헤더 — 화면명 「브랜드 정보」
  await expect(page.getByTestId('app-header-title')).toHaveText('브랜드 정보');

  // 범위 밖이거나 PRD와 다른 Figma 항목
  await expect(page.getByText('부가 정보')).toHaveCount(0);
  await expect(page.getByText(/벡터/)).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('값을 고치면 dirty, 원래 값으로 돌리면 다시 clean이다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-name-en').fill('Pixlate Labs');
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');
  await expect(page.getByTestId('m2-save')).toBeEnabled();
  await page.getByTestId('m2-name-en').fill('Pixlate');
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
  await expect(page.getByTestId('m2-save')).toBeDisabled();
});

test('취소하면 baseline으로 돌아간다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-overview').fill('다른 개요');
  await page.getByTestId('m2-cancel').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
  await expect(page.getByTestId('m2-overview')).toHaveValue(/자연 유래 성분/);
});

test('저장은 서버 응답을 새 baseline으로 쓰고, 새로고침하면 Mock 서버 상태가 fixture로 돌아간다', async ({ page }) => {
  allowWrites = true;
  await enterEdit(page);
  await page.getByTestId('m2-name-en').fill('  Pixlate Labs ');
  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate Labs');

  // 저장된 값이 새 baseline이다
  await enterEdit(page);
  await page.getByTestId('m2-name-en').fill('Other');
  await page.getByTestId('m2-cancel').click();
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate Labs');

  // Mock 서버 상태는 페이지 메모리에만 있어 새로고침하면 fixture 로 돌아간다(실서버라면 남는다)
  await page.reload();
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate');
});

for (const [testId, errorText] of [
  ['m2-name-ko', '한글 브랜드명을 입력해주세요.'],
  ['m2-name-en', '영문 브랜드명을 입력해주세요.'],
] as const) {
  test(`${testId}가 비거나 공백이면 저장할 수 없고 이유를 보여 준다`, async ({ page }) => {
    await enterEdit(page);
    for (const empty of ['', '   ']) {
      await page.getByTestId(testId).fill(empty);
      await expect(page.getByTestId('m2-save')).toBeDisabled();
      await expect(page.getByTestId(`${testId}-error`)).toHaveText(errorText);
      await expect(page.getByTestId(testId)).toHaveAttribute('aria-invalid', 'true');
    }
    await page.getByTestId(testId).fill('값');
    await expect(page.getByTestId(`${testId}-error`)).toHaveCount(0);
    await expect(page.getByTestId('m2-save')).toBeEnabled();
  });
}

for (const testId of ['m2-overview', 'm2-target-customer']) {
  test(`${testId}는 비어도 저장할 수 있다`, async ({ page }) => {
    allowWrites = true;
    await enterEdit(page);
    await page.getByTestId(testId).fill('');
    await expect(page.getByTestId('m2-save')).toBeEnabled();
    await page.getByTestId('m2-save').click();
    await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
    await expect(page.getByTestId(testId)).toHaveValue('');
    // 저장 뒤에도 편집 상태라 비운 칸은 편집 안내(F-TRN-02b 중립 톤)를 보인다
    await expect(page.getByTestId(testId)).toHaveAttribute('placeholder', '비워 두면 중립 톤으로 번역합니다.');
  });
}

test('로고를 추가하면 draft에만 들어가고, 저장해야 확정된다', async ({ page }) => {
  allowWrites = true;
  await enterEdit(page);
  await page.getByTestId('m2-logo-input').setInputFiles([pngFile('a.png'), pngFile('b.png')]);
  await expect(logoCards(page)).toHaveCount(4);
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');
  const added = page.getByRole('img', { name: 'a.png' });
  await expect(added).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => added.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  expect(brandApiRequests).toEqual([]);

  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
  await expect(logoCards(page)).toHaveCount(4);
  // 저장 뒤에는 서버 로고(Mock 은 data: URL)로 바뀌고 서버 순서 번호로 부른다
  const saved = page.getByRole('img', { name: '브랜드 로고 4' });
  await expect(saved).not.toHaveAttribute('src', /^blob:/);
  await expect.poll(() => saved.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  expect(brandApiRequests.filter((r) => r.startsWith('POST'))).toHaveLength(2);
});

test('로고를 삭제하면 draft에서 빠지고 포커스가 파일 선택으로 옮겨 간다', async ({ page }) => {
  await enterEdit(page);
  await page.getByRole('button', { name: '브랜드 로고 2 삭제' }).click();
  await expect(logoCards(page)).toHaveCount(1);
  await expect(page.getByRole('img', { name: '브랜드 로고 2' })).toHaveCount(0);
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');
  await expect(page.getByRole('button', { name: '파일 선택' })).toBeFocused();
});

test('취소하면 추가·삭제한 로고가 원래대로 돌아온다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-logo-input').setInputFiles(pngFile());
  await page.getByRole('button', { name: '브랜드 로고 1 삭제' }).click();
  await page.getByRole('button', { name: '브랜드 로고 2 삭제' }).click();
  await expect(logoCards(page)).toHaveCount(1);
  await page.getByTestId('m2-cancel').click();
  await expect(logoCards(page)).toHaveCount(2);
  await expect(page.getByRole('img', { name: '브랜드 로고 1' })).toBeVisible();
  await expect(page.getByRole('img', { name: '브랜드 로고 2' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'new-logo.png' })).toHaveCount(0);
});

test('허용되지 않는 파일은 추가되지 않고 Invalid 상태를 보여 주며, 다시 고르면 풀린다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-logo-input').setInputFiles({ name: 'logo.ai', mimeType: 'application/postscript', buffer: PNG });
  const uploader = page.getByTestId('m2-logo-uploader');
  await expect(uploader).toHaveAttribute('data-state', 'invalid');
  await expect(uploader.getByRole('alert')).toContainText('업로드할 수 없는 파일입니다.');
  await expect(uploader.getByRole('button', { name: '다시 선택' })).toBeVisible();
  await expect(logoCards(page)).toHaveCount(2);
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');

  await page.getByTestId('m2-logo-input').setInputFiles(pngFile());
  await expect(uploader).toHaveAttribute('data-state', 'default');
  await expect(logoCards(page)).toHaveCount(3);
});

test('로고가 많아져도 로고 목록만 스크롤하고 화면과 파일 선택은 그대로다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-logo-input').setInputFiles(['1', '2', '3', '4', '5', '6'].map((n) => pngFile(`${n}.png`)));
  await expect(logoCards(page)).toHaveCount(8);
  await expect(page.getByRole('button', { name: '파일 선택' })).toBeInViewport();
  await expect(page.getByTestId('m2-save')).toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(overflow).toBe(0);
});

test('변경이 있을 때 헤더 이동은 확인창을 열고, 실제 변경 항목만 보여 준다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-name-en').fill('Pixlate Labs');
  await page.getByTestId('m2-overview').fill('새 개요');
  await page.getByTestId('m2-logo-input').setInputFiles(pngFile());
  await page.getByTestId('app-header-brand').click();

  const dialog = page.getByTestId('m2-unsaved-dialog');
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/brand$/);
  await expect(page.getByTestId('m2-unsaved-changes').getByRole('listitem')).toHaveText([
    '영문 브랜드명',
    '브랜드 개요',
    '로고 1개 추가',
  ]);
  await expect(dialog.getByRole('button')).toHaveText(['계속 수정', '변경사항 버리고 나가기']);

  // 계속 수정: 입력이 그대로 남는다
  await dialog.getByRole('button', { name: '계속 수정' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate Labs');
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');

  // Escape도 머무름이다
  await page.getByTestId('app-header-home').click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/brand$/);

  // 버리고 나가기: 누른 링크(브랜드 관리 → M0)로 이동한다
  await page.getByTestId('app-header-brand').click();
  await dialog.getByRole('button', { name: '변경사항 버리고 나가기' }).click();
  await expect(page).toHaveURL(/\/brand\/select$/);
  await expect(page.getByTestId('app-header-title')).toHaveText('브랜드 선택');
});

test('변경이 없으면 헤더 이동은 바로 된다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('app-header-brand').click();
  await expect(page).toHaveURL(/\/brand\/select$/);
  await expect(page.getByTestId('m2-unsaved-dialog')).toHaveCount(0);
});

test('변경이 있을 때 헤더 [로그아웃]도 확인창을 거치고, 계속 수정하면 로그아웃하지 않는다', async ({ page }) => {
  await page.getByTestId('m2-name-ko').fill('새 이름');
  await page.getByTestId('account-logout').click();
  const dialog = page.getByTestId('m2-unsaved-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '계속 수정' }).click();
  await expect(page).toHaveURL(/\/brand$/);
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('새 이름');

  await page.getByTestId('account-logout').click();
  await dialog.getByRole('button', { name: '변경사항 버리고 나가기' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('변경이 있을 때 내부 링크 이동도 막고, 버리면 그 링크로 간다', async ({ page }) => {
  await enterEdit(page);
  await page.evaluate(() => {
    // GNB가 아직 없어 화면 밖 내부 링크를 흉내 낸다
    const link = document.createElement('a');
    link.href = '/jobs/new';
    link.textContent = '외부 링크 대용';
    link.dataset.testid = 'injected-link';
    document.body.appendChild(link);
  });
  await page.getByTestId('m2-target-customer').fill('새 고객');
  await page.getByTestId('injected-link').click();
  await expect(page.getByTestId('m2-unsaved-dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/brand$/);
  await expect(page.getByTestId('m2-unsaved-changes').getByRole('listitem')).toHaveText(['핵심 고객층']);
  await page.getByRole('button', { name: '변경사항 버리고 나가기' }).click();
  await expect(page).toHaveURL(/\/jobs\/new$/);
});

test('변경이 있을 때 브라우저 뒤로가기도 막고, 저장 뒤에는 한 번에 돌아간다', async ({ page }) => {
  allowWrites = true;
  await page.goto('/');
  await page.goto('/brand');
  await enterEdit(page);
  await page.getByTestId('m2-name-ko').fill('새 이름');
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');

  await page.evaluate(() => window.history.back());
  const dialog = page.getByTestId('m2-unsaved-dialog');
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/brand$/);
  await dialog.getByRole('button', { name: '계속 수정' }).click();
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('새 이름');

  // 다시 눌러도 또 막힌다
  await page.evaluate(() => window.history.back());
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '계속 수정' }).click();

  // 저장하면 가드 항목이 걷혀 뒤로가기 한 번에 이전 화면이다
  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(/\/$/);
});

test('브라우저 뒤로가기에서 변경을 버리면 이전 화면으로 돌아간다', async ({ page }) => {
  await page.goto('/');
  await page.goto('/brand');
  await enterEdit(page);
  await page.getByTestId('m2-name-ko').fill('새 이름');
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');
  await page.evaluate(() => window.history.back());
  await page.getByRole('button', { name: '변경사항 버리고 나가기' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
});

test('1440×640(최소 높이)에서도 가로로 넘치지 않고 저장 버튼이 보이며, 넘치는 폼은 자체 스크롤한다', async ({ page }) => {
  // 최신 Figma 는 섹션 사이 Divider 가 없어 폼이 짧다 — 800 높이에서는 넘치지 않아 최소 높이(640)에서 확인한다
  await page.setViewportSize({ width: 1440, height: 640 });
  await enterEdit(page);
  await expect(page.getByTestId('m2-save')).toBeInViewport();
  const horizontal = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontal).toBe(0);
  const formOverflow = await page.getByTestId('m2-form').evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(formOverflow).toBeGreaterThan(0);
});

test('1920×1080 레이아웃이 Figma 743:6039(2026-11) 좌표와 맞다', async ({ page }) => {
  const box = async (testId: string) => (await page.getByTestId(testId).boundingBox())!;

  const header = await box('app-header');
  expect([header.x, header.y, header.width, header.height]).toEqual([0, 0, 1920, 72]);

  const form = await box('m2-form');
  expect([form.x, form.y, form.width]).toEqual([120, 96, 972]);

  const nameKo = await box('m2-name-ko');
  expect([nameKo.x, nameKo.y, nameKo.width, nameKo.height]).toEqual([120, 152, 405, 40]);
  const nameEn = await box('m2-name-en');
  expect([nameEn.x, nameEn.y]).toEqual([687, 152]);

  const overview = await box('m2-overview');
  expect([overview.y, overview.height]).toEqual([284, 132]);
  const targetCustomer = await box('m2-target-customer');
  expect([targetCustomer.y, targetCustomer.height]).toEqual([508, 112]);

  const panel = await box('m2-logo-panel');
  expect([panel.x, panel.y, panel.width]).toEqual([1232, 96, 568]);
  const card = (await logoCards(page).first().boundingBox())!;
  expect([card.x, card.y, card.width, card.height]).toEqual([1232, 148, 568, 200]);
  const uploader = await box('m2-logo-uploader');
  expect([uploader.y, uploader.height]).toEqual([564, 107]);

  // 왼쪽 폼은 내용이 짧아 스크롤이 없다
  const formOverflow = await page.getByTestId('m2-form').evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(formOverflow).toBe(0);

  const footer = await box('m2-footer');
  expect([footer.x, footer.y, footer.width, footer.height]).toEqual([1112, 991, 688, 37]);
  const save = await box('m2-save');
  expect([save.x + save.width, save.y + save.height]).toEqual([1800, 1028]);
  expect(Math.abs(save.width - 130)).toBeLessThanOrEqual(1);
  const cancel = await box('m2-cancel');
  expect(Math.abs(cancel.width - 80)).toBeLessThanOrEqual(1);
  expect(Math.round(save.x - (cancel.x + cancel.width))).toBe(8);
});

/** DOM 실측 가로 값 */
async function horizontalGeometry(page: Page) {
  return page.evaluate(() => {
    const rect = (id: string) => document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
    const scroller = document.querySelector('[data-testid=m2-form]')!;
    const columns = rect('m2-columns');
    const form = rect('m2-form');
    const panel = rect('m2-logo-panel');
    const ko = rect('m2-name-ko');
    const en = rect('m2-name-en');
    const card = document.querySelector('[data-testid=m2-logo-card]')!.getBoundingClientRect();
    return {
      contentLeft: columns.x,
      contentWidth: columns.width,
      formX: form.x,
      formWidth: form.width,
      formInnerWidth: scroller.clientWidth,
      centerGap: panel.x - form.right,
      panelX: panel.x,
      panelWidth: panel.width,
      cardX: card.x,
      cardWidth: card.width,
      cardHeight: card.height,
      koWidth: ko.width,
      koHeight: ko.height,
      nameGap: en.x - ko.right,
      enWidth: en.width,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

test('1920×1080 가로 비율은 972 : 140 : 568 과 405 : 162 : 405 다', async ({ page }) => {
  const g = await horizontalGeometry(page);
  console.log(`[m2-width] 1920×1080 ${JSON.stringify(g)}`);
  expect([g.contentLeft, g.contentWidth]).toEqual([120, 1680]);
  expect([g.formX, g.formWidth, g.centerGap]).toEqual([120, 972, 140]);
  expect([g.panelX, g.panelWidth]).toEqual([1232, 568]);
  expect([g.cardX, g.cardWidth, g.cardHeight]).toEqual([1232, 568, 200]);
  expect([g.koWidth, g.nameGap, g.enWidth]).toEqual([405, 162, 405]);
  expect(g.overflowX).toBe(0);
});

for (const [width, height] of [[1728, 885], [1512, 860], [1440, 900], [1280, 720]] as const) {
  test(`${width}×${height} 가로 치수가 같은 배율로 줄고 넘치지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const g = await horizontalGeometry(page);
    const scale = (width - 240) / 1680;
    console.log(`[m2-width] ${width}×${height} scale ${scale.toFixed(4)} ${JSON.stringify(g)}`);
    expect(g.contentLeft).toBe(120);
    expect(g.contentWidth).toBe(width - 240);
    const close = (actual: number, expected: number, name: string) => expect(Math.abs(actual - expected), name).toBeLessThanOrEqual(1);
    close(g.formWidth, 972 * scale, 'form');
    close(g.centerGap, 140 * scale, 'gap');
    close(g.panelWidth, 568 * scale, 'panel');
    close(g.cardWidth, 568 * scale, 'card');
    // 세로 스크롤막대가 있으면 폼 안쪽 폭을 기준으로 같은 405 : 162 : 405 다
    const inner = g.formInnerWidth / 972;
    close(g.koWidth, 405 * inner, 'nameKo');
    close(g.nameGap, 162 * inner, 'nameGap');
    close(g.enWidth, 405 * inner, 'nameEn');
    expect(g.koWidth).toBeGreaterThanOrEqual(160);
    // 높이는 줄이지 않는다
    expect(g.koHeight).toBe(40);
    expect(g.cardHeight).toBe(200);
    expect(g.overflowX).toBe(0);
    await expect(page.getByTestId('m2-overview')).toHaveCSS('height', '132px');
    await expect(page.getByTestId('m2-target-customer')).toHaveCSS('height', '112px');
    await expect(page.getByTestId('m2-name-ko')).toHaveCSS('font-size', '14px');
    await expect(page.getByTestId('m2-save')).toBeInViewport();
  });
}

test('좁은 화면에서도 비율을 유지하고 로고 카드가 찌그러지지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const g = await horizontalGeometry(page);
  expect(g.centerGap).toBeGreaterThan(80);
  expect(g.nameGap).toBeGreaterThan(100);
  expect(g.overflowX).toBe(0);
  const image = (await page.getByTestId('m2-logo-image').first().boundingBox())!;
  const card = (await logoCards(page).first().boundingBox())!;
  expect(image.x).toBeGreaterThanOrEqual(card.x);
  expect(image.x + image.width).toBeLessThanOrEqual(card.x + card.width);
  await expect(page.getByTestId('m2-logo-image').first()).toHaveCSS('object-fit', 'contain');
  const uploader = (await page.getByTestId('m2-logo-uploader').boundingBox())!;
  expect(uploader.x + uploader.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
});

const UNCONNECTED_BUTTONS = [
  { testId: 'm2-delete-brand', text: '브랜드 삭제', border: 'rgb(229, 72, 77)', color: 'rgb(229, 72, 77)' },
  { testId: 'm2-logo-change', text: '로고 변경', border: 'rgb(234, 234, 234)', color: 'rgb(23, 23, 23)' },
  { testId: 'm2-logo-delete-action', text: '삭제', border: 'rgb(229, 72, 77)', color: 'rgb(229, 72, 77)' },
];

test('왼쪽 폼은 스크롤막대가 보이지 않지만 휠과 키보드로 스크롤된다', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 640 });
  const form = page.getByTestId('m2-form');
  const metrics = () =>
    form.evaluate((el) => ({
      scrollTop: el.scrollTop,
      scrollable: el.scrollHeight > el.clientHeight,
      bar: el.getBoundingClientRect().width - el.clientWidth,
      overflowY: getComputedStyle(el).overflowY,
      scrollbarWidth: getComputedStyle(el).scrollbarWidth,
      webkitBar: getComputedStyle(el, '::-webkit-scrollbar').display,
    }));
  const before = await metrics();
  expect(before).toMatchObject({ scrollTop: 0, scrollable: true, overflowY: 'auto', scrollbarWidth: 'none', webkitBar: 'none' });
  expect(before.bar).toBeLessThan(1);

  await form.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await metrics()).scrollTop).toBeGreaterThan(0);

  await form.evaluate((el) => el.scrollTo(0, 0));
  await page.getByTestId('m2-target-customer').focus();
  await expect.poll(async () => (await metrics()).scrollTop).toBeGreaterThan(0);

  // 페이지 전체가 아니라 폼만 움직인다
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('미연결 버튼은 enabled 모습으로 Figma 위치·크기에 있다', async ({ page }) => {
  for (const { testId, text, border, color } of UNCONNECTED_BUTTONS) {
    const button = page.getByTestId(testId);
    await expect(button).toHaveText(text);
    await expect(button).toBeVisible();
    await expect(button).toHaveCSS('opacity', '1');
    await expect(button).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(button).toHaveCSS('border-color', border);
    await expect(button).toHaveCSS('color', color);
    await expect(button).toHaveCSS('border-radius', '4px');
    await expect(button).toHaveCSS('font-size', '12px');
    expect(await button.evaluate((el: HTMLButtonElement) => [el.disabled, el.type, getComputedStyle(el).cursor])).toEqual([false, 'button', 'default']);
  }
  const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
  const deleteBrand = await box('m2-delete-brand');
  const change = await box('m2-logo-change');
  const remove = await box('m2-logo-delete-action');
  console.log(`[m2-buttons] ${JSON.stringify({ deleteBrand, change, remove })}`);
  // Figma 743:6121 — x120 · y996 · 94×30
  expect([deleteBrand.x, deleteBrand.y, deleteBrand.height]).toEqual([120, 996, 30]);
  expect(Math.abs(deleteBrand.width - 94)).toBeLessThanOrEqual(1);
  // Figma 로고 액션(1809:38545) — y96, 로고 변경 68 · gap 8 · 삭제 45, 오른쪽 끝 1800
  expect([change.y, change.height, remove.height]).toEqual([96, 24, 24]);
  expect(Math.abs(change.width - 68)).toBeLessThanOrEqual(1);
  expect(Math.abs(remove.width - 45)).toBeLessThanOrEqual(1);
  expect(Math.round(remove.x - (change.x + change.width))).toBe(8);
  expect(remove.x + remove.width).toBe(1800);
});

for (const mode of ['edit-clean', 'edit-dirty'] as const) {
  test(`${mode} 에서 미연결 버튼을 눌러도 요청·이동·상태 변화가 없다`, async ({ page }) => {
    if (mode === 'edit-dirty') await page.getByTestId('m2-name-ko').fill('변경한 이름');
    const url = page.url();
    const logoCount = await logoCards(page).count();
    const nameKo = await page.getByTestId('m2-name-ko').inputValue();
    const requests: string[] = [];
    page.on('request', (r) => {
      if (!/\/_next\/|\.(png|svg|jpg)$/.test(r.url())) requests.push(`${r.method()} ${r.url()}`);
    });

    for (const { testId } of UNCONNECTED_BUTTONS) {
      const button = page.getByTestId(testId);
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      // aria-disabled 는 Playwright 가 비활성으로 봐서 force 로 실제 클릭을 보낸다
      await button.click({ force: true });
    }
    await page.waitForTimeout(200);

    expect(page.url()).toBe(url);
    expect(requests).toEqual([]);
    expect(brandApiRequests).toEqual([]);
    await expect(logoCards(page)).toHaveCount(logoCount);
    await expect(page.getByTestId('m2-name-ko')).toHaveValue(nameKo);
    await expect(status(page)).toHaveAttribute('data-m2-status', mode);
    await expect(page.getByTestId('m2-unsaved-dialog')).toHaveCount(0);
    await expect(status(page).getByRole('alert')).toHaveCount(0);
  });
}

test('미연결 버튼도 키보드 포커스가 보인다', async ({ page }) => {
  const button = page.getByTestId('m2-logo-change');
  await page.getByTestId('m2-target-customer').focus();
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('outline-style', 'solid');
});

const FUTURE_BUTTONS = ['m2-delete-brand', 'm2-logo-change'];
const tooltip = (page: Page) => page.getByRole('tooltip');

const VIEWPORTS = [[1920, 1080], [1728, 885], [1512, 860], [1440, 900], [1280, 720]] as const;

for (const [width, height] of VIEWPORTS) {
  test(`${width}×${height} 안내와 버튼이 Figma 묶음(688)으로 오른쪽 120 · 아래 52 에 있다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const notice = (await page.getByTestId('m2-apply-notice').boundingBox())!;
    const cancel = (await page.getByTestId('m2-cancel').boundingBox())!;
    const save = (await page.getByTestId('m2-save').boundingBox())!;
    const footer = (await page.getByTestId('m2-footer').boundingBox())!;
    const form = (await page.getByTestId('m2-form').boundingBox())!;
    const deleteBrand = (await page.getByTestId('m2-delete-brand').boundingBox())!;
    expect(footer.width).toBe(688);
    expect(footer.x).toBe(notice.x);
    expect(footer.x + footer.width).toBe(width - 120);
    expect(footer.y + footer.height).toBe(height - 52);
    expect(notice.height).toBeLessThan(20);
    expect(notice.x + notice.width).toBeLessThanOrEqual(cancel.x);
    expect(cancel.x + cancel.width).toBeLessThanOrEqual(save.x);
    expect(save.x + save.width).toBe(width - 120);
    expect(deleteBrand.y).toBeGreaterThanOrEqual(form.y + form.height);
    expect(deleteBrand.x + deleteBrand.width).toBeLessThan(footer.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });
}

for (const testId of FUTURE_BUTTONS) {
  test(`${testId} 는 hover 와 키보드 focus 에 3차 구현 예정을 보여 주고 벗어나면 사라진다`, async ({ page }) => {
    const button = page.getByTestId(testId);
    await expect(tooltip(page)).toHaveCount(0);

    await button.hover();
    await expect(tooltip(page)).toHaveCount(1);
    await expect(tooltip(page)).toHaveText('3차 구현 예정');
    const hint = (await tooltip(page).boundingBox())!;
    const box = (await button.boundingBox())!;
    expect(hint.y + hint.height).toBeLessThanOrEqual(box.y);
    expect(hint.x).toBeGreaterThanOrEqual(0);
    await expect(tooltip(page)).toHaveCSS('background-color', 'rgb(23, 23, 23)');
    await expect(tooltip(page)).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(button).toHaveCSS('opacity', '1');
    await expect(button).toHaveAccessibleDescription('3차 구현 예정');
    await page.mouse.move(5, 5);
    await expect(tooltip(page)).toHaveCount(0);

    // 키보드로 이동해 포커스한다
    await page.evaluate((id) => {
      const target = document.querySelector<HTMLElement>(`[data-testid=${id}]`)!;
      // 숨은 파일 input 은 포커스를 받지 않으므로 화면에 보이는 조작만 센다
      const focusable = Array.from(document.querySelectorAll<HTMLElement>('button, input, textarea')).filter(
        (el) => !el.hidden && el.getClientRects().length > 0,
      );
      focusable[focusable.indexOf(target) - 1]?.focus();
    }, testId);
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expect(tooltip(page)).toHaveText('3차 구현 예정');
    await page.keyboard.press('Tab');
    await expect(tooltip(page)).toHaveCount(0);

    // 마우스로 눌러도 포인터가 벗어나면 남지 않고, 눌러도 동작이 없다
    await button.click({ force: true });
    await page.mouse.move(5, 5);
    await expect(tooltip(page)).toHaveCount(0);
    expect(brandApiRequests).toEqual([]);
  });
}

test('현재 범위 버튼에는 3차 구현 예정이 없다', async ({ page }) => {
  for (const locator of [
    page.getByTestId('m2-cancel'),
    page.getByRole('button', { name: '브랜드 로고 2 삭제' }),
    page.getByRole('button', { name: '파일 선택' }),
    page.getByTestId('m2-logo-delete-action'),
  ]) {
    await locator.hover({ force: true });
    await expect(tooltip(page)).toHaveCount(0);
    await locator.focus();
    await expect(tooltip(page)).toHaveCount(0);
  }
  await expect(page.getByText('3차 구현 예정', { exact: true }).locator('visible=true')).toHaveCount(0);
});

test('로고 삭제는 편집 상태에서 동작하고 후속 버튼과 구분된다', async ({ page }) => {
  await page.getByRole('button', { name: '브랜드 로고 2 삭제' }).click();
  await expect(logoCards(page)).toHaveCount(1);
  await expect(page.getByTestId('m2-logo-delete-action')).not.toHaveAttribute('aria-describedby', /.+/);
  await expect(page.getByTestId('m2-delete-brand')).toHaveAttribute('aria-describedby', /.+/);
});

test('부가 정보는 만들지 않고(Brand API 계약에 필드가 없다) 폼 아래에 빈 공간도 두지 않는다', async ({ page }) => {
  for (const text of ['부가 정보', '담당자', '소속', '사업장 주소', '제조사 정보']) {
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  }
  const form = page.getByTestId('m2-form');
  const lastBottom = await form.evaluate((el) => el.lastElementChild!.getBoundingClientRect().bottom + el.scrollTop - el.getBoundingClientRect().top);
  expect(await form.evaluate((el) => el.scrollHeight)).toBeLessThanOrEqual(Math.max(lastBottom + 1, (await form.boundingBox())!.height));
});
