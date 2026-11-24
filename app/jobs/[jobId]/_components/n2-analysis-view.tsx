import type { ApiAnalysisProgress, ApiJobTaskStatus } from '@/lib/api/job-schema';
import { n2DisplayedProgressKey } from '@/lib/processing/displayed-progress-storage';
import { ProcessingStageLayout, keepSingleActive, type ProcessingStageGroup, type ProcessingStepState } from './processing/processing-stage-layout';
import { useDisplayedProgress } from './processing/use-displayed-progress';

// ─────────────────────────────────────────────────────────────────
// N2 — 분석중 (Figma 1821:46419 · 1821:47209 「N2 분석중」, PM 승인 화면 정본)
//
// 레이아웃(rail/헤더/회색 패널/비주얼/로그/progress)은 N4와 같아 ./processing/processing-stage-layout.tsx로
// 뺐다. 이 파일에는 N2 고유의 것만 남는다:
// - copy(헤더/헤드라인/로그/단계 라벨/안내문 텍스트/GIF 하단 caption)
// - N2의 backend stage(ocr/section/verify)·analysisProgress → 사용자 단계 묶음(01·02·03) 상태 해석
// - 관측 단계 → 표시 % 상한(숫자 자체는 ./processing/use-displayed-progress.ts)
//
// 사용자 단계는 Figma 묶음 3개다(01 = 콘텐츠 영역 나누기·전체 텍스트 인식·문단별 역할 파악 / 02 / 03).
// 묶음 안에 label 이 여러 줄이어도 번호·dot·상태 글자는 하나이고, 「진행 중」은 항상 최대 1개다.
// 서버가 두 묶음을 가르는 정보를 주지 않는 구간(judge = 02·03)은 앞 묶음만 진행 중, 다음은 대기로 둔다 —
// top-level progress 로 경계를 지어내지 않는다. 서버 API·stage 는 바꾸지 않는다. 기본 mock 의 단일 'analyze' stage는
// ocr(01 진행 중)로 둔다.
//
// 이 해석 로직은 N4와 공유하지 않는다 — N4는 backend stage 어휘 자체가 다르다(inpaint/translate/verify/render).
//
// GIF 하단 caption(주황 title + 회색 description)은 오른쪽 목록과 같은 값(coarse stage 또는 analysisProgress)을
// 참조해 지금 진행 중인 묶음을 설명한다 — progress%로 caption이나 substage를 다시 추론하지 않는다.
// ─────────────────────────────────────────────────────────────────

const HEADLINE_FALLBACK = '상세페이지의 구조와 문맥을 읽고 있습니다.';
const AUTO_ADVANCE_NOTICE = '분석이 끝나면 섹션 확인 단계로 자동 이동합니다.';
const PAUSE_BUTTON_TITLE = '분석 중단 기능은 아직 제공되지 않습니다.';
// 전체 실패 안내(Figma 793:4890). 서버 응답에 사용자용 문구가 없어(errorCode 뿐) 실패 단계를 추측하지 않고 이 문구를 쓴다
const N2_ERROR = { sectionLabel: 'ANALYSIS STATUS', title: '분석이 중단되었습니다', description: '이미지 분석 중 오류가 발생했습니다.' };

// Figma 1821:46419 · 1821:47209(N2 분석중, PM 승인) — 사용자 단계 묶음은 3개다. 01 묶음은 label 3줄이지만 번호·dot·상태 글자는
// 하나다. 「진행 중」은 항상 최대 1개다.
// 02 라벨 — Figma 에는 01 첫 줄과 같은 「콘텐츠 영역 나누기」가 들어 있어(복사 오류로 보인다) 지금 의미 있는 라벨을 유지한다
// (PM 확인 항목). 01·03 라벨은 Figma 그대로다.
const STAGE_GROUP_META: Omit<ProcessingStageGroup, 'state'>[] = [
  { no: '01', labels: ['콘텐츠 영역 나누기', '전체 텍스트 인식', '문단별 역할 파악'] },
  { no: '02', labels: ['제품 라벨 자동 제외'] },
  { no: '03', labels: ['규제 · 현지 적합성 확인'] },
];

type GroupStates = readonly [ProcessingStepState, ProcessingStepState, ProcessingStepState];

// coarse stage(ocr/section/verify) → 3개 묶음 상태(analysisProgress 가 없는 레거시 응답).
// 기존 5행 해석을 묶음으로 옮긴 것이다 — ocr·section 은 01 묶음(구조·텍스트·역할), verify 는 02·03 묶음이다.
// verify 는 02·03 을 가르는 정보가 없어 앞 묶음(02)만 진행 중, 03 은 대기다(서버가 주지 않는 경계를 만들지 않는다).
const GROUP_STATES_BY_COARSE_STAGE: Record<'ocr' | 'section' | 'verify' | 'done', GroupStates> = {
  ocr: ['active', 'pending', 'pending'],
  section: ['active', 'pending', 'pending'],
  verify: ['done', 'active', 'pending'],
  done: ['done', 'done', 'done'],
};

// coarse stage → GIF 하단 caption. 오른쪽 목록이 참조하는 것과 같은
// coarse stage 값을 그대로 쓴다(steps에서 active를 다시 찾지 않는다) — ocr·section 은 01 묶음,
// verify 는 02 묶음을 설명한다.
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
function resolveOverlayCaption(stage: keyof typeof GROUP_STATES_BY_COARSE_STAGE) {
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

function resolveCoarseStage(stages: ApiJobTaskStatus['stages']): keyof typeof GROUP_STATES_BY_COARSE_STAGE {
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

function buildStageGroups(states: GroupStates): ProcessingStageGroup[] {
  const single = keepSingleActive(states);
  return STAGE_GROUP_META.map((group, i) => ({ ...group, state: single[i] }));
}

// ─────────────────────────────────────────────────────────────────
// analysisProgress(선택) 상세 진행 — server 315816e docs/openapi.yaml AnalysisProgress.
//
// N2 화면 구조(단계 묶음·progress 레이아웃)는 그대로 두고, 서버가
// 이번 poll 에 준 값을 두 수준으로 나눠 쓴다.
// - 실제 세부 작업(ANALYSIS LOG 설명 줄): 원본·영역 위치와 split/ocr/merge 등 지금 하는 일, 또는 판정 수치
// - 큰 묶음(단계 묶음 · GIF 하단 caption): 분석 묶음(analyze) / 정리(finalize) / 영역별 판정(judge)
// 원본마다 split → (영역마다) ocr → merge 가 반복되고 그 뒤 finalize · judge 다. analyze running 동안은 01 묶음
// 하나가 진행 중이다 — split/ocr/merge 중 어느 것인지는 LOG 설명 줄에서만 보인다. judge 에는 02·03 을 가르는 하위
// 단계가 없어 앞 묶음(02)만 진행 중, 03 은 대기다(진행 중은 항상 최대 1개).
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

// GIF 하단 caption 은 단계 묶음과 같은 묶음을 말한다 — split/ocr/merge 는 LOG 설명 줄에서만 구분한다.
const ANALYZE_RUNNING_CAPTION = { title: '이미지 구조 분석 중', description: '원본마다 영역·텍스트·역할을 분석하고 있습니다.' };
const FINALIZE_CAPTION = { title: '분석 결과 정리 중', description: '분석 결과를 정리하고 있습니다.' };

const JUDGE_CAPTION_BY_STATUS: Record<ApiAnalysisProgress['status'], { title: string; description: string }> = {
  waiting: { title: '영역별 판정 대기 중', description: '영역별 판정 시작을 기다리고 있습니다.' },
  retrying: { title: '영역별 판정 재시도 대기 중', description: '일부 영역 판정을 다시 시도하기 전입니다.' },
  running: { title: '영역별 판정 중', description: '영역마다 번역 대상과 현지 적합성을 확인하고 있습니다.' },
  // 판정 실행 실패 종료 — 전체 실패 화면은 isFailed 일 때만이고, 여기선 "판정 중"이라고만 하지 않는다
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

const ALL_PENDING: GroupStates = ['pending', 'pending', 'pending'];

// analyze·running 의 activity → 묶음 상태. split/ocr/merge 는 원본마다 반복되는 한 묶음(01)이라 원본이 바뀌어도
// 01 진행 중 그대로다. finalize 는 모든 원본의 split/ocr/merge 뒤라 01 완료를 계약상 알 수 있다.
const ANALYZE_BUNDLE_ACTIVE: GroupStates = ['active', 'pending', 'pending'];
const GROUP_STATES_BY_ACTIVITY: Record<NonNullable<ApiAnalysisProgress['activity']>, GroupStates> = {
  split: ANALYZE_BUNDLE_ACTIVE,
  ocr: ANALYZE_BUNDLE_ACTIVE,
  merge: ANALYZE_BUNDLE_ACTIVE,
  finalize: ['done', 'pending', 'pending'],
};

/**
 * analysisProgress 가 있을 때의 묶음 상태 — 계약으로 확실히 알 수 있는 것만 표시한다.
 * - analyze: status=running 이고 activity 가 있을 때만 01 진행 중. waiting/retrying/activity=null 은 전부 대기.
 * - judge: analyze 가 끝났으므로 01 완료. 02·03 을 가르는 하위 단계가 없어 running 이면 앞 묶음(02)만 진행 중, 03 은
 *   대기다. 그 외(waiting/retrying/failed)는 둘 다 대기. 02·03 은 실제 완료(N3 응답) 뒤 완료 표시에서 함께 완료가 된다.
 */
function resolveAnalysisProgressGroupStates(detail: ApiAnalysisProgress): GroupStates {
  if (detail.phase === 'judge') return detail.status === 'running' ? ['done', 'active', 'pending'] : ['done', 'pending', 'pending'];
  if (detail.status === 'running' && detail.activity) return GROUP_STATES_BY_ACTIVITY[detail.activity];
  return ALL_PENDING;
}

/**
 * 이번 poll 의 관측 단계가 여는 표시 % 상한. UX 표시 전용 값이며 서버 처리율이 아니다.
 * 화면에 진행 중으로 보이는 묶음과 같은 기준이다 — analysisProgress 가 없으면 coarse stage 의 묶음(ocr·section → 01,
 * verify → 02)으로 연다.
 */
const DISPLAY_CEILING = { analyze: 69, finalize: 79, judge: 99 } as const;

function resolveDisplayCeiling(detail: ApiAnalysisProgress | undefined, coarseStage: keyof typeof GROUP_STATES_BY_COARSE_STAGE): number {
  if (detail) {
    if (detail.phase === 'judge') return DISPLAY_CEILING.judge;
    return detail.activity === 'finalize' ? DISPLAY_CEILING.finalize : DISPLAY_CEILING.analyze;
  }
  return coarseStage === 'ocr' || coarseStage === 'section' ? DISPLAY_CEILING.analyze : DISPLAY_CEILING.judge;
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
   * 완료 표시(100% · 모든 묶음 완료)를 하는 동안만 true 로 넘긴다.
   */
  isCompleted?: boolean;
}) {
  const coarseStage = isCompleted ? 'done' : resolveCoarseStage(status.stages);
  // 완료 표시(isCompleted)는 N3 응답으로 그린다 — 그 응답엔 analysisProgress 가 없어 모든 묶음 완료로 그린다.
  const detail = isCompleted ? undefined : status.analysisProgress;
  // analysisProgress 가 있으면 묶음도 그 값으로, 없을 때만 기존 coarse stages 해석(레거시 응답 그대로).
  const groupStates = detail ? resolveAnalysisProgressGroupStates(detail) : GROUP_STATES_BY_COARSE_STAGE[coarseStage];
  const steps = buildStageGroups(groupStates);
  const caption = isCompleted ? N2_COMPLETION_CAPTION : detail ? resolveDetailCaption(detail) : resolveOverlayCaption(coarseStage);
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
      header={{
        title: '이미지 분석',
      }}
      statusTagLabel={isCompleted ? N2_COMPLETION_COPY.statusTag : '진행중'}
      visual={{
        // 공용 GIF — N2/N4가 같은 자산을 쓴다(별도 복사본 금지).
        src: '/process/ai-processing.gif',
        headline: isCompleted ? N2_COMPLETION_COPY.headline : HEADLINE_FALLBACK,
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
      progressHint={isCompleted ? N2_COMPLETION_COPY.progressHint : AUTO_ADVANCE_NOTICE}
      pauseButtonTitle={PAUSE_BUTTON_TITLE}
      failedItems={failedItems}
      error={isFailed ? N2_ERROR : undefined}
    />
  );
}
