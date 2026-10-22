import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { n4DisplayedProgressKey } from '@/lib/processing/displayed-progress-storage';
import { ProcessingStageLayout, type ProcessingStep } from './processing/processing-stage-layout';
import { hasProcessingFailure, useDisplayedProgress } from './processing/use-displayed-progress';

// ─────────────────────────────────────────────────────────────────
// N4 — 번역 중 (Figma node 660:4221 "N4 번역중")
//
// N2(660:4139)와 레이아웃이 node 단위로 동일해 ./processing/
// processing-stage-layout.tsx를 그대로 재사용한다. 이 파일에는 N4
// 고유의 것만 남는다: copy와 N4 backend stage 해석.
//
// N4의 backend stage 어휘는 N2와 다르다(OpenAPI JobTaskStatus.stages 주석:
// "N2 ocr→section→verify · N4 inpaint→translate→verify→render") — coarse
// 4단계를 화면 고정 5단계에 매핑해야 하므로, N2의 resolveCoarseStage/
// FIVE_STEP_STATES_BY_COARSE_STAGE를 재사용하지 않고 이 파일 안에 N4
// 전용으로 새로 둔다.
//
// 의미 매핑(요청 기준):
// - inpaint          → 01 한글 지우고 배경 채우기
// - translate         → 02 번역 · 용어 맞춤
// - verify            → 03 규제 기준 확인
// - render            → 04 글자 수, 줄바꿈 조정 + 05 이미지 합성(두 행이 함께)
//
// 10/22 — 서버 관측 상태 · 설명 행 · 표시 숫자를 분리했다(PR #40 N4 리뷰).
// - 서버에서 실제로 구분되는 N4 단계는 inpaint/translate/verify/render 4개뿐이다
//   (resolveN4ObservedStage). 행과 caption 은 매 poll 이 값으로만 그린다 — 이전에 보여 준
//   단계를 유지하지 않는다(섹션마다 단계가 달라 서버 관측이 뒤로 갈 수 있다).
// - render 하나를 화면의 04·05 두 행이 함께 설명한다. 서버 계약에 04/05 substage 가 없으므로
//   둘 중 하나만 진행 중으로 고르거나 04 → 05 순서·최소 체류를 만들지 않는다. global
//   progress(job 전체 값)로 render 내부를 가르지 않는다(이전 0.875 경계 제거).
// - N4 전체 완료는 서버 currentStep=N5 뿐이다. render=done·progress=1 은 지금 생성된 render
//   시도들의 집계일 뿐이라 N4 처리 중에는 '완료'·100% 를 만들지 않는다. N5 응답을 받은 뒤에만
//   page.tsx 가 이 화면을 isCompleted 로 잠깐 유지해 100% 와 5행 완료를 보여 주고 N5 로 넘긴다.
//
// 10/22 (2) — 표시 % 는 관측 단계가 상한만 연다(lib/processing/displayed-progress.ts).
// - 단계가 바뀌어도 다음 구간 하한으로 뛰지 않고 현재 값에서 tick 마다 조금씩 오른다. 이전의 90초
//   구간 채우기·서버 progress 하한은 쓰지 않는다(2초 polling 에 수 초 만에 끝나는 처리에서 5 → 25 → 50
//   처럼 뛰거나, 01 구간 19 에 묶여 있다가 N5 로 넘어갔다).
// - 2초 polling 사이에 지나간 단계는 관측하지 못할 수 있다 — 그 단계를 화면에 재생하지 않는다.
//
// 10/22 (3) — 병렬 섹션 정합(resolveN4Presentation). stages 는 task_type 집계라(하나라도 running 이면
// running) 섹션이 병렬로 진행되면 여러 단계가 함께 running 이다. 이전에는 행·caption 은 가장 앞 running
// 하나, 상한은 시작된(running·done) 가장 뒤 단계로 열어 "01 진행 중 · 47%" 처럼 둘이 따로 놀았다.
// - N4 key 가 둘 이상 오는 응답: running 인 단계 행을 모두 진행 중으로 둔다(서버가 실제로 running 이라고 한
//   단계뿐이다). 가장 앞 running 보다 앞 단계 중 서버가 done 이라고 명시한 단계만 완료로 본다 — 응답에 없는
//   단계(key 없음)는 완료로 추정하지 않고 대기로 둔다. 가장 앞 running 뒤의 done(예: render=done)은 완료로
//   그리지 않는다 — 지금 생성된 시도들의 집계일 뿐 이후 render 가 다시 생길 수 있다.
// - key 가 하나뿐인 호환(sparse) 응답·running 이 없는 응답은 위 resolveN4ObservedStage 순서 규칙 그대로다.
// - 표시 % 상한은 화면에 진행 중으로 그린 단계 중 가장 뒤 단계로 연다 — done 은 상한을 열지 않는다. 행과
//   숫자가 같은 상태를 말하고, 숫자는 그 단계 하한으로 뛰지 않고 현재 값에서 오른다.
// - 여러 단계가 함께 진행 중이면 caption 은 하나의 단계만 지금 작업이라고 말하지 않는 병렬 문구다.
//
// stages가 완전히 비어 있거나 전혀 다른 key만 오는 경우(다른 mock/실제 배포 전환기)를 대비한
// progress 기반 coarse fallback 은 남긴다(4단계까지만, render 내부는 나누지 않는다).
// ─────────────────────────────────────────────────────────────────

const N4_HEADLINE = '번역과 배경 복원을 함께 진행하고 있습니다.';
const N4_AUTO_ADVANCE_NOTICE = '완료되면 검수 화면으로 자동 이동합니다.';
const N4_PAUSE_BUTTON_TITLE = '번역 중단 기능은 아직 제공되지 않습니다.';

const FIVE_STEP_META: { no: string; label: string }[] = [
  { no: '01', label: '한글 지우고 배경 채우기' },
  { no: '02', label: '번역 · 용어 맞춤' },
  { no: '03', label: '규제 기준 확인' },
  { no: '04', label: '글자 수, 줄바꿈 조정' },
  { no: '05', label: '이미지 합성' },
];

/** 서버 stages[] 로 실제 구분할 수 있는 N4 단계 — 04/05 substage 나 'done' 은 없다. */
type N4ObservedStage = 'inpaint' | 'translate' | 'verify' | 'render';

const N4_OBSERVED_STAGE_ORDER: readonly N4ObservedStage[] = ['inpaint', 'translate', 'verify', 'render'];

// render 는 04·05 두 행이 함께 설명한다(둘 다 진행 중). 처리 중에는 5행 전부 완료가 없다 — 그건 N5 응답 뒤
// 완료 표시(ALL_DONE)뿐이다.
const FIVE_STEP_STATES_BY_N4_STAGE: Record<N4ObservedStage, ProcessingStep['state'][]> = {
  inpaint: ['active', 'pending', 'pending', 'pending', 'pending'],
  translate: ['done', 'active', 'pending', 'pending', 'pending'],
  verify: ['done', 'done', 'active', 'pending', 'pending'],
  render: ['done', 'done', 'done', 'active', 'active'],
};

/**
 * 관측 단계가 여는 표시 % 상한. UX 표시 전용 값이며 서버 처리율이 아니다(서버는 단계 안의 진행을 주지
 * 않는다). render 는 04/05 를 나누지 않는 한 구간이고 N4 처리 중 최대 99 다.
 */
const DISPLAY_CEILING_BY_N4_STAGE: Record<N4ObservedStage, number> = {
  inpaint: 19,
  translate: 39,
  verify: 59,
  render: 99,
};

/**
 * GIF 하단 caption — 서버 관측 단계마다 하나. render 는 04·05 중 하나를 고르지 않고 render 전체를
 * 설명하는 문구를 쓴다.
 * 9/23 재조정 — 흰색 description은 Figma처럼 한 줄이어야 한다(processing-stage-layout.tsx의
 * whitespace-nowrap 처리 참고). 뜻은 유지하되 분량만 Figma 수준으로 줄였다.
 */
const OVERLAY_CAPTION_BY_N4_STAGE: Record<N4ObservedStage, { title: string; description: string }> = {
  inpaint: { title: '원문 제거·배경 복원 중', description: '원문을 지우고 주변 배경을 자연스럽게 복원하고 있습니다.' },
  translate: { title: '번역·용어 맞춤 중', description: '번역문과 제품·브랜드 용어를 맞추고 있습니다.' },
  verify: { title: '규제 기준 확인 중', description: '번역문이 대상 국가의 규제 기준에 맞는지 확인합니다.' },
  render: { title: '번역 결과 이미지 적용 중', description: '번역문을 디자인에 맞게 조정하고 이미지에 반영합니다.' },
};

/** 여러 단계가 함께 running 일 때 — 하나의 단계만 지금 작업이라고 단정하지 않는다(Figma 에 없는 상태, 최소 보완). */
const N4_PARALLEL_CAPTION = { title: '여러 번역 작업을 함께 처리 중', description: '섹션별 번역·검증·이미지 적용을 함께 진행하고 있습니다.' };

/**
 * 실제 완료(currentStep=N5) 응답 뒤 완료 표시 동안의 문구 — Figma 에 별도 완료 상태가 없어 기존 슬롯(상태 태그·visual headline·
 * GIF caption·LOG·progress 안내) 안에서만 최소한으로 바꾼다. 완료 표시 동안 "진행중"·"…하고 있습니다"·
 * "완료되면 이동합니다"가 남아 100%·5행 완료와 서로 다른 말을 하지 않게 한다.
 */
const N4_COMPLETION_CAPTION = { title: '번역 완료', description: '검수 화면으로 이동합니다.' };
const N4_COMPLETION_COPY = {
  statusTag: '완료',
  headline: '번역 작업이 완료되었습니다.',
  visualDescription: '번역 결과를 반영해 검수 화면으로 이동합니다.',
  logHeading: '번역 완료',
  logDescription: '번역과 이미지 적용이 완료되었습니다.',
  progressHint: '검수 화면으로 이동합니다.',
};
const ALL_DONE: ProcessingStep['state'][] = ['done', 'done', 'done', 'done', 'done'];

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

/**
 * 이번 poll 의 5행 상태와, 화면에 진행 중으로 그린 단계(가장 앞 → 뒤 순서). 위 10/22 (3) 주석 참고.
 * activeStages 는 행·caption·표시 % 상한이 함께 쓰는 하나의 값이다.
 */
function resolveN4Presentation(
  stages: ApiJobTaskStatus['stages'],
  progress: number | undefined,
): { rows: ProcessingStep['state'][]; activeStages: N4ObservedStage[] } {
  const statusOf = (key: N4ObservedStage) => stages?.find((s) => s.key?.toLowerCase() === key)?.status;
  const observed = N4_OBSERVED_STAGE_ORDER.filter((key) => statusOf(key) !== undefined);
  const running = observed.filter((key) => statusOf(key) === 'running');

  if (observed.length >= 2 && running.length > 0) {
    const firstRunningIndex = N4_OBSERVED_STAGE_ORDER.indexOf(running[0]);
    const stateOf = (key: N4ObservedStage): ProcessingStep['state'] => {
      const status = statusOf(key);
      if (status === 'running') return 'active';
      // 서버가 done 이라고 명시한 앞 단계만 완료다. 응답에 없는 단계(undefined)·pending·failed 는 대기, 가장 앞
      // running 뒤의 done 은 완료가 아니다.
      if (status === 'done' && N4_OBSERVED_STAGE_ORDER.indexOf(key) < firstRunningIndex) return 'done';
      return 'pending';
    };
    const render = stateOf('render');
    return { rows: [stateOf('inpaint'), stateOf('translate'), stateOf('verify'), render, render], activeStages: running };
  }

  const stage = resolveN4ObservedStage(stages, progress);
  return { rows: FIVE_STEP_STATES_BY_N4_STAGE[stage], activeStages: [stage] };
}

function buildFiveSteps(states: ProcessingStep['state'][]): ProcessingStep[] {
  return FIVE_STEP_META.map((step, i) => ({ ...step, state: states[i] }));
}

export function N4ProcessingView({
  jobId,
  status,
  isCompleted = false,
}: {
  jobId: string;
  status: ApiJobTaskStatus;
  /**
   * 서버가 이미 N4 를 끝냈다(currentStep=N5 응답) — page.tsx 가 N5 로 넘어가기 직전 완료 표시를 하는
   * 동안만 true 로 넘긴다. 그때 status 는 그 N5 응답이다.
   */
  isCompleted?: boolean;
}) {
  // 행·caption·표시 % 상한은 이번 poll 의 서버 관측(진행 중으로 그린 단계)으로만 정한다. status.progress 는
  // stages 가 비어 있을 때의 coarse fallback 에만 쓴다 — 숫자는 hook 이 그 상한 안에서 따로 올린다.
  const { rows, activeStages } = resolveN4Presentation(status.stages, status.progress);
  const failedItems = (status.items ?? []).filter((i) => i.status === 'failed');
  const displayedProgress = useDisplayedProgress({
    persistKey: n4DisplayedProgressKey(jobId),
    ceiling: Math.max(...activeStages.map((stage) => DISPLAY_CEILING_BY_N4_STAGE[stage])),
    isFrozen: !isCompleted && hasProcessingFailure(status),
    isCompleted,
  });
  const steps = buildFiveSteps(isCompleted ? ALL_DONE : rows);
  const caption = isCompleted
    ? N4_COMPLETION_CAPTION
    : activeStages.length > 1
      ? N4_PARALLEL_CAPTION
      : OVERLAY_CAPTION_BY_N4_STAGE[activeStages[0]];

  return (
    <ProcessingStageLayout
      currentStep="N4"
      header={{
        title: '번역 중',
        description: '확정한 섹션을 번역하고 이미지에 적용하고 있습니다.',
      }}
      statusTagLabel={isCompleted ? N4_COMPLETION_COPY.statusTag : '진행중'}
      visual={{
        // N2/N4 공용 GIF — 별도 복사본을 만들지 않는다.
        src: '/process/ai-processing.gif',
        headline: isCompleted ? N4_COMPLETION_COPY.headline : N4_HEADLINE,
        description: isCompleted
          ? N4_COMPLETION_COPY.visualDescription
          : '확정한 섹션의 원문을 지우고 번역한 뒤, 원래 레이아웃에 맞게 다시 구성합니다.',
        overlayTopLabel: 'SOURCE  →  LOCALIZED',
        overlayBottomTitle: caption.title,
        overlayBottomDescription: caption.description,
      }}
      log={{
        sectionLabel: 'TRANSLATION LOG',
        heading: isCompleted ? N4_COMPLETION_COPY.logHeading : '지금 처리하는 일',
        description: isCompleted ? N4_COMPLETION_COPY.logDescription : '번역문을 원래 디자인 안에 다시 맞추고 있습니다.',
      }}
      steps={steps}
      progressPercent={displayedProgress}
      progressHint={isCompleted ? N4_COMPLETION_COPY.progressHint : N4_AUTO_ADVANCE_NOTICE}
      pauseButtonTitle={N4_PAUSE_BUTTON_TITLE}
      failedItems={failedItems}
    />
  );
}
