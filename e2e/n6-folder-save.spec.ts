import { test, expect, type Page } from '@playwright/test';

import { reachN6 } from './helpers/reach-n6';
import { disableDirectoryPicker, forceInsecureContext, installFakeDirectoryPicker } from './helpers/directory-picker';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N6 "선택 항목 내보내기" — 로컬 폴더 직접 저장(Progressive Enhancement) e2e.
//
// 지원 환경(secure context + showDirectoryPicker): 클릭 → 폴더 선택 → POST /export →
// artifactId → GET /exports/{artifactId}/download → presigned URL fetch → 고른 폴더에 쓰기 →
// "저장 완료". 미지원/insecure 환경과 presigned fetch 실패는 기존 다운로드 링크로 돌아간다.
//
// File System Access API 는 가짜로 바꿔(helpers/directory-picker.ts) 호출 순서와 인자만 본다 —
// 실제 로컬 파일은 만들지 않는다. 가짜 picker 는 Chromium 에서만 쓴다(Firefox/WebKit 은 실제로
// 이 API 가 없으므로 그쪽에서는 fallback 경로를 확인한다).
// ─────────────────────────────────────────────────────────────────

// lib/msw/handlers.ts 의 같은 이름 상수와 같은 값
const MOCK_EXPORT_FAIL_ONCE_FLAG = '__pixlateMockExportFailOnce';
const MOCK_EXPORT_DOWNLOAD_NOT_FOUND_ONCE_FLAG = '__pixlateMockExportDownloadNotFoundOnce';
const MOCK_PRESIGNED_FETCH_FAIL_ONCE_FLAG = '__pixlateMockPresignedFetchFailOnce';

async function setMockFlag(page: Page, flag: string) {
  await page.evaluate((f) => {
    (globalThis as Record<string, unknown>)[f] = true;
  }, flag);
}

const EXPORT_POST = `POST /jobs/${MOCK_JOB_ID}/export`;
const DOWNLOAD_GET = new RegExp(`^GET /jobs/${MOCK_JOB_ID}/exports/\\d+/download$`);
const PRESIGNED_GET = /^GET \/mock\/download\//;

/** 네트워크 요청과 가짜 FS 호출을 한 줄로 기록한다(순서 비교용). */
function trackOrder(page: Page): string[] {
  const order: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith(`/jobs/${MOCK_JOB_ID}/export`) || url.pathname.startsWith('/mock/download/')) {
      order.push(`${req.method()} ${url.pathname}`);
    }
  });
  return order;
}

const count = (order: string[], match: string | RegExp) =>
  order.filter((o) => (typeof match === 'string' ? o === match : match.test(o))).length;

function collectPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  return errors;
}

test.describe('지원 환경(secure context + showDirectoryPicker)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', '가짜 File System Access API 는 Chromium 에서만 검증한다');

  test('A. 폴더 선택 → POST /export → GET download → presigned fetch → 폴더에 저장 → 저장 완료', async ({ page }) => {
    const order = trackOrder(page);
    const pageErrors = collectPageErrors(page);
    const fs = await installFakeDirectoryPicker(page, order);
    await reachN6(page);
    order.length = 0; // 행 다운로드 등 이전 요청은 보지 않는다

    const exported = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
    );
    await page.getByTestId('n6-export-button').click();
    const exportBody = await (await exported).json();

    await expect(page.getByTestId('n6-direct-save-done')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('n6-direct-save-done')).toContainText('저장 완료');
    await expect(page.getByTestId('n6-direct-save-done')).toContainText(
      '선택한 폴더(pixlate-test-folder)에 export.zip을 저장했습니다.',
    );
    // 두 번째 다운로드 버튼을 만들지 않는다
    await expect(page.getByTestId('n6-download-link')).toHaveCount(0);
    await expect(page.getByTestId('n6-export-error')).toHaveCount(0);

    // 순서: picker 가 가장 먼저(user activation 안) → POST → GET download → presigned → 파일 쓰기
    expect(order).toEqual([
      'fs:showDirectoryPicker',
      EXPORT_POST,
      `GET /jobs/${MOCK_JOB_ID}/exports/${exportBody.artifactId}/download`,
      'GET /mock/download/export.zip',
      'fs:getFileHandle',
      'fs:createWritable',
      'fs:write',
      'fs:close',
    ]);
    expect(fs[0]).toEqual({ op: 'showDirectoryPicker', options: { id: 'pixlate-export', mode: 'readwrite' } });
    expect(fs[1]).toEqual({ op: 'getFileHandle', name: 'export.zip', options: { create: true } });
    expect(fs[3]).toEqual({ op: 'write', size: expect.any(Number), text: 'pixlate mock artifact: export.zip' });
    expect(pageErrors).toEqual([]);
  });

  test('B. 폴더 선택을 취소하면 POST /export 와 download GET 을 보내지 않고 오류도 없다', async ({ page }) => {
    const order = trackOrder(page);
    const pageErrors = collectPageErrors(page);
    await installFakeDirectoryPicker(page, order, 'cancel');
    await reachN6(page);
    order.length = 0;

    await page.getByTestId('n6-export-button').click();
    await expect.poll(() => count(order, 'fs:showDirectoryPicker')).toBe(1);
    await page.waitForTimeout(1_000);

    expect(count(order, EXPORT_POST)).toBe(0);
    expect(count(order, DOWNLOAD_GET)).toBe(0);
    await expect(page.getByTestId('n6-export-error')).toHaveCount(0);
    await expect(page.getByTestId('n6-download-error')).toHaveCount(0);
    await expect(page.getByTestId('n6-direct-save-done')).toHaveCount(0);
    await expect(page.getByTestId('n6-export-button')).toHaveText('선택 항목 내보내기');
    await expect(page.getByTestId('n6-export-button')).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test('D. presigned fetch 가 실패(CORS/네트워크)하면 산출물은 성공으로 두고 기존 다운로드 링크를 보여 준다', async ({
    page,
  }) => {
    const order = trackOrder(page);
    const fs = await installFakeDirectoryPicker(page, order);
    await reachN6(page);
    order.length = 0;

    await setMockFlag(page, MOCK_PRESIGNED_FETCH_FAIL_ONCE_FLAG);
    await page.getByTestId('n6-export-button').click();

    await expect(page.getByTestId('n6-direct-save-fallback')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('n6-direct-save-fallback')).toHaveText(
      '직접 저장을 사용할 수 없어 다운로드 링크를 준비했습니다.',
    );
    const link = page.getByTestId('n6-download-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /mock-presigned/);
    // export 자체는 실패가 아니다
    await expect(page.getByTestId('n6-export-error')).toHaveCount(0);
    await expect(page.getByTestId('n6-download-error')).toHaveCount(0);
    await expect(page.getByTestId('n6-direct-save-done')).toHaveCount(0);
    expect(count(order, EXPORT_POST)).toBe(1);
    expect(count(order, DOWNLOAD_GET)).toBe(1);
    expect(fs.map((e) => e.op)).toEqual(['showDirectoryPicker']); // 파일을 만들지 않는다
  });

  test('E. POST /export 가 실패하면 download GET 과 파일 쓰기 없이 기존 오류를 보여 준다', async ({ page }) => {
    const order = trackOrder(page);
    const fs = await installFakeDirectoryPicker(page, order);
    await reachN6(page);
    order.length = 0;

    await setMockFlag(page, MOCK_EXPORT_FAIL_ONCE_FLAG);
    await page.getByTestId('n6-export-button').click();

    await expect(page.getByTestId('n6-export-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('n6-export-button')).toBeEnabled();
    await expect(page.getByTestId('n6-direct-save-progress')).toHaveCount(0);
    expect(count(order, EXPORT_POST)).toBe(1);
    expect(count(order, DOWNLOAD_GET)).toBe(0);
    expect(count(order, PRESIGNED_GET)).toBe(0);
    expect(fs.map((e) => e.op)).toEqual(['showDirectoryPicker']);
  });

  test('F. download GET 이 404 면 파일을 쓰지 않고 오류를 보이며, 다시 시도하면 새 artifactId 로 저장된다', async ({
    page,
  }) => {
    const order = trackOrder(page);
    const fs = await installFakeDirectoryPicker(page, order);
    await reachN6(page);
    order.length = 0;

    await setMockFlag(page, MOCK_EXPORT_DOWNLOAD_NOT_FOUND_ONCE_FLAG);
    const firstExport = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
    );
    await page.getByTestId('n6-export-button').click();
    const firstBody = await (await firstExport).json();

    await expect(page.getByTestId('n6-download-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('n6-export-button')).toBeEnabled();
    expect(count(order, PRESIGNED_GET)).toBe(0);
    expect(fs.map((e) => e.op)).toEqual(['showDirectoryPicker']);

    // 다시 시도 — 새 POST → 새 artifactId → 새 GET
    const retryExport = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
    );
    await page.getByTestId('n6-export-button').click();
    const retryBody = await (await retryExport).json();
    expect(retryBody.artifactId).not.toBe(firstBody.artifactId);

    await expect(page.getByTestId('n6-direct-save-done')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('n6-download-error')).toHaveCount(0);
    expect(order.filter((o) => o === EXPORT_POST || DOWNLOAD_GET.test(o))).toEqual([
      EXPORT_POST,
      `GET /jobs/${MOCK_JOB_ID}/exports/${firstBody.artifactId}/download`,
      EXPORT_POST,
      `GET /jobs/${MOCK_JOB_ID}/exports/${retryBody.artifactId}/download`,
    ]);
    expect(fs.map((e) => e.op)).toEqual([
      'showDirectoryPicker',
      'showDirectoryPicker',
      'getFileHandle',
      'createWritable',
      'write',
      'close',
    ]);
  });
});

test.describe('미지원 / insecure 환경 — 기존 다운로드 링크 fallback', () => {
  test('C-1. showDirectoryPicker 가 없으면 기존 export → download 링크 흐름을 그대로 쓴다', async ({ page }) => {
    const order = trackOrder(page);
    await disableDirectoryPicker(page);
    await reachN6(page);
    order.length = 0;

    await page.getByTestId('n6-export-button').click();
    const link = page.getByTestId('n6-download-link');
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expect(link).toHaveAttribute('href', /mock-presigned/);
    await expect(page.getByTestId('n6-direct-save-done')).toHaveCount(0);
    await expect(page.getByTestId('n6-direct-save-fallback')).toHaveCount(0);
    expect(count(order, EXPORT_POST)).toBe(1);
    expect(count(order, DOWNLOAD_GET)).toBe(1);
    expect(count(order, PRESIGNED_GET)).toBe(0); // FE 가 직접 내려받지 않는다
  });

  test('C-2. insecure context 이면 picker 가 있어도 쓰지 않고 기존 다운로드 링크 흐름을 쓴다', async ({ page }) => {
    const order = trackOrder(page);
    const fs = await installFakeDirectoryPicker(page, order);
    await forceInsecureContext(page);
    await reachN6(page);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    order.length = 0;

    await page.getByTestId('n6-export-button').click();
    await expect(page.getByTestId('n6-download-link')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('n6-direct-save-done')).toHaveCount(0);
    expect(fs).toEqual([]);
    expect(count(order, EXPORT_POST)).toBe(1);
    expect(count(order, DOWNLOAD_GET)).toBe(1);
  });

  test('C-3. 이 API 가 없는 브라우저(Firefox/WebKit)는 아무 설정 없이도 기존 다운로드 링크를 쓴다', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === 'chromium', 'Chromium 은 실제 showDirectoryPicker 가 있어 C-1 로 검증한다');
    expect(await page.evaluate(() => 'showDirectoryPicker' in window)).toBe(false);
    await reachN6(page);

    await page.getByTestId('n6-export-button').click();
    await expect(page.getByTestId('n6-download-link')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('n6-direct-save-done')).toHaveCount(0);
  });
});
