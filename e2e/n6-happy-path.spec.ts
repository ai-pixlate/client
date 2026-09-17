import { test, expect } from '@playwright/test';

import { reachN6 } from './helpers/reach-n6';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N6 — 저장 및 내보내기 happy path e2e (Figma node 643:5523 최종 UI 기준).
//
// render(POST) → tasks polling(GET, job 단위 render task) → deliverables(GET)
// → validation(GET) → export(POST, 묶음) → exports/{artifactId}/download(GET)
// → export/download?artifactType=(GET, 행별 개별) → save(POST) 전체 흐름을
// 새로고침 없이 검증한다. mock은 render task를 confirm 시점에 자동 등록하므로
// (lib/msw/handlers.ts), 이 테스트는 수동 POST /render 호출 없이도 render가
// done까지 진행되는 것을 확인한다.
// ─────────────────────────────────────────────────────────────────

test('render → deliverables → validation → export → download → save 전체 흐름이 새로고침 없이 이어진다', async ({
  page,
}) => {
  // reachN6(=reachN5 + confirm)이 내는 요청까지 전부 잡아야 하므로, 페이지
  // 이동 전에 리스너부터 붙인다(beforeEach로 reachN6을 먼저 호출하면 그 동안의
  // 요청을 놓친다).
  const requests: { method: string; path: string; body?: string }[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith(`/jobs/${MOCK_JOB_ID}`)) {
      requests.push({ method: req.method(), path: url.pathname + url.search, body: req.postData() ?? undefined });
    }
  });

  await reachN6(page);

  // ── render → tasks polling ───────────────────────────────────
  // reachN6이 이미 완료 배너("번역이 완료되었습니다.")까지 기다렸다 — 이는
  // job 단위 render task(taskType=render, unitType='job')가 GET /tasks
  // polling으로 done에 도달했다는 뜻이다. confirm이 자동 등록했으므로 수동
  // POST /render는 호출되지 않아야 한다(계약: "N6 진입 시 무조건 다시
  // 호출하지 않는다").
  expect(requests.some((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/render`)).toBe(false);
  expect(requests.some((r) => r.method === 'GET' && r.path === `/jobs/${MOCK_JOB_ID}/tasks`)).toBe(true);

  // ── StepNav + 헤더가 Figma대로 붙어 있다 ─────────────────────────
  await expect(page.getByRole('heading', { name: '저장 및 내보내기' })).toBeVisible();
  await expect(page.getByRole('link', { name: '보관함으로 나가기' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '작업 진행 단계' })).toBeVisible();

  // ── deliverables / validation ────────────────────────────────
  await expect(page.getByTestId('n6-final-preview')).toBeVisible();
  await expect(page.getByTestId('n6-preview-canvas')).toBeVisible();
  expect(requests.some((r) => r.method === 'GET' && r.path === `/jobs/${MOCK_JOB_ID}/deliverables`)).toBe(true);
  expect(requests.some((r) => r.method === 'GET' && r.path === `/jobs/${MOCK_JOB_ID}/validation`)).toBe(true);

  // 기본 선택: images/csv만 체크된 상태로 로드된다 (Figma 산출물 목록 기준)
  await expect(page.locator('#artifact-images')).toBeChecked();
  await expect(page.locator('#artifact-csv')).toBeChecked();
  await expect(page.locator('#artifact-html')).not.toBeChecked();
  await expect(page.locator('#artifact-psd')).toBeDisabled();
  await expect(page.getByText('12월 제공 예정')).toBeVisible();

  // ── HTML 선택/해제 ────────────────────────────────────────────
  await page.locator('label[for="artifact-html"]').click();
  await expect(page.locator('#artifact-html')).toBeChecked();
  await expect(page.getByText('선택된 산출물 3개')).toBeVisible();
  await page.locator('label[for="artifact-html"]').click();
  await expect(page.locator('#artifact-html')).not.toBeChecked();
  await expect(page.getByText('선택된 산출물 2개')).toBeVisible();

  // ── 개별 다운로드(행별, artifactType 쿼리) ─────────────────────────
  await page.getByTestId('n6-download-row-csv').click();
  await expect(page.getByTestId('n6-download-row-csv')).toHaveText('다운로드', { timeout: 10_000 });
  const byTypeReq = requests.find(
    (r) => r.method === 'GET' && r.path === `/jobs/${MOCK_JOB_ID}/export/download?artifactType=csv`,
  );
  expect(byTypeReq).toBeDefined();
  const rowHref = await page.getByTestId('n6-download-row-csv').getAttribute('href');
  expect(rowHref).toContain('mock-presigned-bytype-csv');
  expect(rowHref).toContain('export.csv');

  // ── export 실행(묶음 선택) ────────────────────────────────────────
  await page.getByTestId('n6-export-button').click();

  await expect(page.getByTestId('n6-download-link')).toBeVisible({ timeout: 10_000 });

  const exportReq = requests.find((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/export`);
  expect(exportReq).toBeDefined();
  const exportBody = JSON.parse(exportReq!.body ?? '{}');
  expect(new Set(exportBody.components)).toEqual(new Set(['images', 'csv']));

  // ── download URL 획득 (mock presigned, 실제 파일 생성 없음) ───────
  const downloadReq = requests.find(
    (r) => r.method === 'GET' && new RegExp(`^/jobs/${MOCK_JOB_ID}/exports/\\d+/download$`).test(r.path),
  );
  expect(downloadReq).toBeDefined();
  const href = await page.getByTestId('n6-download-link').getAttribute('href');
  expect(href).toContain('mock-presigned');
  expect(href).toContain('export.zip');

  // ── save 실행 ─────────────────────────────────────────────────
  await page.getByTestId('n6-save-button').click();
  await expect(page.getByTestId('n6-save-done')).toBeVisible({ timeout: 10_000 });
  expect(requests.some((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/save`)).toBe(true);

  // ── 새로고침 없이 전체 흐름 유지 ────────────────────────────────
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible();
});
