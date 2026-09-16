"use client";

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createJob,
  analyzeJob,
  getSections,
  updateSectionBucket,
  proceedSections,
  getJob,
  getN5Blocks,
  getN5Preview,
  patchN5Block,
  getJobTasks,
  confirmN5,
  getJobResult,
  saveJob,
} from '@/lib/api/pixate';
import type { UpdateSectionBucketRequest, CreateJobRequest, SectionsResponse } from '@/lib/api/types';
import type { ApiBlockPatch, ApiConfirmRequest, ApiTextBlock } from '@/lib/api/n5-schema';

// ─────────────────────────────────────────────
// Query Keys
//
// 5단계: 구 /review·/preview(v3.4.1) 전용이던 review/preview 키는 호출부
// (useReviewQuery/usePreviewQuery)와 함께 제거했다 — N5는 n5Blocks/n5Preview만 쓴다.
//
// 오늘(N1→N6 happy path): 구 status 키(GET /api/jobs/:jobId/status, mockJobState
// 기준)는 tasks 키(GET /jobs/:jobId/tasks, currentStep/userFacingStatus를 서버가
// 그대로 내려줌)로 교체됐다 — page.tsx의 화면 분기도 이 키를 본다. n5Task는
// N5 block 재렌더 task(rerenderTaskId 단건) 전용이라 별도 키로 남겨 둔다 — 같은
// 엔드포인트를 부르지만 polling 중단 조건(특정 taskId 완료 vs currentStep 전환)이
// 달라 캐시를 공유하면 두 refetchInterval이 서로의 조건을 밟는다.
// ─────────────────────────────────────────────

export const pixateKeys = {
  all: ['pixate'] as const,
  job: (jobId: string) => ['pixate', 'job', jobId] as const,
  tasks: (jobId: string) => ['pixate', 'job', jobId, 'tasks'] as const,
  sections: (jobId: string) => ['pixate', 'job', jobId, 'sections'] as const,
  result: (jobId: string) => ['pixate', 'job', jobId, 'result'] as const,
  n5Blocks: (jobId: string) => ['pixate', 'job', jobId, 'n5-blocks'] as const,
  n5Preview: (jobId: string) => ['pixate', 'job', jobId, 'n5-preview'] as const,
  n5Task: (jobId: string, taskId: number | null) => ['pixate', 'job', jobId, 'n5-task', taskId] as const,
};

// ─────────────────────────────────────────────
// N1 — job 생성 + 분석 시작
//
// CLAUDE.md 원칙: 작업 생성만으로 분석이 자동 시작되지 않는다 — 생성과 처리
// 시작은 각 API 흐름을 따른다. useAnalyzeJobMutation은 jobId를 hook 생성
// 시점이 아니라 mutate(jobId) 호출 시점에 받는다 — N1은 createJob이 성공해야
// jobId를 알 수 있기 때문이다(다른 N3~N5 mutation처럼 jobId를 hook 인자로
// 고정할 수 없다).
// ─────────────────────────────────────────────

export function useCreateJobMutation() {
  return useMutation({
    mutationFn: (payload: CreateJobRequest) => createJob(payload),
  });
}

export function useAnalyzeJobMutation() {
  return useMutation({
    mutationFn: (jobId: string) => analyzeJob(jobId),
  });
}

// ─────────────────────────────────────────────
// N2 / N4 — 비동기 처리 진행 polling (API-JOB-05, GET /jobs/:jobId/tasks)
//
// 폴링 주기 2초(계약 그대로). currentStep이 N2·N4(진행 중 단계)가 아니면
// polling을 멈춘다 — N1/N3/N5/N6은 사용자 조작을 기다리는 정적 단계라 계속
// 찔러볼 필요가 없다. currentStep이 바뀌면(N2→N3, N4→N5) page.tsx가 그 값을
// 보고 다음 화면을 그대로 렌더한다 — FE가 별도로 "다음 단계 진입"을 계산하지
// 않는다(userFacingStatus/currentStep은 서버 응답 그대로 쓴다).
// ─────────────────────────────────────────────

export function useJobTasksQuery(jobId: string, options: { polling?: boolean } = {}) {
  const { polling = false } = options;

  return useQuery({
    queryKey: pixateKeys.tasks(jobId),
    queryFn: () => getJobTasks(jobId),
    enabled: !!jobId,
    refetchInterval: polling
      ? (query) => {
          const data = query.state.data;
          if (!data) return 2_000; // 첫 응답 대기 중
          return data.currentStep === 'N2' || data.currentStep === 'N4' ? 2_000 : false;
        }
      : false,
  });
}

// ─────────────────────────────────────────────
// N3 → N4 — 이대로 진행 (API-SEC-04, POST /jobs/:jobId/sections/proceed)
// ─────────────────────────────────────────────

export function useSectionProceedMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => proceedSections(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pixateKeys.tasks(jobId) });
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
    queryFn: () => getJobTasks(jobId),
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
// 전환을 구동하는 tasks 캐시(pixateKeys.tasks, 오늘부터 status 대신 이 키를
// 쓴다)도 함께 invalidate한다 — page.tsx가 currentStep으로 N5/N6 뷰를 고르는
// 라우팅 메커니즘(useSectionProceedMutation과 동일 패턴)을 그대로 재사용하기
// 위함이다. 409(ALL_SECTIONS_EXCLUDED/INVALID_STATE)는 여기서 삼키지 않는다 —
// mutateAsync가 던지는 ApiRequestError를 호출부(N5Panel)가 lib/n5/adapter.ts의
// isAllSectionsExcludedError/isInvalidStateError로 판별한다.
// ─────────────────────────────────────────────

export function useConfirmN5Mutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ApiConfirmRequest) => confirmN5(jobId, payload),
    onSuccess: (job) => {
      queryClient.setQueryData(pixateKeys.job(jobId), job);
      queryClient.invalidateQueries({ queryKey: pixateKeys.tasks(jobId) });
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
