"use client";

import { useEffect, useMemo } from 'react';
import { focusManager, notifyManager, onlineManager, useQueries, useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getAuthEpoch } from '@/lib/auth/session-store';

import {
  createJob,
  analyzeJob,
  uploadSourceImages,
  deleteSourceImage,
  reorderSourceImages,
  patchJob,
  cancelJob,
  getSectionDetail,
  getSections,
  updateSectionBucket,
  proceedSections,
  getSourceImages,
  getJob,
  getN5Blocks,
  getN5Preview,
  patchN5Block,
  getJobTasks,
  isJobNotFoundError,
  confirmN5,
  renderStart,
  getDeliverables,
  getValidation,
  createExport,
  getExportDownload,
  saveJob,
  getLibrary,
  getMasterCountries,
  getMasterLanguages,
  getMasterCategories,
  getMasterChannelSpecs,
  getBrands,
  getBrand,
  createBrand,
  getBrandLogos,
  ApiRequestError,
} from '@/lib/api/pixlate';
import type { ApiJobPatch } from '@/lib/api/job-schema';
import type { ApiBrand, ApiBrandCreate } from '@/lib/api/brand-schema';
import {
  clearDisplayedProgress,
  n2DisplayedProgressKey,
  n4DisplayedProgressKey,
} from '@/lib/processing/displayed-progress-storage';
import type { ApiBlockPatch, ApiConfirmRequest, ApiJob, ApiJobTaskStatus, ApiTextBlock } from '@/lib/api/n5-schema';
import type { ApiExportRequest, ApiExportArtifactType } from '@/lib/api/n6-schema';
import { sectionBucketMutationOptions } from '@/lib/queries/section-bucket-mutation';
import { shouldRetryQuery } from '@/lib/auth/query-retry';

/** GET /tasks 재시도 — 404(없는 작업·미소유 작업)는 0회, 그 밖은 전역 정책(인증 최종 실패 0회 · 일반 오류 1회) */
function retryTasksQuery(failureCount: number, error: unknown): boolean {
  if (isJobNotFoundError(error)) return false;
  return shouldRetryQuery(failureCount, error);
}
import type { ApiSection } from '@/lib/api/n3-schema';
import { isN6RenderStatusUnknown, selectN6RenderTask } from './n6-render-task';

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
  // sections 아래에 둔다 — bucket 변경 뒤 sections invalidate가 상세까지 함께 갱신한다
  sectionDetail: (jobId: string, sectionId: number) => ['pixlate', 'job', jobId, 'sections', sectionId] as const,
  sourceImages: (jobId: string) => ['pixlate', 'job', jobId, 'source-images'] as const,
  n5Blocks: (jobId: string) => ['pixlate', 'job', jobId, 'n5-blocks'] as const,
  n5Preview: (jobId: string) => ['pixlate', 'job', jobId, 'n5-preview'] as const,
  n5Task: (jobId: string, taskId: number | null) => ['pixlate', 'job', jobId, 'n5-task', taskId] as const,
  // N3 캐시를 이어받지 않는다 — N4에서 바뀐 warningBadge 등을 N5 진입 시 새로 읽는다
  n5SectionStatus: (jobId: string) => ['pixlate', 'job', jobId, 'n5-section-status'] as const,
  deliverables: (jobId: string) => ['pixlate', 'job', jobId, 'deliverables'] as const,
  validation: (jobId: string) => ['pixlate', 'job', jobId, 'validation'] as const,
  library: () => ['pixlate', 'library'] as const,
  masterCountries: () => ['pixlate', 'master', 'countries'] as const,
  masterLanguages: () => ['pixlate', 'master', 'languages'] as const,
  masterCategories: () => ['pixlate', 'master', 'categories'] as const,
  masterChannelSpecs: () => ['pixlate', 'master', 'channel-specs'] as const,
  brands: () => ['pixlate', 'brands'] as const,
  brand: (brandId: number) => ['pixlate', 'brands', brandId] as const,
  brandLogos: (brandId: number) => ['pixlate', 'brands', brandId, 'logos'] as const,
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
    mutationFn: ({ brandId, idempotencyKey }: { brandId: string; idempotencyKey?: string }) =>
      createJob(brandId, { idempotencyKey }),
  });
}

// N1 원본 업로드·삭제·재정렬과 N1 값 세팅도 createJob 이후에야 jobId를 알 수 있어
// useAnalyzeJobMutation처럼 mutate 시점에 jobId를 받는다.

export function useUploadSourceImagesMutation() {
  return useMutation({
    mutationFn: ({ jobId, files }: { jobId: string; files: File[] }) => uploadSourceImages(jobId, files),
  });
}

export function useDeleteSourceImageMutation() {
  return useMutation({
    mutationFn: ({ jobId, sourceImageId }: { jobId: string; sourceImageId: number }) =>
      deleteSourceImage(jobId, sourceImageId),
  });
}

export function useReorderSourceImagesMutation() {
  return useMutation({
    mutationFn: ({ jobId, order }: { jobId: string; order: number[] }) => reorderSourceImages(jobId, order),
  });
}

export function usePatchJobMutation() {
  return useMutation({
    mutationFn: ({ jobId, payload }: { jobId: string; payload: ApiJobPatch }) => patchJob(jobId, payload),
  });
}

export function useCancelJobMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => cancelJob(jobId),
    // 저장된 작업을 취소하면 보관함 카드도 사라진다
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pixlateKeys.library() }),
  });
}

export function useAnalyzeJobMutation() {
  return useMutation({
    mutationFn: (jobId: string) => analyzeJob(jobId),
    // 새 N2 실행 — 이전 실행이 남긴 표시 % 를 이어받지 않는다(displayed-progress-storage.ts)
    onSuccess: (_data, jobId) => clearDisplayedProgress(n2DisplayedProgressKey(jobId)),
  });
}

// ─────────────────────────────────────────────
// N2 / N4 / N6 — 비동기 처리 진행 polling (API-JOB-05, GET /jobs/:jobId/tasks)
//
// 폴링 주기 2초(계약 그대로). currentStep이 N2·N4(진행 중 단계)면 무조건
// polling한다 — N1/N3/N5는 사용자 조작을 기다리는 정적 단계라 계속 찔러볼
// 필요가 없다. N6은 그 자체는 정적 단계지만, confirm이 자동 등록한 현재 최종
// render task(n6-render-task.ts selectN6RenderTask)가 진행 중이거나 아직 1건으로
// 관측되지 않았을 때만 계속 polling한다(관측 못 한 상태는 상한까지만). currentStep이
// 바뀌면(N2→N3, N4→N5) page.tsx가 그 값을 보고 다음 화면을 그대로 렌더한다 —
// FE가 별도로 "다음 단계 진입"을 계산하지 않는다(userFacingStatus/currentStep은
// 서버 응답 그대로 쓴다).
// ─────────────────────────────────────────────

export {
  selectN6RenderTask,
  isN6RenderStatusUnknown,
  resetN6RenderStatusTracking,
  N6_TASK_UNRESOLVED_LIMIT_MS,
  type N6RenderTaskSelection,
} from './n6-render-task';

/** N6 에서 /tasks 를 계속 다시 물어야 하는가 — 현재 최종 렌더가 진행 중이거나, 아직 1건으로 관측되지 않았을 때 */
function shouldPollN6Tasks(data: ApiJobTaskStatus, jobId: string): boolean {
  const selection = selectN6RenderTask(data, jobId);
  if (selection.kind === 'single') return selection.task.status === 'pending' || selection.task.status === 'running';
  // none(아직 관측 전)·ambiguous(invariant 위반) — 다른 task 로 대신하지 않고 다음 응답을 기다린다
  return selection.kind === 'none' || selection.kind === 'ambiguous';
}

export function useJobTasksQuery(jobId: string, options: { polling?: boolean } = {}) {
  const { polling = false } = options;

  return useQuery({
    queryKey: pixlateKeys.tasks(jobId),
    queryFn: () => getJobTasks(jobId),
    enabled: !!jobId,
    retry: retryTasksQuery,
    refetchInterval: polling
      ? (query) => {
          // 작업이 없거나 접근할 수 없음(404) — 종료 상태다. 같은 404 를 2초마다 다시 묻지 않는다
          if (isJobNotFoundError(query.state.error)) return false;
          const data = query.state.data;
          if (!data) return 2_000; // 첫 응답 대기 중
          // N2·N4 전체 실패(jobStatus=failed)는 종료 상태라 폴링을 멈춘다
          if ((data.currentStep === 'N2' || data.currentStep === 'N4') && data.jobStatus === 'failed') return false;
          if (data.currentStep === 'N2' || data.currentStep === 'N4') return 2_000;
          if (data.currentStep === 'N6') {
            // 0건·여러 건이 상한을 넘게 이어지면 멈춘다(n6-render-task.ts N6_TASK_UNRESOLVED_LIMIT_MS) — 이후는 [다시 확인]으로만 재조회
            if (isN6RenderStatusUnknown(jobId, data, query.state.dataUpdatedAt)) return false;
            return shouldPollN6Tasks(data, jobId) ? 2_000 : false;
          }
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
      // 새 N4 실행 — 이전 실행이 남긴 표시 % 를 이어받지 않는다(displayed-progress-storage.ts)
      clearDisplayedProgress(n4DisplayedProgressKey(jobId));
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

/** 선택한 섹션 1개의 상세(판정 근거). 카드마다 호출하지 않는다(N+1 금지) — N3 가운데 패널 전용. */
export function useSectionDetailQuery(jobId: string, sectionId: number | null) {
  return useQuery({
    queryKey: pixlateKeys.sectionDetail(jobId, sectionId ?? -1),
    queryFn: () => getSectionDetail(jobId, sectionId!),
    enabled: !!jobId && sectionId != null,
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

/**
 * N3·N5 헤더(targetCountry/targetLanguage)와 N6 ✕ 의 저장 여부(isSaved)용 job 조회.
 * enabled=false 면 같은 key 의 cache 만 읽고 요청하지 않는다(페이지가 N6 에서만 켠다).
 */
export function useJobQuery(jobId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: pixlateKeys.job(jobId),
    queryFn: () => getJob(jobId),
    enabled: !!jobId && (options.enabled ?? true),
  });
}

// /blocks·/preview 는 지문 A·B 를 맞춰 보는 한 쌍이다. 탭 복귀(focus)·재연결 때 두 query 가 따로 다시 받으면 새 /blocks 가 먼저 와
// 「새 blocks + 이전 preview」(A≠B) 중간 조합이 그려진다 — 재렌더 중이면 편집한 섹션이 수정 전 서버 이미지로 잠깐 바뀐다.
// 그래서 두 query 의 자동 focus·재연결 재조회는 끄고, useN5SnapshotFocusRefresh 가 한 쌍으로 다시 받는다(refreshN5Snapshot)
export function useN5BlocksQuery(jobId: string) {
  return useQuery({
    queryKey: pixlateKeys.n5Blocks(jobId),
    queryFn: () => getN5Blocks(jobId),
    enabled: !!jobId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useN5PreviewQuery(jobId: string) {
  return useQuery({
    queryKey: pixlateKeys.n5Preview(jobId),
    queryFn: () => getN5Preview(jobId),
    enabled: !!jobId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * 탭 복귀(focus)·재연결 때 /blocks·/preview 를 한 쌍으로 다시 받는다. 기존 자동 재조회와 같은 조건(기본 staleTime 이 지난 경우)에서만
 * 부르고, 받은 쌍은 publishN5Snapshot 이 한 번에 넣는다(그 사이 저장이 성공했으면 넣지 않는다).
 */
export function useN5SnapshotFocusRefresh(jobId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!jobId) return;
    const refreshIfStale = () => {
      const staleTime = queryClient.getDefaultOptions().queries?.staleTime;
      const staleMs = typeof staleTime === 'number' ? staleTime : 0;
      const updatedAt = Math.min(
        queryClient.getQueryState(pixlateKeys.n5Blocks(jobId))?.dataUpdatedAt ?? 0,
        queryClient.getQueryState(pixlateKeys.n5Preview(jobId))?.dataUpdatedAt ?? 0,
      );
      if (updatedAt === 0 || Date.now() - updatedAt < staleMs) return;
      void refreshN5Snapshot(queryClient, jobId).catch(() => {
        // 실패하면 기존 자동 재조회처럼 다시 받는다(화면 캐시는 그대로 두고 다음 계기를 기다리지 않는다)
        void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Preview(jobId) });
        void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Blocks(jobId) });
      });
    };
    const offFocus = focusManager.subscribe((focused) => {
      if (focused) refreshIfStale();
    });
    const offOnline = onlineManager.subscribe((online) => {
      if (online) refreshIfStale();
    });
    return () => {
      offFocus();
      offOnline();
    };
  }, [jobId, queryClient]);
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
    mutationFn: ({ blockId, payload, idempotencyKey }: { blockId: number; payload: ApiBlockPatch; idempotencyKey?: string | null }) =>
      patchN5Block(jobId, blockId, payload, { idempotencyKey }),
    onSuccess: (response) => {
      const updated = response.block;
      if (!updated) return;
      // 성공한 저장만 경계를 만든다(실패·409 는 onSuccess 가 아니다) — 이 저장 전에 시작한 snapshot 은 이 값을 덮지 못한다
      markN5SnapshotBoundary(jobId);
      queryClient.setQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId), (prev) =>
        prev ? prev.map((b) => (b.id === updated.id ? mergePatchedBlockIntoSnapshot(b, updated) : b)) : prev,
      );
    },
  });
}

/**
 * PATCH 응답 block 을 화면 /blocks 캐시에 넣는다 — 번역문·revision·signals·layoutAdjust 등 block 값은 응답 그대로 쓰고,
 * sectionInputFingerprint(지문 A)만 캐시에 있던 값을 둔다.
 * 응답의 A 는 그 저장 직후 섹션 입력이다. 이 한 block 에만 새 A 를 넣으면 같은 섹션의 다른 block(이전 A)과 섞여 섹션 A 가
 * inconsistent 가 되고, 화면이 local-typeset 에서 이전 서버 이미지로 바뀐다. 새 A 는 /blocks·/preview 를 함께 다시 받은 snapshot
 * (publishN5Snapshot)으로만 넘어간다. FE 가 지문을 계산하거나 만들지 않는다 — 서버가 준 이전 값을 화면 snapshot 동안 유지할 뿐이다.
 * 저장 장벽 판정은 이 캐시가 아니라 새로 받은 /blocks·/preview 와 PATCH 응답 block 을 쓴다(n5-panel.tsx).
 */
export function mergePatchedBlockIntoSnapshot(cached: ApiTextBlock, patched: ApiTextBlock): ApiTextBlock {
  if (!('sectionInputFingerprint' in cached)) return patched;
  return { ...patched, sectionInputFingerprint: cached.sectionInputFingerprint };
}

/** N5 화면 snapshot — 같은 시점에 받은 /blocks·/preview 한 쌍. seq 는 받기 시작한 순서(늦게 시작한 쌍이 더 새 값이다) */
export interface N5Snapshot {
  blocks: Awaited<ReturnType<typeof getN5Blocks>>;
  preview: Awaited<ReturnType<typeof getN5Preview>>;
  seq: number;
  /** 받기 시작할 때의 인증 세대 — 그 사이 계정·세션이 바뀌었으면 화면 캐시에 넣지 않는다 */
  epoch: number;
}

let n5SnapshotSeq = 0;
const publishedN5SnapshotSeq = new Map<string, number>();
/** 마지막으로 성공한 block 저장(PATCH)의 순번 — 같은 카운터를 쓴다 */
const n5SnapshotBoundarySeq = new Map<string, number>();

/**
 * 성공한 block 저장(번역문·번역문+배치·배치만 — 모두 usePatchN5BlockMutation)이 화면 /blocks 캐시를 바꾼 순간을 표시한다.
 * 이보다 먼저 시작한 snapshot 은 PATCH 전 서버 값이라 화면에 넣지 않는다(publishN5Snapshot). 뒤에 시작한 snapshot 은 그대로 넣는다.
 * revision 을 FE 가 계산하지 않는다 — 순서만 본다. 이 저장의 재렌더가 끝나면 use-n5-preview-sync 가 새 snapshot 을 받는다
 */
export function markN5SnapshotBoundary(jobId: string): void {
  n5SnapshotBoundarySeq.set(jobId, ++n5SnapshotSeq);
}

/** /blocks·/preview 를 함께 받는다(캐시는 바꾸지 않는다) */
export async function fetchN5Snapshot(jobId: string): Promise<N5Snapshot> {
  const seq = ++n5SnapshotSeq;
  const epoch = getAuthEpoch();
  const [blocks, preview] = await Promise.all([getN5Blocks(jobId), getN5Preview(jobId)]);
  return { blocks, preview, seq, epoch };
}

/**
 * 받은 한 쌍을 화면 캐시에 한 번에 넣는다 — 「새 blocks + 이전 preview」 같은 중간 조합을 화면이 그리지 않게 한 batch 로 알린다.
 * 동기로 끝난다(넣은 직후 캐시를 읽어도 이 값이다). 넣지 않는 경우(false) — 먼저 시작했지만 늦게 끝난 응답이 새 화면을 이전 값으로 되돌리지 않게 한다:
 * - 이미 더 늦게 시작한 쌍을 넣었다
 * - 이 쌍을 받기 시작한 뒤 block 저장이 성공했다(markN5SnapshotBoundary)
 * - 이 쌍을 받기 시작한 뒤 계정·세션이 바뀌었다 — 이전 계정 응답을 새 세션 캐시에 쓰지 않는다(F-ACC-01)
 * 화면에 넣지 않을 뿐이다 — 저장 장벽은 받은 쌍으로 판정을 그대로 한다(n5-panel.tsx).
 */
export function publishN5Snapshot(queryClient: QueryClient, jobId: string, snapshot: N5Snapshot): boolean {
  if (snapshot.epoch !== getAuthEpoch()) return false;
  const floor = Math.max(publishedN5SnapshotSeq.get(jobId) ?? 0, n5SnapshotBoundarySeq.get(jobId) ?? 0);
  if (snapshot.seq < floor) return false;
  publishedN5SnapshotSeq.set(jobId, snapshot.seq);
  notifyManager.batch(() => {
    queryClient.setQueryData(pixlateKeys.n5Blocks(jobId), snapshot.blocks);
    queryClient.setQueryData(pixlateKeys.n5Preview(jobId), snapshot.preview);
  });
  return true;
}

/** 재렌더 완료 등으로 화면 snapshot 을 새로 받는다 — /blocks·/preview 를 함께 받아 한 번에 넣는다 */
export async function refreshN5Snapshot(queryClient: QueryClient, jobId: string): Promise<void> {
  publishN5Snapshot(queryClient, jobId, await fetchN5Snapshot(jobId));
}

/**
 * rerenderTaskId를 2초 간격으로 polling한다. taskId가 null이면 비활성화된다
 * (요청 접수 전이거나 이미 종료됨). done/failed/cancelled에 도달하면 polling을
 * 멈춘다 — 호출부가 그 상태를 보고 blocks/preview invalidate 여부를 판단한다.
 */
export function n5TaskStatusQueryOptions(jobId: string, taskId: number | null) {
  return {
    queryKey: pixlateKeys.n5Task(jobId, taskId),
    queryFn: () => getJobTasks(jobId),
    enabled: taskId != null,
    retry: retryTasksQuery,
    refetchInterval: (query: { state: { data?: Awaited<ReturnType<typeof getJobTasks>>; error?: unknown } }) => {
      if (taskId == null) return false;
      if (isJobNotFoundError(query.state.error)) return false;
      const item = query.state.data?.items?.find((i) => i.taskId === taskId);
      if (!item) return 2000; // 아직 목록에 반영 전 — 계속 polling
      return item.status === 'done' || item.status === 'failed' || item.status === 'cancelled'
        ? false
        : 2000;
    },
  } as const;
}

/**
 * 같은 task 는 같은 query key 를 쓴다 — 저장 응답의 rerenderTaskId 와 /preview render.attempt.taskId 가 같은 번호면 polling 이
 * 하나로 합쳐진다(use-n5-preview-sync.ts 도 이 옵션을 쓴다).
 */
export function useN5TaskStatusQuery(jobId: string, taskId: number | null) {
  return useQuery(n5TaskStatusQueryOptions(jobId, taskId));
}

// ─────────────────────────────────────────────
// N5 — 검수 화면의 실패 상태(JOB-05)
//
// page.tsx와 같은 tasks 캐시를 본다. N5에서는 page 쪽 polling이 멈춰 있고, 캐시는 N4에서 넘어오는 순간의 응답일 수
// 있어 N5 진입 때 한 번 새로 읽는다.
// ─────────────────────────────────────────────

export function useN5ReviewTasksQuery(jobId: string) {
  return useQuery({
    queryKey: pixlateKeys.tasks(jobId),
    queryFn: () => getJobTasks(jobId),
    enabled: !!jobId,
    retry: retryTasksQuery,
    refetchOnMount: 'always',
  });
}

/**
 * N5 섹션 상태용 Section DTO(id별). 목록(SEC-01)의 포함 섹션은 verdicts가 비어 있어, 되살린 섹션만 상세(SEC-02)로
 * 판정 배지를 읽는다(모든 섹션 상세를 부르지 않는다). 받지 못해도 검수를 막지 않고 그 표시만 생략한다.
 */
export function useN5SectionStatusQuery(jobId: string): ReadonlyMap<number, ApiSection> {
  const list = useQuery({
    queryKey: pixlateKeys.n5SectionStatus(jobId),
    queryFn: () => getSections(jobId),
    enabled: !!jobId,
    staleTime: 0,
  });
  const restoredIds = useMemo(
    () =>
      [...(list.data?.include ?? []), ...(list.data?.exclude ?? [])].flatMap((s) =>
        s.id != null && s.exclusionReason === 'restored_by_user' ? [s.id] : [],
      ),
    [list.data],
  );
  const detailData = useQueries({
    queries: restoredIds.map((id) => ({
      queryKey: pixlateKeys.sectionDetail(jobId, id),
      queryFn: () => getSectionDetail(jobId, id),
    })),
    combine: (results) => results.map((r) => r.data),
  });
  return useMemo(() => {
    const map = new Map<number, ApiSection>();
    for (const s of [...(list.data?.include ?? []), ...(list.data?.exclude ?? [])]) {
      if (s.id != null) map.set(s.id, s);
    }
    for (const s of detailData) {
      if (s?.id != null) map.set(s.id, s);
    }
    return map;
  }, [list.data, detailData]);
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
      // 새 최종 렌더가 시작됐다 — 이전 렌더의 산출물·검증 결과를 완료 결과처럼 다시 쓰지 않도록 버리고 tasks 를 새로 읽는다
      queryClient.removeQueries({ queryKey: pixlateKeys.deliverables(jobId) });
      queryClient.removeQueries({ queryKey: pixlateKeys.validation(jobId) });
      queryClient.setQueryData(pixlateKeys.job(jobId), job);
      // 이전 tasks 응답(이전 최종 렌더 done 포함)을 잠깐이라도 N6 완료로 보지 않게 비우고 다시 읽는다
      void queryClient.resetQueries({ queryKey: pixlateKeys.tasks(jobId) });
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
    mutationFn: async (payload: ApiExportRequest) => {
      const created = await createExport(jobId, payload);
      // 다운로드 조회(FIN-05)에 쓸 artifactId 가 없으면 내보내기가 끝난 것으로 보지 않는다
      if (created.artifactId == null) throw new Error('내보내기 산출물이 만들어지지 않았습니다');
      return created;
    },
  });
}

/** presigned URL 이 없는 다운로드 응답은 실패로 본다 — 빈 링크로 다운로드를 시작하지 않는다 */
async function getExportDownloadWithUrl(jobId: string, artifactId: number) {
  const download = await getExportDownload(jobId, artifactId);
  if (!download.url) throw new Error('다운로드 주소가 없습니다');
  return download;
}

// ─────────────────────────────────────────────
// N6 — 산출물 presigned 다운로드 조회 (API-FIN-05)
//
// 클릭 시점에 바로 조회해야 하는 값(5분 만료 presigned URL)이라 query가 아니라
// mutation으로 감싼다 — 영구 식별자처럼 캐시해 두지 않는다.
// ─────────────────────────────────────────────

/**
 * 다운로드 URL 을 받은 뒤 job 을 다시 받는다 — PRD F-FIN-03 은 [저장]과 첫 다운로드 중 먼저 일어난 것을 완료로 본다. 완료 여부는
 * FE 가 정하지 않고 서버 job.isSaved 를 다시 읽는다(작업 나가기 확인 여부 — useJobExitGuard). URL 발급은 실제 파일 저장 완료가 아니며,
 * 다운로드가 is_saved 를 바꾸는지는 API 계약(3.5.10)에 적혀 있지 않다 — 서버가 false 를 주면 계속 진행 중 작업으로 본다.
 */
function refetchJobAfterDownload(queryClient: ReturnType<typeof useQueryClient>, jobId: string) {
  void queryClient.invalidateQueries({ queryKey: pixlateKeys.job(jobId), exact: true });
}

export function useExportDownloadMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (artifactId: number) => getExportDownloadWithUrl(jobId, artifactId),
    onSuccess: () => refetchJobAfterDownload(queryClient, jobId),
  });
}

/**
 * N6 행별 개별 다운로드 — 계약상 타입별 다운로드(GET /export/download)는 "이미 만든
 * 구성요소"만 돌려준다(미생성 404). 그래서 먼저 POST /export 로 그 구성요소 하나를 만들고
 * 응답 artifactId 로 GET /exports/{artifactId}/download 를 부른다. 생성이 실패하거나
 * 응답에 artifactId 가 없으면 예외로 끝나 다운로드 조회는 하지 않는다.
 * psd는 호출부가 애초에 disabled라 이 mutation을 쓰지 않는다.
 */
export function useExportComponentDownloadMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (artifactType: ApiExportArtifactType) => {
      const created = await createExport(jobId, { components: [artifactType as string] });
      if (created.artifactId == null) throw new Error('내보내기 산출물이 만들어지지 않았습니다');
      return getExportDownloadWithUrl(jobId, created.artifactId);
    },
    onSuccess: () => refetchJobAfterDownload(queryClient, jobId),
  });
}

// ─────────────────────────────────────────────
// N6 — 보관함 저장 (API-FIN-06). 응답은 LibraryCard — 저장 여부는 별도 조회
// 없이 이 mutation의 성공 여부(isSuccess)로 판단한다.
// ─────────────────────────────────────────────

export function useSaveJobMutation(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => saveJob(jobId),
    onSuccess: () => {
      // 계약(API-FIN-06): 저장 성공 = done/N6 · is_saved=true. 이동한 보관함과 job 화면이 이 값을 바로 보도록 캐시에 반영하고, 서버 값으로 다시 받는다
      queryClient.setQueryData<ApiJob>(pixlateKeys.job(jobId), (job) => (job ? { ...job, isSaved: true } : job));
      void queryClient.invalidateQueries({ queryKey: pixlateKeys.job(jobId), exact: true });
      void queryClient.invalidateQueries({ queryKey: pixlateKeys.library() });
    },
  });
}

// ─────────────────────────────────────────────
// M1 — 보관함 카드 목록 (API-LIB-01, F-LST-02). DTO 해석은 lib/library/adapter.ts가
// 맡고 이 hook은 원본 LibraryCard[]만 캐시한다(N5의 blocks/preview query와 같은 방식).
// ─────────────────────────────────────────────

export function useLibraryQuery() {
  return useQuery({
    queryKey: pixlateKeys.library(),
    queryFn: getLibrary,
  });
}

// ─────────────────────────────────────────────
// Master — 국가/언어 기준 목록. 세션 중 거의 바뀌지 않는 기준 데이터라
// staleTime을 길게 둔다(화면마다 반복 조회하지 않기 위함).
// ─────────────────────────────────────────────

export function useMasterCountriesQuery() {
  return useQuery({
    queryKey: pixlateKeys.masterCountries(),
    queryFn: getMasterCountries,
    staleTime: Infinity,
  });
}

export function useMasterLanguagesQuery() {
  return useQuery({
    queryKey: pixlateKeys.masterLanguages(),
    queryFn: getMasterLanguages,
    staleTime: Infinity,
  });
}

export function useMasterCategoriesQuery() {
  return useQuery({
    queryKey: pixlateKeys.masterCategories(),
    queryFn: getMasterCategories,
    staleTime: Infinity,
  });
}

/** 판매 채널 표시 이름용. 받지 못해도 화면을 막지 않는다(그 항목만 비운다) */
export function useMasterChannelSpecsQuery() {
  return useQuery({
    queryKey: pixlateKeys.masterChannelSpecs(),
    queryFn: getMasterChannelSpecs,
    staleTime: Infinity,
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
//
// N5도 같은 SEC-03(N3·N5 공용)이라 이 hook을 그대로 쓴다. N5 프리뷰(n5Preview)는
// 낙관적으로 바꾸지 않는다 — 저장 성공 응답의 bucket/excludedStage만 반영하고,
// 성공·실패 모두 n5Preview를 다시 받아 서버 정본(displayTop 등 서버 계산값 포함)에
// 맞춘다(계약: 프리뷰 재조회는 구성 변경 SEC-03·CFM-02 시). 섹션 bucket은 블록·job을
// 바꾸지 않으므로 n5Blocks/job은 건드리지 않는다.
// ─────────────────────────────────────────────

export function useUpdateSectionBucketMutation(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation(
    sectionBucketMutationOptions({
      queryClient,
      sectionsKey: pixlateKeys.sections(jobId),
      previewKey: pixlateKeys.n5Preview(jobId),
      update: (sectionId, payload) => updateSectionBucket(jobId, sectionId, payload),
    }),
  );
}

// ─────────────────────────────────────────────
// M2 — 브랜드 정보·로고. 404(없음·미소유)는 다시 시도해도 같아서 재시도하지 않는다.
// 로고 logoUrl 은 presigned(만료 5분)라 오래 캐시하지 않는다(staleTime 0 — 다시 볼 때 새 URL 을 받는다).
// ─────────────────────────────────────────────

const retryUnlessNotFound = (failureCount: number, error: unknown) =>
  !(error instanceof ApiRequestError && error.status === 404) && failureCount < 1;

export function useBrandsQuery(enabled: boolean) {
  return useQuery({ queryKey: pixlateKeys.brands(), queryFn: getBrands, enabled });
}

/**
 * 브랜드 등록(POST /brands). 재시도하지 않는다 — 중복 생성 방지. 응답 Brand.id 가 이후 흐름의 정본이고, id 가 없으면 실패로 본다.
 * 성공하면 응답을 brand(id) cache 에 쓰고, 새 브랜드의 로고는 아직 없으므로 빈 목록을 쓴 뒤 brands 목록을 다시 받는다.
 */
export function useCreateBrandMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ApiBrandCreate) => {
      const created = await createBrand(payload);
      if (typeof created.id !== 'number') throw new Error('브랜드 등록 응답에 id 가 없습니다.');
      return created as ApiBrand & { id: number };
    },
    retry: false,
    onSuccess: (created) => {
      queryClient.setQueryData(pixlateKeys.brand(created.id), created);
      queryClient.setQueryData(pixlateKeys.brandLogos(created.id), []);
      void queryClient.invalidateQueries({ queryKey: pixlateKeys.brands(), exact: true });
    },
    onError: (error) => {
      // 409 — 서버 목록을 다시 받아 맞춘다(등록 화면은 목록을 구독하지 않아 invalidate 만으로는 다시 받지 않는다).
      // 받은 목록의 브랜드를 방금 만든 것으로 단정하지 않는다
      if (error instanceof ApiRequestError && error.status === 409) {
        void queryClient.fetchQuery({ queryKey: pixlateKeys.brands(), queryFn: getBrands, staleTime: 0 }).catch(() => undefined);
      }
    },
  });
}

export function useBrandQuery(brandId: number | null) {
  return useQuery({
    queryKey: pixlateKeys.brand(brandId ?? -1),
    queryFn: () => getBrand(brandId as number),
    enabled: brandId != null,
    retry: retryUnlessNotFound,
  });
}

export function useBrandLogosQuery(brandId: number | null) {
  return useQuery({
    queryKey: pixlateKeys.brandLogos(brandId ?? -1),
    queryFn: () => getBrandLogos(brandId as number),
    enabled: brandId != null,
    retry: retryUnlessNotFound,
    staleTime: 0,
  });
}
