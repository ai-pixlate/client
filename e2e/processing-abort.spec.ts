import { type Page, type Request, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

import { pickRegulatoryClass, regulatoryClassTrigger } from './helpers/n1-regulatory-class';

// ─────────────────────────────────────────────────────────────────
// N2·N4 오류 화면 [중단] — POST /jobs/{jobId}/abort(API-JOB-07) · Chromium · Mock.
//
// - 중단 성공은 abort 응답이 아니라 그 뒤 다시 받은 JOB-05 currentStep 으로만 확인한다(N4 → N3 · N2 → N1).
// - 작업 취소(DELETE /jobs/{jobId})와 다르다 — 어떤 경우에도 DELETE 를 보내지 않는다.
// - 409 · 응답 유실은 실패로 단정하지 않고 재조회한다. 자동 재전송은 없다.
// Mock 응답 방식은 lib/msw/handlers.ts __pixlateMockAbortScript · __pixlateMockN2Script · __pixlateMockN4Script 로 정한다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '처리 중단 흐름 검증은 Chromium 기준이다');

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const errorPanel = (page: Page) => page.getByTestId('processing-error');
const abortButton = (page: Page) => page.getByTestId('processing-error-abort');
const proceedButton = (page: Page) => page.getByRole('button', { name: '이대로 진행' });

/** 쓰기 요청 기록 — abort 횟수와 DELETE(작업 취소)가 섞이지 않았는지 본다 */
function recordWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (r: Request) => {
    if (r.method() !== 'GET' && r.method() !== 'HEAD') writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return {
    writes,
    count: (entry: string) => writes.filter((w) => w === entry).length,
  };
}

const ABORT = `POST /jobs/${MOCK_JOB_ID}/abort`;

/** N3 카드별 포함·제외(data-bucket) — id 순 */
async function sectionBuckets(page: Page): Promise<string[]> {
  return page.locator('[data-testid^="n3-section-card-"]').evaluateAll((cards) =>
    cards.map((card) => `${card.getAttribute('data-testid')}=${card.getAttribute('data-bucket')}`).sort(),
  );
}

async function setScript(page: Page, flag: string, value: unknown) {
  await page.addInitScript(({ name, data }) => {
    (globalThis as Record<string, unknown>)[name] = data;
  }, { name: flag, data: value });
}

const n2Stage = (key: string, status: string) => ({ key, label: key, status });
const n4Stage = (key: string, status: string) => ({ key, label: key, status });

/** N1 을 채우고 [다음] — 고른 국가·언어 값을 돌려준다 */
async function fillAndSubmitN1(page: Page, productName: string) {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill(productName);
  const country = page.getByRole('combobox').nth(0);
  const language = page.getByRole('combobox').nth(1);
  await country.selectOption((await country.locator('option').nth(1).getAttribute('value'))!);
  await language.selectOption((await language.locator('option').nth(1).getAttribute('value'))!);
  const picked = { country: await country.inputValue(), language: await language.inputValue() };
  await page.getByRole('button', { name: '선택하기' }).click();
  const dialog = page.getByRole('dialog', { name: '카테고리 선택' });
  await dialog.getByRole('button', { name: '선케어' }).click();
  await dialog.getByRole('button', { name: '선크림' }).click();
  await dialog.getByRole('button', { name: '확인' }).click();
  await page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ }).check();
  await pickRegulatoryClass(page, '화장품');
  await page.getByLabel('파일 선택').setInputFiles({ name: 'abort-source.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_BASE64, 'base64') });
  await page.getByRole('button', { name: '다음' }).click();
  await page.waitForURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  return picked;
}

test('N4 오류 → [중단] → N3 복귀(포함·제외 유지) → 섹션 제외 → 다시 진행', async ({ page }) => {
  test.setTimeout(120_000);
  // 첫 N4 실행은 전체 실패로 끝난다. 중단 요청은 1.2초 걸린다(요청 중 상태·중복 클릭 확인)
  await setScript(page, '__pixlateMockN4Script', [
    { progress: 0.3, stages: [n4Stage('inpaint', 'done'), n4Stage('translate', 'failed')], fail: true },
  ]);
  await setScript(page, '__pixlateMockAbortScript', [{ delayMs: 1_200 }]);
  const log = recordWrites(page);

  await fillAndSubmitN1(page, 'N4 중단 검증');
  await expect(proceedButton(page)).toBeVisible({ timeout: 30_000 });
  // N4 전에 자동 제외된 섹션 하나를 직접 되살려 둔다 — 중단 뒤에도 서버 포함·제외 상태(사용자 변경 포함)가 그대로여야 한다
  const restoredId = (await sectionBuckets(page)).find((entry) => entry.endsWith('=exclude'))!.replace('n3-section-card-', '').replace('=exclude', '');
  await page.getByTestId(`n3-section-action-${restoredId}`).click();
  await expect(page.getByTestId(`n3-section-card-${restoredId}`)).toHaveAttribute('data-bucket', 'include');
  const bucketsBeforeN4 = await sectionBuckets(page);
  await proceedButton(page).click();

  await expect(errorPanel(page)).toBeVisible({ timeout: 15_000 });
  await expect(abortButton(page)).not.toHaveAttribute('aria-disabled', 'true');

  // 빠른 연속 클릭 — 요청은 한 번, 요청 중에는 버튼이 막히고 진행 문구를 보인다. 성공 전에는 N4 오류 화면 그대로다
  await abortButton(page).click();
  await abortButton(page).click({ force: true });
  await expect(abortButton(page)).toHaveAttribute('aria-busy', 'true');
  await expect(abortButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(abortButton(page)).toContainText('중단하는 중');
  await expect(errorPanel(page)).toBeVisible();

  // 재조회한 서버 currentStep=N3 → 기존 N3 화면
  await expect(proceedButton(page)).toBeVisible({ timeout: 10_000 });
  await expect(errorPanel(page)).toHaveCount(0);
  await expect(page.getByTestId('job-header-title')).toHaveText('섹션 확인');
  expect(log.count(ABORT)).toBe(1);
  expect(log.writes.filter((w) => w.startsWith('DELETE'))).toEqual([]);
  // 포함·제외 상태를 초기화하지 않는다 — N4 직전과 모든 카드가 같다
  await expect(page.getByTestId(`n3-section-card-${restoredId}`)).toHaveAttribute('data-bucket', 'include');
  expect(await sectionBuckets(page)).toEqual(bucketsBeforeN4);

  // 늦게 온 처리 단계 응답이 화면을 N4 로 되돌리지 않는다 — 2초 polling 주기를 넘겨 기다린 뒤에도 N3 다
  await page.waitForTimeout(4_500);
  await expect(page.getByTestId('job-header-title')).toHaveText('섹션 확인');

  // 실패 섹션을 제외한다고 가정하고 지금 포함된 섹션 하나를 더 제외 → 다시 진행 → 정상 N4 → N5
  const included = bucketsBeforeN4.filter((entry) => entry.endsWith('=include'));
  expect(included.length, '제외 뒤에도 포함 섹션이 남아야 진행할 수 있다').toBeGreaterThan(1);
  const targetId = included[0].replace('n3-section-card-', '').replace('=include', '');
  await page.getByTestId(`n3-section-action-${targetId}`).click();
  await expect(page.getByTestId(`n3-section-card-${targetId}`)).toHaveAttribute('data-bucket', 'exclude');
  await proceedButton(page).click();
  await expect(page.getByTestId('job-header-title')).toHaveText('번역 중', { timeout: 10_000 });
  await expect(errorPanel(page)).toHaveCount(0);
  await expect(page.getByTestId('job-header-title')).toHaveText('번역 결과 검수', { timeout: 40_000 });
  expect(log.count(ABORT)).toBe(1);
  expect(log.writes.filter((w) => w.startsWith('DELETE'))).toEqual([]);
});

test('N2 오류 → [중단] → 같은 작업 N1 복원 → 다시 진행해도 새 작업을 만들지 않는다', async ({ page }) => {
  test.setTimeout(90_000);
  await setScript(page, '__pixlateMockN2Script', [
    { progress: 0.34, stages: [n2Stage('ocr', 'done'), n2Stage('section', 'failed'), n2Stage('verify', 'pending')], fail: true },
  ]);
  const log = recordWrites(page);

  const picked = await fillAndSubmitN1(page, 'N2 중단 복원');
  await expect(errorPanel(page)).toBeVisible({ timeout: 15_000 });
  await abortButton(page).click();

  // 서버 draft/N1 확인 뒤 같은 작업 id 로 N1 을 연다
  await page.waitForURL(new RegExp(`/jobs/new\\?jobId=${MOCK_JOB_ID}$`), { timeout: 10_000 });
  await expect(page.getByTestId('job-header-title')).toHaveText('정보 입력');
  expect(log.count(ABORT)).toBe(1);

  // 서버 값 복원 — 상품명 · 국가 · 언어 · 카테고리 · 규제 분류 · 원본 1장
  await expect(page.getByPlaceholder('상품 이름을 입력해주세요')).toHaveValue('N2 중단 복원');
  await expect(page.getByRole('combobox').nth(0)).toHaveValue(picked.country);
  await expect(page.getByRole('combobox').nth(1)).toHaveValue(picked.language);
  await expect(page.getByLabel('카테고리 검색')).toHaveValue(/선크림/);
  await expect(regulatoryClassTrigger(page)).toHaveText('화장품');
  await expect(page.getByAltText('원본 이미지 1')).toHaveCount(1);
  // 서버에 없는 FE 진행 조건(책임 동의)은 다시 고른다 — 채워 넣지 않는다
  await expect(page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ })).not.toBeChecked();

  // 다시 진행 — POST /jobs 없이 같은 작업에 PATCH · analyze, 원본을 다시 올리지 않는다
  await page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ }).check();
  const before = log.writes.length;
  await page.getByRole('button', { name: '다음' }).click();
  await page.waitForURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  const after = log.writes.slice(before);
  expect(after).not.toContain('POST /jobs');
  expect(after).not.toContain(`POST /jobs/${MOCK_JOB_ID}/source-images`);
  expect(after).toContain(`PATCH /jobs/${MOCK_JOB_ID}`);
  expect(after).toContain(`POST /jobs/${MOCK_JOB_ID}/analyze`);
  await expect(page.getByTestId('job-header-title')).toHaveText('이미지 분석');
  expect(log.writes.filter((w) => w.startsWith('DELETE'))).toEqual([]);
});

test('409 는 재조회 후 머물며 안내하고 자동 재전송하지 않는다 · 응답 유실은 재조회로 복귀를 확인한다', async ({ page }) => {
  // 오류 화면 고정 시나리오(N4) — 첫 [중단]은 409, 두 번째는 서버가 처리한 뒤 응답을 잃는다
  await setScript(page, '__pixlateMockAbortScript', ['invalid-state', 'drop-after-commit']);
  const log = recordWrites(page);
  const tasksAfterAbort: string[] = [];
  page.on('response', async (res) => {
    if (new URL(res.url()).pathname !== `/jobs/${MOCK_JOB_ID}/tasks` || log.count(ABORT) === 0) return;
    const body = (await res.json().catch(() => null)) as { currentStep?: string } | null;
    tasksAfterAbort.push(body?.currentStep ?? '?');
  });
  await page.goto(`/jobs/${MOCK_JOB_ID}?scenario=n4-error`);
  await expect(errorPanel(page)).toBeVisible();

  await abortButton(page).click();
  const notice = page.getByTestId('processing-error-abort-notice');
  await expect(notice).toHaveText('지금 작업 상태에서는 중단할 수 없습니다.');
  // 재조회는 했고(서버는 여전히 N4), 화면은 오류 화면 그대로 · 버튼은 다시 누를 수 있다
  await expect.poll(() => tasksAfterAbort.length).toBeGreaterThan(0);
  expect(tasksAfterAbort.every((step) => step === 'N4')).toBe(true);
  await expect(errorPanel(page)).toBeVisible();
  await expect(abortButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await page.waitForTimeout(2_500);
  expect(log.count(ABORT)).toBe(1);

  // 사용자가 다시 누른 요청 — 응답은 유실되지만 재조회한 서버가 N3 이므로 복귀한다(실패로 단정하지 않는다)
  await abortButton(page).click();
  await expect(proceedButton(page)).toBeVisible({ timeout: 10_000 });
  await expect(errorPanel(page)).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  expect(log.count(ABORT)).toBe(2);
  expect(log.writes.filter((w) => w.startsWith('DELETE'))).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────
// 처리 중 [중단](PRD v3.6.4 화면정의서 N2·N3 · F-JOB-08) — Figma 일시 정지 자리의 버튼. 일시 정지·이어서 처리가 아니다.
// 오류 화면과 같은 요청 잠금·재조회를 쓰고, 요청 중에는 2초 polling 을 멈춘다.
// ─────────────────────────────────────────────────────────────────

const processingAbort = (page: Page) => page.getByTestId('processing-abort');

test('N2 처리 중 [중단] → 서버 draft/N1 확인 → 같은 작업 N1', async ({ page }) => {
  test.setTimeout(60_000);
  await setScript(page, '__pixlateMockAbortScript', [{ delayMs: 1_000 }]);
  const log = recordWrites(page);
  await fillAndSubmitN1(page, 'N2 처리 중 중단');

  await expect(page.getByTestId('job-header-title')).toHaveText('이미지 분석');
  await expect(errorPanel(page)).toHaveCount(0);
  // 위치·크기는 예전 일시 정지 버튼 그대로(28×28) · 활성
  const box = (await processingAbort(page).boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([28, 28]);
  await expect(processingAbort(page)).toHaveAccessibleName('중단');
  await expect(processingAbort(page)).not.toHaveAttribute('aria-disabled', 'true');

  await processingAbort(page).click();
  await processingAbort(page).click({ force: true });
  await expect(processingAbort(page)).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText('작업을 중단하고 있습니다.')).toBeVisible();

  await page.waitForURL(new RegExp(`/jobs/new\\?jobId=${MOCK_JOB_ID}$`), { timeout: 10_000 });
  await expect(page.getByPlaceholder('상품 이름을 입력해주세요')).toHaveValue('N2 처리 중 중단');
  expect(log.count(ABORT)).toBe(1);
  expect(log.writes.filter((w) => w.startsWith('DELETE'))).toEqual([]);
});

test('N4 처리 중 [중단] → 서버 review/N3 확인 → 포함·제외 유지', async ({ page }) => {
  test.setTimeout(90_000);
  await setScript(page, '__pixlateMockAbortScript', [{ delayMs: 1_000 }]);
  const log = recordWrites(page);
  await fillAndSubmitN1(page, 'N4 처리 중 중단');
  await expect(proceedButton(page)).toBeVisible({ timeout: 30_000 });
  const bucketsBeforeN4 = await sectionBuckets(page);
  await proceedButton(page).click();

  await expect(page.getByTestId('job-header-title')).toHaveText('번역 중', { timeout: 10_000 });
  await expect(errorPanel(page)).toHaveCount(0);
  await processingAbort(page).click();
  await expect(processingAbort(page)).toHaveAttribute('aria-busy', 'true');
  // 성공 확인 전에는 N4 처리 화면 그대로다
  await expect(page.getByTestId('job-header-title')).toHaveText('번역 중');

  await expect(proceedButton(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('job-header-title')).toHaveText('섹션 확인');
  expect(await sectionBuckets(page)).toEqual(bucketsBeforeN4);
  // 정상 N4 schedule 이 끝날 시간을 넘겨도 N5 로 넘어가지 않는다(중단된 처리의 늦은 응답이 화면을 바꾸지 않는다)
  await page.waitForTimeout(5_000);
  await expect(page.getByTestId('job-header-title')).toHaveText('섹션 확인');
  expect(log.count(ABORT)).toBe(1);
  expect(log.writes.filter((w) => w.startsWith('DELETE'))).toEqual([]);
});

test('N1 복귀 후 원본 추가·삭제는 서버에 반영된 뒤에만 analyze 하고, 썸네일 URL 재조회는 제한된다', async ({ page }) => {
  test.setTimeout(60_000);
  const log = recordWrites(page);
  const sourceListGets: number[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/source-images`) sourceListGets.push(Date.now());
  });
  await fillAndSubmitN1(page, 'N1 원본 변경');
  await processingAbort(page).click();
  await page.waitForURL(new RegExp(`/jobs/new\\?jobId=${MOCK_JOB_ID}$`), { timeout: 10_000 });
  await expect(page.getByAltText('원본 이미지 1')).toHaveCount(1);

  // Mock 원본 URL 은 불러올 수 없다 — 실패한 URL 마다 SRC-01 재조회는 최대 1회(같은 URL 을 다시 받으면 멈춘다)
  await page.waitForTimeout(3_000);
  expect(sourceListGets.length, 'N1 복원 1회 + 썸네일 재조회 최대 1회').toBeLessThanOrEqual(2);

  // 새 원본 추가 · 기존 원본 삭제(서버 DELETE 성공 뒤에만 카드가 사라진다)
  await page.getByLabel('파일 선택').setInputFiles({ name: 'added.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG_BASE64, 'base64') });
  await expect(page.getByAltText('added.png')).toHaveCount(1);
  await page.getByRole('button', { name: '원본 이미지 1 삭제' }).click();
  await expect(page.getByAltText('원본 이미지 1')).toHaveCount(0);

  await page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ }).check();
  const before = log.writes.length;
  await page.getByRole('button', { name: '다음' }).click();
  await page.waitForURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  const all = log.writes;
  const after = all.slice(before);
  const analyzeAt = all.indexOf(`POST /jobs/${MOCK_JOB_ID}/analyze`, before);
  // 삭제는 [다음] 전에 이미 서버에 반영됐고, 새 원본 업로드는 같은 작업에 analyze 보다 먼저 간다. 새 작업은 만들지 않는다
  expect(all.slice(0, before)).toContain(`DELETE /jobs/${MOCK_JOB_ID}/source-images/101`);
  expect(after).not.toContain('POST /jobs');
  expect(all.indexOf(`POST /jobs/${MOCK_JOB_ID}/source-images`, before)).toBeGreaterThan(-1);
  expect(all.indexOf(`POST /jobs/${MOCK_JOB_ID}/source-images`, before)).toBeLessThan(analyzeAt);
  expect(all.indexOf(`PATCH /jobs/${MOCK_JOB_ID}`, before)).toBeLessThan(analyzeAt);
  expect(all.filter((w) => w === `DELETE /jobs/${MOCK_JOB_ID}`)).toEqual([]);
});
