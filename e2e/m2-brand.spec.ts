import { test, expect, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// M2 브랜드 정보 (Figma 743:6039) — API 없이 Mock + local state로만 동작한다.
//
// ★ "저장"은 local mock persistence다. 서버 저장을 검증하지 않고, 어떤 흐름에서도 브랜드·로고 API 요청이
//   나가지 않는지만 확인한다. 실제 API 연동 검증이 아니다.
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

async function enterEdit(page: Page) {
  await page.getByTestId('m2-edit').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
}

let brandApiRequests: string[];

test.beforeEach(async ({ page }) => {
  brandApiRequests = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/(v1\/)?brands(\/|$)/.test(pathname) || pathname.includes('/logos')) brandApiRequests.push(pathname);
  });
  await page.goto('/brand');
  await expect(page.getByRole('heading', { name: '브랜드 정보' })).toBeVisible();
});

test.afterEach(() => {
  expect(brandApiRequests).toEqual([]);
});

test('기본 화면은 저장된 Mock을 읽기 전용으로 보여 준다', async ({ page }) => {
  await expect(status(page)).toHaveAttribute('data-m2-status', 'view');
  await expect(status(page)).toHaveAttribute('data-persistence', 'local-mock');
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('픽슬레이트');
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate');
  await expect(page.getByTestId('m2-overview')).toHaveValue(/자연 유래 성분/);
  await expect(page.getByTestId('m2-target-customer')).toHaveValue(/20–30대/);

  for (const field of ['m2-name-ko', 'm2-name-en', 'm2-overview', 'm2-target-customer']) {
    await expect(page.getByTestId(field)).not.toBeEditable();
  }
  await expect(logoCards(page)).toHaveCount(2);
  for (const image of await page.getByTestId('m2-logo-image').all()) {
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByTestId('m2-logo-uploader')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /로고 삭제$/ })).toHaveCount(0);
  await expect(page.getByTestId('m2-save')).toHaveCount(0);
  await expect(page.getByTestId('m2-cancel')).toHaveCount(0);
  await expect(page.getByTestId('m2-apply-notice')).toHaveText(
    '변경한 브랜드 정보는 새로 시작하는 작업부터 적용되며, 이미 완료된 작업에는 자동 반영되지 않습니다.',
  );

  // 범위 밖이거나 PRD와 다른 Figma 항목
  await expect(page.getByText('부가 정보')).toHaveCount(0);
  await expect(page.getByText(/AI|벡터/)).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('정보수정을 누르면 입력과 로고 조작이 열리고 저장은 변경 전까지 비활성이다', async ({ page }) => {
  await enterEdit(page);
  for (const field of ['m2-name-ko', 'm2-name-en', 'm2-overview', 'm2-target-customer']) {
    await expect(page.getByTestId(field)).toBeEditable();
  }
  await expect(page.getByTestId('m2-name-ko')).toBeFocused();
  await expect(page.getByTestId('m2-logo-uploader')).toBeVisible();
  await expect(page.getByRole('button', { name: '워드마크 로고 삭제' })).toBeVisible();
  await expect(page.getByTestId('m2-edit')).toBeHidden();
  await expect(page.getByTestId('m2-save')).toBeDisabled();
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
  await expect(status(page)).toHaveAttribute('data-m2-status', 'view');
  await expect(page.getByTestId('m2-overview')).toHaveValue(/자연 유래 성분/);
  await expect(page.getByTestId('m2-edit')).toBeFocused();
});

test('저장은 화면의 baseline만 바꾸고, 새로고침하면 fixture로 돌아간다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-name-en').fill('  Pixlate Labs ');
  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'view');
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate Labs');
  await expect(page.getByTestId('m2-edit')).toBeFocused();

  // 저장된 값이 새 baseline이다
  await enterEdit(page);
  await page.getByTestId('m2-name-en').fill('Other');
  await page.getByTestId('m2-cancel').click();
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate Labs');

  // 서버 저장이 없으므로 새로고침하면 사라진다
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
    await enterEdit(page);
    await page.getByTestId(testId).fill('');
    await expect(page.getByTestId('m2-save')).toBeEnabled();
    await page.getByTestId('m2-save').click();
    await expect(status(page)).toHaveAttribute('data-m2-status', 'view');
    await expect(page.getByTestId(testId)).toHaveValue('');
    await expect(page.getByTestId(testId)).toHaveAttribute('placeholder', '입력된 내용이 없습니다.');
  });
}

test('로고를 추가하면 draft에만 들어가고, 저장해야 확정된다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-logo-input').setInputFiles([pngFile('a.png'), pngFile('b.png')]);
  await expect(logoCards(page)).toHaveCount(4);
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');
  const added = page.getByRole('img', { name: 'a.png' });
  await expect(added).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => added.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'view');
  await expect(logoCards(page)).toHaveCount(4);
  // 저장 뒤에도 blob URL이 해제되지 않아 계속 보인다
  await expect.poll(() => page.getByRole('img', { name: 'b.png' }).evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test('로고를 삭제하면 draft에서 빠지고 포커스가 파일 선택으로 옮겨 간다', async ({ page }) => {
  await enterEdit(page);
  await page.getByRole('button', { name: '심볼 로고 삭제' }).click();
  await expect(logoCards(page)).toHaveCount(1);
  await expect(page.getByRole('img', { name: '심볼 로고' })).toHaveCount(0);
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');
  await expect(page.getByRole('button', { name: '파일 선택' })).toBeFocused();
});

test('취소하면 추가·삭제한 로고가 원래대로 돌아온다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-logo-input').setInputFiles(pngFile());
  await page.getByRole('button', { name: '워드마크 로고 삭제' }).click();
  await page.getByRole('button', { name: '심볼 로고 삭제' }).click();
  await expect(logoCards(page)).toHaveCount(1);
  await page.getByTestId('m2-cancel').click();
  await expect(logoCards(page)).toHaveCount(2);
  await expect(page.getByRole('img', { name: '워드마크 로고' })).toBeVisible();
  await expect(page.getByRole('img', { name: '심볼 로고' })).toBeVisible();
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

test('변경이 있을 때 뒤로 가기는 확인창을 열고, 실제 변경 항목만 보여 준다', async ({ page }) => {
  await enterEdit(page);
  await page.getByTestId('m2-name-en').fill('Pixlate Labs');
  await page.getByTestId('m2-overview').fill('새 개요');
  await page.getByTestId('m2-logo-input').setInputFiles(pngFile());
  await page.getByTestId('m2-back').click();

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
  await page.getByTestId('m2-back').click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/brand$/);

  // 버리고 나가기: 보관함으로 이동한다
  await page.getByTestId('m2-back').click();
  await dialog.getByRole('button', { name: '변경사항 버리고 나가기' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
});

test('변경이 없으면 뒤로 가기는 바로 이동한다 — 보기·수정 모드 모두', async ({ page }) => {
  await page.getByTestId('m2-back').click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/brand');
  await enterEdit(page);
  await page.getByTestId('m2-back').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('m2-unsaved-dialog')).toHaveCount(0);
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
  await expect(status(page)).toHaveAttribute('data-m2-status', 'view');
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

test('1440×800에서도 가로로 넘치지 않고 저장 버튼이 보이며, 넘치는 폼은 자체 스크롤한다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await enterEdit(page);
  await expect(page.getByTestId('m2-save')).toBeInViewport();
  const horizontal = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontal).toBe(0);
  const formOverflow = await page.getByTestId('m2-form').evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(formOverflow).toBeGreaterThan(0);
});

test('1920×1080 레이아웃이 Figma 743:6039 좌표와 맞다', async ({ page }) => {
  await enterEdit(page);
  const box = async (testId: string) => (await page.getByTestId(testId).boundingBox())!;

  const back = await box('m2-back');
  expect([back.x, back.y, back.width, back.height]).toEqual([39, 39, 40, 40]);

  const title = (await page.getByRole('heading', { name: '브랜드 정보' }).boundingBox())!;
  expect([title.x, title.y]).toEqual([119, 79]);

  const divider = await box('m2-header-divider');
  expect([divider.x, divider.y, divider.width]).toEqual([119, 186, 1680]);

  const form = await box('m2-form');
  expect([form.x, form.y, form.height]).toEqual([119, 219, 700]);

  const nameKo = await box('m2-name-ko');
  expect([nameKo.y, nameKo.width, nameKo.height]).toEqual([277, 405, 40]);
  const nameEn = await box('m2-name-en');
  expect(nameEn.x + nameEn.width).toBe(119 + 972);

  const overview = await box('m2-overview');
  expect([overview.y, overview.height]).toEqual([420, 132]);
  const targetCustomer = await box('m2-target-customer');
  expect([targetCustomer.y, targetCustomer.height]).toEqual([655, 112]);

  const card = (await logoCards(page).first().boundingBox())!;
  expect([card.x, card.width, card.height]).toEqual([1211, 568, 200]);

  // 왼쪽 폼은 내용이 700보다 짧아 스크롤이 없다
  const formOverflow = await page.getByTestId('m2-form').evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(formOverflow).toBe(0);

  const save = await box('m2-save');
  // Figma에서 저장 버튼 오른쪽 끝은 Divider 오른쪽 끝과 같은 선이다
  expect(save.x + save.width).toBe(divider.x + divider.width);
  expect(save.y + save.height).toBe(1027);
});

/** DOM 실측 가로 값 */
async function horizontalGeometry(page: Page) {
  return page.evaluate(() => {
    const rect = (id: string) => document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
    const scroller = document.querySelector('[data-testid=m2-form]')!;
    const form = rect('m2-form');
    const panel = rect('m2-logo-panel');
    const ko = rect('m2-name-ko');
    const en = rect('m2-name-en');
    const divider = rect('m2-header-divider');
    const card = document.querySelector('[data-testid=m2-logo-card]')!.getBoundingClientRect();
    return {
      contentLeft: divider.x,
      contentWidth: divider.width,
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

test('1920×1080 가로 비율은 972 : 120 : 568 과 405 : 162 : 405 다', async ({ page }) => {
  const g = await horizontalGeometry(page);
  console.log(`[m2-width] 1920×1080 ${JSON.stringify(g)}`);
  expect([g.contentLeft, g.contentWidth]).toEqual([119, 1680]);
  expect([g.formX, g.formWidth, g.centerGap]).toEqual([119, 972, 120]);
  expect([g.panelX, g.panelWidth]).toEqual([1211, 568]);
  expect([g.cardX, g.cardWidth, g.cardHeight]).toEqual([1211, 568, 200]);
  expect([g.koWidth, g.nameGap, g.enWidth]).toEqual([405, 162, 405]);
  expect(g.overflowX).toBe(0);
});

for (const [width, height] of [[1728, 885], [1512, 860], [1440, 900]] as const) {
  test(`${width}×${height} 가로 치수가 같은 배율로 줄고 넘치지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const g = await horizontalGeometry(page);
    const scale = (width - 240) / 1680;
    console.log(`[m2-width] ${width}×${height} scale ${scale.toFixed(4)} ${JSON.stringify(g)}`);
    expect(g.contentLeft).toBe(119);
    expect(g.contentWidth).toBe(width - 240);
    const close = (actual: number, expected: number, name: string) => expect(Math.abs(actual - expected), name).toBeLessThanOrEqual(1);
    close(g.formWidth, 972 * scale, 'form');
    close(g.centerGap, 120 * scale, 'gap');
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
    await expect(page.getByRole('heading', { name: '브랜드 정보' })).toHaveCSS('font-size', '32px');
    await expect(page.getByTestId('m2-name-ko')).toHaveCSS('font-size', '14px');
  });
}

test('좁은 화면 수정 모드에서도 비율을 유지하고 로고 카드가 찌그러지지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('m2-edit').click();
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
  { testId: 'm2-new-brand', text: '새 브랜드 추가', border: 'rgb(234, 234, 234)', color: 'rgb(23, 23, 23)' },
  { testId: 'm2-delete-brand', text: '브랜드 삭제', border: 'rgb(229, 72, 77)', color: 'rgb(229, 72, 77)' },
  { testId: 'm2-logo-change', text: '로고 변경', border: 'rgb(234, 234, 234)', color: 'rgb(23, 23, 23)' },
  { testId: 'm2-logo-delete-action', text: '삭제', border: 'rgb(229, 72, 77)', color: 'rgb(229, 72, 77)' },
];

test('왼쪽 폼은 스크롤막대가 보이지 않지만 휠과 키보드로 스크롤된다', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 700 });
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
  const newBrand = await box('m2-new-brand');
  const edit = await box('m2-edit');
  const deleteBrand = await box('m2-delete-brand');
  const change = await box('m2-logo-change');
  const remove = await box('m2-logo-delete-action');
  console.log(`[m2-buttons] ${JSON.stringify({ newBrand, edit, deleteBrand, change, remove })}`);
  expect([newBrand.width, newBrand.height]).toEqual([120, 36]);
  expect(edit.x + edit.width).toBe(1799);
  expect(edit.x - (newBrand.x + newBrand.width)).toBe(14);
  expect(edit.height).toBe(30);
  expect(Math.abs(edit.width - 81)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('m2-edit')).toHaveText('정보수정');
  await expect(page.getByTestId('m2-edit')).toHaveCSS('border-top-width', '0px');
  expect([deleteBrand.x, deleteBrand.y + deleteBrand.height, deleteBrand.height]).toEqual([119, 1025, 30]);
  expect(Math.abs(deleteBrand.width - 94)).toBeLessThanOrEqual(1);
  expect([change.height, remove.height]).toEqual([24, 24]);
  expect(Math.abs(change.width - 68)).toBeLessThanOrEqual(1);
  expect(Math.abs(remove.width - 45)).toBeLessThanOrEqual(1);
  expect(remove.x - (change.x + change.width)).toBe(8);
  expect(remove.x + remove.width).toBe(1779);
});

for (const mode of ['view', 'edit-dirty'] as const) {
  test(`${mode} 에서 미연결 버튼을 눌러도 요청·이동·상태 변화가 없다`, async ({ page }) => {
    if (mode === 'edit-dirty') {
      await enterEdit(page);
      await page.getByTestId('m2-name-ko').fill('변경한 이름');
    }
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
  const button = page.getByTestId('m2-new-brand');
  await page.getByTestId('m2-back').focus();
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('outline-style', 'solid');
});

test('수정 모드로 바꿔도 헤더 버튼 위치가 그대로이고 숨은 버튼에는 포커스가 가지 않는다', async ({ page }) => {
  const before = (await page.getByTestId('m2-new-brand').boundingBox())!;
  await enterEdit(page);
  expect(await page.getByTestId('m2-new-brand').boundingBox()).toEqual(before);
  await page.getByTestId('m2-new-brand').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('m2-edit')).not.toBeFocused();
});

const FUTURE_BUTTONS = ['m2-new-brand', 'm2-delete-brand', 'm2-logo-change'];
const tooltip = (page: Page) => page.getByRole('tooltip');

const VIEWPORTS = [[1920, 1080], [1728, 885], [1512, 860], [1440, 900]] as const;

for (const [width, height] of VIEWPORTS) {
  test(`${width}×${height} 보기 모드 안내는 버튼 자리 없이 content 오른쪽 끝에 붙는다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId('m2-cancel')).toHaveCount(0);
    await expect(page.getByTestId('m2-save')).toHaveCount(0);
    const notice = (await page.getByTestId('m2-apply-notice').boundingBox())!;
    const footer = (await page.getByTestId('m2-footer').boundingBox())!;
    const divider = (await page.getByTestId('m2-header-divider').boundingBox())!;
    const form = (await page.getByTestId('m2-form').boundingBox())!;
    const deleteBrand = (await page.getByTestId('m2-delete-brand').boundingBox())!;
    console.log(`[m2-notice] ${width}×${height} ${JSON.stringify({ notice, right: divider.x + divider.width, formBottom: form.y + form.height })}`);
    expect(Math.abs(notice.x + notice.width - (divider.x + divider.width))).toBeLessThanOrEqual(0.5);
    expect(footer.x).toBe(notice.x);
    expect(footer.width).toBe(notice.width);
    expect(notice.height).toBeLessThan(20);
    expect(notice.y).toBeGreaterThanOrEqual(form.y + form.height);
    expect(deleteBrand.y).toBeGreaterThanOrEqual(form.y + form.height);
    expect(deleteBrand.x + deleteBrand.width).toBeLessThan(notice.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });

  test(`${width}×${height} 수정 모드는 안내와 버튼이 Figma 묶음으로 오른쪽에 있다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await enterEdit(page);
    const notice = (await page.getByTestId('m2-apply-notice').boundingBox())!;
    const cancel = (await page.getByTestId('m2-cancel').boundingBox())!;
    const save = (await page.getByTestId('m2-save').boundingBox())!;
    const footer = (await page.getByTestId('m2-footer').boundingBox())!;
    const divider = (await page.getByTestId('m2-header-divider').boundingBox())!;
    expect(footer.width).toBe(688);
    expect(footer.x).toBe(notice.x);
    expect(notice.height).toBeLessThan(20);
    expect(notice.x + notice.width).toBeLessThanOrEqual(cancel.x);
    expect(cancel.x + cancel.width).toBeLessThanOrEqual(save.x);
    expect(Math.abs(save.x + save.width - (divider.x + divider.width))).toBeLessThanOrEqual(0.5);
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
      const focusable = Array.from(document.querySelectorAll<HTMLElement>('button, input, textarea'));
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
  await page.getByTestId('m2-logo-delete-action').hover();
  await expect(tooltip(page)).toHaveCount(0);
  await page.getByTestId('m2-edit').hover();
  await expect(tooltip(page)).toHaveCount(0);
  await page.getByTestId('m2-edit').focus();
  await expect(tooltip(page)).toHaveCount(0);

  await enterEdit(page);
  for (const locator of [
    page.getByTestId('m2-cancel'),
    page.getByTestId('m2-save'),
    page.getByRole('button', { name: '심볼 로고 삭제' }),
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

test('로고 삭제는 수정 모드에서 계속 동작하고 후속 버튼과 구분된다', async ({ page }) => {
  await enterEdit(page);
  await page.getByRole('button', { name: '심볼 로고 삭제' }).click();
  await expect(logoCards(page)).toHaveCount(1);
  await expect(page.getByTestId('m2-logo-delete-action')).not.toHaveAttribute('aria-describedby', /.+/);
  await expect(page.getByTestId('m2-delete-brand')).toHaveAttribute('aria-describedby', /.+/);
});

test('부가 정보는 만들지 않고 폼 아래에 빈 공간도 두지 않는다', async ({ page }) => {
  for (const text of ['부가 정보', '담당자', '소속', '사업장 주소', '제조사 정보']) {
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  }
  const form = page.getByTestId('m2-form');
  const lastBottom = await form.evaluate((el) => el.lastElementChild!.getBoundingClientRect().bottom + el.scrollTop - el.getBoundingClientRect().top);
  expect(await form.evaluate((el) => el.scrollHeight)).toBeLessThanOrEqual(Math.max(lastBottom + 1, (await form.boundingBox())!.height));
});
