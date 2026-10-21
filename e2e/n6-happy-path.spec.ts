import { test, expect } from '@playwright/test';

import { reachN6 } from './helpers/reach-n6';
import { disableDirectoryPicker } from './helpers/directory-picker';
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

// "선택 항목 내보내기"는 지원 환경(Chromium localhost = secure context)에서 폴더 선택 창을 연다.
// 이 파일은 기존 다운로드 링크 흐름을 검증하므로 picker 를 없앤 미지원 환경으로 고정한다
// (폴더 저장 흐름은 e2e/n6-folder-save.spec.ts).
test.beforeEach(async ({ page }) => {
  await disableDirectoryPicker(page);
});

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

  // 기본 선택: DEFAULT_SELECTED_TYPES(images/ + content.csv, PM 확정 — n6-result-view.tsx 참고).
  // HTML·PSD 는 1.0.0 에서 제공하지 않아 비활성·미체크이고, 행 우측에 "12월 제공 예정"만 보인다.
  await expect(page.locator('#artifact-images')).toBeChecked();
  await expect(page.locator('#artifact-csv')).toBeChecked();
  await expect(page.locator('#artifact-html')).not.toBeChecked();
  await expect(page.locator('#artifact-html')).toBeDisabled();
  await expect(page.locator('#artifact-psd')).not.toBeChecked();
  await expect(page.locator('#artifact-psd')).toBeDisabled();
  await expect(page.getByText('선택된 산출물 2개')).toBeVisible();
  const artifactRow = (type: string) =>
    page
      .locator('[data-testid="n6-export-panel"] div.flex.w-full.items-center.gap-4')
      .filter({ has: page.locator(`#artifact-${type}`) });
  await expect(page.getByText('12월 제공 예정')).toHaveCount(2);
  await expect(artifactRow('html')).toContainText('12월 제공 예정');
  await expect(artifactRow('psd')).toContainText('12월 제공 예정');
  // HTML·PSD 행에는 개별 다운로드 컨트롤이 없다
  await expect(page.getByTestId('n6-download-row-html')).toHaveCount(0);
  await expect(page.getByTestId('n6-download-row-psd')).toHaveCount(0);

  // 9/23 — 표시 순서: images → HTML → content.csv → PSD (backend type 값은
  // 그대로, ARTIFACT_DISPLAY_ORDER로 presentation만 재정렬). 각 행 라벨을
  // DOM 등장 순서 그대로 읽어 순서 자체를 회귀 검증한다.
  const labelTexts = await page
    .locator('[data-testid="n6-export-panel"] div.flex.w-full.items-center.gap-4 label span')
    .allTextContents();
  expect(labelTexts.filter((_, i) => i % 2 === 0)).toEqual(['images/', 'HTML', 'content.csv', 'PSD']);

  // ── content.csv 해제/재선택 ──────────────────────────────────────
  await page.locator('label[for="artifact-csv"]').click();
  await expect(page.locator('#artifact-csv')).not.toBeChecked();
  await expect(page.getByText('선택된 산출물 1개')).toBeVisible();
  await page.locator('label[for="artifact-csv"]').click();
  await expect(page.locator('#artifact-csv')).toBeChecked();
  await expect(page.getByText('선택된 산출물 2개')).toBeVisible();

  // ── 개별 다운로드(행별) — POST /export {components:[csv]} → 응답 artifactId 로 다운로드 ──
  const rowExport = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export`,
  );
  await page.getByTestId('n6-download-row-csv').click();
  const rowExportBody = await (await rowExport).json();
  await expect(page.getByTestId('n6-download-row-csv')).toHaveText('다운로드', { timeout: 10_000 });
  expect(JSON.parse(requests.find((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/export`)!.body ?? '{}'))
    .toEqual({ components: ['csv'] });
  expect(rowExportBody.artifactType).toBe('csv');
  expect(
    requests.some((r) => r.method === 'GET' && r.path === `/jobs/${MOCK_JOB_ID}/exports/${rowExportBody.artifactId}/download`),
  ).toBe(true);
  expect(requests.some((r) => r.path.startsWith(`/jobs/${MOCK_JOB_ID}/export/download`))).toBe(false);
  const rowHref = await page.getByTestId('n6-download-row-csv').getAttribute('href');
  expect(rowHref).toContain(`mock-presigned-${rowExportBody.artifactId}`);
  expect(rowHref).toContain('export.csv');

  // ── export 실행(기본 묶음 선택 images/ + content.csv) ────────────────
  const bundleExport = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/export` &&
      new Set(JSON.parse(r.request().postData() ?? '{}').components ?? []).size === 2,
  );
  await page.getByTestId('n6-export-button').click();
  const bundleExportBody = await (await bundleExport).json();
  expect(bundleExportBody.artifactType).toBe('zip');

  await expect(page.getByTestId('n6-download-link')).toBeVisible({ timeout: 10_000 });

  // 행 다운로드가 먼저 POST /export 를 한 번 냈으므로, 묶음 내보내기는 그 다음 요청이다
  const exportReq = requests.filter((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/export`)[1];
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
