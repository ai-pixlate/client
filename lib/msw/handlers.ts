import { http, HttpResponse } from 'msw';

import type {
  JobStatusResponse,
  JobCurrentStep,
  JobDbStatus,
  SectionBucket,
} from '@/lib/api/types';
import {
  MOCK_JOB_ID,
  mockN2ProcessingStatus,
  mockN2VerdictStatus,
  mockN4ProcessingStatus,
  mockN4RenderingStatus,
  mockN4PartialFailureStatus,
  mockN6RenderingStatus,
  mockSectionsResponse,
  mockJobResultResponse,
} from '@/lib/mock-api/fixtures';
import { mockN5Job, mockN5Blocks, mockN5PreviewSections, buildMockN5Preview } from '@/lib/mock-api/n5-fixtures';
import type { ApiJob, ApiJobAsyncTaskItem, ApiTextBlock } from '@/lib/api/n5-schema';

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
 * N5 실제 계약(v3.4.2) job 상태. mockN5Job(원본 fixture) 직접 변경을 막기
 * 위해 복제해 관리한다 — confirm 성공 시 이 값만 갱신한다.
 */
let n5JobState: ApiJob = { ...mockN5Job };

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
 * Mock job 진행 상태 (2일차: N2/N4 polling auto-progress용)
 *
 * scenario 쿼리 없이 GET /status를 호출할 때만 이 상태를 진행시킵니다.
 * scenario가 명시된 요청은 읽기 전용 디버그 조회이므로 이 상태를 건드리지 않습니다.
 */
let mockJobState: { currentStep: JobCurrentStep; dbStatus: JobDbStatus; pollCount: number } = {
  currentStep: 'N2',
  dbStatus: 'processing',
  pollCount: 0,
};

function resetMockJobState() {
  mockJobState = { currentStep: 'N2', dbStatus: 'processing', pollCount: 0 };
}

/**
 * scenario 없는 기본 GET /status 요청에 대해 mockJobState를 한 단계 진행시키고
 * 그에 맞는 JobStatusResponse를 반환합니다.
 */
function advanceMockJobState(): JobStatusResponse {
  if (mockJobState.currentStep === 'N2') {
    if (mockJobState.pollCount === 0) {
      mockJobState.pollCount += 1;
      return mockN2ProcessingStatus;
    }
    if (mockJobState.pollCount === 1) {
      mockJobState.pollCount += 1;
      return mockN2VerdictStatus;
    }
    mockJobState = { currentStep: 'N3', dbStatus: 'review', pollCount: 0 };
    return { ...mockN2VerdictStatus, currentStep: 'N3', dbStatus: 'review', progress: 100 };
  }

  if (mockJobState.currentStep === 'N4') {
    if (mockJobState.pollCount === 0) {
      mockJobState.pollCount += 1;
      return mockN4ProcessingStatus;
    }
    if (mockJobState.pollCount === 1) {
      mockJobState.pollCount += 1;
      return mockN4RenderingStatus;
    }
    mockJobState = { currentStep: 'N5', dbStatus: 'review', pollCount: 0 };
    return { ...mockN4RenderingStatus, currentStep: 'N5', dbStatus: 'review', progress: 100 };
  }

  // N3: 다음 단계 진입 API가 없어 현재 상태를 그대로 반환한다. N5→N6은 이
  // 함수가 아니라 POST /jobs/:jobId/confirm 핸들러(아래, 6단계)가 mockJobState를
  // 직접 갱신한다 — 이 분기는 그 갱신 결과(currentStep: 'N6')를 그대로
  // 돌려주는 경로로만 통과한다.
  return {
    jobId: MOCK_JOB_ID,
    currentStep: mockJobState.currentStep,
    dbStatus: mockJobState.dbStatus,
    progress: 100,
    processingSubStep: '',
    activeSubSteps: [],
    hasFailed: false,
    failedItems: [],
  };
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

  // ── health (기존 유지)
  http.get('/api/mock/health', () => {
    return HttpResponse.json({ ok: true, source: 'msw' });
  }),

  // ──────────────────────────────────────────
  // N1 — job 생성
  //
  // Mock에서는 항상 MOCK_JOB_ID를 반환합니다.
  // 실제 백엔드는 별도 job ID를 생성합니다.
  // ──────────────────────────────────────────
  http.post('/api/jobs', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;

    if (!body.brandId) return badRequest('brandId가 필요합니다');
    if (!body.targetCountry) return badRequest('targetCountry가 필요합니다');
    if (!body.targetLanguage) return badRequest('targetLanguage가 필요합니다');
    if (!Array.isArray(body.sourceImages) || body.sourceImages.length === 0) {
      return badRequest('sourceImages가 1개 이상 필요합니다');
    }

    // 새 job 생성 시 이전 브라우저 테스트에서 진행됐던 mock 상태를 N2부터 다시 시작
    resetMockJobState();

    return HttpResponse.json({ jobId: MOCK_JOB_ID }, { status: 201 });
  }),

  // ──────────────────────────────────────────
  // N2 / N4 / N6 공용 — 비동기 처리 상태 polling
  //
  // scenario 없음                 mockJobState 기준 auto-progress (2일차)
  // ?scenario=n2               N2 섹션 분해 중 (읽기 전용 디버그)
  // ?scenario=n2-verdict       N2 규제 판정 중 (읽기 전용 디버그)
  // ?scenario=n4               N4 번역·인페인팅 병렬 처리 중 (읽기 전용 디버그)
  // ?scenario=n4-partial-failure  N4 부분 실패 (blk_04 타임아웃, 읽기 전용 디버그)
  // ?scenario=n6-rendering     N6 렌더링 중 (읽기 전용 디버그)
  // ──────────────────────────────────────────
  http.get('/api/jobs/:jobId/status', ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const scenario = new URL(request.url).searchParams.get('scenario');

    // scenario가 명시된 요청은 수동 fixture 조회용 — mockJobState에 영향 없음
    if (scenario) {
      const scenarioMap: Record<string, JobStatusResponse> = {
        'n2':                 mockN2ProcessingStatus,
        'n2-verdict':         mockN2VerdictStatus,
        'n4':                 mockN4ProcessingStatus,
        'n4-partial-failure': mockN4PartialFailureStatus,
        'n6-rendering':       mockN6RenderingStatus,
      };
      return HttpResponse.json(scenarioMap[scenario] ?? mockN2ProcessingStatus);
    }

    // scenario 없는 기본 요청 — mockJobState를 진행시키며 응답
    return HttpResponse.json(advanceMockJobState());
  }),

  // ──────────────────────────────────────────
  // N3 → N4 — 다음 단계 진입
  //
  // Mock 검증용 임시 계약입니다. 백엔드 확정 API가 아닙니다.
  // 이 엔드포인트는 N3 → N4 전환만 지원합니다. N5 → N6은 이 임시 계약이
  // 아니라 실제 v3.4.2 계약인 POST /jobs/:jobId/confirm(아래, 6단계)으로
  // 처리합니다 — 별도 엔드포인트라 여기서 다루지 않습니다.
  // ──────────────────────────────────────────
  http.post('/api/jobs/:jobId/status/advance', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    if (mockJobState.currentStep !== 'N3') {
      return badRequest('현재 단계에서는 다음 단계로 진행할 수 없습니다.');
    }

    mockJobState = { currentStep: 'N4', dbStatus: 'processing', pollCount: 0 };

    const response: JobStatusResponse = {
      jobId: MOCK_JOB_ID,
      currentStep: 'N4',
      dbStatus: 'processing',
      progress: 0,
      processingSubStep: 'translation',
      activeSubSteps: [],
      hasFailed: false,
      failedItems: [],
    };
    return HttpResponse.json(response);
  }),

  // ──────────────────────────────────────────
  // N3 — 섹션 목록 조회
  // 현재 인메모리 bucket 상태를 반영해 반환합니다.
  // ──────────────────────────────────────────
  http.get('/api/jobs/:jobId/sections', ({ params }) => {
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
  // (mockJobState.currentStep)를 기준으로 판단한다.
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

    const excludedStage = bucket === 'include' ? null : mockJobState.currentStep;
    sectionState.set(sectionId, { bucket, exclusionReason: null, excludedStage });
    return HttpResponse.json({ sectionId, bucket, excludedStage });
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
    return HttpResponse.json(n5JobState);
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
  // N5 — 재렌더 task polling (API-JOB-05)
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

    return HttpResponse.json({
      jobStatus: 'review',
      currentStep: 'N5',
      userFacingStatus: 'reviewing',
      progress: items.length === 0 ? 1 : items.filter((i) => i.status === 'done').length / items.length,
      total: items.length,
      done: items.filter((i) => i.status === 'done').length,
      failedCount: items.filter((i) => i.status === 'failed').length,
      stages: [],
      items,
    });
  }),

  // ──────────────────────────────────────────
  // N5 — 검수 확정 = N5→N6 (API-CFM-04, v3.4.2)
  //
  // 전 섹션 제외 차단(409 ALL_SECTIONS_EXCLUDED), acknowledgedWarnings가
  // 현재 미해결 경고 집합과 다르면 409 INVALID_STATE(+details.warnings에
  // 현재 목록). 성공하면 job이 N6로 넘어간다 — 화면 전환은 구 status
  // polling(mockJobState)에 기대므로 그것도 함께 갱신한다(다른 화면들이
  // 이미 그 메커니즘으로 전환하고 있어, 여기서만 새로 만들지 않는다).
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

    // job→N6. dbStatus/userFacingStatus는 "review 완료, 렌더 자동 등록" 상태로
    // 옮긴다 — 렌더 진행 자체는 N6 화면의 JOB-05 폴링 몫이라 여기서 task를
    // 새로 만들지 않는다. N6 화면 자체는 이미 구현돼 있다(getJobResult 기준,
    // 아래 GET /api/jobs/:jobId/result) — 여기서 만들지 않는 건 그 렌더
    // task 등록/폴링뿐이며, 6단계 범위 밖이라 손대지 않았다.
    n5JobState = { ...n5JobState, currentStep: 'N6', status: 'processing', userFacingStatus: 'done' };
    mockJobState = { currentStep: 'N6', dbStatus: 'processing', pollCount: 0 };

    return HttpResponse.json(n5JobState);
  }),

  // ──────────────────────────────────────────
  // N6 — 최종 결과 조회
  // ──────────────────────────────────────────
  http.get('/api/jobs/:jobId/result', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    return HttpResponse.json({ ...mockJobResultResponse, saved: jobResultSaved });
  }),

  // ──────────────────────────────────────────
  // N6 — 보관함 저장
  // 호출 후 GET result에서 saved: true가 반환됩니다.
  // ──────────────────────────────────────────
  http.post('/api/jobs/:jobId/save', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    jobResultSaved = true;
    return HttpResponse.json({ saved: true });
  }),
];
