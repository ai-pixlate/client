"use client";

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { createJob, getJobStatus, advanceJobStep, getSections, updateSectionBucket, getJob, getN5Blocks, getN5Preview, patchN5Block, getN5Tasks, confirmN5, getJobResult, saveJob } from '@/lib/api/pixate';
import type { UpdateSectionBucketRequest, CreateJobRequest, SectionsResponse } from '@/lib/api/types';
import type { ApiBlockPatch, ApiConfirmRequest, ApiTextBlock } from '@/lib/api/n5-schema';

// ─────────────────────────────────────────────
// Query Keys
//
// 5단계: 구 /review·/preview(v3.4.1) 전용이던 review/preview 키는 호출부
// (useReviewQuery/usePreviewQuery)와 함께 제거했다 — N5는 n5Blocks/n5Preview만 쓴다.
// ─────────────────────────────────────────────

export const pixateKeys = {
  all: ['pixate'] as const,
  job: (jobId: string) => ['pixate', 'job', jobId] as const,
  status: (jobId: string, scenario?: string) =>
    ['pixate', 'job', jobId, 'status', scenario] as const,
  sections: (jobId: string) => ['pixate', 'job', jobId, 'sections'] as const,
  result: (jobId: string) => ['pixate', 'job', jobId, 'result'] as const,
  n5Blocks: (jobId: string) => ['pixate', 'job', jobId, 'n5-blocks'] as const,
  n5Preview: (jobId: string) => ['pixate', 'job', jobId, 'n5-preview'] as const,
  n5Task: (jobId: string, taskId: number | null) => ['pixate', 'job', jobId, 'n5-task', taskId] as const,
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
// N5 — 실제 계약(v3.4.2) 조회.
// ─────────────────────────────────────────────

/** N5 헤더(targetCountry/targetLanguage)용 job 조회 */
export function useJobQuery(jobId: string) {
  return useQuery({
    queryKey: pixateKeys.job(jobId),
    queryFn: () => getJob(jobId),
    enabled: !!jobId,
  });
}

export function useN5BlocksQuery(jobId: string) {
  return useQuery({
    queryKey: pixateKeys.n5Blocks(jobId),
    queryFn: () => getN5Blocks(jobId),
    enabled: !!jobId,
  });
}

export function useN5PreviewQuery(jobId: string) {
  return useQuery({
    queryKey: pixateKeys.n5Preview(jobId),
    queryFn: () => getN5Preview(jobId),
    enabled: !!jobId,
  });
}

// ─────────────────────────────────────────────
// N5 — 번역문 수정 (실제 계약 v3.4.2, PATCH /jobs/:jobId/blocks/:blockId)
//
// 4단계: revision 낙관적 잠금 + 재렌더 task polling. 성공 시 서버가 반환한
// block(트랜스1·revision·charCount — overflow/autoAdjust는 재렌더 전이라
// 아직 이전 값)으로 n5Blocks 캐시를 갱신한다. 409는 여기서 처리하지 않는다 —
// mutateAsync가 그대로 던지는 에러(ApiRequestError)를 호출부(TranslationEditor)가
// 잡아 lib/n5/adapter.ts의 parseApiError/isRevisionConflict로 판별한다.
// ─────────────────────────────────────────────

export function usePatchN5BlockMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ blockId, payload }: { blockId: number; payload: ApiBlockPatch }) =>
      patchN5Block(jobId, blockId, payload),
    onSuccess: (response) => {
      const updated = response.block;
      if (!updated) return;
      queryClient.setQueryData<ApiTextBlock[]>(pixateKeys.n5Blocks(jobId), (prev) =>
        prev ? prev.map((b) => (b.id === updated.id ? updated : b)) : prev,
      );
    },
  });
}

/**
 * rerenderTaskId를 2초 간격으로 polling한다. taskId가 null이면 비활성화된다
 * (요청 접수 전이거나 이미 종료됨). done/failed/cancelled에 도달하면 polling을
 * 멈춘다 — 호출부가 그 상태를 보고 blocks/preview invalidate 여부를 판단한다.
 */
export function useN5TaskStatusQuery(jobId: string, taskId: number | null) {
  return useQuery({
    queryKey: pixateKeys.n5Task(jobId, taskId),
    queryFn: () => getN5Tasks(jobId),
    enabled: taskId != null,
    refetchInterval: (query) => {
      if (taskId == null) return false;
      const item = query.state.data?.items?.find((i) => i.taskId === taskId);
      if (!item) return 2000; // 아직 목록에 반영 전 — 계속 polling
      return item.status === 'done' || item.status === 'failed' || item.status === 'cancelled'
        ? false
        : 2000;
    },
  });
}

// ─────────────────────────────────────────────
// N5 — 검수 확정 = N5→N6 (실제 계약 v3.4.2, POST /jobs/:jobId/confirm)
//
// 6단계: 성공(200)이면 서버가 준 최신 Job으로 job 캐시를 갱신하고, 화면
// 전환을 구동하는 구 status polling 캐시(pixateKeys.status)도 함께
// invalidate한다 — page.tsx가 currentStep으로 N5/N6 뷰를 고르는 기존 라우팅
// 메커니즘(useAdvanceJobStepMutation과 동일 패턴)을 그대로 재사용하기 위함이다.
// 409(ALL_SECTIONS_EXCLUDED/INVALID_STATE)는 여기서 삼키지 않는다 —
// mutateAsync가 던지는 ApiRequestError를 호출부(N5Panel)가 lib/n5/adapter.ts의
// isAllSectionsExcludedError/isInvalidStateError로 판별한다.
// ─────────────────────────────────────────────

export function useConfirmN5Mutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ApiConfirmRequest) => confirmN5(jobId, payload),
    onSuccess: (job) => {
      queryClient.setQueryData(pixateKeys.job(jobId), job);
      queryClient.invalidateQueries({ queryKey: pixateKeys.status(jobId) });
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
// N5(n5Blocks/n5Preview 캐시)는 이 낙관적 갱신의 영향을 받지 않는다 — 별도 query key.
// ─────────────────────────────────────────────

export function useUpdateSectionBucketMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sectionId, ...payload }: { sectionId: string } & UpdateSectionBucketRequest) =>
      updateSectionBucket(jobId, sectionId, payload),
    onMutate: async ({ sectionId, bucket }) => {
      await queryClient.cancelQueries({ queryKey: pixateKeys.sections(jobId) });
      const previous = queryClient.getQueryData<SectionsResponse>(pixateKeys.sections(jobId));

      if (previous) {
        // 서버(mock) 규칙과 동일하게 맞춘다: bucket을 바꾸는 모든 PATCH는
        // exclusionReason을 항상 null로 비운다. excludedStage는 클라이언트가
        // 보내지 않는다 — 서버가 현재 job 단계를 기준으로 판단한다. 이 mutation은
        // N3에서만 호출되므로 exclude 시 낙관적으로 'N3'를 반영한다. 자동 판정
        // 사유는 사용자가 직접 조작한 순간 더 이상 유효하지 않기 때문이다.
        queryClient.setQueryData<SectionsResponse>(pixateKeys.sections(jobId), {
          sections: previous.sections.map((section) =>
            section.sectionId === sectionId
              ? {
                  ...section,
                  bucket,
                  exclusionReason: null,
                  excludedStage: bucket === 'include' ? null : 'N3',
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
