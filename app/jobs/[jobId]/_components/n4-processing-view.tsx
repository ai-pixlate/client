import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { toServerPercent, type ProgressBand } from '@/lib/processing/displayed-progress';
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
// - N4 전체 완료는 서버 currentStep=N5 뿐이다(page.tsx 가 N5 화면으로 전환). render=done·
//   progress=1 은 지금 생성된 render 시도들의 집계일 뿐이라 N4 안에서 '완료'·100% 를 만들지
//   않는다. N4 완료 dwell 도 없다.
// - 표시 숫자(displayedProgress)는 useDisplayedProgress 가 뒤로 가지 않게 유지한다. 구간은 UX
//   전용(01 0~19 · 02 20~39 · 03 40~59 · render 60~99)이고 N4 동안 최대 99 다. 숫자 유지용
//   단계 tracker 는 hook 안에만 있고 행·caption 에 다시 쓰지 않는다. status.progress 는 바꾸지
//   않는다 — lib/processing/displayed-progress.ts 참고.
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

// render 는 04·05 두 행이 함께 설명한다(둘 다 진행 중). N4 안에서 5행 전부 완료는 없다.
const FIVE_STEP_STATES_BY_N4_STAGE: Record<N4ObservedStage, ProcessingStep['state'][]> = {
  inpaint: ['active', 'pending', 'pending', 'pending', 'pending'],
  translate: ['done', 'active', 'pending', 'pending', 'pending'],
  verify: ['done', 'done', 'active', 'pending', 'pending'],
  render: ['done', 'done', 'done', 'active', 'active'],
};

/**
 * 서버 관측 단계 → 표시 progress 구간. UX 표시 전용 값이며 서버 처리율이 아니다(서버는 단계 안의
 * 진행을 주지 않는다). 진행 중 구간의 ceiling 은 다음 구간 floor - 1 이고, render 는 04/05 를
 * 나누지 않는 한 구간이며 N4 동안 100 이 되지 않도록 99 에서 멈춘다.
 */
const DISPLAY_BAND_BY_N4_STAGE: Record<N4ObservedStage, ProgressBand> = {
  inpaint: { floor: 0, ceiling: 19 },
  translate: { floor: 20, ceiling: 39 },
  verify: { floor: 40, ceiling: 59 },
  render: { floor: 60, ceiling: 99 },
};
/** 한 구간을 floor → ceiling까지 시간 기반으로 채우는 시간(UX 값, 서버 처리 시간 아님) */
const N4_STAGE_DISPLAY_FILL_MS = 90_000;

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

function buildFiveSteps(states: ProcessingStep['state'][]): ProcessingStep[] {
  return FIVE_STEP_META.map((step, i) => ({ ...step, state: states[i] }));
}

export function N4ProcessingView({ jobId, status }: { jobId: string; status: ApiJobTaskStatus }) {
  // page.tsx가 넘기는 mock 표시 progressOverride는 N2 전용이라 status.progress를 그대로 쓴다 —
  // stages가 비어 있을 때의 coarse fallback 과 표시 숫자 하한에만 쓴다.
  // 행·caption 은 이번 poll 의 서버 관측 단계로만 그린다. 숫자만 hook 이 뒤로 가지 않게 유지한다.
  const observedStage = resolveN4ObservedStage(status.stages, status.progress);
  const failedItems = (status.items ?? []).filter((i) => i.status === 'failed');
  const { displayedProgress } = useDisplayedProgress({
    // v2 — 이전 표시 정책(render=done → 100)이 남긴 maxShown=100 을 복구하지 않도록 키를 바꿨다.
    persistKey: `n4:v2:${jobId}`,
    serverStage: observedStage,
    stageOrder: N4_OBSERVED_STAGE_ORDER,
    bandOf: (stage) => DISPLAY_BAND_BY_N4_STAGE[stage],
    activeDurationOf: () => N4_STAGE_DISPLAY_FILL_MS,
    serverPercent: toServerPercent(status.progress),
    isFrozen: hasProcessingFailure(status),
  });
  const steps = buildFiveSteps(FIVE_STEP_STATES_BY_N4_STAGE[observedStage]);
  const caption = OVERLAY_CAPTION_BY_N4_STAGE[observedStage];

  return (
    <ProcessingStageLayout
      currentStep="N4"
      header={{
        title: '번역 중',
        description: '확정한 섹션을 번역하고 이미지에 적용하고 있습니다.',
      }}
      statusTagLabel="진행중"
      visual={{
        // N2/N4 공용 GIF — 별도 복사본을 만들지 않는다.
        src: '/process/ai-processing.gif',
        headline: N4_HEADLINE,
        description: '확정한 섹션의 원문을 지우고 번역한 뒤, 원래 레이아웃에 맞게 다시 구성합니다.',
        overlayTopLabel: 'SOURCE  →  LOCALIZED',
        overlayBottomTitle: caption.title,
        overlayBottomDescription: caption.description,
      }}
      log={{
        sectionLabel: 'TRANSLATION LOG',
        heading: '지금 처리하는 일',
        description: '번역문을 원래 디자인 안에 다시 맞추고 있습니다.',
      }}
      steps={steps}
      progressPercent={displayedProgress}
      progressHint={N4_AUTO_ADVANCE_NOTICE}
      pauseButtonTitle={N4_PAUSE_BUTTON_TITLE}
      failedItems={failedItems}
    />
  );
}
