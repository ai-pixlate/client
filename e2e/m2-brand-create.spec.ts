import { test, expect, type Page, type Request } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// 신규 브랜드 등록(셀러 1:N — v3.6.4 F-ACC-02) — H0·M0·M1 → /brand?mode=create(&next=n1|&from=) → POST /brands → 응답 Brand.id → N1(/jobs/new?brandId=) 또는 새 브랜드 M2.
// MSW Mock(lib/msw/m2-brand-handlers.ts)이 실제 계약(201 Brand · 400 · 409) 모양으로 응답한다. 실서버 검증이 아니다.
// 실패·분기는 ?mockScenario=m2-<name> 으로 만든다(요청 referrer 로 판별).
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const pngFile = (name = 'new-logo.png') => ({ name, mimeType: 'image/png', buffer: PNG });

const m2 = (page: Page) => page.getByTestId('m2-brand');
const createButton = (page: Page) => page.getByTestId('m2-create');

type Recorded = { method: string; path: string; request: Request };
function recordBrandRequests(page: Page) {
  const list: Recorded[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/brands(\/|$)/.test(pathname)) list.push({ method: request.method(), path: pathname, request });
  });
  return list;
}
const calls = (list: Recorded[], method: string, path?: string) =>
  list.filter((r) => r.method === method && (path == null || r.path === path)).map((r) => r.path);

/** 등록 화면 — 브랜드 0개 계정(create-* 또는 no-brand 시나리오)으로 연다. 1:N 이라 브랜드가 있어도 등록 경로는 열리지만, 기존 시나리오는 0개 계정 기준이다 */
async function openCreate(page: Page, query = '') {
  const scenario = query.includes('mockScenario=') ? '' : '&mockScenario=m2-no-brand';
  await page.goto(`/brand?mode=create${query}${scenario}`);
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
}

async function fillNames(page: Page, nameKo = '새 브랜드', nameEn = 'New Brand') {
  await page.getByTestId('m2-name-ko').fill(nameKo);
  await page.getByTestId('m2-name-en').fill(nameEn);
}

test('A. 신규 계정 — 브랜드 0개 M1 → 등록 화면 → POST /brands 1회 → /jobs/new?brandId={응답 id}', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await page.goto('/?mockScenario=m2-no-brand');
  const link = page.getByTestId('library-add-card-link');
  await expect(link).toHaveAttribute('href', '/brand?mode=create&next=n1');
  await link.click();
  await expect(page).toHaveURL(/\/brand\?mode=create&next=n1$/);
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');

  // 등록 화면 — 빈 초기값, 정보수정·브랜드 삭제 없음, 새 브랜드 추가는 숨김
  for (const id of ['m2-name-ko', 'm2-name-en', 'm2-overview', 'm2-target-customer']) await expect(page.getByTestId(id)).toHaveValue('');
  await expect(page.getByTestId('m2-logo-card')).toHaveCount(0);
  await expect(page.getByTestId('m2-edit')).toBeHidden();
  await expect(page.getByTestId('m2-new-brand')).toBeHidden();
  await expect(page.getByTestId('m2-delete-brand')).toHaveCount(0);
  await expect(createButton(page)).toHaveText('브랜드 등록');
  await expect(createButton(page)).toBeDisabled();

  await fillNames(page, '  새 브랜드 ', ' New Brand ');
  await page.getByTestId('m2-overview').fill('  차분한 톤  ');
  const responsePromise = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/brands');
  await createButton(page).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const created = (await response.json()) as { id: number };
  expect(response.request().postDataJSON()).toEqual({ nameKo: '새 브랜드', nameEn: 'New Brand', overview: '차분한 톤', targetCustomer: null });

  await expect(page).toHaveURL(new RegExp(`/jobs/new\\?brandId=${created.id}$`));
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
  // 로고가 없으면 로고 요청도 없다
  expect(requests.filter((r) => r.method === 'POST' && r.path !== '/brands')).toEqual([]);
});

test('A-2. 브랜드 0개로 /brand 에 오면 안내에서 멈추지 않고 등록 화면을 보인다', async ({ page }) => {
  await page.goto('/brand?mockScenario=m2-no-brand');
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
  await expect(createButton(page)).toHaveText('브랜드 등록');
});

test('B. 필수값 — 한글명·영문명이 비거나 공백이면 등록할 수 없다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page);
  // 손대기 전에는 오류를 빨갛게 보이지 않는다
  await expect(page.getByTestId('m2-name-ko-error')).toHaveCount(0);

  await fillNames(page, '', 'New');
  await expect(createButton(page)).toBeDisabled();
  await expect(page.getByTestId('m2-name-ko-error')).toHaveText('한글 브랜드명을 입력해주세요.');

  await fillNames(page, '새 브랜드', '   ');
  await expect(createButton(page)).toBeDisabled();
  await expect(page.getByTestId('m2-name-en-error')).toHaveText('영문 브랜드명을 입력해주세요.');

  await fillNames(page);
  await expect(createButton(page)).toBeEnabled();
  expect(calls(requests, 'POST')).toEqual([]);
});

test('C. 선택값 없이 등록 → /brand?brandId={id} 보기 화면에서 서버 값을 다시 받는다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page);
  await fillNames(page);
  const responsePromise = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/brands');
  await createButton(page).click();
  const response = await responsePromise;
  const created = (await response.json()) as { id: number; overview: unknown; targetCustomer: unknown };
  expect(response.request().postDataJSON()).toEqual({ nameKo: '새 브랜드', nameEn: 'New Brand', overview: null, targetCustomer: null });
  expect(created.overview).toBeNull();
  expect(created.targetCustomer).toBeNull();

  await expect(page).toHaveURL(new RegExp(`/brand\\?brandId=${created.id}$`));
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'edit-clean');
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('새 브랜드');
  await expect(page.getByTestId('m2-overview')).toHaveValue('');
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
});

test('D. 연속 클릭 — 브랜드 등록을 빠르게 두 번 눌러도 POST /brands 는 1회다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&mockScenario=m2-create-slow');
  await fillNames(page);
  // state 반영 전의 두 번째 클릭까지 — DOM 이벤트를 같은 틱에 두 번 보낸다
  await createButton(page).evaluate((el: HTMLButtonElement) => {
    el.click();
    el.click();
  });
  await expect(createButton(page)).toBeDisabled();
  await expect(page.getByTestId('m2-cancel')).toBeDisabled();
  await page.getByTestId('m2-cancel').click({ force: true });
  await expect(page).toHaveURL(/\/brand\?brandId=\d+$/, { timeout: 10_000 });
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
});

test('E. 500 — 입력을 그대로 두고 등록 화면에 남으며, 다시 누르면 다시 시도한다(자동 재시도 없음)', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&mockScenario=m2-create-fail');
  await fillNames(page);
  await page.getByTestId('m2-target-customer').fill('20대');
  await createButton(page).click();
  await expect(page.getByTestId('m2-save-error')).toHaveText('브랜드를 등록하지 못했습니다. 입력한 내용은 그대로 있으니 다시 시도해주세요.');
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('새 브랜드');
  await expect(page.getByTestId('m2-target-customer')).toHaveValue('20대');
  await page.waitForTimeout(500);
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);

  await expect(createButton(page)).toBeEnabled();
  await createButton(page).click();
  await expect.poll(() => calls(requests, 'POST', '/brands').length).toBe(2);
});

test('F. 409 — 자동 재시도 없이 입력을 유지하고 GET /brands 를 다시 받는다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&mockScenario=m2-create-conflict');
  await fillNames(page);
  const before = calls(requests, 'GET', '/brands').length;
  await createButton(page).click();
  await expect(page.getByTestId('m2-save-error')).toContainText('이미 등록된 브랜드와 겹쳐 등록하지 못했습니다.');
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
  await expect(page.getByTestId('m2-name-en')).toHaveValue('New Brand');
  await expect.poll(() => calls(requests, 'GET', '/brands').length).toBeGreaterThan(before);
  await page.waitForTimeout(500);
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
  await expect(page).toHaveURL(/mode=create/);
});

test('G. 등록 성공 + 로고 실패 — 다시 저장은 로고만 보내고 POST /brands 는 다시 나가지 않는다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&next=n1&mockScenario=m2-create-logo-fail-once');
  await fillNames(page);
  await page.getByTestId('m2-logo-input').setInputFiles(pngFile('first.png'));
  await expect(page.getByTestId('m2-logo-card')).toHaveCount(1);

  await createButton(page).click();
  await expect(page.getByTestId('m2-save-error')).toHaveText(
    '브랜드는 등록됐지만 일부 로고를 저장하지 못했습니다. 남은 로고를 확인하고 다시 저장해주세요.',
  );
  // POST /brands → 그 응답 id 로 로고 POST(순서), 로고 draft 는 남는다
  const brandPost = requests.findIndex((r) => r.method === 'POST' && r.path === '/brands');
  const logoPost = requests.findIndex((r) => r.method === 'POST' && /^\/brands\/\d+\/logos$/.test(r.path));
  expect(brandPost).toBeGreaterThanOrEqual(0);
  expect(logoPost).toBeGreaterThan(brandPost);
  const createdId = Number(requests[logoPost].path.split('/')[2]);
  await expect(page.getByTestId('m2-logo-card')).toHaveCount(1);
  await expect(page).toHaveURL(/mode=create/);
  await expect(createButton(page)).toHaveText('다시 저장');

  await createButton(page).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/new\\?brandId=${createdId}$`));
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
  expect(calls(requests, 'POST', `/brands/${createdId}/logos`)).toHaveLength(2);
  // 이름은 바꾸지 않았으니 PATCH 도 없다
  expect(calls(requests, 'PATCH')).toEqual([]);
});

test('1:N(F-ACC-02) — 브랜드가 있어도 M0 [브랜드 추가] → 등록 → POST 1회 → 새 브랜드 M2 · M0 에 두 브랜드', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await page.goto('/brand/select');
  await expect(page.getByTestId('brand-card-101')).toBeVisible();
  const add = page.getByTestId('brand-add-card-link');
  await expect(add).toHaveAttribute('href', '/brand?mode=create&from=brands');
  await add.click();
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
  // 기존 브랜드 값을 채우지 않는다(신규 등록과 정보 수정을 섞지 않는다)
  for (const id of ['m2-name-ko', 'm2-name-en', 'm2-overview', 'm2-target-customer']) await expect(page.getByTestId(id)).toHaveValue('');
  await fillNames(page, '두 번째 브랜드', 'Second Brand');
  await createButton(page).click();
  await expect(page).toHaveURL(/\/brand\?brandId=\d+$/);
  const id = Number(new URL(page.url()).searchParams.get('brandId'));
  expect(id).not.toBe(101);
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('두 번째 브랜드');
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
  // 기존 브랜드는 바뀌지 않았다(PATCH 없음)
  expect(calls(requests, 'PATCH')).toEqual([]);

  await page.getByTestId('app-header-brand').click();
  await expect(page.getByTestId('brand-card-101')).toBeVisible();
  await expect(page.getByTestId(`brand-card-${id}`)).toBeVisible();
});

test('중복 등록 방지(F-ACC-02a) — 공백·대소문자·특수문자를 정규화해 같은 이름이면 POST 없이 안내 · 기존 브랜드로 가는 길 · 입력 유지', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await page.goto('/brand?mode=create&from=brands');
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
  await fillNames(page, '다른 이름', '  PIX-late! ');
  await createButton(page).click();
  await expect(page.getByTestId('m2-save-error')).toContainText('같은 셀러에 같은 이름의 브랜드가 있어 등록하지 않았습니다.');
  const link = page.getByTestId('m2-error-link');
  await expect(link).toHaveText('기존 브랜드 「픽슬레이트」 보기');
  await expect(link).toHaveAttribute('href', '/brand?brandId=101');
  await expect(page.getByTestId('m2-name-en')).toHaveValue('  PIX-late! ');
  expect(calls(requests, 'POST')).toEqual([]);

  // 한글명도 공백만 다르면 중복이다
  await fillNames(page, ' 픽슬 레이트 ', 'Totally New');
  await createButton(page).click();
  await expect(page.getByTestId('m2-error-link')).toHaveAttribute('href', '/brand?brandId=101');
  expect(calls(requests, 'POST')).toEqual([]);

  // 기존 브랜드로 이동 — 입력이 있어 미저장 확인을 거친다
  await page.getByTestId('m2-error-link').click();
  await page.getByRole('button', { name: '변경사항 버리고 나가기' }).click();
  await expect(page).toHaveURL(/\/brand\?brandId=101$/);
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('픽슬레이트');

  // 다른 이름이면 등록된다(1:N)
  await page.goto('/brand?mode=create&from=brands');
  await fillNames(page, '픽슬레이트 투', 'Pixlate Two');
  await createButton(page).click();
  await expect(page).toHaveURL(/\/brand\?brandId=\d+$/);
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
});

test('서버 409(FE 사전 확인을 지난 동시 등록) — 그대로 따르고 입력을 남긴다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&mockScenario=m2-create-conflict');
  await fillNames(page);
  await createButton(page).click();
  await expect(page.getByTestId('m2-save-error')).toContainText('이미 등록된 브랜드와 겹쳐 등록하지 못했습니다.');
  await expect(page).toHaveURL(/mode=create/);
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
});

test('등록 화면 [취소]는 진입한 화면으로 돌아간다 — from=home → H0 · from=brands → M0', async ({ page }) => {
  await page.goto('/home');
  await page.getByTestId('home-new-brand').click();
  await expect(page).toHaveURL(/\/brand\?mode=create&from=home$/);
  await page.getByTestId('m2-cancel').click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto('/brand?mode=create&from=brands');
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
  await page.getByTestId('m2-cancel').click();
  await expect(page).toHaveURL(/\/brand\/select$/);
});

test('G. 브랜드가 있어도 /brand?mode=create 직접 진입은 등록 화면이다(1:N) — 기존 브랜드로 연결하지 않는다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await page.goto('/brand?mode=create');
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
  await expect(page).toHaveURL(/mode=create/);
  await page.goto('/brand?mode=create&next=n1');
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
  await expect(page).toHaveURL(/mode=create&next=n1/);
  expect(calls(requests, 'POST')).toEqual([]);
});

test('F. 목록 조회 실패 — 등록 화면을 열지 않고(0개로 보지 않음) N1 으로도 가지 않으며 POST 0', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await page.goto('/brand?mode=create&next=n1&mockScenario=m2-list-fail');
  await expect(m2(page)).toHaveAttribute('data-m2-load', 'error', { timeout: 15_000 });
  await expect(page.getByTestId('m2-create')).toHaveCount(0);
  await expect(page).toHaveURL(/\/brand\?mode=create/);
  expect(calls(requests, 'POST')).toEqual([]);
});

test('H. 여러 브랜드 — ?brandId 없는 /brand 는 고르지 않고 M0 로, 등록 경로는 등록 화면 · POST 0', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await page.goto('/brand?mockScenario=m2-multi-brand');
  await expect(page).toHaveURL(/\/brand\/select/);
  await expect(page.getByTestId('app-header-title')).toHaveText('브랜드 선택');
  await page.goto('/brand?mode=create&next=n1&mockScenario=m2-multi-brand');
  await expect(m2(page)).toHaveAttribute('data-m2-status', 'create');
  expect(calls(requests, 'POST')).toEqual([]);
});

const UNCONFIRMED = '등록 결과를 확인하지 못했습니다. 같은 이름의 브랜드가 있지만 이번 요청으로 만들어졌는지 알 수 없어 로고·정보를 이어 저장하지 않았습니다.';

test('C·D. 응답 유실(서버는 생성) — POST 1회 → 결과 확인 → 같은 이름 브랜드는 「후보」로만 안내 · 이동·로고 저장 없음 · 재클릭에도 POST 추가 0', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&next=n1&mockScenario=m2-create-response-lost');
  await fillNames(page);
  await page.getByTestId('m2-logo-input').setInputFiles(pngFile());
  const listBefore = calls(requests, 'GET', '/brands').length;
  // 같은 틱 두 번 클릭(확인 전 재클릭)
  await createButton(page).evaluate((el: HTMLButtonElement) => {
    el.click();
    el.click();
  });
  await expect(page.getByTestId('m2-save-error')).toContainText(UNCONFIRMED);
  const link = page.getByTestId('m2-error-link');
  await expect(link).toHaveText('「새 브랜드」 확인하기');
  await expect(link).toHaveAttribute('href', /^\/brand\?brandId=\d+$/);
  await page.waitForTimeout(500);
  // 후보 브랜드로 자동 이동(N1·M2)하지 않고, 그 브랜드에 로고를 올리지 않는다
  await expect(page).toHaveURL(/mode=create/);
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
  expect(requests.filter((r) => r.method === 'POST' && /\/logos$/.test(r.path))).toEqual([]);
  // POST 직전 확인 1회 + 결과 확인 1회
  expect(calls(requests, 'GET', '/brands').length - listBefore).toBe(2);
});

test('E. 응답 유실 뒤 — 사용자가 후보 브랜드를 직접 확인하러 간다 · 다시 등록하면 중복으로 막혀 POST 가 늘지 않는다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&mockScenario=m2-create-response-lost');
  await fillNames(page);
  await createButton(page).click();
  await expect(page.getByTestId('m2-save-error')).toContainText(UNCONFIRMED);
  const href = await page.getByTestId('m2-error-link').getAttribute('href');

  // 같은 입력으로 다시 등록 → 후보와 이름이 같아 중복 안내(POST 없음)
  await createButton(page).click();
  await expect(page.getByTestId('m2-save-error')).toContainText('같은 셀러에 같은 이름의 브랜드가 있어 등록하지 않았습니다.');
  await expect(page.getByTestId('m2-error-link')).toHaveAttribute('href', href!);
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);

  await page.getByTestId('m2-error-link').click();
  await page.getByRole('button', { name: '변경사항 버리고 나가기' }).click();
  await expect(page).toHaveURL(new RegExp(`${href!.replace('?', '\\?')}$`));
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('새 브랜드');
});

test('결과 확인도 실패 — 입력 유지 · 안내 · [다시 확인]은 목록 재조회만(POST 0) → 후보가 보여도 이어 저장하지 않는다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&next=n1&mockScenario=m2-create-lost-list-fail');
  await fillNames(page);
  await createButton(page).click();
  await expect(page.getByTestId('m2-save-error')).toHaveText('등록 결과를 확인하지 못했습니다. 다시 등록하지 말고 먼저 결과를 확인해 주세요.');
  await expect(page.getByTestId('m2-create')).toHaveCount(0);
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('새 브랜드');
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
  const listBefore = calls(requests, 'GET', '/brands').length;

  await page.getByTestId('m2-create-verify').click();
  await expect(page.getByTestId('m2-save-error')).toContainText(UNCONFIRMED);
  await expect(page).toHaveURL(/mode=create/);
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
  expect(calls(requests, 'GET', '/brands').length).toBeGreaterThan(listBefore);
});

test('응답 유실인데 서버에도 없음 — 자동 재시도 없이 안내하고, 사용자가 다시 누를 때만 POST', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&mockScenario=m2-create-lost-not-created');
  await fillNames(page);
  await createButton(page).click();
  await expect(page.getByTestId('m2-save-error')).toHaveText('등록된 브랜드를 확인하지 못했습니다. 입력한 내용으로 다시 등록할 수 있습니다.');
  await page.waitForTimeout(500);
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
  await expect(createButton(page)).toBeEnabled();
  await createButton(page).click();
  await expect.poll(() => calls(requests, 'POST', '/brands').length).toBe(2);
});

test('I. 다른 탭이 먼저 다른 브랜드를 등록 — 그 브랜드로 연결하지 않고 이번 입력으로 POST 1회 · 이번 브랜드의 N1', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openCreate(page, '&next=n1&mockScenario=m2-create-other-tab');
  await fillNames(page);
  const responsePromise = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/brands');
  await createButton(page).click();
  const created = (await (await responsePromise).json()) as { id: number; nameKo: string };
  expect(created.nameKo).toBe('새 브랜드');
  await expect(page).toHaveURL(new RegExp(`/jobs/new\\?brandId=${created.id}$`), { timeout: 15_000 });
  expect(calls(requests, 'POST', '/brands')).toHaveLength(1);
});

test('전체 보관함 새 작업 — 브랜드 1개면 /jobs/new?brandId={id}, 2개 이상이면 브랜드를 고르지 않고 이유와 함께 잠근다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('library-add-card-link')).toHaveAttribute('href', '/jobs/new?brandId=101');

  await page.goto('/?mockScenario=m2-multi-brand');
  const button = page.getByTestId('library-add-card-link');
  await expect(button).toBeDisabled();
  await expect(button).not.toHaveAttribute('href', /.*/);
  await expect(page.getByTestId('library-add-card-scope')).toHaveText('브랜드가 여러 개일 때는 브랜드별 보관함에서 작업을 시작할 수 있습니다(준비 중).');
  await expect(button).toHaveAccessibleDescription('브랜드가 여러 개일 때는 브랜드별 보관함에서 작업을 시작할 수 있습니다(준비 중).');
});

test('M1 — 브랜드 목록을 받지 못하면 brandId 없이 N1 으로 보내지 않는다', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === '/brands') {
        return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'x', retryable: true, details: null, traceId: 't' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return original(input, init);
    };
  });
  await page.goto('/');
  await expect(page.getByTestId('library-add-card-error')).toHaveText('브랜드 정보를 불러오지 못해 작업을 시작할 수 없습니다.', { timeout: 15_000 });
  const button = page.getByTestId('library-add-card-link');
  await expect(button).toBeDisabled();
  await expect(button).not.toHaveAttribute('href', /.*/);
});
