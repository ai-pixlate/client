"use client";

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createJob,
  analyzeJob,
  getSections,
  updateSectionBucket,
  proceedSections,
  getSourceImages,
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
} from '@/lib/api/pixlate';
import type { CreateJobRequest } from '@/lib/api/types';
import type { ApiBlockPatch, ApiConfirmRequest, ApiJobTaskStatus, ApiTextBlock } from '@/lib/api/n5-schema';
import type { ApiExportRequest, ApiExportArtifactType } from '@/lib/api/n6-schema';
import type { ApiSection, ApiSectionBucket, ApiSectionList, ApiSectionPatch } from '@/lib/api/n3-schema';

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

export const pixlateKeys = {
  all: ['pixlate'] as const,
  job: (jobId: string) => ['pixlate', 'job', jobId] as const,
  tasks: (jobId: string) => ['pixlate', 'job', jobId, 'tasks'] as const,
  sections: (jobId: string) => ['pixlate', 'job', jobId, 'sections'] as const,
  sourceImages: (jobId: string) => ['pixlate', 'job', jobId, 'source-images'] as const,
  n5Blocks: (jobId: string) => ['pixlate', 'job', jobId, 'n5-blocks'] as const,
  n5Preview: (jobId: string) => ['pixlate', 'job', jobId, 'n5-preview'] as const,
  n5Task: (jobId: string, taskId: number | null) => ['pixlate', 'job', jobId, 'n5-task', taskId] as const,
  deliverables: (jobId: string) => ['pixlate', 'job', jobId, 'deliverables'] as const,
  validation: (jobId: string) => ['pixlate', 'job', jobId, 'validation'] as const,
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
    queryKey: pixlateKeys.tasks(jobId),
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
// N3 → N4 — 이대로 진행 (API-SEC-04, POST /jobs/:jobId/sections/proceed)
// ─────────────────────────────────────────────

export function useSectionProceedMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => proceedSections(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pixlateKeys.tasks(jobId) });
    },
  });
}

// ─────────────────────────────────────────────
// N3 — 섹션 목록 조회
// ─────────────────────────────────────────────

export function useSectionsQuery(jobId: string) {
  return useQuery({
    queryKey: pixlateKeys.sections(jobId),
    queryFn: () => getSections(jobId),
    enabled: !!jobId,
  });
}

/**
 * N1 소스 이미지 목록 (x-screen: N1, N3 재사용 가능). 아직 어떤 화면에도
 * 연결하지 않았다 — fileUrl이 presigned(5분 만료)라 이 query 응답 범위
 * 안에서만 쓰고 별도로 영구 저장하지 않는다.
 */
export function useSourceImagesQuery(jobId: string) {
  return useQuery({
    queryKey: pixlateKeys.sourceImages(jobId),
    queryFn: () => getSourceImages(jobId),
    enabled: !!jobId,
  });
}

// ─────────────────────────────────────────────
// N5 — 실제 계약(v3.4.2) 조회.
// ─────────────────────────────────────────────

/** N5 헤더(targetCountry/targetLanguage)용 job 조회 */
export function useJobQuery(jobId: string) {
  return useQuery({
    queryKey: pixlateKeys.job(jobId),
    queryFn: () => getJob(jobId),
    enabled: !!jobId,
  });
}

export function useN5BlocksQuery(jobId: string) {
  return useQuery({
    queryKey: pixlateKeys.n5Blocks(jobId),
    queryFn: () => getN5Blocks(jobId),
    enabled: !!jobId,
  });
}

export function useN5PreviewQuery(jobId: string) {
  return useQuery({
    queryKey: pixlateKeys.n5Preview(jobId),
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
      queryClient.setQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId), (prev) =>
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
    queryKey: pixlateKeys.n5Task(jobId, taskId),
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
// 전환을 구동하는 tasks 캐시(pixlateKeys.tasks, 오늘부터 status 대신 이 키를
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
      queryClient.setQueryData(pixlateKeys.job(jobId), job);
      queryClient.invalidateQueries({ queryKey: pixlateKeys.tasks(jobId) });
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
      queryClient.invalidateQueries({ queryKey: pixlateKeys.tasks(jobId) });
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
    queryKey: pixlateKeys.deliverables(jobId),
    queryFn: () => getDeliverables(jobId),
    enabled: !!jobId && enabled,
  });
}

export function useValidationQuery(jobId: string, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: pixlateKeys.validation(jobId),
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
// N3 — 섹션 bucket 변경 (3단계: N3View가 이제 ApiSection/ApiSectionList를
// 직접 쓰므로 캐시 shape도 실제 {exclude, include}로 맞춘다)
//
// N3View는 여전히 {sectionId, bucket}으로 mutate를 부른다 — action 해석은
// 이 hook 내부에 남겨 UI가 계약을 중복 해석하지 않게 한다(bucket→action:
// include로 이동 = 'restore', exclude로 이동 = 'exclude').
//
// optimistic update는 대상 section을 원래 배열에서 빼서 목표 배열로 옮기고
// bucket 필드만 바꾼다 — exclusionReason/excludedStage는 서버가 파생하는
// 값이라 FE가 임의로 채워 넣지 않는다. 최신 값은 onSettled의 refetch로 받는다.
// N5(n5Blocks/n5Preview 캐시)는 이 낙관적 갱신의 영향을 받지 않는다 — 별도 query key.
// ─────────────────────────────────────────────

export function useUpdateSectionBucketMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sectionId, bucket }: { sectionId: number; bucket: ApiSectionBucket }) => {
      const action: ApiSectionPatch['action'] = bucket === 'include' ? 'restore' : 'exclude';
      return updateSectionBucket(jobId, sectionId, { action });
    },
    onMutate: async ({ sectionId, bucket }) => {
      await queryClient.cancelQueries({ queryKey: pixlateKeys.sections(jobId) });
      const previous = queryClient.getQueryData<ApiSectionList>(pixlateKeys.sections(jobId));

      if (previous) {
        const exclude = previous.exclude ?? [];
        const include = previous.include ?? [];
        const moving = exclude.find((s) => s.id === sectionId) ?? include.find((s) => s.id === sectionId);

        if (moving) {
          const moved: ApiSection = { ...moving, bucket };
          const withoutMoving = { exclude: exclude.filter((s) => s.id !== sectionId), include: include.filter((s) => s.id !== sectionId) };
          queryClient.setQueryData<ApiSectionList>(
            pixlateKeys.sections(jobId),
            bucket === 'include'
              ? { exclude: withoutMoving.exclude, include: [...withoutMoving.include, moved] }
              : { exclude: [...withoutMoving.exclude, moved], include: withoutMoving.include },
          );
        }
      }

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(pixlateKeys.sections(jobId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pixlateKeys.sections(jobId) });
    },
  });
}
