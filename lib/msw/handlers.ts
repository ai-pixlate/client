import { http, HttpResponse } from 'msw';

import type {
  JobCurrentStep,
  SectionBucket,
} from '@/lib/api/types';
import {
  MOCK_JOB_ID,
  mockSectionsResponse,
  mockJobResultResponse,
} from '@/lib/mock-api/fixtures';
import { mockN5Job, mockN5Blocks, mockN5PreviewSections, buildMockN5Preview } from '@/lib/mock-api/n5-fixtures';
import type { ApiJob, ApiJobAsyncTaskItem, ApiTextBlock } from '@/lib/api/n5-schema';
import type { ApiAcceptedTask } from '@/lib/api/job-schema';

// ─────────────────────────────────────────────
// Mock 인메모리 상태
//
// fixture 원본 직접 변경을 막기 위해 별도 Map/변수로 관리합니다.
// HMR·새로고침 시 초기값으로 리셋되는 것은 Mock 환경에서 허용합니다.
// ─────────────────────────────────────────────

/**
 * 섹션 bucket 상태 — N3 구 계약(GET/PATCH /api/jobs/:jobId/sections, 문자열
 * sectionId)만 쓴다. N5 v3.4.2(GET /jobs/:jobId/preview, POST .../confirm)는
 * 이 상태를 전혀 읽지 않는다 — mockN5PreviewSections(숫자 sectionId, N3와
 * 완전히 분리된 별도 fixture)를 쓴다(7단계에서 확인). N3에서 섹션을
 * 제외해도 N5의 전체 제외(ALL_SECTIONS_EXCLUDED) 판정에는 영향이 없다 — 실제
 * 백엔드가 같은 섹션 엔티티를 공유하는지는 별개이며, 이 mock 구조가 그 계약을
 * 대신 보증하지 않는다.
 * excludedStage: 어느 단계에서 제외됐는지 — N3 / N5 / null
 */
const sectionState = new Map<string, {
  bucket: SectionBucket;
  exclusionReason: string | null;
  excludedStage: JobCurrentStep | null;
}>(
  mockSectionsResponse.sections.map(s => [
    s.sectionId,
    { bucket: s.bucket, exclusionReason: s.exclusionReason, excludedStage: s.excludedStage },
  ])
);

/**
 * job 진행 상태(N1~N6 공용, ApiJob 그대로). mockN5Job(원본 fixture)이 가진
 * productName/brandId/targetCountry 등 N5 표시용 필드는 그대로 씨드하되,
 * currentStep/userFacingStatus/status만 "방금 분석이 시작된" 값으로 덮어써서
 * 시작한다 — mockN5Job 원본은 N5 화면을 독립적으로 만들던 시절 currentStep을
 * 'N5'로 고정해 뒀던 값이라, 그대로 쓰면 새 job이 생성되자마자 이미 N5에
 * 있는 것처럼 보인다(N1→N6 전체 경로를 검증하려는 오늘 작업과 모순).
 * analyze/sections-proceed/confirm 성공 시 이 값만 갱신한다 — N3(구
 * mockJobState)와 N5(구 n5JobState) 각자 따로 있던 진행 상태를 오늘 하나로
 * 합쳤다(같은 job의 currentStep이 두 소스에서 다르게 답하는 걸 막기 위함).
 *
 * N1('/jobs/new')에서 '/jobs/:jobId'로의 첫 진입은 Next dev 서버가 실제
 * full page load를 낸다(해당 동적 라우트를 그 세션에서 처음 컴파일할 때의
 * dev 전용 동작 — 실측: page.on('load')가 실제로 두 번째 발생한다). 그
 * 순간 MSW Service Worker의 모듈(top-level let 전부, jobState 포함)이
 * 다시 초기화되므로, POST /jobs/:jobId/analyze가 이미 성공시킨 N2 전환이
 * 그 직후 지워질 수 있다. 그래서 리셋 기준값 자체를 draft/N1이 아니라
 * "분석 시작 직후"(N2/processing/analyzing)로 잡는다 — analyze 엔드포인트
 * 자체는 그대로 두고 N1이 실제로 호출한다(멱등하게 같은 값을 다시 확정할
 * 뿐이니 무해하다). 이 개발 서버 특성과 무관한 실제 배포 환경에서는
 * analyze 호출이 여전히 유일한 N1→N2 전환 경로다.
 */
let jobState: ApiJob = { ...mockN5Job, currentStep: 'N2', userFacingStatus: 'analyzing', status: 'processing' };

/** N2/N4 진행 polling 카운터. jobState.currentStep이 N2/N4로 바뀔 때마다 0으로 리셋한다. */
let jobProcessingPollCount = 0;

function resetJobState() {
  jobState = { ...mockN5Job, currentStep: 'N2', userFacingStatus: 'analyzing', status: 'processing' };
  jobProcessingPollCount = 0;
}

/**
 * N5 실제 계약(v3.4.2) 블록 상태. mockN5Blocks(원본 fixture) 직접 변경을
 * 막기 위해 별도 Map으로 복제해 관리한다 — PATCH가 이 Map만 갱신한다.
 */
const n5BlockState = new Map<number, ApiTextBlock>(mockN5Blocks.map((b) => [b.id as number, { ...b }]));

/**
 * 현재 미해결 경고 집합 — 모든 block의 signals[]를 {blockId, code}로 펼친
 * 것. confirm의 acknowledgedWarnings와 정확히 같아야 한다(달라지면 409
 * INVALID_STATE). PATCH가 signals를 갱신하지 않으므로(계약에 없음) 이 목록은
 * job 생애주기 동안 고정이다 — FE의 buildAcknowledgedWarnings가 매 확정
 * 시점에 같은 소스(로드된 block.signals)에서 다시 계산해 보내므로 정상
 * 흐름에서는 항상 일치한다.
 */
function computeCurrentN5Warnings(): { blockId: number; code: string }[] {
  const warnings: { blockId: number; code: string }[] = [];
  for (const block of n5BlockState.values()) {
    for (const signal of block.signals ?? []) {
      if (block.id != null && signal.code != null) {
        warnings.push({ blockId: block.id, code: signal.code });
      }
    }
  }
  return warnings;
}

function n5WarningSetsMatch(
  a: { blockId: number; code: string }[],
  b: { blockId: number; code: string }[],
): boolean {
  const key = (w: { blockId: number; code: string }) => `${w.blockId}:${w.code}`;
  const setA = new Set(a.map(key));
  const setB = new Set(b.map(key));
  if (setA.size !== setB.size) return false;
  for (const k of setA) if (!setB.has(k)) return false;
  return true;
}

function getN5BlocksFromState(sectionId?: number): ApiTextBlock[] {
  const all = [...n5BlockState.values()];
  return sectionId != null ? all.filter((b) => b.sectionId === sectionId) : all;
}

/**
 * N5 재렌더 task 인메모리 상태. PATCH 성공 시 task 하나가 생긴다.
 * pollCount>=2가 되면 done(또는 trans1에 "실패유도"가 포함돼 있으면 failed)
 * 처리한다 — 실제 2초 polling 몇 번만에 끝나는 모습을 mock에서도 재현하기
 * 위함이다. done 시점에 overflow/autoAdjust를 그제서야 갱신한다(계약: 재렌더
 * 전까지는 이전 값을 유지).
 */
let n5TaskIdCounter = 90000;
const n5TaskState = new Map<number, { blockId: number; pollCount: number }>();

function n5RevisionConflictResponse(current: ApiTextBlock) {
  return HttpResponse.json(
    {
      error: {
        code: 'REVISION_CONFLICT',
        message: '다른 곳에서 이미 수정되어 저장할 수 없습니다.',
        retryable: false,
        details: { current },
        traceId: `mock-trace-${Date.now()}`,
      },
    },
    { status: 409 },
  );
}

/** N6 보관함 저장 상태 */
let jobResultSaved = false;

/**
 * N2/N4 진행 중(processing) 단계에서 다음 단계로 넘어갈 조건 — 오늘(N1→N6
 * happy path) 작업. 실제 처리 로직은 만들지 않는다 — GET /jobs/:jobId/tasks를
 * 2초 polling할 때마다 poll count만 늘려 pending→running→done을 흉내내고,
 * done이 되는 시점에 jobState.currentStep을 다음 단계로 바꾼다. 중간 실패·재시도
 * 시나리오는 오늘 범위가 아니라 failedCount/items는 항상 0/[]이다.
 */
const PROCESSING_STAGES: Record<'N2' | 'N4', { key: string; label: string; next: ApiJob['currentStep']; nextUserFacingStatus: ApiJob['userFacingStatus'] }> = {
  N2: { key: 'analyze', label: '이미지를 분석하고 있습니다', next: 'N3', nextUserFacingStatus: 'section_review' },
  N4: { key: 'translate', label: '번역과 이미지 처리를 진행하고 있습니다', next: 'N5', nextUserFacingStatus: 'reviewing' },
};

/**
 * jobState가 N2/N4(진행 중 단계)면 poll count를 진행시키고, 2번째 poll에서
 * done 처리와 함께 다음 단계로 전환한다(jobState를 직접 갱신). N1/N3/N5/N6처럼
 * 사용자 조작을 기다리는 단계면 아무것도 진행시키지 않고 빈 진행 정보를
 * 반환한다 — GET /jobs/:jobId/tasks 핸들러가 이 결과를 응답 조립에 쓴다.
 */
function advanceJobProcessing(): {
  progress: number;
  total: number;
  done: number;
  stages: { key: string; label: string; status: 'running' | 'done' }[];
} {
  const step = jobState.currentStep;
  if (step !== 'N2' && step !== 'N4') {
    return { progress: 1, total: 0, done: 0, stages: [] };
  }

  const stage = PROCESSING_STAGES[step];
  jobProcessingPollCount += 1;

  if (jobProcessingPollCount < 2) {
    return { progress: 0.5, total: 1, done: 0, stages: [{ ...stage, status: 'running' }] };
  }

  jobState = { ...jobState, currentStep: stage.next, userFacingStatus: stage.nextUserFacingStatus, status: 'review' };
  jobProcessingPollCount = 0;
  return { progress: 1, total: 1, done: 1, stages: [{ ...stage, status: 'done' }] };
}

// ─────────────────────────────────────────────
// 에러 응답 헬퍼
// Mock 전용 형식입니다. 백엔드 확정 에러 코드가 아닙니다.
// ─────────────────────────────────────────────

function notFound(message: string) {
  return HttpResponse.json({ code: 'NOT_FOUND', message }, { status: 404 });
}

function badRequest(message: string) {
  return HttpResponse.json({ code: 'INVALID_REQUEST', message }, { status: 400 });
}

// ─────────────────────────────────────────────
// handlers
// ─────────────────────────────────────────────

export const handlers = [

  // ── health (기존 유지). N1→N6 화면 흐름과 무관한 MSW 자체 점검용
  // 엔드포인트라 오늘 /api 경로 정리 대상이 아니다 — 실제 OpenAPI에도 대응
  // 경로가 없다(mock 전용 유틸리티).
  http.get('/api/mock/health', () => {
    return HttpResponse.json({ ok: true, source: 'msw' });
  }),

  // ──────────────────────────────────────────
  // N1 — job 생성. 경로는 실제 OpenAPI(POST /jobs)로 맞췄다 — mock 전용
  // /api 프리픽스를 쓰지 않는다(오늘 경로 정리, 이전엔 /api/jobs였다).
  //
  // Mock에서는 항상 MOCK_JOB_ID를 반환합니다.
  // 실제 백엔드는 별도 job ID를 생성합니다. 실제 계약(JobCreate)은 brandId만
  // 받는 draft-first 흐름(POST /jobs → PATCH로 N1값 세팅 → analyze)이지만,
  // N1 화면 자체를 이 흐름으로 다시 만드는 건 오늘 범위 밖이라 기존 한 번에
  // 받는 payload/검증은 그대로 둔다 — 대신 job 진행 상태(jobState)만
  // 리셋해서, 이후 analyze/tasks polling이 실제로 이어지게 한다.
  // ──────────────────────────────────────────
  http.post('/jobs', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;

    if (!body.brandId) return badRequest('brandId가 필요합니다');
    if (!body.targetCountry) return badRequest('targetCountry가 필요합니다');
    if (!body.targetLanguage) return badRequest('targetLanguage가 필요합니다');
    if (!Array.isArray(body.sourceImages) || body.sourceImages.length === 0) {
      return badRequest('sourceImages가 1개 이상 필요합니다');
    }

    // 새 job 생성 시 이전 브라우저 테스트에서 진행됐던 mock 상태를 다시 시작
    // (리셋 기준값이 N2인 이유는 위 jobState 선언부 주석 참고)
    resetJobState();

    return HttpResponse.json({ jobId: MOCK_JOB_ID }, { status: 201 });
  }),

  // ──────────────────────────────────────────
  // N1 → N2 — 분석 시작 (API-ANL-01)
  //
  // draft 생성만으로 분석이 자동 시작되지 않는다 — 이 호출이 게이트다
  // (CLAUDE.md 원칙). 큐 등록까지만 202로 수락하고, 진행은 GET
  // /jobs/:jobId/tasks 폴링(아래)이 맡는다.
  // ──────────────────────────────────────────
  http.post('/jobs/:jobId/analyze', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    jobState = { ...jobState, currentStep: 'N2', userFacingStatus: 'analyzing', status: 'processing' };
    jobProcessingPollCount = 0;

    const response: ApiAcceptedTask = { jobId: jobState.id, taskId: 1 };
    return HttpResponse.json(response, { status: 202 });
  }),

  // ──────────────────────────────────────────
  // N3 — 섹션 목록 조회. 경로는 실제 OpenAPI(GET /jobs/:jobId/sections)로
  // 맞췄다(오늘 경로 정리, 이전엔 /api/jobs/:jobId/sections였다) — PATCH는
  // 이미 실제 경로를 쓰고 있었다.
  // 현재 인메모리 bucket 상태를 반영해 반환합니다.
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/sections', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const sections = mockSectionsResponse.sections.map(sec => {
      const state = sectionState.get(sec.sectionId);
      return state
        ? { ...sec, bucket: state.bucket, exclusionReason: state.exclusionReason }
        : sec;
    });

    return HttpResponse.json({ sections });
  }),

  // ──────────────────────────────────────────
  // N3 / N5 — 섹션 bucket 변경 (포함 / 제외 전환)
  //
  // Request: { "bucket": "include" | "exclude" }
  // exclusionReason은 사용자 입력 필드가 아닙니다.
  // excludedStage는 클라이언트가 보내지 않는다 — 서버가 현재 job 단계
  // (jobState.currentStep)를 기준으로 판단한다.
  // ──────────────────────────────────────────
  http.patch('/jobs/:jobId/sections/:sectionId', async ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const sectionId = params.sectionId as string;
    if (!sectionState.has(sectionId)) return notFound(`Section '${sectionId}' not found`);

    const body = await request.json() as Record<string, unknown>;
    const bucket = body.bucket;

    if (bucket !== 'include' && bucket !== 'exclude') {
      return badRequest("bucket은 'include' 또는 'exclude'이어야 합니다");
    }

    const excludedStage = bucket === 'include' ? null : (jobState.currentStep as JobCurrentStep | undefined) ?? null;
    sectionState.set(sectionId, { bucket, exclusionReason: null, excludedStage });
    return HttpResponse.json({ sectionId, bucket, excludedStage });
  }),

  // ──────────────────────────────────────────
  // N3 → N4 — 이대로 진행 (API-SEC-04)
  //
  // 전 섹션 제외면 409 ALL_SECTIONS_EXCLUDED(N5 confirm과 같은 규칙, N3 자신의
  // sectionState 기준). include≥1이면 큐 등록(202) — 진행은 GET
  // /jobs/:jobId/tasks 폴링이 맡는다. 구 /api/jobs/:jobId/status/advance
  // (mock 임시 계약)를 대체한다.
  // ──────────────────────────────────────────
  http.post('/jobs/:jobId/sections/proceed', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const hasIncludedSection = [...sectionState.values()].some((s) => s.bucket === 'include');
    if (!hasIncludedSection) {
      return HttpResponse.json(
        {
          error: {
            code: 'ALL_SECTIONS_EXCLUDED',
            message: '모든 섹션이 제외되어 진행할 수 없습니다. 최소 1개 섹션을 포함해야 합니다.',
            retryable: false,
            details: null,
            traceId: `mock-trace-${Date.now()}`,
          },
        },
        { status: 409 },
      );
    }

    jobState = { ...jobState, currentStep: 'N4', userFacingStatus: 'translating', status: 'processing' };
    jobProcessingPollCount = 0;

    const response: ApiAcceptedTask = { jobId: jobState.id, taskId: 2 };
    return HttpResponse.json(response, { status: 202 });
  }),

  // ──────────────────────────────────────────
  // N5 — 실제 계약(v3.4.2) 조회. mock 전용 /api 프리픽스를 쓰지 않는다 —
  // 실제 backend 상대경로(/jobs/...)를 그대로 흉내낸다.
  //
  // 5단계: 구 /api/jobs/:jobId/review·preview(v3.4.1) handler와 N5 stress
  // job 2종(job_mock_stress_001/002)은 호출부가 전혀 남지 않아 제거했다 —
  // 새 엔드포인트(/jobs/:jobId 등)는 MOCK_JOB_ID만 인식하므로, 그 stress job id로는
  // 애초에 도달할 수 없었다(고아 상태였다).
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);
    return HttpResponse.json(jobState);
  }),

  http.get('/jobs/:jobId/blocks', ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const sectionIdParam = new URL(request.url).searchParams.get('sectionId');
    const sectionId = sectionIdParam != null ? Number(sectionIdParam) : undefined;
    return HttpResponse.json(getN5BlocksFromState(sectionId));
  }),

  http.get('/jobs/:jobId/preview', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);
    return HttpResponse.json(buildMockN5Preview());
  }),

  // ──────────────────────────────────────────
  // N5 — 번역문 수정 (API-CFM-02, v3.4.2)
  //
  // { trans1, revision } → revision 불일치 시 409 REVISION_CONFLICT
  // (error.details.current에 최신 block). 성공 시 { block, rerenderTaskId }.
  // char_count는 즉시 반영, overflow/autoAdjust는 GET /tasks가 done을
  // 돌려준 뒤에만 갱신한다.
  // ──────────────────────────────────────────
  http.patch('/jobs/:jobId/blocks/:blockId', async ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const blockId = Number(params.blockId);
    const current = n5BlockState.get(blockId);
    if (!current) return notFound(`Block '${blockId}' not found`);

    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.trans1 !== 'string' || typeof body.revision !== 'number') {
      return badRequest('trans1(string)과 revision(number)이 필요합니다');
    }

    if (body.revision !== current.revision) {
      return n5RevisionConflictResponse(current);
    }

    const updated: ApiTextBlock = {
      ...current,
      trans1: body.trans1,
      charCount: body.trans1.length,
      revision: current.revision + 1,
    };
    n5BlockState.set(blockId, updated);

    const rerenderTaskId = n5TaskIdCounter++;
    n5TaskState.set(rerenderTaskId, { blockId, pollCount: 0 });

    return HttpResponse.json({ block: updated, rerenderTaskId });
  }),

  // ──────────────────────────────────────────
  // 비동기 큐 상태 polling (API-JOB-05, x-screen: N2·N4·N6)
  //
  // 오늘(N1→N6 happy path)부터 이 엔드포인트가 두 가지 진행을 함께 나른다 —
  // ① N5 block 재렌더 task(n5TaskState, PATCH /blocks/:id가 등록. 기존 로직
  // 그대로 유지) ② N2/N4 job 단계 진행(advanceJobProcessing, jobState.currentStep이
  // N2/N4일 때만 poll count를 늘려 다음 단계로 전환). 응답 wrapper의
  // currentStep/userFacingStatus/jobStatus는 항상 jobState를 그대로 반영한다 —
  // FE(page.tsx)가 이 값으로만 다음 화면을 고른다(별도 계산 없음).
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/tasks', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const items: ApiJobAsyncTaskItem[] = [];
    for (const [taskId, state] of n5TaskState.entries()) {
      state.pollCount += 1;
      const block = n5BlockState.get(state.blockId);
      // "실패유도"를 trans1에 넣으면 이 task가 실패로 끝난다 — 실패/polling
      // 종료 경로를 mock에서도 재현하기 위한 테스트 전용 hook이다.
      const forceFail = block?.trans1?.includes('실패유도') ?? false;

      if (state.pollCount < 2) {
        items.push({
          taskId,
          taskType: 'render',
          unitType: 'text_block',
          unitId: state.blockId,
          status: 'running',
          uiStatus: 'running',
          retryCount: 0,
          maxRetry: 3,
          retryable: false,
          errorCode: null,
          revision: null,
        });
        continue;
      }

      if (forceFail) {
        items.push({
          taskId,
          taskType: 'render',
          unitType: 'text_block',
          unitId: state.blockId,
          status: 'failed',
          uiStatus: 'failed',
          retryCount: 0,
          maxRetry: 3,
          retryable: true,
          errorCode: 'RENDER_FAILED',
          revision: block?.revision ?? null,
        });
        continue;
      }

      // 재렌더 완료 — 이 시점에야 overflow/autoAdjust를 갱신한다(계약대로
      // PATCH 응답 시점이 아니라 재렌더 완료 시점에 반영).
      if (block) {
        const overflow = block.charLimit != null && (block.trans1?.length ?? 0) > block.charLimit;
        n5BlockState.set(state.blockId, {
          ...block,
          overflow,
          autoAdjust: overflow ? { fontScale: 0.85, lineBreakApplied: true } : null,
        });
      }
      items.push({
        taskId,
        taskType: 'render',
        unitType: 'text_block',
        unitId: state.blockId,
        status: 'done',
        uiStatus: 'done',
        retryCount: 0,
        maxRetry: 3,
        retryable: false,
        errorCode: null,
        revision: n5BlockState.get(state.blockId)?.revision ?? null,
      });
    }

    const jobProgress = advanceJobProcessing();
    const hasN5Items = items.length > 0;

    return HttpResponse.json({
      jobStatus: jobState.status,
      currentStep: jobState.currentStep,
      userFacingStatus: jobState.userFacingStatus,
      progress: hasN5Items ? items.filter((i) => i.status === 'done').length / items.length : jobProgress.progress,
      total: hasN5Items ? items.length : jobProgress.total,
      done: hasN5Items ? items.filter((i) => i.status === 'done').length : jobProgress.done,
      failedCount: items.filter((i) => i.status === 'failed').length,
      stages: jobProgress.stages,
      items,
    });
  }),

  // ──────────────────────────────────────────
  // N5 — 검수 확정 = N5→N6 (API-CFM-04, v3.4.2)
  //
  // 전 섹션 제외 차단(409 ALL_SECTIONS_EXCLUDED), acknowledgedWarnings가
  // 현재 미해결 경고 집합과 다르면 409 INVALID_STATE(+details.warnings에
  // 현재 목록). 성공하면 job이 N6로 넘어간다 — 화면 전환을 구동하는
  // jobState를 여기서 직접 갱신한다(GET /jobs/:jobId/tasks가 그대로 반영).
  // ──────────────────────────────────────────
  http.post('/jobs/:jobId/confirm', async ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const hasIncludedSection = mockN5PreviewSections.some((s) => s.bucket === 'include');
    if (!hasIncludedSection) {
      return HttpResponse.json(
        {
          error: {
            code: 'ALL_SECTIONS_EXCLUDED',
            message: '모든 섹션이 제외되어 확정할 수 없습니다. 최소 1개 섹션을 포함해야 합니다.',
            retryable: false,
            details: null,
            traceId: `mock-trace-${Date.now()}`,
          },
        },
        { status: 409 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      acknowledgedWarnings?: { blockId: number; code: string }[];
    };
    const acknowledged = body.acknowledgedWarnings ?? [];
    const currentWarnings = computeCurrentN5Warnings();
    if (!n5WarningSetsMatch(acknowledged, currentWarnings)) {
      return HttpResponse.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: '확인하지 않은 경고가 있어 확정할 수 없습니다.',
            retryable: true,
            details: { warnings: currentWarnings },
            traceId: `mock-trace-${Date.now()}`,
          },
        },
        { status: 409 },
      );
    }

    // job→N6, status=review(스펙: "job→review/N6"). userFacingStatus는 'done'이
    // 아니라 'reviewing'으로 둔다 — 렌더 task는 confirm 트랜잭션에서 서버가
    // 자동 등록하지만 아직 완료된 게 아니다(서버가 안 준 완료 상태를 mock이
    // 임의로 만들지 않는다). 실제 렌더 진행 polling·완료 시 'done' 전환은
    // N6 5단계 구현(오늘 범위 밖)에서 다룬다. N6 화면 자체는 이미 구현돼
    // 있다(getJobResult 기준, 아래 GET /api/jobs/:jobId/result) — 그 결과
    // 데이터는 이 jobState와 별개로 항상 완료 상태를 보여준다.
    jobState = { ...jobState, currentStep: 'N6', status: 'review', userFacingStatus: 'reviewing' };

    return HttpResponse.json(jobState);
  }),

  // ──────────────────────────────────────────
  // N6 — 최종 결과 조회. mock 전용 /api placeholder를 아직 그대로 둔다 —
  // N6 화면 자체를 만들지 않는 오늘(경로 정리) 범위 밖이다. TODO(N6 구현
  // 시): 실제 계약은 GET /jobs/:jobId/deliverables(+ /validation)이고
  // 응답 shape가 이 JobResultResponse와 전혀 다르다 — 경로만 바꿔 끼울 수
  // 없고 화면·adapter를 함께 다시 만들어야 한다.
  // ──────────────────────────────────────────
  http.get('/api/jobs/:jobId/result', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    return HttpResponse.json({ ...mockJobResultResponse, saved: jobResultSaved });
  }),

  // ──────────────────────────────────────────
  // N6 — 보관함 저장. 위와 같은 이유로 /api placeholder 유지. TODO(N6 구현
  // 시): 실제 계약은 POST /jobs/:jobId/save이고 응답이 LibraryCard다({saved:
  // boolean}이 아니다).
  // 호출 후 GET result에서 saved: true가 반환됩니다.
  // ──────────────────────────────────────────
  http.post('/api/jobs/:jobId/save', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    jobResultSaved = true;
    return HttpResponse.json({ saved: true });
  }),
];
