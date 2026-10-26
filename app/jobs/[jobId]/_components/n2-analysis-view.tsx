import type { ApiAnalysisProgress, ApiJobTaskStatus } from '@/lib/api/job-schema';
import { n2DisplayedProgressKey } from '@/lib/processing/displayed-progress-storage';
import { ProcessingStageLayout, type ProcessingStep } from './processing/processing-stage-layout';
import { useDisplayedProgress } from './processing/use-displayed-progress';

// ─────────────────────────────────────────────────────────────────
// N2 — 분석중 (Figma node 660:4139 기준, 2026-09-18 재정합)
//
// 레이아웃(rail/헤더/회색 패널/비주얼/로그/progress) 자체는 N4와 완전히
// 동일해(Figma가 N4의 5단계 목록 컴포넌트를 "N2 / Step List"로 그대로
// 재사용할 정도) ./processing/processing-stage-layout.tsx로 뺐다. 이
// 파일에는 N2 고유의 것만 남는다:
// - copy(헤더/헤드라인/로그/5단계 라벨/안내문 텍스트/GIF 하단 caption)
// - N2의 backend stage(ocr/section/verify)·analysisProgress → 5단계 상태 해석
// - 관측 단계 → 표시 % 상한(숫자 자체는 ./processing/use-displayed-progress.ts)
//
// ANALYSIS LOG는 Figma가 항상 고정 5단계(01~05)를 보여준다 — 실제 백엔드는
// OpenAPI JobTaskStatus.stages 계약상 N2에 coarse 3단계(ocr→section→verify)만
// 준다. API를 5단계로 바꾸지 않고, 이 파일 안의 resolveCoarseStage/
// FIVE_STEP_STATES_BY_COARSE_STAGE 두 개로 3→5 presentation 매핑만 흡수한다
// (컴포넌트 JSX 안에는 조건문을 두지 않는다). 기본 mock 은 이 3단계 대신 단일 'analyze' stage만
// 주는데, 그때는 ocr(01 진행 중)로 둔다 — 표시 % 로 단계를 추정하지 않는다(10/22 제거: 이전에는
// mock 경과 시간으로 만든 % 로 02·03·04·05 를 차례로 켰다).
//
// 하나의 backend coarse stage가 진행 중이어도 오른쪽 목록의 여러 시각
// 항목이 동시에 "진행 중"일 수 있다(section 진행 중 → 02·03 동시 진행
// 중, verify 진행 중 → 04·05 동시 진행 중) — 이 계약(coarse 3단계)에서는
// 실제로 그게 맞는 표현이다. N2는 backend가 stage별 progress를 전혀
// 주지 않으므로(OpenAPI JobTaskStatus — 최상위 progress 1개뿐), 이걸
// 억지로 02/03·04/05로 쪼개려면 top-level progress로 FE가 그 경계를
// 지어내야 한다 — 서버가 안 주는 세부 상태를 FE가 추론하는 것이므로 하지
// 않는다(9/23 재확인: 한 번 이렇게 시도했다가 되돌렸다).
//
// 이 해석 로직은 N4와 절대 공유하지 않는다 — N4는 backend stage 어휘 자체가
// 다르다(inpaint/translate/verify/render, n4-processing-view.tsx 참고).
//
// 9/23 — GIF 하단 caption(주황 title + 회색 description)을 추가했다.
// 이전엔 backend stage와 무관하게 항상 같은 문구(04 캡션)만 보였다.
// N2는 02·03(또는 04·05)이 동시에 active라 "active 시각 항목 하나 =
// caption"이라는 전제를 쓸 수 없다(N4는 이 전제가 성립해서 그렇게
// 한다) — 대신 caption도 오른쪽 목록과 "같은 coarse stage 값"
// (resolveCoarseStage 결과, ocr/section/verify/done)을 그대로 참조한다.
// 즉 하나의 backend stage가 오른쪽에서는 세부 항목 여러 개를 동시에
// active로 보여주고, GIF에서는 그 stage를 포괄하는 문구 하나로
// 설명한다 — progress%로 caption이나 substage를 다시 추론하지 않는다.
// ─────────────────────────────────────────────────────────────────

const HEADLINE_FALLBACK = '상세페이지의 구조와 문맥을 읽고 있습니다.';
const AUTO_ADVANCE_NOTICE = '분석이 끝나면 섹션 확인 단계로 자동 이동합니다.';
const PAUSE_BUTTON_TITLE = '분석 중단 기능은 아직 제공되지 않습니다.';
const FAILED_HEADLINE = '이미지 분석을 완료하지 못했습니다.';
const FAILED_NOTICE = '분석을 완료하지 못해 다음 단계로 자동 이동하지 않습니다.';
const FAILED_CAPTION = { title: '분석 실패', description: '이미지 분석을 완료하지 못했습니다.' };

const FIVE_STEP_META: { no: string; label: string }[] = [
  { no: '01', label: '콘텐츠 영역 나누기' },
  { no: '02', label: '전체 텍스트 인식' },
  { no: '03', label: '문단별 역할 파악' },
  { no: '04', label: '제품 라벨 자동 제외' },
  { no: '05', label: '규제 · 현지 적합성 확인' },
];

// coarse stage(ocr/section/verify) → 5개 항목 각각의 presentation state.
// 하나의 backend stage가 진행 중이어도 여러 UI 항목이 동시에 "진행 중"일
// 수 있다(예: verify 진행 중 → 04·05 동시 진행 중).
const FIVE_STEP_STATES_BY_COARSE_STAGE: Record<'ocr' | 'section' | 'verify' | 'done', ProcessingStep['state'][]> = {
  ocr: ['active', 'pending', 'pending', 'pending', 'pending'],
  section: ['done', 'active', 'active', 'pending', 'pending'],
  verify: ['done', 'done', 'done', 'active', 'active'],
  done: ['done', 'done', 'done', 'done', 'done'],
};

// coarse stage → GIF 하단 caption. 오른쪽 목록이 참조하는 것과 같은
// coarse stage 값을 그대로 쓴다(steps에서 active를 다시 찾지 않는다) —
// section/verify는 시각 항목이 2개씩 걸려 있어 그 둘을 포괄하는 문구
// 하나로 쓴다.
// 9/23 재조정 — 흰색 description은 Figma처럼 한 줄이어야 한다(processing-
// stage-layout.tsx의 whitespace-nowrap 처리 참고). 이전 문구는 Figma 원본
// 분량보다 길어 실측상 줄바꿈이 났다 — 뜻은 유지하되 분량만 Figma 수준으로
// 줄였다(font-size를 줄이거나 컨테이너를 늘리는 방식으로 우회하지 않는다).
const OVERLAY_CAPTION_BY_COARSE_STAGE: Record<'ocr' | 'section' | 'verify', { title: string; description: string }> = {
  ocr: {
    title: '텍스트 영역 인식 중',
    description: '이미지 속 텍스트와 위치를 인식하고 있습니다.',
  },
  section: {
    title: '콘텐츠 구조 분석 중',
    description: '콘텐츠 영역과 텍스트 역할을 구분하고 있습니다.',
  },
  verify: {
    title: '번역 대상·적합성 확인 중',
    description: '번역 제외 대상과 현지 적합성을 확인하고 있습니다.',
  },
};

/** 처리 중 'done'(verify=done 이지만 아직 N3 응답 전)에는 마지막 coarse stage(verify)의 caption을
 *  그대로 둔다. 실제 완료(N3 응답) 뒤 완료 표시는 N2_COMPLETION_CAPTION 이다. */
function resolveOverlayCaption(stage: keyof typeof FIVE_STEP_STATES_BY_COARSE_STAGE) {
  return OVERLAY_CAPTION_BY_COARSE_STAGE[stage === 'done' ? 'verify' : stage];
}

/**
 * 실제 완료(currentStep=N3) 응답 뒤 완료 표시 동안의 문구 — Figma 에 별도 완료 상태가 없어 기존 슬롯(상태 태그·visual headline·
 * GIF caption·LOG·progress 안내) 안에서만 최소한으로 바꾼다. 완료 표시 동안 "진행중"·"…하고 있습니다"·
 * "끝나면 이동합니다"가 남아 100%·5행 완료와 서로 다른 말을 하지 않게 한다.
 */
const N2_COMPLETION_CAPTION = { title: '분석 완료', description: '섹션 확인 단계로 이동합니다.' };
const N2_COMPLETION_COPY = {
  statusTag: '완료',
  headline: '이미지 분석이 완료되었습니다.',
  visualDescription: '분석 결과를 정리해 섹션 확인 단계로 이동합니다.',
  logHeading: '분석 완료',
  logDescription: '이미지 분석이 완료되었습니다.',
  progressHint: '섹션 확인 단계로 이동합니다.',
};

function resolveCoarseStage(stages: ApiJobTaskStatus['stages']): keyof typeof FIVE_STEP_STATES_BY_COARSE_STAGE {
  const find = (key: string) => stages?.find((s) => s.key?.toLowerCase() === key);
  const ocr = find('ocr');
  const section = find('section');
  const verify = find('verify');

  // ocr/section/verify 가 하나도 없는 응답(기본 mock 의 단일 'analyze' 등) — 진행 중인 첫 단계로만 둔다
  if (!ocr && !section && !verify) return 'ocr';

  if (verify?.status === 'done') return 'done';
  if (verify?.status === 'running') return 'verify';
  if (section?.status === 'running') return 'section';
  if (ocr?.status === 'running') return 'ocr';
  if (section?.status === 'done') return 'verify';
  if (ocr?.status === 'done') return 'section';
  // 실제 stage는 있지만(예: 전부 pending) 아직 뭐가 진행 중인지 알 수 없는
  // 애매한 경우 — 모르는 진행을 완료로 부풀리지 않도록 보수적 기본값.
  return 'ocr';
}

function buildFiveSteps(states: ProcessingStep['state'][]): ProcessingStep[] {
  return FIVE_STEP_META.map((step, i) => ({ ...step, state: states[i] }));
}

// ─────────────────────────────────────────────────────────────────
// analysisProgress(선택) 상세 진행 — server 315816e docs/openapi.yaml AnalysisProgress.
//
// 기존 N2 화면(Figma 660:4139)을 바꾸지 않는다 — 5단계 목록·progress 레이아웃은 그대로 두고, 서버가
// 이번 poll 에 준 값을 두 수준으로 나눠 쓴다.
// - 실제 세부 작업(ANALYSIS LOG 설명 줄): 원본·영역 위치와 split/ocr/merge 등 지금 하는 일, 또는 판정 수치
// - 큰 묶음(5단계 행 · GIF 하단 caption): 분석 묶음(analyze) / 정리(finalize) / 영역별 판정(judge)
// 원본마다 split → (영역마다) ocr → merge 가 반복되고 그 뒤 finalize · judge 다. activity 를 그대로 행에
// 연결하면 원본이 바뀔 때 03 → 01 로 돌아가는데, 사용자는 5단계를 전역 순차 과정으로 읽는다(10/22 사용자
// 테스트). 그래서 analyze running 동안 01~03 을 함께 진행 중으로 둔다 — 셋 중 하나가 지금 서버 작업이라고
// 주장하지 않는다. judge 에도 04·05 를 가르는 하위 단계가 없어 running 이면 둘 다 진행 중이다.
// - null 은 정보 없음이다 — 0·완료·이전 값·추정값으로 채우지 않고 그 조각을 빼고 쓴다.
// - 이전 poll 값을 state 에 쌓지 않는다(재시도·새 시도 때 이전 detail 이 남지 않는다).
// - 표시 % 는 status.progress 가 아니다. phase 가 상한만 연다(analyze 69 · finalize 79 · judge 99) — 숫자는
//   ./processing/use-displayed-progress.ts 가 현재 값에서 조금씩 올리고, 100 은 N3 응답 뒤 완료 표시뿐이다.
// ─────────────────────────────────────────────────────────────────

const LOG_DESCRIPTION = '완료된 항목은 분리하고, 현재 판단만 선명하게 정리 중 입니다.';

const ACTIVITY_LABEL: Record<NonNullable<ApiAnalysisProgress['activity']>, string> = {
  split: '영역을 나누는 중',
  ocr: '텍스트를 추출하는 중',
  merge: '병합·역할 분석 중',
  finalize: '분석 결과를 정리하는 중',
};

const ACTIVITY_REGION_VERB: Partial<Record<NonNullable<ApiAnalysisProgress['activity']>, string>> = {
  ocr: '텍스트 추출 중',
  merge: '병합·역할 분석 중',
};

/** running 이 아닐 때 analyze 상태를 짧게 덧붙이는 말 — running 은 activity 가 대신 말한다. */
const ANALYZE_STATUS_LABEL: Partial<Record<ApiAnalysisProgress['status'], string>> = {
  waiting: '대기',
  retrying: '재시도 대기',
  failed: '실패',
};

// GIF 하단 caption 은 5단계 행과 같은 묶음을 말한다 — split/ocr/merge 는 LOG 설명 줄에서만 구분한다.
const ANALYZE_RUNNING_CAPTION = { title: '이미지 구조 분석 중', description: '원본마다 영역·텍스트·역할을 분석하고 있습니다.' };
const FINALIZE_CAPTION = { title: '분석 결과 정리 중', description: '분석 결과를 정리하고 있습니다.' };

const JUDGE_CAPTION_BY_STATUS: Record<ApiAnalysisProgress['status'], { title: string; description: string }> = {
  waiting: { title: '영역별 판정 대기 중', description: '영역별 판정 시작을 기다리고 있습니다.' },
  retrying: { title: '영역별 판정 재시도 대기 중', description: '일부 영역 판정을 다시 시도하기 전입니다.' },
  running: { title: '영역별 판정 중', description: '영역마다 번역 대상과 현지 적합성을 확인하고 있습니다.' },
  // 판정 실행 실패 종료 — 전체 실패 표시(FAILED_CAPTION)는 isFailed 일 때만이고, 여기선 "판정 중"이라고만 하지 않는다
  failed: { title: '영역별 판정 중단', description: '영역별 판정을 마치지 못했습니다.' },
};

function resolveDetailCaption(detail: ApiAnalysisProgress): { title: string; description: string } {
  if (detail.phase === 'judge') return JUDGE_CAPTION_BY_STATUS[detail.status];
  if (detail.status === 'waiting') return { title: '분석 대기 중', description: '분석 시작을 기다리고 있습니다.' };
  if (detail.status === 'retrying') return { title: '분석 재시도 대기 중', description: '분석을 다시 시도하기 전입니다.' };
  if (detail.activity === 'finalize') return FINALIZE_CAPTION;
  if (detail.status === 'running' && detail.activity) return ANALYZE_RUNNING_CAPTION;
  // activity=null 이면 특정 작업을 하고 있다고 추정하지 않는다
  return { title: '이미지 분석 중', description: '원본 이미지를 분석하고 있습니다.' };
}

function describeActivity(detail: ApiAnalysisProgress): string | null {
  const { activity, current } = detail;
  if (!activity) return null;
  const verb = ACTIVITY_REGION_VERB[activity];
  if (verb && current && current.regionIndex != null && current.regionCountInSource != null) {
    return `영역 ${current.regionCountInSource}개 중 ${current.regionIndex}번째 ${verb}`;
  }
  return ACTIVITY_LABEL[activity];
}

/** ANALYSIS LOG 설명 줄에 넣을 한 줄. 예: "원본 2장 중 1번째 · 영역 3개 중 2번째 텍스트 추출 중" */
function describeDetailLine(detail: ApiAnalysisProgress): string {
  const { judge, current } = detail;
  if (detail.phase === 'judge' && judge) {
    const parts = [
      `판정 대상 ${judge.total}개`,
      `완료 ${judge.done}`,
      `자동 제외 ${judge.excluded}`,
      `진행 중 ${judge.running}`,
      `대기 ${judge.waiting}`,
    ];
    if (judge.retrying > 0) parts.push(`재시도 대기 ${judge.retrying}`);
    if (judge.failed > 0) parts.push(`실패 ${judge.failed}`);
    if (judge.cancelled > 0) parts.push(`취소 ${judge.cancelled}`);
    return parts.join(' · ');
  }
  const parts = [current ? `원본 ${detail.sourceTotal}장 중 ${current.sourceIndex}번째` : `원본 ${detail.sourceTotal}장`];
  const activityText = describeActivity(detail);
  if (activityText) parts.push(activityText);
  else if (ANALYZE_STATUS_LABEL[detail.status]) parts.push(ANALYZE_STATUS_LABEL[detail.status]!);
  return parts.join(' · ');
}

const ALL_PENDING: ProcessingStep['state'][] = ['pending', 'pending', 'pending', 'pending', 'pending'];

// analyze·running 의 activity → 5단계 행. split/ocr/merge 는 원본마다 반복되는 한 묶음이라 01~03 을 함께
// 진행 중으로 둔다(원본이 바뀌어도 행이 돌아가지 않는다). finalize 는 모든 원본의 split/ocr/merge 뒤라 01~03
// 완료를 계약상 알 수 있다.
// 01~03 이 함께 진행 중이라는 것은 "서버의 세부 단계 3개가 지금 동시에 실행 중"이라는 뜻이 아니다 —
// "원본별로 반복되는 analyze 작업 묶음이 진행 중"이라는 presentation 이다. 지금 정확히 어느 activity 인지는
// ANALYSIS LOG 설명 줄(describeDetailLine)에서만 보여 준다.
const ANALYZE_BUNDLE_ACTIVE: ProcessingStep['state'][] = ['active', 'active', 'active', 'pending', 'pending'];
const STEP_STATES_BY_ACTIVITY: Record<NonNullable<ApiAnalysisProgress['activity']>, ProcessingStep['state'][]> = {
  split: ANALYZE_BUNDLE_ACTIVE,
  ocr: ANALYZE_BUNDLE_ACTIVE,
  merge: ANALYZE_BUNDLE_ACTIVE,
  finalize: ['done', 'done', 'done', 'pending', 'pending'],
};

/**
 * analysisProgress 가 있을 때의 5단계 행 상태 — 계약으로 확실히 알 수 있는 것만 표시한다.
 * - analyze: status=running 이고 activity 가 있을 때만 진행 중(split/ocr/merge 는 01~03 함께). waiting/retrying/
 *   activity=null 은 전부 대기.
 * - judge: analyze 가 끝났으므로 01~03 완료. 04·05 는 구분할 하위 단계가 없어 running 이면 둘 다 진행 중,
 *   그 외(waiting/retrying/failed)는 둘 다 대기.
 */
function resolveAnalysisProgressStepStates(detail: ApiAnalysisProgress): ProcessingStep['state'][] {
  if (detail.phase === 'judge') {
    const judgeState = detail.status === 'running' ? 'active' : 'pending';
    return ['done', 'done', 'done', judgeState, judgeState];
  }
  if (detail.status === 'running' && detail.activity) return STEP_STATES_BY_ACTIVITY[detail.activity];
  return ALL_PENDING;
}

/**
 * 이번 poll 의 관측 단계가 여는 표시 % 상한. UX 표시 전용 값이며 서버 처리율이 아니다.
 * analysisProgress 가 없으면 coarse stages 로 연다 — OpenAPI 상 ocr 은 분석 시도(분해·OCR·병합 전체),
 * section 은 영역별 판정이다.
 */
const DISPLAY_CEILING = { analyze: 69, finalize: 79, judge: 99 } as const;

function resolveDisplayCeiling(detail: ApiAnalysisProgress | undefined, coarseStage: keyof typeof FIVE_STEP_STATES_BY_COARSE_STAGE): number {
  if (detail) {
    if (detail.phase === 'judge') return DISPLAY_CEILING.judge;
    return detail.activity === 'finalize' ? DISPLAY_CEILING.finalize : DISPLAY_CEILING.analyze;
  }
  return coarseStage === 'ocr' ? DISPLAY_CEILING.analyze : DISPLAY_CEILING.judge;
}

export function N2AnalysisView({
  jobId,
  status,
  isCompleted = false,
  isFailed = false,
}: {
  jobId: string;
  status: ApiJobTaskStatus;
  /**
   * N2 전체 분석 실패(currentStep=N2 && jobStatus=failed) — page.tsx 가 그 조건으로만 넘긴다.
   * failedCount·stages.section=failed·progress<1·analysisProgress.status=failed 만으로는 true 가 아니다
   * (LOCAL_JUDGE_FAILED 는 그 영역만 제외하고 N3 로 넘어갈 수 있다).
   */
  isFailed?: boolean;
  /**
   * 서버가 이미 N2 를 끝냈다(currentStep=N3 응답)는 뜻 — page.tsx 가 다음 화면으로 넘어가기 직전
   * 완료 표시(100% · 5단계 전부 완료)를 하는 동안만 true 로 넘긴다.
   */
  isCompleted?: boolean;
}) {
  const coarseStage = isCompleted ? 'done' : resolveCoarseStage(status.stages);
  // 완료 표시(isCompleted)는 N3 응답으로 그린다 — 그 응답엔 analysisProgress 가 없어 기존 5단계 완료로 그린다.
  const detail = isCompleted ? undefined : status.analysisProgress;
  // analysisProgress 가 있으면 행도 그 값으로, 없을 때만 기존 coarse stages 해석(레거시 응답 그대로).
  const stepStates = detail ? resolveAnalysisProgressStepStates(detail) : FIVE_STEP_STATES_BY_COARSE_STAGE[coarseStage];
  // 전체 실패면 진행 중인 행이 없다 — 별도 실패 행 디자인이 없어 "진행 중"만 "대기"로 낮춘다(완료 행은 그대로).
  const steps = buildFiveSteps(stepStates.map((state) => (isFailed && state === 'active' ? 'pending' : state)));
  const caption = isFailed
    ? FAILED_CAPTION
    : isCompleted
      ? N2_COMPLETION_CAPTION
      : detail
        ? resolveDetailCaption(detail)
        : resolveOverlayCaption(coarseStage);
  // 서버가 analysisProgress 로 대기·재시도 대기·실패라고 알린 동안만 숫자를 그 자리에 둔다(running 이 오면 그 값에서
  // 이어서 오른다). status=failed 는 표시 % 정지일 뿐 전체 실패 판정(isFailed)에 쓰지 않는다. analysisProgress 가 없는
  // 레거시 응답에서는 대기를 추정하지 않는다.
  const isProgressPaused = detail?.status === 'waiting' || detail?.status === 'retrying' || detail?.status === 'failed';
  const progressPercent = useDisplayedProgress({
    persistKey: n2DisplayedProgressKey(jobId),
    ceiling: resolveDisplayCeiling(detail, coarseStage),
    // 실패로 멈추는 것은 전체 분석 실패뿐이다 — LOCAL_JUDGE_FAILED 부분 제외는 N3 로 넘어가는 정상 흐름이다
    isFrozen: isFailed || isProgressPaused,
    isCompleted,
  });
  const failedItems = (status.items ?? []).filter((i) => i.status === 'failed');

  return (
    <ProcessingStageLayout
      currentStep="N2"
      header={{
        title: '이미지 분석',
        description: '등록한 이미지의 텍스트와 구조를 분석하고 있습니다.',
      }}
      statusTagLabel={isFailed ? '분석 실패' : isCompleted ? N2_COMPLETION_COPY.statusTag : '진행중'}
      visual={{
        // 공용 GIF — N2/N4가 같은 자산을 쓴다(별도 복사본 금지).
        src: '/process/ai-processing.gif',
        headline: isFailed ? FAILED_HEADLINE : isCompleted ? N2_COMPLETION_COPY.headline : HEADLINE_FALLBACK,
        description: isCompleted
          ? N2_COMPLETION_COPY.visualDescription
          : '텍스트만 추출하지 않고, 번역에 필요한 섹션과 판단 근거를 함께 정리합니다.',
        overlayTopLabel: 'SCAN  ·  STRUCTURE  ·  CONTEXT',
        overlayBottomTitle: caption.title,
        overlayBottomDescription: caption.description,
      }}
      log={{
        sectionLabel: 'ANALYSIS LOG',
        heading: isCompleted ? N2_COMPLETION_COPY.logHeading : '지금 처리하는 일',
        description: isCompleted ? N2_COMPLETION_COPY.logDescription : detail ? describeDetailLine(detail) : LOG_DESCRIPTION,
      }}
      steps={steps}
      progressPercent={progressPercent}
      progressHint={isFailed ? FAILED_NOTICE : isCompleted ? N2_COMPLETION_COPY.progressHint : AUTO_ADVANCE_NOTICE}
      pauseButtonTitle={PAUSE_BUTTON_TITLE}
      failedItems={failedItems}
      failedItemsTitle={isFailed ? '이미지 분석에 실패했습니다' : undefined}
    />
  );
}
