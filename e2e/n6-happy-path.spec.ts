import { test, expect } from '@playwright/test';

import { reachN6 } from './helpers/reach-n6';
import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N6 — 저장 및 내보내기 happy path e2e.
//
// render(POST) → tasks polling(GET, job 단위 render task) → deliverables(GET)
// → validation(GET) → export(POST) → exports/{artifactId}/download(GET) →
// save(POST) 전체 흐름을 새로고침 없이 검증한다. mock은 render task를 confirm
// 시점에 자동 등록하므로(lib/msw/handlers.ts), 이 테스트는 수동 POST /render
// 호출 없이도 renderStatus가 done까지 진행되는 것을 확인한다.
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
  // reachN6이 이미 "번역이 완료됐습니다" 헤딩까지 기다렸다 — 이는 job 단위
  // render task(taskType=render, unitType='job')가 GET /tasks polling으로
  // done에 도달했다는 뜻이다. confirm이 자동 등록했으므로 수동 POST /render는
  // 호출되지 않아야 한다(계약: "N6 진입 시 무조건 다시 호출하지 않는다").
  expect(requests.some((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/render`)).toBe(false);
  expect(requests.some((r) => r.method === 'GET' && r.path === `/jobs/${MOCK_JOB_ID}/tasks`)).toBe(true);

  // ── deliverables / validation ────────────────────────────────
  await expect(page.getByRole('heading', { name: '결과 이미지' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '규격 검증' })).toBeVisible();
  expect(requests.some((r) => r.method === 'GET' && r.path === `/jobs/${MOCK_JOB_ID}/deliverables`)).toBe(true);
  expect(requests.some((r) => r.method === 'GET' && r.path === `/jobs/${MOCK_JOB_ID}/validation`)).toBe(true);

  // 기본 선택: images/csv만 체크된 상태로 로드된다 (Figma 산출물 목록 기준)
  await expect(page.locator('#artifact-images')).toBeChecked();
  await expect(page.locator('#artifact-csv')).toBeChecked();
  await expect(page.locator('#artifact-html')).not.toBeChecked();
  await expect(page.locator('#artifact-psd')).toBeDisabled();
  await expect(page.getByText('12월 제공 예정')).toBeVisible();

  // ── export 실행 ───────────────────────────────────────────────
  await page.getByTestId('n6-export-button').click();

  await expect(page.getByTestId('n6-download-link')).toBeVisible({ timeout: 10_000 });

  const exportReq = requests.find((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/export`);
  expect(exportReq).toBeDefined();
  const exportBody = JSON.parse(exportReq!.body ?? '{}');
  expect(new Set(exportBody.components)).toEqual(new Set(['images', 'csv']));

  // ── download URL 획득 (mock presigned, 실제 파일 생성 없음) ───────
  const downloadReq = requests.find(
    (r) => r.method === 'GET' && /^\/jobs\/job_mock_001\/exports\/\d+\/download$/.test(r.path),
  );
  expect(downloadReq).toBeDefined();
  const href = await page.getByTestId('n6-download-link').getAttribute('href');
  expect(href).toContain('mock-presigned');
  expect(href).toContain('export.zip');

  // ── save 실행 ─────────────────────────────────────────────────
  await page.getByTestId('n6-save-button').click();
  await expect(page.getByText('보관함에 저장됨')).toBeVisible({ timeout: 10_000 });
  expect(requests.some((r) => r.method === 'POST' && r.path === `/jobs/${MOCK_JOB_ID}/save`)).toBe(true);

  // ── 새로고침 없이 전체 흐름 유지 ────────────────────────────────
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  await expect(page.getByRole('heading', { name: '번역이 완료됐습니다' })).toBeVisible();
});
