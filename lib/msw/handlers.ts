import { http, HttpResponse } from 'msw';

import type {
  JobStatusResponse,
  JobCurrentStep,
  JobDbStatus,
  SectionBucket,
  TranslationStatus,
  TranslationCandidate,
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
  mockReviewResponse,
  mockJobResultResponse,
} from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────
// Mock 인메모리 상태
//
// fixture 원본 직접 변경을 막기 위해 별도 Map/변수로 관리합니다.
// HMR·새로고침 시 초기값으로 리셋되는 것은 Mock 환경에서 허용합니다.
// ─────────────────────────────────────────────

/**
 * 섹션 bucket 상태. N3 섹션 조회와 N5 검수 조회가 이 상태를 공유합니다.
 * excludedStage: 어느 단계에서 제외됐는지 — N3 / N5 / null
 */
const sectionState = new Map<string, {
  bucket: SectionBucket;
  exclusionReason: string | null;
  excludedStage: string | null;
}>(
  mockSectionsResponse.sections.map(s => [
    s.sectionId,
    { bucket: s.bucket, exclusionReason: s.exclusionReason, excludedStage: s.excludedStage },
  ])
);

/**
 * 텍스트 블록 번역 상태.
 * candidates는 fixture 원본 오염 방지를 위해 structuredClone으로 복사합니다.
 */
const textBlockState = new Map<string, {
  translatedText: string;
  translationStatus: TranslationStatus;
  candidates: TranslationCandidate[];
}>();

mockReviewResponse.sections.forEach(sec => {
  sec.textBlocks.forEach(blk => {
    textBlockState.set(blk.blockId, {
      translatedText: blk.translatedText,
      translationStatus: blk.translationStatus,
      candidates: structuredClone(blk.candidates),
    });
  });
});

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

  // N3 / N5 / N6: 이번 단계에서는 다음 단계 진입 API가 없으므로 현재 상태를 그대로 반환
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
  // 이번 단계에서는 N3 → N4 전환만 지원합니다 (N5 → N6은 미지원).
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
  // ──────────────────────────────────────────
  http.patch('/api/sections/:sectionId', async ({ params, request }) => {
    const sectionId = params.sectionId as string;
    if (!sectionState.has(sectionId)) return notFound(`Section '${sectionId}' not found`);

    const body = await request.json() as Record<string, unknown>;
    const bucket = body.bucket;

    if (bucket !== 'include' && bucket !== 'exclude') {
      return badRequest("bucket은 'include' 또는 'exclude'이어야 합니다");
    }

    // stage: Mock 검증용 임시 필드. N3 / N5 context를 구분하기 위해 사용.
    const stage = typeof body.stage === 'string' ? body.stage : null;
    sectionState.set(sectionId, {
      bucket,
      exclusionReason: null,
      // include로 복구하면 항상 null. exclude이면 요청의 stage 값을 보존.
      excludedStage: bucket === 'include' ? null : stage,
    });
    return HttpResponse.json({ sectionId, bucket, excludedStage: bucket === 'include' ? null : stage });
  }),

  // ──────────────────────────────────────────
  // N5 — 검수 데이터 조회
  //
  // - section bucket: N3에서 변경한 값이 반영됩니다.
  // - textBlock: 번역 수정·후보 선택이 반영됩니다.
  // ──────────────────────────────────────────
  http.get('/api/jobs/:jobId/review', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const sections = mockReviewResponse.sections
      .filter(sec => {
        const secState = sectionState.get(sec.sectionId);
        const bucket = secState?.bucket ?? sec.bucket;
        const excludedStage = secState?.excludedStage ?? sec.excludedStage;
        // N3에서 제외된 섹션은 N5 화면에 전달하지 않음
        return !(bucket === 'exclude' && excludedStage === 'N3');
      })
      .map(sec => {
        const secState = sectionState.get(sec.sectionId);
        const textBlocks = sec.textBlocks.map(blk => {
          const blkState = textBlockState.get(blk.blockId);
          return blkState ? { ...blk, ...blkState } : blk;
        });
        return {
          ...sec,
          bucket: secState?.bucket ?? sec.bucket,
          excludedStage: secState?.excludedStage ?? sec.excludedStage,
          textBlocks,
        };
      });

    return HttpResponse.json({ ...mockReviewResponse, sections });
  }),

  // ──────────────────────────────────────────
  // N5 — 번역문 수정 / 번역 후보 선택
  //
  // 수동 수정: { "translatedText": "..." }
  //   → translationStatus가 'userEdited'로 변경됩니다.
  //
  // 후보 선택: { "candidateId": "cand_..." }
  //   → 해당 후보의 translatedText로 변경됩니다.
  //   → translationStatus는 'machine' 유지 (기계 번역 후보 중 선택)
  //
  // 둘 다 있으면 400, 둘 다 없으면 400
  // ──────────────────────────────────────────
  http.patch('/api/text-blocks/:blockId/translation', async ({ params, request }) => {
    const blockId = params.blockId as string;
    if (!textBlockState.has(blockId)) return notFound(`TextBlock '${blockId}' not found`);

    const body = await request.json() as Record<string, unknown>;
    const hasText = 'translatedText' in body;
    const hasCandidate = 'candidateId' in body;

    if (hasText && hasCandidate) {
      return badRequest('translatedText와 candidateId를 동시에 전송할 수 없습니다');
    }
    if (!hasText && !hasCandidate) {
      return badRequest('translatedText 또는 candidateId 중 하나가 필요합니다');
    }

    const current = textBlockState.get(blockId)!;

    if (hasText) {
      if (typeof body.translatedText !== 'string') {
        return badRequest('translatedText는 문자열이어야 합니다');
      }
      textBlockState.set(blockId, {
        ...current,
        translatedText: body.translatedText,
        translationStatus: 'userEdited',
      });
    } else {
      const candidateId = body.candidateId as string;
      const candidate = current.candidates.find(c => c.candidateId === candidateId);
      if (!candidate) return notFound(`Candidate '${candidateId}' not found`);

      textBlockState.set(blockId, {
        ...current,
        translatedText: candidate.translatedText,
        translationStatus: 'machine',
        candidates: current.candidates.map(c => ({
          ...c,
          isSelected: c.candidateId === candidateId,
        })),
      });
    }

    const updated = textBlockState.get(blockId)!;
    return HttpResponse.json({ blockId, ...updated });
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
