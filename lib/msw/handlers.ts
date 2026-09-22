import { http, HttpResponse, passthrough } from 'msw';

import type {
  JobCurrentStep,
  Section as LegacySection,
  SectionBucket,
} from '@/lib/api/types';
import {
  MOCK_JOB_ID,
  mockSectionsResponse,
  mockN6Deliverables,
  mockN6Components,
  mockN6Validation,
} from '@/lib/mock-api/fixtures';
import { mockN5Job, mockN5Blocks, mockN5PreviewSections, buildMockN5Preview } from '@/lib/mock-api/n5-fixtures';
import type { ApiJob, ApiJobAsyncTaskItem, ApiTextBlock } from '@/lib/api/n5-schema';
import type { ApiAcceptedTask } from '@/lib/api/job-schema';
import type {
  ApiExcludedStage,
  ApiExclusionReason,
  ApiSection,
  ApiSectionList,
  ApiSectionVerdict,
  ApiSourceImage,
} from '@/lib/api/n3-schema';
import type { ApiDeliverableList, ApiExportResponse, ApiLibraryCard } from '@/lib/api/n6-schema';

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
 * 2단계(API 계약 정합화): fixture 내부 문자열 id('sec_01', 'src_mock_001')를
 * 실제 계약이 요구하는 숫자 id로 바꾼다. fixtures.ts(N5와 공유)는 건드리지
 * 않고 이 handler 응답을 조립하는 시점에서만 변환한다 — 같은 문자열은
 * 항상 같은 숫자로 매핑되므로(끝자리 숫자 추출) 세션 내내 안정적이다.
 */
function toNumericId(id: string): number {
  const digits = id.match(/\d+/)?.[0];
  return digits ? Number(digits) : 0;
}

/**
 * 실제 SectionVerdict 계약({id, basisArticle, reason, ...})으로 변환한다.
 * legacy fixture의 verdict.basis(표시용 한 줄)는 근거 설명에 가까우므로
 * reason에 담고, basisArticle(조문 식별자)은 이 fixture에 없어 null이다.
 */
function toWireVerdict(verdict: LegacySection['verdicts'][number]): ApiSectionVerdict {
  return {
    id: toNumericId(verdict.verdictId),
    verdictStatus: verdict.verdictStatus,
    verdictType: verdict.verdictType,
    problemText: verdict.problemText,
    alternativeExpression: verdict.alternativeExpression,
    basisArticle: null,
    evidenceUrl: verdict.evidenceUrl,
    reason: verdict.basis,
  };
}

/**
 * legacy fixture Section + 현재 bucket/exclusionReason/excludedStage 상태 →
 * 실제 Section 계약. bbox는 {x,y,width,height} → {x,y,w,h}로 필드명이
 * 다르다. topOffset/displayTop/height/category/inpaintStatus/signals는 이
 * fixture·N3 화면 어느 쪽도 아직 쓰지 않아 null/빈 배열로 둔다(임의 값을
 * 지어내지 않는다는 원칙에 따라 "모른다"를 null로 표현).
 */
function toWireSection(
  sec: LegacySection,
  bucket: SectionBucket,
  exclusionReason: string | null,
  excludedStage: JobCurrentStep | null,
): ApiSection {
  return {
    id: toNumericId(sec.sectionId),
    sectionOrder: sec.sectionOrder,
    sourceImageId: toNumericId(sec.sourceImageId),
    topOffset: null,
    displayTop: null,
    height: null,
    bbox: { x: sec.bbox.x, y: sec.bbox.y, w: sec.bbox.width, h: sec.bbox.height },
    category: null,
    bucket,
    exclusionReason: exclusionReason as ApiExclusionReason | null,
    excludedStage: excludedStage as ApiExcludedStage | null,
    inpaintStatus: null,
    warningBadge: sec.warningBadge,
    verdicts: sec.verdicts.map(toWireVerdict),
    signals: [],
  };
}

/**
 * N1 source-images mock (x-screen: N1, N3 재사용 가능). fileUrl은 presigned
 * 계약을 흉내내 기존 정적 fixture 이미지 경로를 그대로 쓴다 — 아직 어떤
 * 화면도 이 값을 소비하지 않는다(N1/N3 UI 연결은 이번 단계 범위 밖).
 */
const mockN3SourceImages: ApiSourceImage[] = [
  {
    id: 1,
    uploadOrder: 1,
    imageType: 'detail',
    fileUrl: '/mock/n3/section-1000x1360.png',
    width: 1000,
    height: 1300,
    createdAt: new Date('2026-09-01T00:00:00Z').toISOString(),
  },
  {
    id: 2,
    uploadOrder: 2,
    imageType: 'detail',
    fileUrl: '/mock/n3/section-830x3225.png',
    width: 1000,
    height: 1100,
    createdAt: new Date('2026-09-01T00:00:00Z').toISOString(),
  },
];

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

/** N2 진행 polling 카운터. jobState.currentStep이 N2로 바뀔 때마다 0으로 리셋한다. */
let jobProcessingPollCount = 0;

/**
 * N4 진행 polling index — N2의 jobProcessingPollCount(단일 stage, 2-poll)와
 * 다르게 N4는 실제 계약(inpaint→translate→verify→render) 4단계를 순서대로
 * 최소 한 번씩 지나가야 해서 별도 카운터를 둔다. N4_POLL_SCHEDULE의 인덱스다.
 */
let n4PollIndex = 0;

function resetJobState() {
  jobState = { ...mockN5Job, currentStep: 'N2', userFacingStatus: 'analyzing', status: 'processing' };
  jobProcessingPollCount = 0;
  n4PollIndex = 0;
  n6LatestRenderTaskId = null;
  n6RenderTaskState.clear();
  n6ExportArtifactState.clear();
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

/**
 * N6 렌더 task 인메모리 상태 — job 전체 렌더 1건(unitType='job'). N5
 * confirm이 N6 진입 시 최초 1회 자동 등록한다(API 계약: "최초 렌더는
 * confirm(CFM-04)이 자동 등록"). POST /jobs/:jobId/render(수동 재렌더)는
 * 이미 진행 중인 task가 있으면 새로 만들지 않고 그 taskId를 그대로 돌려준다
 * (계약: "렌더 task upsert·unit당 1행·멱등"). n5TaskState(블록별 재렌더)와
 * 같은 방식으로 pollCount>=2가 되면 done 처리한다 — 실제 2초 polling 몇 번
 * 만에 끝나는 모습을 mock에서도 재현하기 위함이다.
 */
let n6RenderTaskIdCounter = 80000;
let n6LatestRenderTaskId: number | null = null;
const n6RenderTaskState = new Map<number, { pollCount: number }>();

function registerOrReuseN6RenderTask(): number {
  if (n6LatestRenderTaskId != null) {
    const state = n6RenderTaskState.get(n6LatestRenderTaskId);
    if (state && state.pollCount < 2) return n6LatestRenderTaskId; // 아직 진행 중 — 멱등 재사용
  }
  const taskId = n6RenderTaskIdCounter++;
  n6RenderTaskState.set(taskId, { pollCount: 0 });
  n6LatestRenderTaskId = taskId;
  return taskId;
}

function isN6RenderDone(): boolean {
  if (n6LatestRenderTaskId == null) return false;
  return (n6RenderTaskState.get(n6LatestRenderTaskId)?.pollCount ?? 0) >= 2;
}

/**
 * N6 export 묶음 인메모리 상태. POST /export가 발급하고 GET
 * /exports/:artifactId/download가 조회한다. 계약에 재사용·멱등이 명시돼
 * 있지 않으므로 호출마다 새 artifactId를 발급한다.
 */
let n6ExportArtifactIdCounter = 70000;
const n6ExportArtifactState = new Map<number, { artifactType: ApiExportResponse['artifactType']; components: string[] }>();

/**
 * N2 진행 중(processing) 단계에서 다음 단계로 넘어갈 조건 — 오늘(N1→N6
 * happy path) 작업. 실제 처리 로직은 만들지 않는다 — GET /jobs/:jobId/tasks를
 * 2초 polling할 때마다 poll count만 늘려 pending→running→done을 흉내내고,
 * done이 되는 시점에 jobState.currentStep을 다음 단계로 바꾼다. 중간 실패·재시도
 * 시나리오는 오늘 범위가 아니라 failedCount/items는 항상 0/[]이다. (N4는
 * 이 아래 별도 로직 — N4_PROCESSING_STAGES/advanceN4Processing 참고.)
 */
const N2_PROCESSING_STAGE = {
  key: 'analyze',
  label: '이미지를 분석하고 있습니다',
  next: 'N3' as const,
  nextUserFacingStatus: 'section_review' as const,
};

function advanceN2Processing(): {
  progress: number;
  total: number;
  done: number;
  stages: { key: string; label: string; status: 'running' | 'done' }[];
} {
  jobProcessingPollCount += 1;

  if (jobProcessingPollCount < 2) {
    return { progress: 0.5, total: 1, done: 0, stages: [{ ...N2_PROCESSING_STAGE, status: 'running' }] };
  }

  jobState = {
    ...jobState,
    currentStep: N2_PROCESSING_STAGE.next,
    userFacingStatus: N2_PROCESSING_STAGE.nextUserFacingStatus,
    status: 'review',
  };
  jobProcessingPollCount = 0;
  return { progress: 1, total: 1, done: 1, stages: [{ ...N2_PROCESSING_STAGE, status: 'done' }] };
}

/**
 * N4 coarse stage 순서 — 실제 OpenAPI 계약(JobTaskStatus.stages 주석:
 * "N4 inpaint→translate→verify→render"). 예전엔 'translate' 단일 key만
 * 2-poll로 줘서 inpaint/verify/render(04·05) 화면을 mock에서 확인할 방법이
 * 없었다 — 4단계를 순서대로 최소 한 번씩 running→done으로 흘려보낸다.
 *
 * render는 화면 04(글자 수·줄바꿈 조정)·05(이미지 합성) 두 항목을 만들어야
 * 해서 running을 두 번(전반부→04, 후반부→05) 보낸다 — 그 외 3단계는 N2와
 * 같은 1-running-then-done 패턴이다. progress는 poll마다 커지는 누적값이고
 * (JobTaskStatus.progress는 stage-local이 아니라 job 전체 global 값 —
 * lib/api/generated/openapi.d.ts의 JobTaskStatus.progress에는 stage별 필드가
 * 없고 최상위 progress 하나뿐이다), N4TranslationView의 render 04/05 분기
 * 임계값(0.875)과 같은 "4단계 동일 비중" 가정으로 구간을 나눴다.
 */
const N4_PROCESSING_STAGES: { key: string; label: string }[] = [
  { key: 'inpaint', label: '한글을 지우고 배경을 복원하고 있습니다' },
  { key: 'translate', label: '번역과 용어를 맞추고 있습니다' },
  { key: 'verify', label: '규제 기준을 확인하고 있습니다' },
  { key: 'render', label: '글자 수와 줄바꿈을 맞추고 이미지를 합성하고 있습니다' },
];

const N4_NEXT_STEP = 'N5' as const;
const N4_NEXT_USER_FACING_STATUS = 'reviewing' as const;

/** n4PollIndex → (어느 coarse stage, running/done, 이 poll에서 보여줄 progress). */
const N4_POLL_SCHEDULE: { stageIndex: number; status: 'running' | 'done'; progress: number }[] = [
  { stageIndex: 0, status: 'running', progress: 0.05 }, // inpaint 진행 중 → 01 active
  { stageIndex: 0, status: 'done', progress: 0.25 }, // inpaint 완료 → 02 active로 승격
  { stageIndex: 1, status: 'running', progress: 0.3 }, // translate 진행 중 → 02 active
  { stageIndex: 1, status: 'done', progress: 0.5 }, // translate 완료 → 03 active로 승격
  { stageIndex: 2, status: 'running', progress: 0.55 }, // verify 진행 중 → 03 active
  { stageIndex: 2, status: 'done', progress: 0.75 }, // verify 완료 → render(04) active로 승격
  { stageIndex: 3, status: 'running', progress: 0.8 }, // render 전반부(<0.875) → 04 active
  { stageIndex: 3, status: 'running', progress: 0.9 }, // render 후반부(>=0.875) → 05 active
  { stageIndex: 3, status: 'done', progress: 1 }, // render 완료 → N5로 전환
];

function advanceN4Processing(): {
  progress: number;
  total: number;
  done: number;
  stages: { key: string; label: string; status: 'running' | 'done' }[];
} {
  const tick = N4_POLL_SCHEDULE[Math.min(n4PollIndex, N4_POLL_SCHEDULE.length - 1)];
  const stageMeta = N4_PROCESSING_STAGES[tick.stageIndex];
  const isLastTick = n4PollIndex >= N4_POLL_SCHEDULE.length - 1;

  n4PollIndex += 1;

  if (isLastTick) {
    // 마지막 tick(render done)에서만 다음 단계로 전환한다 — 그 전까지는
    // stages 진행만 흉내내고 currentStep은 그대로 N4다.
    jobState = { ...jobState, currentStep: N4_NEXT_STEP, userFacingStatus: N4_NEXT_USER_FACING_STATUS, status: 'review' };
    n4PollIndex = 0;
  }

  return {
    progress: tick.progress,
    total: N4_PROCESSING_STAGES.length,
    done: tick.status === 'done' ? tick.stageIndex + 1 : tick.stageIndex,
    stages: [{ ...stageMeta, status: tick.status }],
  };
}

function advanceJobProcessing(): {
  progress: number;
  total: number;
  done: number;
  stages: { key: string; label: string; status: 'running' | 'done' }[];
} {
  const step = jobState.currentStep;
  if (step === 'N2') return advanceN2Processing();
  if (step === 'N4') return advanceN4Processing();
  return { progress: 1, total: 0, done: 0, stages: [] };
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
  //
  // productName/productCode(오늘 계약 보정): 실제 JobCreate/Job 스키마의
  // productName은 이 엔드포인트 자체에서는 optional이고 analyze 게이트에서
  // 필수로 걸린다 — 하지만 이 mock은 targetCountry/targetLanguage처럼
  // "N1 폼이 이미 필수로 받는 값"을 이 시점에 함께 검증하는 기존 패턴을
  // 그대로 따른다(다른 필드와 다른 규칙을 새로 만들지 않는다). productCode는
  // 실제 계약대로 선택값이라 없어도 통과시키고 null로 저장한다.
  // ──────────────────────────────────────────
  http.post('/jobs', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;

    if (!body.brandId) return badRequest('brandId가 필요합니다');
    if (!body.productName) return badRequest('productName이 필요합니다');
    if (!body.targetCountry) return badRequest('targetCountry가 필요합니다');
    if (!body.targetLanguage) return badRequest('targetLanguage가 필요합니다');
    if (!Array.isArray(body.sourceImages) || body.sourceImages.length === 0) {
      return badRequest('sourceImages가 1개 이상 필요합니다');
    }

    // 새 job 생성 시 이전 브라우저 테스트에서 진행됐던 mock 상태를 다시 시작
    // (리셋 기준값이 N2인 이유는 위 jobState 선언부 주석 참고)
    resetJobState();
    jobState = {
      ...jobState,
      productName: body.productName as string,
      productCode: (body.productCode as string | undefined) ?? null,
    };

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
  // N3 — 섹션 목록 조회. 2단계(API 계약 정합화): 실제 응답 shape인
  // SectionList({exclude, include}, 숫자 id, {x,y,w,h} bbox)로 맞췄다 —
  // 이전 mock은 {sections: [...]}에 문자열 id를 그대로 얹어 실제로 없는
  // 계약처럼 보이게 했었다. 인메모리 bucket 상태(sectionState)는 그대로
  // 두고, 응답을 조립하는 시점에만 toWireSection으로 변환한다.
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/sections', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const wireSections = mockSectionsResponse.sections.map((sec) => {
      const state = sectionState.get(sec.sectionId);
      return toWireSection(
        sec,
        state?.bucket ?? sec.bucket,
        state?.exclusionReason ?? sec.exclusionReason,
        state?.excludedStage ?? sec.excludedStage,
      );
    });

    const response: ApiSectionList = {
      exclude: wireSections.filter((s) => s.bucket === 'exclude'),
      include: wireSections.filter((s) => s.bucket === 'include'),
    };
    return HttpResponse.json(response);
  }),

  // ──────────────────────────────────────────
  // N3 / N5 — 섹션 bucket 변경 (포함 / 제외 전환). 2단계: 실제 계약대로
  // sectionId는 path의 숫자, body는 { action: 'restore' | 'exclude' }다 —
  // 이전 mock의 { bucket } body는 실제 계약에 없다. restore=include로
  // 이동, exclude=exclude로 이동. exclusionReason은 사용자 입력 필드가
  // 아니라 항상 null로 비운다. excludedStage는 클라이언트가 보내지 않는다 —
  // 서버가 현재 job 단계(jobState.currentStep)를 기준으로 판단한다. 응답은
  // 갱신된 전체 Section이다(이전 mock처럼 {sectionId,bucket} 부분 응답이
  // 아니다).
  // ──────────────────────────────────────────
  http.patch('/jobs/:jobId/sections/:sectionId', async ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const sectionIdNum = Number(params.sectionId);
    const sec = mockSectionsResponse.sections.find((s) => toNumericId(s.sectionId) === sectionIdNum);
    if (!sec || !sectionState.has(sec.sectionId)) {
      return notFound(`Section '${params.sectionId}' not found`);
    }

    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action;

    if (action !== 'restore' && action !== 'exclude') {
      return badRequest("action은 'restore' 또는 'exclude'여야 합니다");
    }

    const bucket: SectionBucket = action === 'restore' ? 'include' : 'exclude';
    const excludedStage = bucket === 'include' ? null : (jobState.currentStep as JobCurrentStep | undefined) ?? null;
    sectionState.set(sec.sectionId, { bucket, exclusionReason: null, excludedStage });

    return HttpResponse.json(toWireSection(sec, bucket, null, excludedStage));
  }),

  // ──────────────────────────────────────────
  // N1 — 소스 이미지 목록 조회 (x-screen: N1, N3 재사용 가능). 아직 어떤
  // 화면도 호출하지 않는다 — lib/queries/pixlate.ts의 useSourceImagesQuery
  // 추가에 대응하는 mock만 먼저 갖춰 둔다.
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/source-images', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);
    return HttpResponse.json(mockN3SourceImages);
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
    n4PollIndex = 0;

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
  // N1→N2 hard navigation 조사(9단계)로 확인: 이 REST 경로(GET /jobs/:jobId,
  // job 상태 조회)는 실제 페이지 라우트 app/jobs/[jobId]/page.tsx와 URL이
  // 우연히 같다. Next.js App Router가 router.push 소프트 내비게이션에 쓰는
  // RSC flight fetch도 같은 URL로 RSC:1 헤더를 달아 나간다 — 이 핸들러가
  // 그 요청까지 가로채 JSON을 돌려주면(RSC flight 포맷이 아니므로) 라우터가
  // 유효하지 않은 응답으로 보고 전체 페이지 하드 네비게이션으로 폴백한다
  // (Playwright network 계측으로 실측: RSC fetch 직후 resourceType=document
  // 요청이 별도로 발생). RSC 헤더가 있는 요청은 mock을 거치지 않고 실제 dev
  // 서버로 그대로 흘려보낸다 — happy path 응답 자체(jobState)는 그대로다.
  http.get('/jobs/:jobId', ({ params, request }) => {
    if (request.headers.get('RSC') != null) return passthrough();

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
  // 오늘(N1→N6 happy path)부터 이 엔드포인트가 세 가지 진행을 함께 나른다 —
  // ① N5 block 재렌더 task(n5TaskState, PATCH /blocks/:id가 등록. 기존 로직
  // 그대로 유지) ② N2/N4 job 단계 진행(advanceJobProcessing, jobState.currentStep이
  // N2/N4일 때만 poll count를 늘려 다음 단계로 전환) ③ N6 job 단위 render
  // task(n6RenderTaskState, confirm/POST render가 등록 — taskType은 같은
  // 'render'지만 unitType='job'으로 n5TaskState의 unitType='text_block'과
  // 구분한다). 응답 wrapper의 currentStep/userFacingStatus/jobStatus는 항상
  // jobState를 그대로 반영한다 — FE(page.tsx)가 이 값으로만 다음 화면을
  // 고른다(별도 계산 없음).
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/tasks', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const items: ApiJobAsyncTaskItem[] = [];

    if (n6LatestRenderTaskId != null) {
      const state = n6RenderTaskState.get(n6LatestRenderTaskId);
      if (state) {
        state.pollCount += 1;
        const done = state.pollCount >= 2;
        items.push({
          taskId: n6LatestRenderTaskId,
          taskType: 'render',
          unitType: 'job',
          unitId: jobState.id,
          status: done ? 'done' : 'running',
          uiStatus: done ? 'done' : 'running',
          retryCount: 0,
          maxRetry: 3,
          retryable: false,
          errorCode: null,
          revision: null,
        });
        // 렌더가 이 polling에서 막 완료됐고 아직 job이 'done'으로 넘어가지
        // 않았으면 여기서 전환한다 — save(API-FIN-06)는 "렌더 성공 확인 후
        // done/N6"이 전제이므로, 그 확인을 이 시점에 반영해 둔다.
        if (done && jobState.currentStep === 'N6' && jobState.userFacingStatus !== 'done') {
          jobState = { ...jobState, userFacingStatus: 'done', status: 'done' };
        }
      }
    }

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
    // n6 render item(job 단위)과 n5 rerender item(block 단위) 둘 다 여기 속한다
    // — N2/N4 job 단계 진행(advanceJobProcessing)과는 별도 진행률 소스라 있으면
    // 이쪽을 우선한다(과거 이름 hasN5Items를 오늘 N6 항목도 포함하도록 재사용).
    const hasTaskItems = items.length > 0;

    return HttpResponse.json({
      jobStatus: jobState.status,
      currentStep: jobState.currentStep,
      userFacingStatus: jobState.userFacingStatus,
      progress: hasTaskItems ? items.filter((i) => i.status === 'done').length / items.length : jobProgress.progress,
      total: hasTaskItems ? items.length : jobProgress.total,
      done: hasTaskItems ? items.filter((i) => i.status === 'done').length : jobProgress.done,
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
    // 아니라 'reviewing'으로 둔다 — 렌더가 아직 완료된 게 아니다(서버가 안 준
    // 완료 상태를 mock이 임의로 만들지 않는다). 최초 render task는 이 confirm
    // 트랜잭션이 자동 등록한다(계약: "최초 렌더는 confirm이 자동 등록") — GET
    // /jobs/:jobId/tasks polling이 이 task를 done으로 진행시키면 그 시점에
    // userFacingStatus가 'done'으로 바뀐다(아래 tasks 핸들러 참고).
    jobState = { ...jobState, currentStep: 'N6', status: 'review', userFacingStatus: 'reviewing' };
    registerOrReuseN6RenderTask();

    return HttpResponse.json(jobState);
  }),

  // ──────────────────────────────────────────
  // N6 — 최종 이미지 (재)렌더링 트리거 (API-FIN-01)
  //
  // 최초 렌더는 confirm이 자동 등록한다(위 confirm 핸들러) — 이 엔드포인트는
  // 수동 재렌더용이지만, 진행 중인 task가 없거나(예: 개발 서버 모듈 재초기화)
  // failed일 때 FE가 호출해도 같은 upsert 규칙(멱등)으로 동작한다.
  // ──────────────────────────────────────────
  http.post('/jobs/:jobId/render', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const renderTaskId = registerOrReuseN6RenderTask();
    return HttpResponse.json({ renderTaskId }, { status: 202 });
  }),

  // ──────────────────────────────────────────
  // N6 — 산출물 목록 + 구성요소 상태 (API-FIN-02)
  //
  // 렌더가 아직 done이 아니면 deliverables는 빈 배열, components는 전부
  // pending으로 돌려준다 — "렌더 전" 상태를 실패로 위장하지 않는다
  // (renderedUrl=null만으로 실패를 단정하지 않는 CLAUDE.md 원칙과 같은 축).
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/deliverables', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const renderDone = isN6RenderDone();
    const response: ApiDeliverableList = {
      deliverables: renderDone ? mockN6Deliverables : [],
      components: renderDone
        ? mockN6Components
        : mockN6Components.map((c) => ({ ...c, status: 'pending', isGenerated: false, isActive: false })),
    };
    return HttpResponse.json(response);
  }),

  // ──────────────────────────────────────────
  // N6 — 규격 검증 상세 (API-FIN-03). deliverables와 같은 렌더 완료 전제.
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/validation', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    return HttpResponse.json(isN6RenderDone() ? mockN6Validation : []);
  }),

  // ──────────────────────────────────────────
  // N6 — 산출물 묶음 생성 (API-FIN-04). components(셀러 선택)를 묶어
  // export.zip 1건을 발급한다 — 호출마다 새 artifactId(재사용/멱등 규칙은
  // 계약에 없다).
  // ──────────────────────────────────────────
  http.post('/jobs/:jobId/export', async ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const body = (await request.json().catch(() => ({}))) as { components?: unknown };
    const components = Array.isArray(body.components)
      ? body.components.filter((c): c is string => typeof c === 'string')
      : [];
    if (components.length === 0) {
      return badRequest('components가 1개 이상 필요합니다');
    }

    const artifactId = n6ExportArtifactIdCounter++;
    const artifactType: ApiExportResponse['artifactType'] = 'zip';
    n6ExportArtifactState.set(artifactId, { artifactType, components });

    const response: ApiExportResponse = { artifactId, artifactType, components };
    return HttpResponse.json(response, { status: 201 });
  }),

  // ──────────────────────────────────────────
  // N6 — 산출물 다운로드, presigned (API-FIN-05, 5분 만료). manifest·미생성·
  // 남의 job은 404 — 여기서는 "이 job이 만든 적 없는 artifactId"로 표현한다.
  // 실제 파일은 만들지 않는다 — mock presigned URL만 반환한다.
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/exports/:artifactId/download', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const artifactId = Number(params.artifactId);
    const artifact = n6ExportArtifactState.get(artifactId);
    if (!artifact) return notFound(`Export artifact '${artifactId}' not found`);

    const fileName = artifact.artifactType === 'zip' ? 'export.zip' : `export.${artifact.artifactType}`;
    return HttpResponse.json({
      url: `/mock/download/${fileName}?token=mock-presigned-${artifactId}`,
      fileName,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }),

  // ──────────────────────────────────────────
  // N6 — 행별 개별 다운로드, 타입별 presigned (API-FIN-05, exportDownloadByType).
  // export 묶음 생성 없이 구성요소 하나만 바로 받는다 — artifactType(기본
  // zip) 쿼리로 images|csv|html을 지정한다. psd는 호출부가 항상 비활성이라
  // 여기 도달하지 않지만, 혹시 들어와도 404로 거절한다(생성된 적 없는 구성요소).
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/export/download', ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const artifactType = new URL(request.url).searchParams.get('artifactType') ?? 'zip';
    if (!['zip', 'images', 'csv', 'html'].includes(artifactType)) {
      return badRequest("artifactType은 'zip'|'images'|'csv'|'html'이어야 합니다");
    }
    if (!isN6RenderDone()) return notFound(`'${artifactType}' 구성요소가 아직 생성되지 않았습니다`);

    const fileName = artifactType === 'zip' ? 'export.zip' : `export.${artifactType}`;
    return HttpResponse.json({
      url: `/mock/download/${fileName}?token=mock-presigned-bytype-${artifactType}-${Date.now()}`,
      fileName,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }),

  // ──────────────────────────────────────────
  // N6 — 저장 = 보관함 카드 생성 (API-FIN-06)
  //
  // "렌더 성공 확인 후 done/N6·is_saved=true" — 렌더가 아직 안 끝났으면 409
  // INVALID_STATE로 거절한다(계약: 409 상태 충돌).
  // ──────────────────────────────────────────
  http.post('/jobs/:jobId/save', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    if (!isN6RenderDone()) {
      return HttpResponse.json(
        {
          error: {
            code: 'INVALID_STATE',
            message: '렌더가 완료되지 않아 저장할 수 없습니다.',
            retryable: true,
            details: null,
            traceId: `mock-trace-${Date.now()}`,
          },
        },
        { status: 409 },
      );
    }

    jobState = { ...jobState, isSaved: true, status: 'done', userFacingStatus: 'done' };

    const card: ApiLibraryCard = {
      jobId: jobState.id,
      productName: jobState.productName ?? null,
      brandName: null,
      targetCountry: jobState.targetCountry ?? null,
      targetLanguage: jobState.targetLanguage ?? null,
      specType: jobState.specType,
      thumbnailUrl: mockN6Deliverables[0]?.imageUrl ?? null,
      savedAt: new Date().toISOString(),
    };
    return HttpResponse.json(card);
  }),
];
