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

// lib/msw/handlers.ts MOCK_EXPORT_FAIL_ONCE_FLAG 와 같은 값(핸들러 모듈을 Node 쪽 시험에서 불러오지 않으려고 문자열로 둔다)
const MOCK_EXPORT_FAIL_ONCE_FLAG = '__pixlateMockExportFailOnce';

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

test('기본 선택 묶음 내보내기는 그대로 zip 하나를 만들어 내려받는다', async ({ page }) => {
  const requests = track(page);
  await reachN6(page);

  const exported = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
  );
  await page.getByTestId('n6-export-button').click();
  const body = await (await exported).json();
  await expect(page.getByTestId('n6-download-link')).toBeVisible({ timeout: 10_000 });

  expect(new Set(JSON.parse(exportPosts(requests)[0].body ?? '{}').components)).toEqual(new Set(['images', 'html']));
  expect(body.artifactType).toBe('zip');
  expect(downloads(requests).map((r) => r.path)).toEqual([`/jobs/${MOCK_JOB_ID}/exports/${body.artifactId}/download`]);
  await expect(page.getByTestId('n6-download-link')).toHaveAttribute('href', /export\.zip/);
});
