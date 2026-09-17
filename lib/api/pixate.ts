import type {
  SectionsResponse,
  SectionBucket,
  UpdateSectionBucketRequest,
  CreateJobRequest,
  CreateJobResponse,
} from '@/lib/api/types';
import type { ApiBlockPatch, ApiBlockPatchResponse, ApiConfirmRequest, ApiJob, ApiJobTaskStatus, ApiReviewPreview, ApiTextBlock } from '@/lib/api/n5-schema';
import type { ApiAcceptedTask } from '@/lib/api/job-schema';
import type {
  ApiRenderResponse,
  ApiDeliverableList,
  ApiValidationDetail,
  ApiExportRequest,
  ApiExportResponse,
  ApiDownloadResponse,
  ApiSaveRequest,
  ApiLibraryCard,
  ApiExportArtifactType,
} from '@/lib/api/n6-schema';

// ─────────────────────────────────────────────
// 공통 fetch 헬퍼
// ─────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `API error: ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // body가 JSON이 아닌 경우 status 기반 메시지를 그대로 사용
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/**
 * 공통 apiFetch는 실패 시 body를 버리고 문자열 message만 남긴다 — N1~N6의
 * 다른 엔드포인트는 그걸로 충분했지만, N5 PATCH block의 409
 * REVISION_CONFLICT는 error.details.current(최신 block)를 꺼내 써야 한다.
 * apiFetch 자체를 공통으로 바꾸지 않고, 이 호출 하나에서만 raw body를
 * 보존하는 에러를 던진다(lib/n5/adapter.ts의 parseApiError가 이 body를 받는다).
 */
export class ApiRequestError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API error: ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}

// ─────────────────────────────────────────────
// N1 — job 생성. 경로는 실제 OpenAPI(POST /jobs)로 맞췄다 — mock 전용 /api
// 프리픽스를 쓰지 않는다. 요청/응답 payload 자체(CreateJobRequest/
// CreateJobResponse, 실제 JobCreate/Job 계약과 다름 — 예: targetCountry 등
// N1 값을 한 번에 같이 받음)는 오늘(경로 정리) 범위가 아니라 그대로 뒀다 —
// N1을 draft-first(brandId만 POST → PATCH로 나머지 세팅) 흐름으로 다시
// 만드는 건 더 큰 화면 작업이라 별도로 다룬다.
// ─────────────────────────────────────────────

export function createJob(payload: CreateJobRequest): Promise<CreateJobResponse> {
  return apiFetch<CreateJobResponse>('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ─────────────────────────────────────────────
// N1 → N2 — 분석 시작
// ─────────────────────────────────────────────

/** 분석 시작 = N1 완료 → N2 진입 (API-ANL-01). draft 생성만으로 자동 시작되지 않는다 — 이 호출이 게이트다. */
export function analyzeJob(jobId: string): Promise<ApiAcceptedTask> {
  return apiFetch<ApiAcceptedTask>(`/jobs/${jobId}/analyze`, { method: 'POST' });
}

// ─────────────────────────────────────────────
// N3 — 섹션
// ─────────────────────────────────────────────

export function getSections(jobId: string): Promise<SectionsResponse> {
  return apiFetch<SectionsResponse>(`/jobs/${jobId}/sections`);
}

/**
 * 실제 OpenAPI(SectionPatch)는 body가 `{ bucket }`이 아니라 `{ action:
 * 'exclude'|'restore' }`다(F-CFM-14). 호출부(UpdateSectionBucketRequest)는
 * 그대로 bucket 기준으로 두고, 이 함수 안에서만 실제 wire body로 변환한다.
 */
export function updateSectionBucket(
  jobId: string,
  sectionId: string,
  payload: UpdateSectionBucketRequest,
): Promise<{ sectionId: string; bucket: SectionBucket }> {
  const action = payload.bucket === 'exclude' ? 'exclude' : 'restore';
  return apiFetch(`/jobs/${jobId}/sections/${sectionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

/** 이대로 진행 = N3 → N4 (API-SEC-04). 전 섹션 제외면 409 ALL_SECTIONS_EXCLUDED. */
export function proceedSections(jobId: string): Promise<ApiAcceptedTask> {
  return apiFetch<ApiAcceptedTask>(`/jobs/${jobId}/sections/proceed`, { method: 'POST' });
}

// ─────────────────────────────────────────────
// N5 — 실제 계약(v3.4.2) 조회. 경로는 실제 backend 상대경로를 그대로 쓴다 —
// mock 전용 `/api/...` 프리픽스를 추가하지 않는다(CLAUDE.md 엔드포인트 규칙).
//
// 5단계: 구 /api/jobs/:jobId/review·preview(getReview/getPreview, v3.4.1
// 계약)와 구 번역 수정(updateTranslation, /api/text-blocks/:blockId/translation)은
// 실제 호출부가 전혀 남아있지 않음을 확인하고 제거했다 — N5는 이제 아래
// 함수들만 쓴다.
// ─────────────────────────────────────────────

/** N5 헤더(targetCountry/targetLanguage)용 job 조회 (API-JOB-03) */
export function getJob(jobId: string): Promise<ApiJob> {
  return apiFetch<ApiJob>(`/jobs/${jobId}`);
}

/** 섹션 단위 lazy-load. sectionId 생략 시 job 전체 블록을 받는다 (API-CFM-01) */
export function getN5Blocks(jobId: string, sectionId?: number): Promise<ApiTextBlock[]> {
  const url =
    sectionId != null
      ? `/jobs/${jobId}/blocks?sectionId=${sectionId}`
      : `/jobs/${jobId}/blocks`;
  return apiFetch<ApiTextBlock[]>(url);
}

/** N5 좌측 뷰어 다폭 프리뷰 조회 (API-CFM-03, v3.4.2) */
export function getN5Preview(jobId: string): Promise<ApiReviewPreview> {
  return apiFetch<ApiReviewPreview>(`/jobs/${jobId}/preview`);
}

/**
 * 번역문 수정 (API-CFM-02, v3.4.2). revision 낙관적 잠금 — 불일치 시 409
 * REVISION_CONFLICT(ApiRequestError로 던짐, body에 원본 Error 응답 보존).
 */
export async function patchN5Block(
  jobId: string,
  blockId: number,
  payload: ApiBlockPatch,
): Promise<ApiBlockPatchResponse> {
  const res = await fetch(`/jobs/${jobId}/blocks/${blockId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, body);
  return body as ApiBlockPatchResponse;
}

/**
 * job 비동기 큐 상태 조회 (API-JOB-05, x-screen: N2·N4·N6). N5의
 * rerenderTaskId polling(items[]에서 찾음)과 N2/N4/N6 페이지 레벨 진행 polling
 * (currentStep/userFacingStatus)이 이 하나의 엔드포인트를 공유한다 — 오늘(N1→N6
 * happy path) 작업에서 job 전체 공용으로 승격했다.
 */
export function getJobTasks(jobId: string): Promise<ApiJobTaskStatus> {
  return apiFetch<ApiJobTaskStatus>(`/jobs/${jobId}/tasks`);
}

/**
 * N5 검수 확정 = N5→N6 (API-CFM-04, v3.4.2). 전 섹션 제외면 409
 * ALL_SECTIONS_EXCLUDED, acknowledgedWarnings가 서버의 현재 미해결 경고
 * 집합과 다르면 409 INVALID_STATE(+현재 경고 목록) — 둘 다 ApiRequestError로
 * 던져 error.code로 분기할 수 있게 한다(patchN5Block과 같은 패턴).
 */
export async function confirmN5(jobId: string, payload: ApiConfirmRequest): Promise<ApiJob> {
  const res = await fetch(`/jobs/${jobId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, body);
  return body as ApiJob;
}

// ─────────────────────────────────────────────
// N6 — 저장 및 내보내기. 실제 계약(OpenAPI, N6 Save & Export)으로 맞췄다 —
// mock 전용 /api 프리픽스를 쓰지 않는다.
//
// happy path: render → tasks polling(job 단위 taskType=render) → deliverables
// → validation → export → exports/{artifactId}/download → save.
// ─────────────────────────────────────────────

/**
 * 최종 이미지 (재)렌더링 트리거 (API-FIN-01). 최초 렌더는 N5 confirm(CFM-04)이
 * 자동 등록하므로, N6 진입 시 무조건 이 함수를 호출하지 않는다 — 현재
 * task 상태(getJobTasks)에 진행 중인 render task가 없을 때만(또는 재렌더가
 * 필요할 때만) 호출한다. 렌더 진행/실패는 이 응답이 아니라 renderTaskId로
 * GET /jobs/:jobId/tasks를 폴링해 판별한다(taskType=render).
 */
export function renderStart(jobId: string): Promise<ApiRenderResponse> {
  return apiFetch<ApiRenderResponse>(`/jobs/${jobId}/render`, { method: 'POST' });
}

/** 산출물 목록 + 검증 요약 + 구성요소 상태 조회 (API-FIN-02) */
export function getDeliverables(jobId: string): Promise<ApiDeliverableList> {
  return apiFetch<ApiDeliverableList>(`/jobs/${jobId}/deliverables`);
}

/** 규격 검증 상세 조회 (API-FIN-03) */
export function getValidation(jobId: string): Promise<ApiValidationDetail[]> {
  return apiFetch<ApiValidationDetail[]>(`/jobs/${jobId}/validation`);
}

/** 선택한 구성요소를 묶어 export.zip 생성 (API-FIN-04) */
export function createExport(jobId: string, payload: ApiExportRequest): Promise<ApiExportResponse> {
  return apiFetch<ApiExportResponse>(`/jobs/${jobId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** 생성된 산출물의 presigned 다운로드 정보 조회 (API-FIN-05, 5분 만료) */
export function getExportDownload(jobId: string, artifactId: number): Promise<ApiDownloadResponse> {
  return apiFetch<ApiDownloadResponse>(`/jobs/${jobId}/exports/${artifactId}/download`);
}

/**
 * N6 행별 개별 다운로드 — 타입별 presigned (API-FIN-05, exportDownloadByType).
 * export 묶음 생성(POST /export) 없이 구성요소 하나만 바로 받는다. artifactType
 * 생략 시 서버 기본값은 zip이지만, 이 화면에서는 항상 images|csv|html 중
 * 하나를 명시해서 부른다 — psd는 호출하지 않는다(12월 예정, 항상 비활성).
 */
export function getExportDownloadByType(
  jobId: string,
  artifactType: ApiExportArtifactType,
): Promise<ApiDownloadResponse> {
  return apiFetch<ApiDownloadResponse>(
    `/jobs/${jobId}/export/download?artifactType=${encodeURIComponent(artifactType ?? 'zip')}`,
  );
}

/** 저장 = 보관함 카드 생성 (API-FIN-06). 응답은 { saved: boolean }이 아니라 LibraryCard다. */
export function saveJob(jobId: string, payload?: ApiSaveRequest): Promise<ApiLibraryCard> {
  return apiFetch<ApiLibraryCard>(`/jobs/${jobId}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
}
