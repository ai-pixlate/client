import type {
  JobStatusResponse,
  SectionsResponse,
  SectionBucket,
  UpdateSectionBucketRequest,
  JobResultResponse,
  CreateJobRequest,
  CreateJobResponse,
} from '@/lib/api/types';
import type { ApiBlockPatch, ApiBlockPatchResponse, ApiConfirmRequest, ApiJob, ApiJobTaskStatus, ApiReviewPreview, ApiTextBlock } from '@/lib/api/n5-schema';

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
// N1 — job 생성
// ─────────────────────────────────────────────

export function createJob(payload: CreateJobRequest): Promise<CreateJobResponse> {
  return apiFetch<CreateJobResponse>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ─────────────────────────────────────────────
// N2 / N4 / N6 — 처리 상태 polling
// ─────────────────────────────────────────────

/**
 * scenario는 MSW Mock 테스트 전용입니다. 실제 백엔드 사용 시 생략합니다.
 * 사용 가능한 값: 'n2' | 'n2-verdict' | 'n4' | 'n4-partial-failure' | 'n6-rendering'
 */
export function getJobStatus(
  jobId: string,
  scenario?: string,
): Promise<JobStatusResponse> {
  const url = scenario
    ? `/api/jobs/${jobId}/status?scenario=${encodeURIComponent(scenario)}`
    : `/api/jobs/${jobId}/status`;
  return apiFetch<JobStatusResponse>(url);
}

/**
 * 다음 단계로 진행 (현재는 N3 → N4만 지원).
 * Mock 검증용 임시 계약입니다. 백엔드 확정 API가 아닙니다.
 */
export function advanceJobStep(jobId: string): Promise<JobStatusResponse> {
  return apiFetch<JobStatusResponse>(`/api/jobs/${jobId}/status/advance`, {
    method: 'POST',
  });
}

// ─────────────────────────────────────────────
// N3 — 섹션
// ─────────────────────────────────────────────

export function getSections(jobId: string): Promise<SectionsResponse> {
  return apiFetch<SectionsResponse>(`/api/jobs/${jobId}/sections`);
}

export function updateSectionBucket(
  jobId: string,
  sectionId: string,
  payload: UpdateSectionBucketRequest,
): Promise<{ sectionId: string; bucket: SectionBucket }> {
  return apiFetch(`/jobs/${jobId}/sections/${sectionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
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

/** N5 재렌더 task 상태 조회 (API-JOB-05). rerenderTaskId를 items[]에서 찾아 polling한다. */
export function getN5Tasks(jobId: string): Promise<ApiJobTaskStatus> {
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
// N6 — 결과 / 저장
// ─────────────────────────────────────────────

export function getJobResult(jobId: string): Promise<JobResultResponse> {
  return apiFetch<JobResultResponse>(`/api/jobs/${jobId}/result`);
}

export function saveJob(jobId: string): Promise<{ saved: boolean }> {
  return apiFetch<{ saved: boolean }>(`/api/jobs/${jobId}/save`, {
    method: 'POST',
  });
}
