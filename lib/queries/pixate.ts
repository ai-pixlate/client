"use client";

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { createJob, getJobStatus, advanceJobStep, getSections, updateSectionBucket, getReview, updateTranslation, getJobResult, saveJob } from '@/lib/api/pixate';
import type { UpdateSectionBucketRequest, UpdateTranslationRequest, CreateJobRequest, SectionsResponse } from '@/lib/api/types';

// ─────────────────────────────────────────────
// Query Keys
// ─────────────────────────────────────────────

export const pixateKeys = {
  all: ['pixate'] as const,
  job: (jobId: string) => ['pixate', 'job', jobId] as const,
  status: (jobId: string, scenario?: string) =>
    ['pixate', 'job', jobId, 'status', scenario] as const,
  sections: (jobId: string) => ['pixate', 'job', jobId, 'sections'] as const,
  review: (jobId: string) => ['pixate', 'job', jobId, 'review'] as const,
  result: (jobId: string) => ['pixate', 'job', jobId, 'result'] as const,
};

// ─────────────────────────────────────────────
// N1 — job 생성
// ─────────────────────────────────────────────

export function useCreateJobMutation() {
  return useMutation({
    mutationFn: (payload: CreateJobRequest) => createJob(payload),
  });
}

// ─────────────────────────────────────────────
// N2 — 처리 상태 polling
// ─────────────────────────────────────────────

interface UseJobStatusQueryOptions {
  /** MSW Mock 테스트 전용. 실제 백엔드 사용 시 생략 */
  scenario?: string;
  /** true일 때만 refetchInterval 활성화 */
  polling?: boolean;
}

export function useJobStatusQuery(
  jobId: string,
  options: UseJobStatusQueryOptions = {},
) {
  const { scenario, polling = false } = options;

  return useQuery({
    queryKey: pixateKeys.status(jobId, scenario),
    queryFn: () => getJobStatus(jobId, scenario),
    enabled: !!jobId,
    refetchInterval: polling
      ? (query) => {
          const data = query.state.data;
          // 데이터가 없으면 첫 응답 대기 중이므로 계속 polling
          if (!data) return 1_000;
          // dbStatus가 processing이 아니면 (N2/N4 어느 단계든) polling 중단
          if (data.dbStatus !== 'processing') return false;
          return 1_000;
        }
      : false,
  });
}

// ─────────────────────────────────────────────
// N3 → N4 — 다음 단계 진입
//
// Mock 검증용 임시 계약입니다. 백엔드 확정 API가 아닙니다.
// ─────────────────────────────────────────────

export function useAdvanceJobStepMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => advanceJobStep(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pixateKeys.status(jobId) });
    },
  });
}

// ─────────────────────────────────────────────
// N3 — 섹션 목록 조회
// ─────────────────────────────────────────────

export function useSectionsQuery(jobId: string) {
  return useQuery({
    queryKey: pixateKeys.sections(jobId),
    queryFn: () => getSections(jobId),
    enabled: !!jobId,
  });
}

// ─────────────────────────────────────────────
// N5 — 검수 데이터 조회
// ─────────────────────────────────────────────

export function useReviewQuery(jobId: string) {
  return useQuery({
    queryKey: pixateKeys.review(jobId),
    queryFn: () => getReview(jobId),
    enabled: !!jobId,
  });
}

// ─────────────────────────────────────────────
// N5 — 번역문 수정 / 후보 선택
// ─────────────────────────────────────────────

export function useUpdateTranslationMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ blockId, payload }: { blockId: string; payload: UpdateTranslationRequest }) =>
      updateTranslation(blockId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pixateKeys.review(jobId) });
    },
  });
}

// ─────────────────────────────────────────────
// N6 — 최종 결과 조회
// ─────────────────────────────────────────────

export function useJobResultQuery(jobId: string) {
  return useQuery({
    queryKey: pixateKeys.result(jobId),
    queryFn: () => getJobResult(jobId),
    enabled: !!jobId,
  });
}

// ─────────────────────────────────────────────
// N6 — 보관함 저장
// ─────────────────────────────────────────────

export function useSaveJobMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => saveJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pixateKeys.result(jobId) });
    },
  });
}

// ─────────────────────────────────────────────
// N3 — 섹션 bucket 변경
//
// N3 drag & drop에서 즉시 settle 애니메이션을 보여주기 위해
// sections 캐시를 optimistic하게 갱신한다. 실패 시 이전 값으로 롤백한다.
// N5(review 캐시)는 이 낙관적 갱신의 영향을 받지 않는다 — 별도 query key.
// ─────────────────────────────────────────────

export function useUpdateSectionBucketMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sectionId, ...payload }: { sectionId: string } & UpdateSectionBucketRequest) =>
      updateSectionBucket(sectionId, payload),
    onMutate: async ({ sectionId, bucket, stage }) => {
      await queryClient.cancelQueries({ queryKey: pixateKeys.sections(jobId) });
      const previous = queryClient.getQueryData<SectionsResponse>(pixateKeys.sections(jobId));

      if (previous) {
        // 서버(mock) 규칙과 동일하게 맞춘다: bucket을 바꾸는 모든 PATCH는
        // exclusionReason을 항상 null로 비우고, excludedStage는 stage가
        // 없으면(=include로 복구) null로 되돌린다. 자동 판정 사유는
        // 사용자가 직접 조작한 순간 더 이상 유효하지 않기 때문이다.
        queryClient.setQueryData<SectionsResponse>(pixateKeys.sections(jobId), {
          sections: previous.sections.map((section) =>
            section.sectionId === sectionId
              ? {
                  ...section,
                  bucket,
                  exclusionReason: null,
                  excludedStage: bucket === 'include' ? null : (stage ?? null),
                }
              : section,
          ),
        });
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(pixateKeys.sections(jobId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pixateKeys.sections(jobId) });
    },
  });
}
