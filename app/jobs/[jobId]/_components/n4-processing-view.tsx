import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { n4DisplayedProgressKey } from '@/lib/processing/displayed-progress-storage';
import type { ProcessingErrorAbort } from './processing/processing-error-content';
import { ProcessingStageLayout, keepSingleActive, type ProcessingStageGroup, type ProcessingStepState } from './processing/processing-stage-layout';
import { hasProcessingFailure, useDisplayedProgress } from './processing/use-displayed-progress';

// ─────────────────────────────────────────────────────────────────
// N4 — 번역 중 (Figma 1821:48003 · 1821:48808 「N4 번역중」, PM 승인 화면 정본)
//
// 레이아웃은 N2와 같아 ./processing/processing-stage-layout.tsx를 재사용한다. 이 파일에는 N4 고유의 것만
// 남는다: copy와 N4 backend stage → 사용자 단계 묶음 해석.
//
// 사용자 단계 묶음(Figma 4개) ↔ 서버 stage(OpenAPI JobTaskStatus.stages "N4 inpaint→translate→verify→render"):
// - 01 배경복원 · 번역 · 용어 맞춤 ← inpaint + translate
// - 02 규제 기준 확인           ← verify
// - 03 글자 수, 줄바꿈 조정      ← render
// - 04 이미지 합성              ← render (render 하나를 03·04 가 함께 설명한다 — 서버에 둘을 가르는 substage 가 없다)
//
// 서버는 섹션마다 inpaint/translate/verify/render 를 병렬로 처리하고, stages 는 task_type 집계라(하나라도 running 이면
// running) 여러 stage 가 동시에 running 일 수 있다. 서버 작업은 그대로 두고, 표시만 「아직 완료되지 않은 가장 앞 묶음
// 하나」를 진행 중으로 고른다 — 화면의 「진행 중」은 항상 최대 1개다(resolveN4Presentation).
// - 묶음 완료: 그 묶음의 stage 가 모두 서버에서 명시적으로 done 일 때뿐이다. 응답에 없는 stage 는 완료로 추정하지 않는다.
// - 뒤 stage 가 이미 running 이어도 앞 묶음이 미완료면 뒤 묶음은 진행 중으로 올리지 않는다(대기).
// - 03·04 는 render 하나라 render 단계에서는 앞 묶음(03)만 진행 중, 04 는 대기다(04 단독 단계를 만들지 않는다).
// - N4 전체 완료는 서버 currentStep=N5 뿐이다. render=done·progress=1 은 지금 생성된 render 시도들의 집계일 뿐이라 처리
//   중에는 완료·100% 를 만들지 않는다. N5 응답 뒤에만 page.tsx 가 isCompleted 로 잠깐 유지해 모든 묶음 완료를 보여 준다.
//
// 표시 % 상한·LOG 현재 상태도 화면에 진행 중으로 그린 묶음 하나를 기준으로 한다 — dot·「진행 중」·LOG 상태·% 가 같은 사용자
// 단계를 말한다. 뒤쪽 병렬 stage 가 running 이라는 이유로 상한을 열지 않는다. 숫자는 서버 처리율이 아니라 UX 표시용이며,
// 상한만 열고 현재 값에서 tick 마다 조금씩 오른다(lib/processing/displayed-progress.ts). 2초 polling 사이에 지나간 단계는
// 관측하지 못할 수 있다 — 그 단계를 화면에 재생하지 않는다.
//
// stages가 완전히 비어 있거나 전혀 다른 key만 오는 경우(다른 mock/실제 배포 전환기)를 대비한
// progress 기반 coarse fallback 은 남긴다(4단계까지만, render 내부는 나누지 않는다).
// ─────────────────────────────────────────────────────────────────

const N4_AUTO_ADVANCE_NOTICE = '완료되면 검수 화면으로 자동 이동합니다.';

// Figma 1821:48015 「N2 / Step List」(N4) — 묶음 4개, 라벨은 Figma 그대로다.
const STAGE_GROUP_META: Omit<ProcessingStageGroup, 'state'>[] = [
  { no: '01', labels: ['배경복원', '번역 · 용어 맞춤'] },
  { no: '02', labels: ['규제 기준 확인'] },
  { no: '03', labels: ['글자 수, 줄바꿈 조정'] },
  { no: '04', labels: ['이미지 합성'] },
];

type GroupIndex = 0 | 1 | 2;

/** 묶음별 서버 stage — 03·04 는 render 하나를 함께 쓴다(04 는 render 단계에서도 대기라 별도 index 가 없다) */
const GROUP_STAGES: Record<GroupIndex, readonly N4ObservedStage[]> = {
  0: ['inpaint', 'translate'],
  1: ['verify'],
  2: ['render'],
};

/** 서버 stages[] 로 실제 구분할 수 있는 N4 단계 — 04/05 substage 나 'done' 은 없다. */
type N4ObservedStage = 'inpaint' | 'translate' | 'verify' | 'render';

const N4_OBSERVED_STAGE_ORDER: readonly N4ObservedStage[] = ['inpaint', 'translate', 'verify', 'render'];

/** 관측 단계 → 진행 중으로 그릴 묶음 */
const GROUP_BY_N4_STAGE: Record<N4ObservedStage, GroupIndex> = { inpaint: 0, translate: 0, verify: 1, render: 2 };

/**
 * 진행 중 묶음이 여는 표시 % 상한. UX 표시 전용 값이며 서버 처리율이 아니다(서버는 단계 안의 진행을 주지 않는다).
 * 01 은 inpaint·translate 를 함께 담아 39 까지, render(03·04)는 나누지 않는 한 구간이고 N4 처리 중 최대 99 다.
 */
const DISPLAY_CEILING_BY_GROUP: Record<GroupIndex, number> = { 0: 39, 1: 59, 2: 99 };

/**
 * TRANSLATION LOG 현재 상태(설명 줄 앞)와 세부 설명 — 진행 중 묶음의 지금 단계를 말한다(01 묶음은 그 안에서 아직 끝나지
 * 않은 앞 stage). render 는 03·04 중 하나를 고르지 않고 render 전체를 설명한다. 예전 GIF 하단 caption 문구를 그대로 쓴다.
 */
const LOG_STATUS_BY_N4_STAGE: Record<N4ObservedStage, { status: string; description: string }> = {
  inpaint: { status: '원문 제거·배경 복원 중', description: '원문을 지우고 주변 배경을 자연스럽게 복원하고 있습니다.' },
  translate: { status: '번역·용어 맞춤 중', description: '번역문과 제품·브랜드 용어를 맞추고 있습니다.' },
  verify: { status: '규제 기준 확인 중', description: '번역문이 대상 국가의 규제 기준에 맞는지 확인합니다.' },
  render: { status: '번역 결과 이미지 적용 중', description: '번역문을 디자인에 맞게 조정하고 이미지에 반영합니다.' },
};

/**
 * 실제 완료(currentStep=N5) 응답 뒤 완료 표시 동안의 문구 — Figma 에 별도 완료 상태가 없어 기존 슬롯(LOG·progress 안내) 안에서만 최소한으로 바꾼다. 완료 표시 동안 "진행중"·"…하고 있습니다"·
 * "완료되면 이동합니다"가 남아 100%·모든 묶음 완료와 서로 다른 말을 하지 않게 한다.
 */
const N4_COMPLETION_COPY = {
  logHeading: '번역 완료',
  logDescription: '번역과 이미지 적용이 완료되었습니다.',
  progressHint: '검수 화면으로 이동합니다.',
};
type GroupStates = readonly [ProcessingStepState, ProcessingStepState, ProcessingStepState, ProcessingStepState];
const ALL_DONE: GroupStates = ['done', 'done', 'done', 'done'];

/**
 * API 계약값이 아니다 — 실제 inpaint/translate/verify/render stage가 하나도 없을 때만 쓰는
 * progress 기반 coarse fallback. coarse 단계가 4개이므로 0~1 구간을 4등분한다. render 내부(04/05)는
 * 나누지 않는다. 실제 BE stage가 하나라도 있으면 resolveN4ObservedStage가 이 함수를 호출하지 않는다.
 */
function resolveN4ProgressFallback(progress: number | undefined): N4ObservedStage {
  const p = progress ?? 0;
  if (p >= 0.75) return 'render';
  if (p >= 0.5) return 'verify';
  if (p >= 0.25) return 'translate';
  return 'inpaint';
}

/**
 * 이번 poll 의 stages 에서 지금 처리 중인 N4 단계를 고른다. 섹션마다 단계가 달라 여러 stage 가
 * 동시에 running 이거나 일부 render 가 이미 done 일 수 있다.
 * 1. running 이 있으면 그중 가장 앞 단계 — render=done 을 running 보다 우선하지 않는다.
 * 2. failed 가 있으면 그중 가장 앞 단계(멈춘 곳).
 * 3. 그 외에는 마지막 done 다음 단계(render 가 done 이어도 render 에 머문다 — 완료는 N5 전환뿐).
 * 4. 실제 stage 는 있지만 모두 pending 이면 보수적으로 inpaint.
 */
function resolveN4ObservedStage(stages: ApiJobTaskStatus['stages'], progress: number | undefined): N4ObservedStage {
  const statusOf = (key: N4ObservedStage) => stages?.find((s) => s.key?.toLowerCase() === key)?.status;
  const observed = N4_OBSERVED_STAGE_ORDER.filter((key) => statusOf(key) !== undefined);
  if (observed.length === 0) return resolveN4ProgressFallback(progress);

  const running = observed.find((key) => statusOf(key) === 'running');
  if (running) return running;
  const failed = observed.find((key) => statusOf(key) === 'failed');
  if (failed) return failed;
  const lastDone = [...observed].reverse().find((key) => statusOf(key) === 'done');
  if (lastDone) return N4_OBSERVED_STAGE_ORDER[Math.min(N4_OBSERVED_STAGE_ORDER.indexOf(lastDone) + 1, N4_OBSERVED_STAGE_ORDER.length - 1)];
  return 'inpaint';
}

/** 진행 중 묶음 하나 → 4개 묶음 상태. 앞 묶음은 완료, 뒤 묶음은 대기다(03 진행 중이면 04 는 대기). */
function groupStatesFor(active: GroupIndex): GroupStates {
  const states: ProcessingStepState[] = [0, 1, 2, 3].map((i) => (i < active ? 'done' : i === active ? 'active' : 'pending'));
  return states as unknown as GroupStates;
}

/**
 * 이번 poll 의 묶음 상태와, 그 진행 중 묶음을 설명하는 서버 stage(caption 용). 위 머리 주석 참고.
 * - N4 key 가 둘 이상이고 running 이 있는 응답(섹션 병렬): 서버가 명시적으로 모두 done 이라고 한 묶음을 앞에서부터 건너뛰고,
 *   처음 만나는 미완료 묶음 하나만 진행 중이다. 응답에 없는 stage 는 완료로 보지 않는다. 뒤 묶음의 running 은 대기로 둔다.
 * - key 가 하나뿐인 호환(sparse) 응답·running 이 없는 응답은 resolveN4ObservedStage 순서 규칙 그대로 한 묶음을 고른다.
 * activeGroup 은 dot·caption·표시 % 상한이 함께 쓰는 하나의 값이다.
 */
function resolveN4Presentation(
  stages: ApiJobTaskStatus['stages'],
  progress: number | undefined,
): { rows: GroupStates; activeGroup: GroupIndex; captionStage: N4ObservedStage } {
  const statusOf = (key: N4ObservedStage) => stages?.find((s) => s.key?.toLowerCase() === key)?.status;
  const observed = N4_OBSERVED_STAGE_ORDER.filter((key) => statusOf(key) !== undefined);
  const hasRunning = observed.some((key) => statusOf(key) === 'running');

  if (observed.length >= 2 && hasRunning) {
    const isGroupDone = (group: GroupIndex) => GROUP_STAGES[group].every((key) => statusOf(key) === 'done');
    const activeGroup = ([0, 1, 2] as const).find((group) => !isGroupDone(group)) ?? 2;
    // caption 은 진행 중 묶음 안에서 서버가 running 이라고 한 stage, 없으면 아직 끝나지 않은 앞 stage 를 설명한다
    const groupKeys = GROUP_STAGES[activeGroup];
    const captionStage =
      groupKeys.find((key) => statusOf(key) === 'running') ?? groupKeys.find((key) => statusOf(key) !== 'done') ?? groupKeys[0];
    return { rows: groupStatesFor(activeGroup), activeGroup, captionStage };
  }

  const stage = resolveN4ObservedStage(stages, progress);
  const activeGroup = GROUP_BY_N4_STAGE[stage];
  return { rows: groupStatesFor(activeGroup), activeGroup, captionStage: stage };
}

function buildStageGroups(states: GroupStates): ProcessingStageGroup[] {
  const single = keepSingleActive(states);
  return STAGE_GROUP_META.map((group, i) => ({ ...group, state: single[i] }));
}

// 전체 실패 안내(Figma 795:4820). 서버 응답에 사용자용 문구가 없어(errorCode 뿐) 실패 단계를 추측하지 않고 이 문구를 쓴다
const N4_ERROR = { sectionLabel: 'TRANSLATION STATUS', title: '번역을 완료하지 못했습니다', description: '번역 처리 중 오류가 발생했습니다.' };

export function N4ProcessingView({
  jobId,
  status,
  isCompleted = false,
  isFailed = false,
  abort,
}: {
  jobId: string;
  status: ApiJobTaskStatus;
  /** [중단](API-JOB-07) — page.tsx 의 useJobAbort 가 넘긴다. 처리 중 버튼(Figma 일시 정지 자리)과 전체 실패 화면 [중단]이 같은 값을 쓴다 */
  abort?: ProcessingErrorAbort;
  /** N4 전체 실패(currentStep=N4 && jobStatus=failed) — page.tsx 가 그 조건으로만 넘긴다. 일부 항목 실패만으로는 true 가 아니다 */
  isFailed?: boolean;
  /**
   * 서버가 이미 N4 를 끝냈다(currentStep=N5 응답) — page.tsx 가 N5 로 넘어가기 직전 완료 표시를 하는
   * 동안만 true 로 넘긴다. 그때 status 는 그 N5 응답이다.
   */
  isCompleted?: boolean;
}) {
  // 묶음·caption·표시 % 상한은 이번 poll 에서 진행 중으로 그린 묶음 하나로만 정한다. status.progress 는
  // stages 가 비어 있을 때의 coarse fallback 에만 쓴다 — 숫자는 hook 이 그 상한 안에서 따로 올린다.
  const { rows, activeGroup, captionStage } = resolveN4Presentation(status.stages, status.progress);
  const displayedProgress = useDisplayedProgress({
    persistKey: n4DisplayedProgressKey(jobId),
    ceiling: DISPLAY_CEILING_BY_GROUP[activeGroup],
    isFrozen: !isCompleted && hasProcessingFailure(status),
    isCompleted,
  });
  const steps = buildStageGroups(isCompleted ? ALL_DONE : rows);

  return (
    <ProcessingStageLayout
      header={{
        title: '번역 중',
      }}
      visual={{
        // N2/N4 공용 GIF — 별도 복사본을 만들지 않는다.
        src: '/process/ai-processing.gif',
        overlayTopLabel: 'SOURCE  →  LOCALIZED',
      }}
      log={{
        sectionLabel: 'TRANSLATION LOG',
        heading: isCompleted ? N4_COMPLETION_COPY.logHeading : '지금 처리하는 일',
        status: isCompleted ? undefined : LOG_STATUS_BY_N4_STAGE[captionStage].status,
        description: isCompleted ? N4_COMPLETION_COPY.logDescription : LOG_STATUS_BY_N4_STAGE[captionStage].description,
      }}
      steps={steps}
      progressPercent={displayedProgress}
      progressHint={isCompleted ? N4_COMPLETION_COPY.progressHint : N4_AUTO_ADVANCE_NOTICE}
      // 처리 중 [중단] — 완료 표시(isCompleted) 동안은 이미 다음 단계라 누를 수 없다
      abort={isCompleted ? undefined : abort}
      // 부분 실패 항목(unitType·unitId·errorCode)은 내부 진단 정보라 N4 화면에 내지 않는다 — 블록·섹션 오류는 N5 에서 확인한다.
      // 진행 멈춤(hasProcessingFailure)·전체 실패(jobStatus=failed) 판정은 그대로다
      failedItems={[]}
      error={isFailed ? { ...N4_ERROR, ...abort } : undefined}
    />
  );
}
