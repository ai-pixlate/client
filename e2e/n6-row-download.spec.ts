import { test, expect, type Page } from '@playwright/test';

import { reachN6 } from './helpers/reach-n6';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N6 행별 개별 다운로드 회귀(F1 운영 검증 결함).
//
// 계약상 타입별 다운로드(GET /export/download)는 이미 만든 구성요소만 돌려준다(미생성 404).
// 행 다운로드는 POST /export {components:[type]} → 응답 artifactId 로
// GET /exports/{artifactId}/download 를 불러야 한다. mock 도 계약대로 "미생성 404"를 재현한다.
// ─────────────────────────────────────────────────────────────────

// lib/msw/handlers.ts 의 같은 이름 상수와 같은 값(핸들러 모듈을 Node 쪽 시험에서 불러오지 않으려고 문자열로 둔다)
const MOCK_EXPORT_FAIL_ONCE_FLAG = '__pixlateMockExportFailOnce';
const MOCK_EXPORT_NO_ARTIFACT_ID_ONCE_FLAG = '__pixlateMockExportNoArtifactIdOnce';
const MOCK_EXPORT_DOWNLOAD_NOT_FOUND_ONCE_FLAG = '__pixlateMockExportDownloadNotFoundOnce';

async function setMockFlag(page: Page, flag: string) {
  await page.evaluate((f) => {
    (globalThis as Record<string, unknown>)[f] = true;
  }, flag);
}

function collectPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  return errors;
}

type Req = { method: string; path: string; body?: string };

function track(page: Page): Req[] {
  const requests: Req[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith(`/jobs/${MOCK_JOB_ID}`)) {
      requests.push({ method: req.method(), path: url.pathname + url.search, body: req.postData() ?? undefined });
    }
  });
  return requests;
}

const exportPosts = (rs: Req[]) => rs.filter((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/export`);
const downloads = (rs: Req[]) =>
  rs.filter((r) => r.method === 'GET' && new RegExp(`^/jobs/${MOCK_JOB_ID}/exports?/`).test(r.path) && r.path.includes('download'));

test('CSV 를 아직 만들지 않은 상태에서 개별 다운로드가 생성 → artifactId 다운로드 순서로 성공한다', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);

  // mock 이 계약대로 미생성 구성요소를 404 로 돌려주는지(수정 전 흐름이 실패했던 이유)
  const before = await page.evaluate(async (jobId) => {
    const r = await fetch(`/jobs/${jobId}/export/download?artifactType=csv`, { headers: { 'x-pixlate-api-proxy': '1' } });
    return r.status;
  }, MOCK_JOB_ID);
  expect(before).toBe(404);

  const exported = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
  );
  await page.getByTestId('n6-download-row-csv').click();
  const body = await (await exported).json();
  await expect(page.getByTestId('n6-download-row-csv')).toHaveText('다운로드', { timeout: 10_000 });

  expect(exportPosts(requests).map((r) => JSON.parse(r.body ?? '{}'))).toEqual([{ components: ['csv'] }]);
  expect(body).toMatchObject({ artifactType: 'csv', components: ['csv'] });
  const dl = downloads(requests).filter((r) => !r.path.includes('artifactType'));
  expect(dl.map((r) => r.path)).toEqual([`/jobs/${MOCK_JOB_ID}/exports/${body.artifactId}/download`]);
  await expect(page.getByTestId('n6-download-row-csv')).toHaveAttribute('href', new RegExp(`mock-presigned-${body.artifactId}`));
  await expect(page.getByTestId('n6-download-row-error-csv')).toHaveCount(0);
});

test('생성(POST /export)이 실패하면 다운로드 요청을 보내지 않고 오류를 보여 준다', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);

  await page.evaluate((flag) => {
    (globalThis as Record<string, unknown>)[flag] = true;
  }, MOCK_EXPORT_FAIL_ONCE_FLAG);
  await page.getByTestId('n6-download-row-csv').click();
  await expect(page.getByTestId('n6-download-row-error-csv')).toBeVisible({ timeout: 10_000 });

  expect(exportPosts(requests)).toHaveLength(1);
  expect(downloads(requests).filter((r) => !r.path.includes('artifactType'))).toHaveLength(0);
  await expect(page.getByTestId('n6-download-row-csv')).toHaveText('개별 다운로드');
});

test('빠른 연속 클릭에도 생성 요청은 한 번만 나간다', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);

  const button = page.getByTestId('n6-download-row-csv');
  await button.evaluate((el) => {
    (el as HTMLButtonElement).click();
    (el as HTMLButtonElement).click();
    (el as HTMLButtonElement).click();
  });
  await expect(button).toHaveText('다운로드', { timeout: 10_000 });
  expect(exportPosts(requests)).toHaveLength(1);
});

test('생성은 성공했지만 응답에 artifactId 가 없으면 다운로드 요청을 보내지 않고 오류를 보여 준다', async ({ page }) => {
  const requests = track(page);
  const pageErrors = collectPageErrors(page);
  await reachN6(page);

  await setMockFlag(page, MOCK_EXPORT_NO_ARTIFACT_ID_ONCE_FLAG);
  const exported = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
  );
  await page.getByTestId('n6-download-row-csv').click();
  const res = await exported;
  expect(res.status()).toBe(201);
  expect((await res.json()).artifactId).toBeUndefined();
  await expect(page.getByTestId('n6-download-row-error-csv')).toBeVisible({ timeout: 10_000 });

  expect(exportPosts(requests)).toHaveLength(1);
  expect(downloads(requests)).toHaveLength(0);
  await expect(page.getByTestId('n6-download-row-csv')).toHaveText('개별 다운로드');
  expect(pageErrors).toEqual([]);
});

test('생성 후 GET /exports/{artifactId}/download 가 404 면 오류를 보여 주고 화면은 유지된다', async ({ page }) => {
  const requests = track(page);
  const pageErrors = collectPageErrors(page);
  await reachN6(page);

  await setMockFlag(page, MOCK_EXPORT_DOWNLOAD_NOT_FOUND_ONCE_FLAG);
  const exported = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
  );
  const downloaded = page.waitForResponse(
    (r) => r.request().method() === 'GET' && /\/exports\/\d+\/download$/.test(new URL(r.url()).pathname),
  );
  await page.getByTestId('n6-download-row-csv').click();
  const body = await (await exported).json();
  const dlRes = await downloaded;

  expect(dlRes.status()).toBe(404);
  await expect(page.getByTestId('n6-download-row-error-csv')).toBeVisible({ timeout: 10_000 });
  expect(exportPosts(requests).map((r) => JSON.parse(r.body ?? '{}'))).toEqual([{ components: ['csv'] }]);
  expect(downloads(requests).map((r) => r.path)).toEqual([`/jobs/${MOCK_JOB_ID}/exports/${body.artifactId}/download`]);

  // 화면이 깨지지 않고 다시 시도할 수 있는 상태로 남는다
  await expect(page.getByTestId('n6-download-row-csv')).toHaveText('개별 다운로드');
  await expect(page.getByTestId('n6-download-row-csv')).toBeEnabled();
  await expect(page.getByTestId('n6-export-panel')).toBeVisible();
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('HTML·PSD 는 비활성이고 기본 선택에 들어가지 않으며, POST /export 는 html·psd 가 섞이면 400 이다', async ({ page }) => {
  await reachN6(page);

  await expect(page.locator('#artifact-html')).toBeDisabled();
  await expect(page.locator('#artifact-html')).not.toBeChecked();
  await expect(page.getByTestId('n6-download-row-html')).toBeDisabled();
  await expect(page.locator('#artifact-psd')).toBeDisabled();
  await expect(page.locator('#artifact-psd')).not.toBeChecked();
  await expect(page.getByTestId('n6-download-row-psd')).toHaveCount(0);

  // mock 이 BE release/1.0.0 계약(csv·images 만 생성, 그 밖이 섞이면 전체 400)을 따르는지
  const statuses = await page.evaluate(async (jobId) => {
    const post = (components: string[]) =>
      fetch(`/jobs/${jobId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pixlate-api-proxy': '1' },
        body: JSON.stringify({ components }),
      }).then((r) => r.status);
    return { html: await post(['images', 'html']), psd: await post(['csv', 'psd']) };
  }, MOCK_JOB_ID);
  expect(statuses).toEqual({ html: 400, psd: 400 });
});

test('기본 선택(active 인 images/ 만)으로 묶음 내보내기가 성공한다', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);

  await expect(page.getByText('선택된 산출물 1개')).toBeVisible();
  const exported = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
  );
  await page.getByTestId('n6-export-button').click();
  const res = await exported;
  const body = await res.json();
  await expect(page.getByTestId('n6-download-link')).toBeVisible({ timeout: 10_000 });

  expect(res.status()).toBe(201);
  expect(JSON.parse(exportPosts(requests)[0].body ?? '{}')).toEqual({ components: ['images'] });
  expect(body).toMatchObject({ artifactType: 'images', components: ['images'] });
  expect(downloads(requests).map((r) => r.path)).toEqual([`/jobs/${MOCK_JOB_ID}/exports/${body.artifactId}/download`]);
  await expect(page.getByTestId('n6-download-link')).toHaveAttribute('href', /export\.zip/);
});

test('active 인 csv·images 를 함께 고르면 zip 하나를 만들어 내려받는다', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);

  await page.locator('label[for="artifact-csv"]').click();
  await expect(page.getByText('선택된 산출물 2개')).toBeVisible();
  const exported = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
  );
  await page.getByTestId('n6-export-button').click();
  const res = await exported;
  const body = await res.json();
  await expect(page.getByTestId('n6-download-link')).toBeVisible({ timeout: 10_000 });

  expect(res.status()).toBe(201);
  expect(new Set(JSON.parse(exportPosts(requests)[0].body ?? '{}').components)).toEqual(new Set(['images', 'csv']));
  expect(body.artifactType).toBe('zip');
  expect(downloads(requests).map((r) => r.path)).toEqual([`/jobs/${MOCK_JOB_ID}/exports/${body.artifactId}/download`]);
  await expect(page.getByTestId('n6-download-link')).toHaveAttribute('href', /export\.zip/);
});
