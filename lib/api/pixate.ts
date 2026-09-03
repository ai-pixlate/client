import type {
  JobStatusResponse,
  SectionsResponse,
  SectionBucket,
  ReviewResponse,
  UpdateTranslationRequest,
  UpdateTranslationResponse,
  JobResultResponse,
  CreateJobRequest,
  CreateJobResponse,
} from '@/lib/api/types';

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
  sectionId: string,
  bucket: SectionBucket,
  stage?: string,
): Promise<{ sectionId: string; bucket: SectionBucket }> {
  return apiFetch(`/api/sections/${sectionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, ...(stage !== undefined ? { stage } : {}) }),
  });
}

// ─────────────────────────────────────────────
// N5 — 검수
// ─────────────────────────────────────────────

export function getReview(jobId: string): Promise<ReviewResponse> {
  return apiFetch<ReviewResponse>(`/api/jobs/${jobId}/review`);
}

export function updateTranslation(
  blockId: string,
  payload: UpdateTranslationRequest,
): Promise<UpdateTranslationResponse> {
  return apiFetch<UpdateTranslationResponse>(
    `/api/text-blocks/${blockId}/translation`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
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
