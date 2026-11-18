import { test, expect, type Page } from '@playwright/test';

import { reachN6 } from './helpers/reach-n6';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N6 [선택 항목 내보내기] — 브라우저 기본 다운로드 e2e.
//
// 계약: POST /jobs/{jobId}/export → artifactId → GET /jobs/{jobId}/exports/{artifactId}/download
// → presigned url 로 브라우저 기본 다운로드. 로컬 폴더 선택(File System Access API showDirectoryPicker)을 쓰지 않는다.
// picker 가 있는 브라우저에서도 부르지 않는지 보려고 호출을 세는 가짜 picker 를 둔다. Mock 이다.
// ─────────────────────────────────────────────────────────────────

// lib/msw/handlers.ts 의 같은 이름 상수와 같은 값
const MOCK_EXPORT_FAIL_ONCE_FLAG = '__pixlateMockExportFailOnce';
const MOCK_EXPORT_DOWNLOAD_NOT_FOUND_ONCE_FLAG = '__pixlateMockExportDownloadNotFoundOnce';

const EXPORT_POST = `POST /jobs/${MOCK_JOB_ID}/export`;
const DOWNLOAD_GET = new RegExp(`^GET /jobs/${MOCK_JOB_ID}/exports/\\d+/download$`);

async function setMockFlag(page: Page, flag: string) {
  await page.evaluate((f) => {
    (globalThis as Record<string, unknown>)[f] = true;
  }, flag);
}

/** export·download API 요청을 순서대로 기록한다 */
function trackOrder(page: Page): string[] {
  const order: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith(`/jobs/${MOCK_JOB_ID}/export`)) order.push(`${req.method()} ${url.pathname}`);
  });
  return order;
}

/** showDirectoryPicker 를 호출 수만 세는 가짜로 바꾼다(지원 브라우저라도 폴더 선택 창이 열리면 안 된다) */
async function spyDirectoryPicker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __pickerCalls: number };
    w.__pickerCalls = 0;
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      writable: true,
      value: () => {
        w.__pickerCalls += 1;
        return Promise.reject(new DOMException('spy', 'AbortError'));
      },
    });
  });
}
const pickerCalls = (page: Page) => page.evaluate(() => (window as unknown as { __pickerCalls: number }).__pickerCalls);

test('A. 기본 선택(images/ + content.csv) 내보내기 — 폴더 선택 없이 POST /export → artifactId → GET download → 브라우저 다운로드', async ({
  page,
}) => {
  const order = trackOrder(page);
  await spyDirectoryPicker(page);
  await reachN6(page);
  order.length = 0;

  const exported = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`);
  const browserDownload = page.waitForEvent('download', { timeout: 10_000 });
  await page.getByTestId('n6-export-button').click();
  const exportBody = await (await exported).json();
  expect(typeof exportBody.artifactId).toBe('number');
  const download = await browserDownload;
  expect(download.url()).toMatch(/mock-presigned/);

  expect(order).toEqual([EXPORT_POST, `GET /jobs/${MOCK_JOB_ID}/exports/${exportBody.artifactId}/download`]);
  expect(await pickerCalls(page)).toBe(0);
  await expect(page.getByTestId('n6-export-error')).toHaveCount(0);
  await expect(page.getByTestId('n6-download-error')).toHaveCount(0);
  await expect(page.getByTestId('n6-export-button')).toBeEnabled();
});

test('E. POST /export 가 실패하면 download GET 없이 내보내기 오류를 보여 준다', async ({ page }) => {
  const order = trackOrder(page);
  await spyDirectoryPicker(page);
  await reachN6(page);
  order.length = 0;

  await setMockFlag(page, MOCK_EXPORT_FAIL_ONCE_FLAG);
  await page.getByTestId('n6-export-button').click();

  await expect(page.getByTestId('n6-export-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('n6-download-error')).toHaveCount(0);
  await expect(page.getByTestId('n6-export-button')).toBeEnabled();
  expect(order.filter((o) => o === EXPORT_POST)).toHaveLength(1);
  expect(order.filter((o) => DOWNLOAD_GET.test(o))).toHaveLength(0);
  expect(await pickerCalls(page)).toBe(0);
});

test('F. download GET 이 404 면 다운로드 오류(내보내기 오류와 구분)를 보이고, 다시 시도하면 새 artifactId 로 내려받는다', async ({ page }) => {
  const order = trackOrder(page);
  await reachN6(page);
  order.length = 0;

  await setMockFlag(page, MOCK_EXPORT_DOWNLOAD_NOT_FOUND_ONCE_FLAG);
  const firstExport = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`);
  await page.getByTestId('n6-export-button').click();
  const firstBody = await (await firstExport).json();

  await expect(page.getByTestId('n6-download-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('n6-export-error')).toHaveCount(0);
  await expect(page.getByTestId('n6-export-button')).toBeEnabled();

  const retryExport = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`);
  const browserDownload = page.waitForEvent('download', { timeout: 10_000 });
  await page.getByTestId('n6-export-button').click();
  const retryBody = await (await retryExport).json();
  expect(retryBody.artifactId).not.toBe(firstBody.artifactId);
  await browserDownload;
  await expect(page.getByTestId('n6-download-error')).toHaveCount(0);
  expect(order).toEqual([
    EXPORT_POST,
    `GET /jobs/${MOCK_JOB_ID}/exports/${firstBody.artifactId}/download`,
    EXPORT_POST,
    `GET /jobs/${MOCK_JOB_ID}/exports/${retryBody.artifactId}/download`,
  ]);
});
