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
import { mockLibraryCards } from '@/lib/mock-api/library-fixtures';
import { mockMasterCountries, mockMasterLanguages } from '@/lib/mock-api/master-fixtures';
import type { ApiJob, ApiJobAsyncTaskItem, ApiTextBlock } from '@/lib/api/n5-schema';
import type { ApiAcceptedTask, ApiAnalysisProgress, ApiJobPatch, ApiSourceImageUploadResult } from '@/lib/api/job-schema';
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
 * N4 진행 polling index — N2의 jobProcessingPollCount(N2_DEFAULT_SCHEDULE 인덱스)와
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
  mockJobSavedAt = null;
}

/**
 * M1 보관함 — 흐름 job(jobState)이 POST /jobs/:jobId/save로 저장된 시각.
 * GET /library가 저장 응답과 같은 savedAt을 돌려주도록 보관한다.
 */
let mockJobSavedAt: string | null = null;

/** 흐름 job → LibraryCard 투영. POST /save 응답과 GET /library가 같은 모양을 쓴다. */
function buildMockLibraryCardFromJobState(savedAt: string | null): ApiLibraryCard {
  return {
    jobId: jobState.id,
    productName: jobState.productName ?? null,
    brandName: null,
    targetCountry: jobState.targetCountry ?? null,
    targetLanguage: jobState.targetLanguage ?? null,
    specType: jobState.specType,
    thumbnailUrl: mockN6Deliverables[0]?.imageUrl ?? null,
    savedAt,
  };
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
/** POST /export 로 한 번이라도 만든 구성요소(타입별 개별 다운로드 GET /export/download 가 조회한다). */
const n6GeneratedComponents = new Set<string>();
/** e2e 가 page 에서 true 로 두면 다음 POST /export 한 번이 500 으로 실패한다(MSW 핸들러는 페이지 쪽에서 돈다). */
export const MOCK_EXPORT_FAIL_ONCE_FLAG = '__pixlateMockExportFailOnce';
/** e2e 전용 — 다음 POST /export 한 번이 201 이지만 artifactId 없이 응답한다(다운로드 조회를 이어가지 않는지 확인용). */
export const MOCK_EXPORT_NO_ARTIFACT_ID_ONCE_FLAG = '__pixlateMockExportNoArtifactIdOnce';
/** e2e 전용 — 다음 GET /exports/:artifactId/download 한 번이 404 로 실패한다. */
export const MOCK_EXPORT_DOWNLOAD_NOT_FOUND_ONCE_FLAG = '__pixlateMockExportDownloadNotFoundOnce';
/**
 * e2e 전용 — 다음 presigned 파일 GET(/mock/download/...) 한 번이 네트워크 오류로 끝난다.
 * 실제 환경에서 S3 CORS 가 막혀 FE fetch 가 실패하는 경우를 흉내 낸다(브라우저는 CORS 실패를
 * 네트워크 오류(TypeError)로만 알려 준다).
 */
export const MOCK_PRESIGNED_FETCH_FAIL_ONCE_FLAG = '__pixlateMockPresignedFetchFailOnce';
/** BE release/1.0.0 에서 POST /export 가 만드는 구성요소. html·psd 가 섞이면 아무것도 만들지 않고 400 이다. */
const N6_EXPORTABLE_COMPONENTS = ['csv', 'images'];

/** e2e 가 page 에서 켠 1회 주입 플래그를 읽고 바로 끈다. */
function takeMockFlag(flag: string): boolean {
  const flags = globalThis as Record<string, unknown>;
  if (!flags[flag]) return false;
  flags[flag] = false;
  return true;
}

/**
 * N2 진행 중(processing) 단계에서 다음 단계로 넘어갈 조건 — 오늘(N1→N6
 * happy path) 작업. 실제 처리 로직은 만들지 않는다 — GET /jobs/:jobId/tasks를
 * 2초 polling할 때마다 poll count만 늘려 pending→running→done을 흉내내고,
 * done이 되는 시점에 jobState.currentStep을 다음 단계로 바꾼다. 중간 실패·재시도
 * 시나리오는 오늘 범위가 아니라 failedCount/items는 항상 0/[]이다. (N4는
 * 이 아래 별도 로직 — N4_PROCESSING_STAGES/advanceN4Processing 참고.)
 */
const N2_PROCESSING_STAGE = {
  next: 'N3' as const,
  nextUserFacingStatus: 'section_review' as const,
};

const n2Stage = (key: 'ocr' | 'section' | 'verify', status: 'pending' | 'running' | 'done') => ({ key, label: key, status });

/**
 * 기본 mock N2 poll 순서 — server 315816e docs/openapi.yaml JobTaskStatus·AnalysisProgress 계약 값.
 * 10/22 (2) — 이전 기본 mock 은 단일 'analyze' stage 만 주고 analysisProgress 가 없어, 수동 QA 화면(01 만 진행
 * 중이다가 끝남)이 e2e script 로 보는 화면(analyze 묶음 → finalize → judge)과 달랐다. 이제 기본 흐름도 같은
 * 계약 상태를 poll 마다 차례로 돌려준다. FE 에 시간을 끄는 장치를 두지 않고 mock 서버가 상태를 돌려줄 뿐이다.
 * - 원본은 GET /jobs/:jobId/source-images fixture(mockN3SourceImages) 2장, 영역은 N3 섹션 fixture
 *   (원본 1 에 3개 · 원본 2 에 2개, 합 5개)와 맞춘다.
 * - 2초 polling 이라 사이 activity(원본 1 merge · 원본 2 split·ocr)는 응답에 남지 않는다 — 실서버도 그렇다.
 * - progress 는 계약대로 분석 시도가 끝날 때까지 0, 채택 뒤 done/(1 + 영역 수).
 * - null 가능 필드는 계약상 해당 없는 곳에서 null 이다(가짜 0 을 채우지 않는다).
 * 마지막 항목 다음 poll 에서 N3 로 넘긴다(약 10초).
 */
const N2_DEFAULT_SCHEDULE: { progress: number; total: number; done: number; stages: MockJobProcessingTick['stages']; analysisProgress: ApiAnalysisProgress }[] = [
  {
    progress: 0,
    total: 1,
    done: 0,
    stages: [n2Stage('ocr', 'running'), n2Stage('section', 'pending'), n2Stage('verify', 'pending')],
    analysisProgress: {
      phase: 'analyze',
      status: 'running',
      sourceTotal: 2,
      activity: 'split',
      current: { sourceIndex: 1, sourceImageId: 1, regionIndex: null, regionCountInSource: null },
      regions: null,
      judge: null,
    },
  },
  {
    progress: 0,
    total: 1,
    done: 0,
    stages: [n2Stage('ocr', 'running'), n2Stage('section', 'pending'), n2Stage('verify', 'pending')],
    analysisProgress: {
      phase: 'analyze',
      status: 'running',
      sourceTotal: 2,
      activity: 'ocr',
      current: { sourceIndex: 1, sourceImageId: 1, regionIndex: 2, regionCountInSource: 3 },
      regions: { done: 1, known: 3, totalFixed: false },
      judge: null,
    },
  },
  {
    progress: 0,
    total: 1,
    done: 0,
    stages: [n2Stage('ocr', 'running'), n2Stage('section', 'pending'), n2Stage('verify', 'pending')],
    analysisProgress: {
      phase: 'analyze',
      status: 'running',
      sourceTotal: 2,
      activity: 'merge',
      current: { sourceIndex: 2, sourceImageId: 2, regionIndex: 2, regionCountInSource: 2 },
      regions: { done: 4, known: 5, totalFixed: true },
      judge: null,
    },
  },
  {
    progress: 0,
    total: 1,
    done: 0,
    stages: [n2Stage('ocr', 'running'), n2Stage('section', 'pending'), n2Stage('verify', 'pending')],
    analysisProgress: {
      phase: 'analyze',
      status: 'running',
      sourceTotal: 2,
      activity: 'finalize',
      current: null,
      regions: { done: 5, known: 5, totalFixed: true },
      judge: null,
    },
  },
  {
    progress: 0.5,
    total: 6,
    done: 3,
    stages: [n2Stage('ocr', 'done'), n2Stage('section', 'running'), n2Stage('verify', 'pending')],
    analysisProgress: {
      phase: 'judge',
      status: 'running',
      sourceTotal: 2,
      activity: null,
      current: null,
      regions: { done: 5, known: 5, totalFixed: true },
      judge: { total: 5, done: 2, excluded: 0, running: 2, waiting: 1, retrying: 0, failed: 0, cancelled: 0 },
    },
  },
];

/** N2/N4 job 단계 진행 mock 이 GET /tasks 에 돌려주는 한 번의 진행 값. */
type MockJobProcessingTick = {
  progress: number;
  total: number;
  done: number;
  stages: { key: string; label: string; status: 'pending' | 'running' | 'done' | 'failed' }[];
  /** 실패 시나리오 flag·N2 e2e script 에서만 채운다 — 정상 흐름은 항상 비어 있다. */
  items?: ApiJobAsyncTaskItem[];
  /** 기본 N2 흐름·N2 e2e script 에서 채운다. 없으면 응답에 속성 자체를 싣지 않는다(미구현 서버·레거시 작업과 같다). */
  analysisProgress?: ApiAnalysisProgress;
};

/**
 * e2e 전용 — 이 값(배열)이 있으면 N2 poll 마다 앞에서 하나씩 꺼내 그대로 응답한다.
 * stage key·순서는 테스트가 정한다(mock 은 어떤 key 도 가정하지 않는다). `advance: true`
 * 인 항목을 응답하는 poll 에서 job 을 N3 로 넘긴다 — 서버가 마지막 stage 를 끝내자마자
 * currentStep=N3 를 돌려주는 상황을 재현하기 위한 것이다. `advanceTo: 'N1'` 이면 같은 poll 에서
 * job 을 N1(draft)로 돌려 N2 중단 복귀를 재현한다(생략 시 N3). `fail: true` 면 그 poll 에서 job 을
 * N2 그대로 jobStatus=failed 로 바꾼다(분석 실패 종료). `items`·`analysisProgress` 는 그대로 응답에
 * 싣는다 — analysisProgress 를 생략한 tick 은 속성 없는 응답이 된다.
 */
const MOCK_N2_SCRIPT_FLAG = '__pixlateMockN2Script';

type MockN2ScriptTick = {
  progress: number;
  stages: { key: string; label: string; status: 'pending' | 'running' | 'done' | 'failed' }[];
  items?: ApiJobAsyncTaskItem[];
  analysisProgress?: ApiAnalysisProgress;
  advance?: boolean;
  advanceTo?: 'N1' | 'N3';
  fail?: boolean;
};

function takeN2ScriptTick(): MockN2ScriptTick | null {
  const script = (globalThis as Record<string, unknown>)[MOCK_N2_SCRIPT_FLAG];
  if (!Array.isArray(script) || script.length === 0) return null;
  return (script.length > 1 ? script.shift() : script[0]) as MockN2ScriptTick;
}

function advanceN2Processing(): MockJobProcessingTick {
  const scripted = takeN2ScriptTick();
  if (scripted) {
    if (scripted.advance) {
      (globalThis as Record<string, unknown>)[MOCK_N2_SCRIPT_FLAG] = undefined;
      jobState =
        scripted.advanceTo === 'N1'
          ? { ...jobState, currentStep: 'N1', userFacingStatus: 'draft', status: 'draft' }
          : {
              ...jobState,
              currentStep: N2_PROCESSING_STAGE.next,
              userFacingStatus: N2_PROCESSING_STAGE.nextUserFacingStatus,
              status: 'review',
            };
      jobProcessingPollCount = 0;
    } else if (scripted.fail) {
      jobState = { ...jobState, status: 'failed', userFacingStatus: 'failed' };
    }
    return {
      progress: scripted.progress,
      total: scripted.stages.length,
      done: 0,
      stages: scripted.stages,
      items: scripted.items,
      analysisProgress: scripted.analysisProgress,
    };
  }

  jobProcessingPollCount += 1;

  if (jobProcessingPollCount <= N2_DEFAULT_SCHEDULE.length) return N2_DEFAULT_SCHEDULE[jobProcessingPollCount - 1];

  jobState = {
    ...jobState,
    currentStep: N2_PROCESSING_STAGE.next,
    userFacingStatus: N2_PROCESSING_STAGE.nextUserFacingStatus,
    status: 'review',
  };
  jobProcessingPollCount = 0;
  // N3 전환 응답 — analysisProgress 는 currentStep=N3 이라 응답에서 빠진다(GET /tasks 핸들러)
  return { progress: 1, total: 6, done: 6, stages: [n2Stage('ocr', 'done'), n2Stage('section', 'done'), n2Stage('verify', 'done')] };
}

/**
 * N4 coarse stage 순서 — 실제 OpenAPI 계약(JobTaskStatus.stages 주석:
 * "N4 inpaint→translate→verify→render"). 예전엔 'translate' 단일 key만
 * 2-poll로 줘서 inpaint/verify/render(04·05) 화면을 mock에서 확인할 방법이
 * 없었다 — 4단계를 순서대로 최소 한 번씩 running→done으로 흘려보낸다.
 *
 * render는 running을 두 번 보낸다(render 가 여러 poll 동안 이어지는 경우). 화면은
 * render 를 04·05 두 행으로 함께 설명할 뿐 04/05 를 나누지 않는다(n4-processing-view.tsx).
 * 그 외 3단계는 N2와 같은 1-running-then-done 패턴이다. progress는 poll마다 커지는
 * 누적값이다(JobTaskStatus.progress는 stage-local이 아니라 job 전체 global 값).
 * 섹션마다 단계가 다른 응답(예: translate=running·render=done)은 아래 N4 script 로 재현한다.
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
  { stageIndex: 3, status: 'running', progress: 0.8 }, // render 진행 중 → 04·05 active
  { stageIndex: 3, status: 'running', progress: 0.9 }, // render 계속 진행 중 → 04·05 active
  { stageIndex: 3, status: 'done', progress: 1 }, // render 완료와 같은 poll 에서 N5로 전환
];

/** e2e 전용 — 켜져 있으면 N4 의 현재 stage 를 failed 로 돌려주고 진행을 멈춘다. */
const MOCK_N4_FAIL_FLAG = '__pixlateMockN4Fail';

/**
 * e2e 전용 — 이 값(배열)이 있으면 N4 poll 마다 앞에서 하나씩 꺼내 그대로 응답한다(N2 script 와
 * 같은 방식, 마지막 항목은 계속 반복). stage key·status·progress 는 테스트가 정한다 — 섹션마다
 * 단계가 다른 응답(translate=running·render=done)을 재현하기 위한 것이다. `advance: true` 인 항목을
 * 응답하는 poll 에서 job 을 N5 로 넘기고, `fail: true` 면 그 poll 에서 job 을 N4 그대로
 * jobStatus=failed 로 바꾼다. 정상 흐름(값 없음)에는 영향이 없다.
 */
const MOCK_N4_SCRIPT_FLAG = '__pixlateMockN4Script';

type MockN4ScriptTick = {
  progress: number;
  stages: { key: string; label: string; status: 'pending' | 'running' | 'done' | 'failed' }[];
  items?: ApiJobAsyncTaskItem[];
  advance?: boolean;
  fail?: boolean;
};

function takeN4ScriptTick(): MockN4ScriptTick | null {
  const script = (globalThis as Record<string, unknown>)[MOCK_N4_SCRIPT_FLAG];
  if (!Array.isArray(script) || script.length === 0) return null;
  return (script.length > 1 ? script.shift() : script[0]) as MockN4ScriptTick;
}

function mockFailedJobTaskItem(taskType: ApiJobAsyncTaskItem['taskType'], errorCode: string): ApiJobAsyncTaskItem {
  return {
    taskId: 9001,
    taskType,
    unitType: 'job',
    unitId: jobState.id,
    status: 'failed',
    uiStatus: 'failed',
    retryCount: 3,
    maxRetry: 3,
    retryable: false,
    errorCode,
    revision: null,
  };
}

function advanceN4Processing(): MockJobProcessingTick {
  const scripted = takeN4ScriptTick();
  if (scripted) {
    if (scripted.advance) {
      (globalThis as Record<string, unknown>)[MOCK_N4_SCRIPT_FLAG] = undefined;
      jobState = { ...jobState, currentStep: N4_NEXT_STEP, userFacingStatus: N4_NEXT_USER_FACING_STATUS, status: 'review' };
      n4PollIndex = 0;
    } else if (scripted.fail) {
      jobState = { ...jobState, status: 'failed', userFacingStatus: 'failed' };
    }
    return {
      progress: scripted.progress,
      total: N4_PROCESSING_STAGES.length,
      done: 0,
      stages: scripted.stages,
      items: scripted.items,
    };
  }

  const tick = N4_POLL_SCHEDULE[Math.min(n4PollIndex, N4_POLL_SCHEDULE.length - 1)];
  const stageMeta = N4_PROCESSING_STAGES[tick.stageIndex];

  if ((globalThis as Record<string, unknown>)[MOCK_N4_FAIL_FLAG]) {
    // 진행을 멈추고(n4PollIndex 그대로) 현재 stage 를 failed 로 보고한다.
    return {
      progress: tick.progress,
      total: N4_PROCESSING_STAGES.length,
      done: tick.stageIndex,
      stages: [{ ...stageMeta, status: 'failed' }],
      items: [mockFailedJobTaskItem(stageMeta.key as ApiJobAsyncTaskItem['taskType'], 'MOCK_STAGE_FAILED')],
    };
  }
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

function advanceJobProcessing(): MockJobProcessingTick {
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

/** 실제 공통 Error 계약 형태({ error: { code, message, retryable, traceId } }) — N1 draft-first handler용 */
function contractError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, retryable: false, traceId: 'mock-trace' } }, { status });
}

// ─────────────────────────────────────────────
// N1 draft-first mock 상태 (POST /jobs → source-images → PATCH /jobs/:jobId → reorder → analyze)
//
// jobState(N2~N6 진행 상태)와 분리한다 — jobState의 리셋 기준값은 위 설명대로 N2다.
// 이 상태는 N1 화면 안에서만 쓰이며, GET /jobs/:jobId/source-images는 N3 fixture를
// 그대로 돌려준다(N3 섹션이 fixture sourceImageId를 참조하기 때문).
// ─────────────────────────────────────────────

/** 이 이름을 포함한 파일은 첫 업로드만 실패한다 — 개별 재시도 E2E 재현용(mock 전용 규칙) */
export const MOCK_UPLOAD_FAIL_ONCE_MARKER = '__fail_once__';

interface MockN1Draft {
  patch: ApiJobPatch;
  sourceImages: ApiSourceImage[];
  nextSourceImageId: number;
  failedOnce: Set<string>;
}

let n1Draft: MockN1Draft | null = null;

/** 계약: JPG·PNG만 허용 (그 외는 파일별 UNSUPPORTED_FORMAT 실패) */
function isAcceptedSourceImage(file: File): boolean {
  return file.type === 'image/png' || file.type === 'image/jpeg';
}

function sortedDraftImages(draft: MockN1Draft): ApiSourceImage[] {
  return [...draft.sourceImages].sort((a, b) => (a.uploadOrder ?? 0) - (b.uploadOrder ?? 0));
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
  // N1 — draft 생성 (API-JOB-02). 실제 계약(JobCreate)대로 brandId만 받고
  // 201 Job(status=draft, currentStep=N1)을 돌려준다. 식별자는 Job.id(number)다.
  // Mock에서는 항상 id=1(MOCK_JOB_ID '1')이며, 같은 Idempotency-Key 재요청도 같은 job을 준다.
  // ──────────────────────────────────────────
  http.post('/jobs', async ({ request }) => {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body?.brandId) return contractError(400, 'VALIDATION_ERROR', 'brandId가 필요합니다');

    // 새 job 생성 시 이전 브라우저 테스트에서 진행됐던 mock 상태를 다시 시작
    // (리셋 기준값이 N2인 이유는 위 jobState 선언부 주석 참고)
    resetJobState();
    n1Draft = { patch: {}, sourceImages: [], nextSourceImageId: 101, failedOnce: new Set() };

    const draft: ApiJob = {
      ...jobState,
      id: Number(MOCK_JOB_ID),
      status: 'draft',
      currentStep: 'N1',
      userFacingStatus: 'draft',
      productName: null,
      productCode: null,
    };
    return HttpResponse.json(draft, { status: 201 });
  }),

  // ──────────────────────────────────────────
  // N1 — 원본 업로드 (API-SRC-02, multipart `files`). 파일별 성공/실패를 results[]에
  // 담고, 한 파일이 실패해도 나머지는 적재한다. sourceImages는 현재 job 원본 전체다.
  // ──────────────────────────────────────────
  http.post('/jobs/:jobId/source-images', async ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID || !n1Draft) return contractError(404, 'NOT_FOUND', `Job '${jobId}' not found`);
    const draft = n1Draft;

    const form = await request.formData();
    const files = form.getAll('files').filter((v): v is File => typeof v !== 'string');
    if (files.length === 0) return contractError(400, 'VALIDATION_ERROR', 'files가 필요합니다');

    const results: NonNullable<ApiSourceImageUploadResult['results']> = files.map((file) => {
      if (!isAcceptedSourceImage(file)) {
        return { fileName: file.name, ok: false, sourceImageId: null, errorCode: 'UNSUPPORTED_FORMAT' };
      }
      if (file.name.includes(MOCK_UPLOAD_FAIL_ONCE_MARKER) && !draft.failedOnce.has(file.name)) {
        draft.failedOnce.add(file.name);
        return { fileName: file.name, ok: false, sourceImageId: null, errorCode: 'INTERNAL_ERROR' };
      }
      const id = draft.nextSourceImageId++;
      const uploadOrder = draft.sourceImages.reduce((max, img) => Math.max(max, img.uploadOrder ?? 0), 0) + 1;
      draft.sourceImages.push({
        id,
        uploadOrder,
        imageType: 'detail',
        fileUrl: `/mock/n1/source-${id}.png`,
        width: 860,
        height: 1200,
        createdAt: new Date().toISOString(),
      });
      return { fileName: file.name, ok: true, sourceImageId: id, errorCode: null };
    });

    const response: ApiSourceImageUploadResult = { results, sourceImages: sortedDraftImages(draft) };
    return HttpResponse.json(response);
  }),

  // N1 — 원본 순서 재정렬 (API-SRC-03). order는 현재 원본 sourceImageId 전체여야 한다.
  http.patch('/jobs/:jobId/source-images/reorder', async ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID || !n1Draft) return contractError(404, 'NOT_FOUND', `Job '${jobId}' not found`);
    const draft = n1Draft;
    const { order } = await request.json() as { order?: unknown };
    const ids = draft.sourceImages.map((img) => img.id);
    if (
      !Array.isArray(order) ||
      order.length !== ids.length ||
      new Set(order).size !== order.length ||
      !order.every((id) => ids.includes(id as number))
    ) {
      return contractError(400, 'VALIDATION_ERROR', 'order는 현재 원본 sourceImageId 전체여야 합니다');
    }
    draft.sourceImages = draft.sourceImages.map((img) => ({ ...img, uploadOrder: order.indexOf(img.id) + 1 }));
    return HttpResponse.json(sortedDraftImages(draft));
  }),

  // N1 — 원본 삭제 (API-SRC-04, 204)
  http.delete('/jobs/:jobId/source-images/:sourceImageId', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID || !n1Draft) return contractError(404, 'NOT_FOUND', `Job '${jobId}' not found`);
    const sourceImageId = Number(params.sourceImageId);
    const before = n1Draft.sourceImages.length;
    n1Draft.sourceImages = n1Draft.sourceImages.filter((img) => img.id !== sourceImageId);
    if (n1Draft.sourceImages.length === before) return contractError(404, 'NOT_FOUND', `Source image '${sourceImageId}' not found`);
    return new HttpResponse(null, { status: 204 });
  }),

  // ──────────────────────────────────────────
  // N1 — 입력값 세팅 (PATCH /jobs/:jobId, JobPatch 부분 갱신). draft 단계에서만 허용.
  // productName/productCode는 N5 헤더가 읽으므로 jobState에도 반영한다.
  // ──────────────────────────────────────────
  http.patch('/jobs/:jobId', async ({ params, request }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return contractError(404, 'NOT_FOUND', `Job '${jobId}' not found`);
    if (!n1Draft) return contractError(409, 'INVALID_STATE', 'draft 단계에서만 수정할 수 있습니다');
    const patch = await request.json() as ApiJobPatch;
    n1Draft.patch = { ...n1Draft.patch, ...patch };
    jobState = {
      ...jobState,
      productName: n1Draft.patch.productName ?? null,
      productCode: n1Draft.patch.productCode ?? null,
    };
    const { productName, productCode, targetCountry, regulatoryClass, targetLanguage, specType, keywords, imageType } = n1Draft.patch;
    const response: ApiJob = {
      ...jobState,
      status: 'draft',
      currentStep: 'N1',
      userFacingStatus: 'draft',
      productName: productName ?? null,
      productCode: productCode ?? null,
      targetCountry: targetCountry ?? null,
      regulatoryClass: regulatoryClass ?? null,
      targetLanguage: targetLanguage ?? null,
      specType: specType ?? undefined,
      keywords: keywords ?? [],
      imageType: imageType ?? null,
    };
    return HttpResponse.json(response);
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
    // 실제 analyze 게이트: draft · 원본 존재 · product_name
    if (!n1Draft) return contractError(409, 'INVALID_STATE', 'draft 작업이 아닙니다');
    if (n1Draft.sourceImages.length === 0) return contractError(400, 'VALIDATION_ERROR', '원본 이미지가 필요합니다');
    if (!n1Draft.patch.productName) return contractError(400, 'VALIDATION_ERROR', 'productName이 필요합니다');
    n1Draft = null;

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
  // N3 — 섹션 상세(API-SEC-02). 계약상 판정 근거 전체를 준다. 목록과 같은
  // 인메모리 bucket 상태로 조립한다.
  // ──────────────────────────────────────────
  http.get('/jobs/:jobId/sections/:sectionId', ({ params }) => {
    const jobId = params.jobId as string;
    if (jobId !== MOCK_JOB_ID) return notFound(`Job '${jobId}' not found`);

    const sectionIdNum = Number(params.sectionId);
    const sec = mockSectionsResponse.sections.find((s) => toNumericId(s.sectionId) === sectionIdNum);
    if (!sec) return notFound(`Section '${params.sectionId}' not found`);

    const state = sectionState.get(sec.sectionId);
    return HttpResponse.json(
      toWireSection(
        sec,
        state?.bucket ?? sec.bucket,
        state?.exclusionReason ?? sec.exclusionReason,
        state?.excludedStage ?? sec.excludedStage,
      ),
    );
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
    // 실패 시나리오 flag·N2 e2e script 에서만 job 단계 item 이 붙는다(정상 흐름은 빈 배열).
    const jobItems = jobProgress.items ?? [];
    const allItems = [...items, ...jobItems];
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
      failedCount: allItems.filter((i) => i.status === 'failed').length,
      stages: jobProgress.stages,
      items: allItems,
      // 계약: currentStep=N2 일 때만 싣고, 그 밖에는 속성을 생략한다(null 을 보내지 않는다)
      ...(jobState.currentStep === 'N2' && jobProgress.analysisProgress
        ? { analysisProgress: jobProgress.analysisProgress }
        : {}),
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
    // 계약(BE release/1.0.0): 지원하지 않는 구성요소(html·psd 등)가 하나라도 있으면 전체 400
    const unsupported = components.filter((c) => !N6_EXPORTABLE_COMPONENTS.includes(c));
    if (unsupported.length > 0) {
      return contractError(400, 'VALIDATION_ERROR', `unsupported export components: ${unsupported.join(', ')}`);
    }

    // e2e 전용 실패 주입 — 한 번만 500(생성 실패 시 다운로드를 이어가지 않는지 확인용)
    const failFlags = globalThis as { [MOCK_EXPORT_FAIL_ONCE_FLAG]?: boolean };
    if (failFlags[MOCK_EXPORT_FAIL_ONCE_FLAG]) {
      failFlags[MOCK_EXPORT_FAIL_ONCE_FLAG] = false;
      return HttpResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'mock export failure', retryable: true, details: {}, traceId: 'mock' } },
        { status: 500 },
      );
    }

    const artifactId = n6ExportArtifactIdCounter++;
    // 계약(API-FIN-04): 둘 이상이면 zip 하나, 하나면 그 구성요소(csv·images)를 돌려준다
    const artifactType = (components.length > 1 ? 'zip' : components[0]) as ApiExportResponse['artifactType'];
    n6ExportArtifactState.set(artifactId, { artifactType, components });
    for (const c of components) n6GeneratedComponents.add(c);
    if (components.length > 1) n6GeneratedComponents.add('zip');

    if (takeMockFlag(MOCK_EXPORT_NO_ARTIFACT_ID_ONCE_FLAG)) {
      return HttpResponse.json({ artifactType, components }, { status: 201 });
    }
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
    if (takeMockFlag(MOCK_EXPORT_DOWNLOAD_NOT_FOUND_ONCE_FLAG)) return notFound(`Export artifact '${artifactId}' not found`);

    const fileName = artifact.artifactType === 'csv' ? 'export.csv' : 'export.zip'; // images 단독도 zip 묶음(BE 와 같음)
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
    // 계약(exportDownloadByType): export_artifact 에 이미 만든 구성요소만 — 미생성은 404
    if (!isN6RenderDone() || !n6GeneratedComponents.has(artifactType)) {
      return notFound(`'${artifactType}' 구성요소가 아직 생성되지 않았습니다`);
    }

    const fileName = artifactType === 'csv' || artifactType === 'html' ? `export.${artifactType}` : 'export.zip';
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
    mockJobSavedAt = new Date().toISOString();

    return HttpResponse.json(buildMockLibraryCardFromJobState(mockJobSavedAt));
  }),

  // ──────────────────────────────────────────
  // M1 — 보관함 카드 목록 (API-LIB-01, F-LST-02)
  //
  // 계약: job(is_saved=true) 투영. 고정 fixture(저장 완료 job들) 뒤에, 흐름 job이
  // 저장됐으면 그 카드도 함께 돌려준다. 미저장 job은 포함하지 않는다.
  // ──────────────────────────────────────────
  http.get('/library', () => {
    const cards: ApiLibraryCard[] = [...mockLibraryCards];
    if (jobState.isSaved) cards.push(buildMockLibraryCardFromJobState(mockJobSavedAt));
    return HttpResponse.json(cards);
  }),

  // ──────────────────────────────────────────
  // Master — 국가/언어 기준 목록 (API-MST-01/02). M1 카드의 국가·언어 표시 이름 출처.
  // ──────────────────────────────────────────
  http.get('/master/countries', () => HttpResponse.json(mockMasterCountries)),
  http.get('/master/languages', () => HttpResponse.json(mockMasterLanguages)),

  // ──────────────────────────────────────────
  // presigned 다운로드 URL(mock) — 실제로는 S3 객체다. 위 download 응답의 url 이 이 경로를
  // 가리킨다. N6 폴더 직접 저장(FE fetch)을 mock 에서 확인할 수 있도록 작은 더미 바이트를
  // 돌려준다(실제 zip/csv 내용 아님). <a href> 다운로드도 같은 응답을 받는다.
  // ──────────────────────────────────────────
  http.get('/mock/download/:fileName', ({ params }) => {
    if (takeMockFlag(MOCK_PRESIGNED_FETCH_FAIL_ONCE_FLAG)) return HttpResponse.error();
    const fileName = params.fileName as string;
    const contentType = fileName.endsWith('.csv') ? 'text/csv' : 'application/zip';
    return new HttpResponse(`pixlate mock artifact: ${fileName}`, { headers: { 'Content-Type': contentType } });
  }),
];
