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
  renderStart,
  getDeliverables,
  getValidation,
  createExport,
  getExportDownload,
  getExportDownloadByType,
  saveJob,
} from '@/lib/api/pixate';
import type { UpdateSectionBucketRequest, CreateJobRequest, SectionsResponse, SectionBucket } from '@/lib/api/types';
import type { ApiBlockPatch, ApiConfirmRequest, ApiJobTaskStatus, ApiTextBlock } from '@/lib/api/n5-schema';
import type { ApiExportRequest, ApiExportArtifactType } from '@/lib/api/n6-schema';

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
  n5Blocks: (jobId: string) => ['pixate', 'job', jobId, 'n5-blocks'] as const,
  n5Preview: (jobId: string) => ['pixate', 'job', jobId, 'n5-preview'] as const,
  n5Task: (jobId: string, taskId: number | null) => ['pixate', 'job', jobId, 'n5-task', taskId] as const,
  deliverables: (jobId: string) => ['pixate', 'job', jobId, 'deliverables'] as const,
  validation: (jobId: string) => ['pixate', 'job', jobId, 'validation'] as const,
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
// N2 / N4 / N6 — 비동기 처리 진행 polling (API-JOB-05, GET /jobs/:jobId/tasks)
//
// 폴링 주기 2초(계약 그대로). currentStep이 N2·N4(진행 중 단계)면 무조건
// polling한다 — N1/N3/N5는 사용자 조작을 기다리는 정적 단계라 계속 찔러볼
// 필요가 없다. N6은 그 자체는 정적 단계지만, confirm이 자동 등록한 job 단위
// render task(taskType=render, unitType이 'text_block'이 아닌 것 — N5의 블록별
// 재렌더 task와 구분)가 아직 진행 중일 때만 계속 polling한다. currentStep이
// 바뀌면(N2→N3, N4→N5) page.tsx가 그 값을 보고 다음 화면을 그대로 렌더한다 —
// FE가 별도로 "다음 단계 진입"을 계산하지 않는다(userFacingStatus/currentStep은
// 서버 응답 그대로 쓴다).
// ─────────────────────────────────────────────

function hasActiveN6RenderTask(data: ApiJobTaskStatus): boolean {
  return (
    data.items?.some(
      (item) =>
        item.taskType === 'render' &&
        item.unitType !== 'text_block' &&
        (item.status === 'pending' || item.status === 'running'),
    ) ?? false
  );
}

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
          if (data.currentStep === 'N2' || data.currentStep === 'N4') return 2_000;
          if (data.currentStep === 'N6') return hasActiveN6RenderTask(data) ? 2_000 : false;
          return false;
        }
      : false,
  });
}

// ─────────────────────────────────────────────
// N3 — 드래그 중 bucket 변경 (로컬 전용, F-CFM-14)
//
// 드래그는 이제 네트워크 호출을 하지 않는다 — sections 캐시의 bucket만 즉시
// 바꿔 기존 회색 제외 UI를 그대로 보여준다. 실제 서버 반영은 확정
// (useSectionProceedMutation)에서 배치로만 일어난다.
// ─────────────────────────────────────────────

export function useSetSectionBucketLocally(jobId: string) {
  const queryClient = useQueryClient();

  return (sectionId: string, bucket: SectionBucket) => {
    queryClient.setQueryData<SectionsResponse>(pixateKeys.sections(jobId), (prev) =>
      prev
        ? {
            sections: prev.sections.map((section) =>
              section.sectionId === sectionId
                ? {
                    ...section,
                    bucket,
                    exclusionReason: null,
                    excludedStage: bucket === 'include' ? null : 'N3',
                  }
                : section,
            ),
          }
        : prev,
    );
  };
}

// ─────────────────────────────────────────────
// N3 → N4 — 이대로 진행 (API-SEC-04, POST /jobs/:jobId/sections/proceed)
//
// F-CFM-14: 확정 시점에 "아직 서버에 exclude로 반영되지 않은" section만
// PATCH(action=exclude)로 반영한 뒤에만 proceed를 부른다. include는 다시
// PATCH하지 않는다(서버가 exclude→PATCH 없이도 기본 include로 안다).
//
// alreadySyncedExcludeIds는 호출부(N3View)가 들고 있는 Set이다 — N3 진입
// 시점에 서버가 이미 exclude로 응답한 section들로 시드해 둬야 한다(그래야
// 사용자가 아무것도 안 건드렸을 때 "제외 없음 → PATCH 없음"이 성립한다).
// 이 함수는 그 Set을 그대로(참조로) 받아 성공한 sectionId를 추가한다 —
// PATCH 중 하나라도 실패하면 proceed를 부르지 않고 그대로 던져 N3에 머문다.
// 이미 성공한 PATCH는 Set에 남아 재시도 시 중복 전송하지 않는다. 성공 후에도
// /preview는 재조회하지 않는다(N3엔 그런 계약이 없다).
// ─────────────────────────────────────────────

export function useSectionProceedMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alreadySyncedExcludeIds: Set<string>) => {
      const sections = queryClient.getQueryData<SectionsResponse>(pixateKeys.sections(jobId))?.sections ?? [];
      const pendingExcludes = sections.filter(
        (section) => section.bucket === 'exclude' && !alreadySyncedExcludeIds.has(section.sectionId),
      );

      for (const section of pendingExcludes) {
        await updateSectionBucket(jobId, section.sectionId, { bucket: 'exclude' });
        alreadySyncedExcludeIds.add(section.sectionId);
      }

      return proceedSections(jobId);
    },
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
// N6 — render 트리거 (API-FIN-01)
//
// N5 confirm이 최초 render task를 자동 등록하므로, 호출부(N6ResultView)는
// tasks 조회 결과에 진행 중/완료된 job 단위 render task가 이미 있으면 이
// mutation을 부르지 않는다 — task가 아예 없거나(도달 불가 상태) failed일
// 때만 (재)트리거한다. 성공(202) 후 tasks를 invalidate해 polling이 새
// renderTaskId를 바로 잡게 한다.
// ─────────────────────────────────────────────

export function useN6RenderMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => renderStart(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pixateKeys.tasks(jobId) });
    },
  });
}

// ─────────────────────────────────────────────
// N6 — 산출물 목록 + 검증 상세 조회 (API-FIN-02/03)
//
// render task가 done이 되기 전에도 호출 자체는 막지 않는다(계약상 "렌더 전"
// 상태도 있을 수 있다 — renderedUrl=null만으로 실패를 확정하지 않는다는
// CLAUDE.md 원칙과 같은 축). 호출 시점 제어(=render 완료를 기다렸다가 조회)는
// 화면(N6ResultView)이 판단한다.
// ─────────────────────────────────────────────

export function useDeliverablesQuery(jobId: string, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: pixateKeys.deliverables(jobId),
    queryFn: () => getDeliverables(jobId),
    enabled: !!jobId && enabled,
  });
}

export function useValidationQuery(jobId: string, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: pixateKeys.validation(jobId),
    queryFn: () => getValidation(jobId),
    enabled: !!jobId && enabled,
  });
}

// ─────────────────────────────────────────────
// N6 — 산출물 묶음 생성 (API-FIN-04)
// ─────────────────────────────────────────────

export function useExportMutation(jobId: string) {
  return useMutation({
    mutationFn: (payload: ApiExportRequest) => createExport(jobId, payload),
  });
}

// ─────────────────────────────────────────────
// N6 — 산출물 presigned 다운로드 조회 (API-FIN-05)
//
// 클릭 시점에 바로 조회해야 하는 값(5분 만료 presigned URL)이라 query가 아니라
// mutation으로 감싼다 — 영구 식별자처럼 캐시해 두지 않는다.
// ─────────────────────────────────────────────

export function useExportDownloadMutation(jobId: string) {
  return useMutation({
    mutationFn: (artifactId: number) => getExportDownload(jobId, artifactId),
  });
}

/**
 * N6 행별 개별 다운로드 (exportDownloadByType) — export 묶음 생성 없이
 * images|csv|html 구성요소 하나만 바로 presigned URL로 받는다. psd는 호출부가
 * 애초에 disabled라 이 mutation을 쓰지 않는다.
 */
export function useExportDownloadByTypeMutation(jobId: string) {
  return useMutation({
    mutationFn: (artifactType: ApiExportArtifactType) => getExportDownloadByType(jobId, artifactType),
  });
}

// ─────────────────────────────────────────────
// N6 — 보관함 저장 (API-FIN-06). 응답은 LibraryCard — 저장 여부는 별도 조회
// 없이 이 mutation의 성공 여부(isSuccess)로 판단한다.
// ─────────────────────────────────────────────

export function useSaveJobMutation(jobId: string) {
  return useMutation({
    mutationFn: () => saveJob(jobId),
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
