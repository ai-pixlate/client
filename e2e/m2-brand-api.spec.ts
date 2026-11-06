import { test, expect, type Page, type Request } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// M2 Brand API 연결 — GET /brands(·/{brandId}) · PATCH /brands/{brandId} · 로고 GET·POST·DELETE.
// MSW Mock(lib/msw/m2-brand-handlers.ts)이 실제 계약 모양으로 응답한다. 실서버 검증이 아니다.
// 실패·분기는 ?mockScenario=m2-<name> 으로 만든다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const pngFile = (name = 'new-logo.png') => ({ name, mimeType: 'image/png', buffer: PNG });

const status = (page: Page) => page.getByTestId('m2-brand');
const logoCards = (page: Page) => page.getByTestId('m2-logo-card');

type Recorded = { method: string; path: string; request: Request };
function recordBrandRequests(page: Page) {
  const list: Recorded[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (/^\/brands(\/|$)/.test(pathname)) list.push({ method: request.method(), path: pathname, request });
  });
  return list;
}
const calls = (list: Recorded[], method: string) => list.filter((r) => r.method === method).map((r) => r.path);

async function open(page: Page, query = '') {
  await page.goto(`/brand${query}`);
}
async function openLoaded(page: Page, query = '') {
  await open(page, query);
  await expect(status(page)).toHaveAttribute('data-m2-status', 'view');
}
async function enterEdit(page: Page) {
  await page.getByTestId('m2-edit').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-clean');
}

test('처음 진입 — 브랜드 목록으로 brandId 를 정하고 브랜드·로고를 받아 보인다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openLoaded(page);
  expect(calls(requests, 'GET')).toEqual(expect.arrayContaining(['/brands', '/brands/101', '/brands/101/logos']));
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('픽슬레이트');
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate');
  await expect(page.getByTestId('m2-overview')).toHaveValue(/자연 유래 성분/);
  await expect(page.getByTestId('m2-target-customer')).toHaveValue(/20–30대/);
  // orderNo ASC 그대로
  await expect(page.getByTestId('m2-logo-image').first()).toHaveAttribute('src', '/brand/mock/wordmark.png');
  await expect(page.getByTestId('m2-logo-image').nth(1)).toHaveAttribute('src', '/brand/mock/symbol.png');
  await expect(status(page)).toHaveAttribute('data-persistence', 'api');
});

test('?brandId 가 있으면 목록을 부르지 않고 그 브랜드를 받는다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openLoaded(page, '?brandId=101');
  expect(calls(requests, 'GET')).not.toContain('/brands');
  expect(calls(requests, 'GET')).toContain('/brands/101');
});

for (const { query, state, text } of [
  { query: '?mockScenario=m2-not-found', state: 'not-found', text: '브랜드를 찾을 수 없습니다.' },
  { query: '?brandId=999', state: 'not-found', text: '브랜드를 찾을 수 없습니다.' },
  { query: '?mockScenario=m2-no-brand', state: 'none', text: '등록된 브랜드가 없습니다.' },
  { query: '?mockScenario=m2-multi-brand', state: 'ambiguous', text: '표시할 브랜드를 하나로 정할 수 없습니다.' },
]) {
  test(`조회 ${query} → ${state}`, async ({ page }) => {
    await open(page, query);
    await expect(status(page)).toHaveAttribute('data-m2-load', state);
    await expect(page.getByTestId('m2-load-message')).toHaveText(text);
    await expect(page.getByTestId('m2-edit')).toHaveCount(0);
  });
}

test('수정 초기값은 서버 값이고, 저장은 바뀐 항목만 PATCH 한 뒤 응답을 정본으로 쓴다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openLoaded(page);
  await enterEdit(page);
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate');
  await page.getByTestId('m2-name-en').fill('  Pixlate Labs ');
  await page.getByTestId('m2-target-customer').fill('');
  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'view');
  await expect(status(page)).toHaveAttribute('data-save-state', 'success');

  const patch = requests.find((r) => r.method === 'PATCH');
  expect(patch?.path).toBe('/brands/101');
  expect(patch?.request.postDataJSON()).toEqual({ nameEn: 'Pixlate Labs', targetCustomer: null });
  expect(calls(requests, 'POST')).toEqual([]);
  expect(calls(requests, 'DELETE')).toEqual([]);
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate Labs');
  await expect(page.getByTestId('m2-target-customer')).toHaveValue('');
  // 저장 뒤 수정 초기값 = 서버 응답
  await enterEdit(page);
  await expect(page.getByTestId('m2-name-en')).toHaveValue('Pixlate Labs');
});

test('저장 실패 — 입력은 그대로, dirty 유지, 오류 안내, 다시 저장할 수 있다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openLoaded(page, '?mockScenario=m2-save-fail');
  await enterEdit(page);
  await page.getByTestId('m2-overview').fill('저장 실패해도 남아야 하는 개요');
  await page.getByTestId('m2-logo-input').setInputFiles(pngFile());
  await page.getByTestId('m2-save').click();

  await expect(status(page)).toHaveAttribute('data-save-state', 'error');
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');
  await expect(page.getByTestId('m2-overview')).toHaveValue('저장 실패해도 남아야 하는 개요');
  await expect(logoCards(page)).toHaveCount(3);
  await expect(page.getByTestId('m2-save-error')).toHaveText(/저장하지 못했습니다/);
  await expect(page.getByTestId('m2-apply-notice')).toHaveCount(0);
  await expect(page.getByTestId('m2-save')).toBeEnabled();
  // 브랜드 저장이 실패하면 로고는 보내지 않는다
  expect(calls(requests, 'POST')).toEqual([]);

  // 실패 뒤 나가려 해도 막힌다
  await page.getByTestId('m2-back').click();
  await expect(page.getByTestId('m2-unsaved-dialog')).toBeVisible();
  await page.getByRole('button', { name: '계속 수정' }).click();

  await page.getByTestId('m2-save').click();
  await expect.poll(() => calls(requests, 'PATCH').length).toBe(2);
});

test('저장 중에는 다시 저장하지 않는다(중복 요청 금지)', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openLoaded(page, '?mockScenario=m2-save-slow');
  await enterEdit(page);
  await page.getByTestId('m2-name-ko').fill('픽슬레이트 랩스');
  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'saving');
  await expect(page.getByTestId('m2-save')).toBeDisabled();
  await expect(page.getByTestId('m2-cancel')).toBeDisabled();
  await page.getByTestId('m2-save').click({ force: true });
  await expect(status(page)).toHaveAttribute('data-m2-status', 'view', { timeout: 5_000 });
  expect(calls(requests, 'PATCH')).toHaveLength(1);
});

test('로고 추가·삭제 — 저장 때 multipart POST(file)·DELETE 하고 목록을 다시 받는다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openLoaded(page);
  await enterEdit(page);
  await page.getByRole('button', { name: '브랜드 로고 1 삭제' }).click();
  await page.getByTestId('m2-logo-input').setInputFiles(pngFile('added.png'));
  expect(calls(requests, 'POST')).toEqual([]);
  const logoGetsBefore = calls(requests, 'GET').filter((p) => p.endsWith('/logos')).length;
  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-m2-status', 'view');

  expect(calls(requests, 'PATCH')).toEqual([]); // 글은 그대로라 PATCH 없음
  expect(calls(requests, 'DELETE')).toEqual(['/brands/101/logos/9001']);
  const post = requests.find((r) => r.method === 'POST');
  expect(post?.path).toBe('/brands/101/logos');
  expect(post?.request.headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/);
  // multipart 본문은 service worker(MSW)를 거쳐 Playwright 에서 읽히지 않는다 — Mock 은 field `file` 이 없으면 400 이라 201 응답으로 확인한다
  expect((await post!.request.response())?.status()).toBe(201);
  expect(calls(requests, 'GET').filter((p) => p.endsWith('/logos')).length).toBeGreaterThan(logoGetsBefore);

  // 서버 순서: 남은 9002 → 새 로고
  await expect(logoCards(page)).toHaveCount(2);
  await expect(page.getByTestId('m2-logo-image').first()).toHaveAttribute('src', '/brand/mock/symbol.png');
  await expect(page.getByTestId('m2-logo-image').nth(1)).toHaveAttribute('src', /^data:image\/png;base64,/);
});

test('로고 추가 실패 — 그 로고는 저장 전 로고로 남고 dirty 가 유지된다', async ({ page }) => {
  await openLoaded(page, '?mockScenario=m2-logo-upload-fail');
  await enterEdit(page);
  await page.getByTestId('m2-name-ko').fill('픽슬레이트 2');
  await page.getByTestId('m2-logo-input').setInputFiles(pngFile('fail.png'));
  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'error');
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');
  await expect(page.getByTestId('m2-save-error')).toHaveText(/일부 로고를 저장하지 못했습니다/);
  // 글은 저장됐고(서버 응답), 실패한 로고만 남는다
  await expect(page.getByTestId('m2-name-ko')).toHaveValue('픽슬레이트 2');
  await expect(page.getByRole('img', { name: 'fail.png' })).toHaveAttribute('src', /^blob:/);
  await page.getByTestId('m2-back').click();
  await expect(page.getByTestId('m2-unsaved-changes').getByRole('listitem')).toHaveText(['로고 1개 추가']);
});

test('로고 삭제 실패 — 서버 로고는 그대로이고, 취소하면 원래 로고가 보인다', async ({ page }) => {
  await openLoaded(page, '?mockScenario=m2-logo-delete-fail');
  await enterEdit(page);
  await page.getByRole('button', { name: '브랜드 로고 2 삭제' }).click();
  await page.getByTestId('m2-save').click();
  await expect(status(page)).toHaveAttribute('data-save-state', 'error');
  await expect(status(page)).toHaveAttribute('data-m2-status', 'edit-dirty');
  await expect(logoCards(page)).toHaveCount(1);
  await page.getByTestId('m2-cancel').click();
  await expect(logoCards(page)).toHaveCount(2);
  await expect(page.getByRole('img', { name: '브랜드 로고 2' })).toBeVisible();
});

test('범위 유지 — 로고 변경·새 브랜드 추가·브랜드 삭제는 요청 없는 후속 버튼이다', async ({ page }) => {
  const requests = recordBrandRequests(page);
  await openLoaded(page);
  for (const testId of ['m2-logo-change', 'm2-new-brand', 'm2-delete-brand']) {
    await expect(page.getByTestId(testId)).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId(testId).click({ force: true });
  }
  await page.waitForTimeout(200);
  expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
});
