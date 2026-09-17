import { test, expect, type Request } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// /jobs/{jobId} 페이지 ↔ API rewrite 충돌 회귀 테스트.
//
// 배경: app/jobs/[jobId]/page.tsx(Next 페이지 라우트)와 백엔드 API(getJob 등,
// lib/api/pixate.ts)가 완전히 같은 경로 `/jobs/{jobId}`를 공유한다.
// next.config.ts의 backend rewrite(`/jobs/:path*`)가 경로만 보고 매칭되면
// 동적 페이지 라우트보다 먼저 걸려(afterFiles가 동적 라우트보다 앞에서
// 매칭됨 — Next 공식 rewrites 문서 확인, fix/jobs-rewrite-conflict-investigation
// 조사 결과) 페이지 navigation까지 백엔드로 프록시되어 버렸다.
//
// 수정: apiFetch(및 patchN5Block/confirmN5)가 내부 식별 헤더
// `x-pixate-api-proxy`를 붙이고, next.config.ts의 `/jobs/:path*` rewrite는
// 그 헤더가 있을 때만 매칭되게 했다. 이 테스트는 실제 pixate-api 호스트가
// 필요 없다 — mock(MSW)만 켠 상태에서 "document navigation은 헤더 없이
// 페이지에 도달하고, API fetch만 헤더를 달고 나간다"는 구분 자체만 검증한다
// (ENOTFOUND를 성공 조건으로 삼지 않는다).
// ─────────────────────────────────────────────────────────────────

const PROXY_HEADER = 'x-pixate-api-proxy';

test('mock enabled — /jobs/{jobId} document navigation은 헤더 없이 페이지에 도달하고, API fetch만 프록시 식별 헤더를 단다', async ({
  page,
}) => {
  const requests: Request[] = [];
  page.on('request', (req) => requests.push(req));

  // 1. document navigation으로 직접 진입 (N1을 거치지 않는다 — mock 기본
  // job(job_mock_001)은 이미 analyzing/N2 상태로 시작한다).
  const navResponse = await page.goto(`/jobs/${MOCK_JOB_ID}`);

  // 2. 페이지 요청은 200
  expect(navResponse?.status()).toBe(200);

  // 3. document request에는 x-pixate-api-proxy가 없음
  const documentRequest = requests.find(
    (r) => r.resourceType() === 'document' && new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}`,
  );
  expect(documentRequest, 'document navigation 요청을 찾지 못했다').toBeDefined();
  expect(documentRequest!.headers()[PROXY_HEADER]).toBeUndefined();

  // 7. 페이지가 실제로 정상 렌더됐는지 — 프록시됐다면 이 화면 자체가
  // 뜨지 않고 500이 났을 것이다(2번 상태코드 200과 함께, "프록시 안 됨"의
  // 직접적 증거이기도 하다 — 4번은 별도 assertion 없이 2·3·7로 함께 증명됨).
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByText('완료되면 자동으로 다음 단계로 이동합니다.')).toBeVisible();

  // 5~6. 페이지 로드 후 발생하는 /jobs/... API fetch(tasks 폴링 등)에는
  // 헤더가 붙고, MSW가 정상 응답했으므로 화면이 위에서 이미 렌더된 상태다.
  await page.waitForTimeout(500); // tasks 첫 폴링 응답까지 짧게 대기
  const apiRequests = requests.filter(
    (r) => r !== documentRequest && r.resourceType() !== 'document' && r.url().includes(`/jobs/${MOCK_JOB_ID}`),
  );
  expect(apiRequests.length, '/jobs/... API fetch가 최소 1건 있어야 한다').toBeGreaterThan(0);
  for (const req of apiRequests) {
    expect(req.headers()[PROXY_HEADER], `${req.url()} 요청에 프록시 식별 헤더가 없다`).toBe('1');
  }

  // 추가: /tasks 하위 API 요청에도 헤더가 붙는지 별도 확인
  const tasksRequest = apiRequests.find((r) => new URL(r.url()).pathname === `/jobs/${MOCK_JOB_ID}/tasks`);
  expect(tasksRequest, '/jobs/{jobId}/tasks 요청을 찾지 못했다').toBeDefined();
  expect(tasksRequest!.headers()[PROXY_HEADER]).toBe('1');
});
