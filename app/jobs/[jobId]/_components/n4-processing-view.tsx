import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { ProcessingStageLayout, type ProcessingStep } from './processing/processing-stage-layout';

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
// - render(전반부)     → 04 글자 수, 줄바꿈 조정
// - render(후반부)     → 05 이미지 합성
//
// coarse stage가 4개인데 화면은 5단계라, render 하나를 04/05로 나눠야
// 한다(둘이 동시에 active면 안 된다 — Figma 예시는 04만 진행 중, 05는
// 대기다). API의 stages[]는 key/label/status만 있고 per-stage progress가
// 없다(lib/api/generated/openapi.d.ts JobTaskStatus 확인) — progress는
// JobTaskStatus 최상위 필드 하나뿐이라 job 전체 기준 global 값이다. 그래서
// render 내부를 04/05로 가르는 유일한 신호는 이 global progress뿐이고,
// "50%를 임의로 박는" 게 아니라 이미 아래 fallback에서 쓰는 것과 같은
// "coarse 4단계 동일 비중" 가정을 그대로 연장해 render의 global 구간
// [0.75, 1.0)의 중간값(0.875)을 04/05 경계로 쓴다.
//
// 지금 mock(lib/msw/handlers.ts N4_PROCESSING_STAGES/advanceN4Processing)은
// 실제 계약대로 inpaint→translate→verify→render 4단계를 순서대로 최소
// 한 번씩 running→done으로 보내도록 고쳤다(2단계 작업 참고) — render는
// 04/05를 모두 보여주기 위해 running을 두 번(progress 0.8 → 04, 0.9 →
// 05) 보낸다. stages가 완전히 비어 있거나 전혀 다른 key만 오는 경우(다른
// mock/실제 배포 전환기)를 대비해 progress 기반 fallback도 별도로 둔다.
//
// 9/23 — GIF 하단 caption을 5단계 각각의 고정 문구로 추가했다(N2와 같은
// 방식). N4는 presentation stage가 이미 5개 화면 항목 중 정확히 하나만
// active이므로(위 주석) 별도 재분할 없이 steps에서 active 하나를 그대로
// 찾아 caption에 쓴다 — progress%로 caption을 따로 추론하지 않는다.
// ─────────────────────────────────────────────────────────────────

const N4_HEADLINE = '번역과 배경 복원을 함께 진행하고 있습니다.';
const N4_AUTO_ADVANCE_NOTICE = '완료되면 검수 화면으로 자동 이동합니다.';
const N4_PAUSE_BUTTON_TITLE = '번역 중단 기능은 아직 제공되지 않습니다.';

// 9/23 재조정 — 흰색 description은 Figma처럼 한 줄이어야 한다(processing-
// stage-layout.tsx의 whitespace-nowrap 처리 참고). 이전 문구는 Figma 원본
// 분량보다 길어 실측상 줄바꿈이 났다 — 뜻은 유지하되 분량만 Figma 수준으로
// 줄였다(font-size를 줄이거나 컨테이너를 늘리는 방식으로 우회하지 않는다).
const FIVE_STEP_META: {
  no: string;
  label: string;
  /** GIF 하단 주황 title — 이 step이 active일 때만 보인다. */
  visualTitle: string;
  visualDescription: string;
}[] = [
  {
    no: '01',
    label: '한글 지우고 배경 채우기',
    visualTitle: '원문 제거·배경 복원 중',
    visualDescription: '원문을 지우고 주변 배경을 자연스럽게 복원하고 있습니다.',
  },
  {
    no: '02',
    label: '번역 · 용어 맞춤',
    visualTitle: '번역·용어 맞춤 중',
    visualDescription: '번역문과 제품·브랜드 용어를 맞추고 있습니다.',
  },
  {
    no: '03',
    label: '규제 기준 확인',
    visualTitle: '규제 기준 확인 중',
    visualDescription: '번역문이 대상 국가의 규제 기준에 맞는지 확인합니다.',
  },
  {
    no: '04',
    label: '글자 수, 줄바꿈 조정',
    visualTitle: '문장 길이·줄바꿈 조정 중',
    visualDescription: '번역문을 원래 디자인 안에 맞게 조정하고 있습니다.',
  },
  {
    no: '05',
    label: '이미지 합성',
    visualTitle: '최종 이미지 합성 중',
    visualDescription: '조정된 번역문을 원래 위치에 합성하고 있습니다.',
  },
];

// render를 04(전반부)/05(후반부)로 쪼갠 6개 presentation 상태. 5개 화면
// 항목 중 어느 시점에도 active는 정확히 하나뿐이다.
type N4PresentationStage = 'inpaint' | 'translate' | 'verify' | 'render_04' | 'render_05' | 'done';

const FIVE_STEP_STATES_BY_N4_PRESENTATION_STAGE: Record<N4PresentationStage, ProcessingStep['state'][]> = {
  inpaint: ['active', 'pending', 'pending', 'pending', 'pending'],
  translate: ['done', 'active', 'pending', 'pending', 'pending'],
  verify: ['done', 'done', 'active', 'pending', 'pending'],
  render_04: ['done', 'done', 'done', 'active', 'pending'],
  render_05: ['done', 'done', 'done', 'done', 'active'],
  done: ['done', 'done', 'done', 'done', 'done'],
};

/**
 * API 계약값이 아니다 — N4 global progress를 coarse 4단계가 동일 비중으로
 * 차지한다고 가정한 FE presentation heuristic이다(서버는 render 내부
 * substage를 별도로 주지 않는다).
 *
 * render coarse stage의 global progress 구간 [0.75, 1.0) 중간값 — "coarse
 * 4단계 동일 비중" 가정을 render 내부 04/05 분리에도 그대로 연장한 값이다
 * (아래 resolveN4PresentationProgressFallback의 0.75 경계 + 그 폭 0.25의
 * 절반). N2 값을 옮긴 게 아니라 이 파일 안에서 스스로 정합적인 값이다.
 */
const RENDER_SUBSTAGE_SPLIT = 0.875;

function resolveRenderSubstage(progress: number | undefined): 'render_04' | 'render_05' {
  return (progress ?? 0) >= RENDER_SUBSTAGE_SPLIT ? 'render_05' : 'render_04';
}

/**
 * 실제 inpaint/translate/verify/render stage가 하나도 없을 때만 쓰는
 * progress 기반 fallback. coarse 단계가 4개이므로 0~1 구간을 4등분한다
 * (N2는 3구간이라 0.3/0.7이라는 다른 임계값을 썼다 — 그 값을 그대로
 * 옮기면 근거 없는 복사가 된다. N4는 4구간이니 0.25 간격으로 균등
 * 분할하는 것이 가장 단순하고 방어 가능한 기준이다). 마지막 구간
 * (render)도 화면 5단계와 맞도록 RENDER_SUBSTAGE_SPLIT으로 다시 04/05를
 * 나눈다. 실제 BE stage가 하나라도 있으면 resolveN4PresentationStage가
 * 이 함수를 아예 호출하지 않는다 — 항상 실제 stage key가 우선이다.
 */
function resolveN4PresentationProgressFallback(progress: number | undefined): N4PresentationStage {
  const p = progress ?? 0;
  if (p >= 0.75) return resolveRenderSubstage(p);
  if (p >= 0.5) return 'verify';
  if (p >= 0.25) return 'translate';
  return 'inpaint';
}

function resolveN4PresentationStage(
  stages: ApiJobTaskStatus['stages'],
  progress: number | undefined,
): N4PresentationStage {
  const find = (key: string) => stages?.find((s) => s.key?.toLowerCase() === key);
  const inpaint = find('inpaint');
  const translate = find('translate');
  const verify = find('verify');
  const render = find('render');

  if (!inpaint && !translate && !verify && !render) {
    return resolveN4PresentationProgressFallback(progress);
  }

  if (render?.status === 'done') return 'done';
  // render가 진행 중이라는 것만으로는 04/05를 구분할 수 없다 — stages에
  // stage-local progress가 없으므로 global progress로 04/05를 가른다.
  if (render?.status === 'running') return resolveRenderSubstage(progress);
  if (verify?.status === 'running') return 'verify';
  if (translate?.status === 'running') return 'translate';
  if (inpaint?.status === 'running') return 'inpaint';
  // verify가 막 끝난 시점(render의 첫 poll이 아직 안 왔을 수 있음)도
  // 같은 이유로 progress로 04/05를 추정한다.
  if (verify?.status === 'done') return resolveRenderSubstage(progress);
  if (translate?.status === 'done') return 'verify';
  if (inpaint?.status === 'done') return 'translate';
  // 실제 stage는 있지만(예: 전부 pending) 아직 뭐가 진행 중인지 알 수
  // 없는 애매한 경우 — 모르는 진행을 완료로 부풀리지 않도록 보수적 기본값.
  return 'inpaint';
}

function buildFiveSteps(states: ProcessingStep['state'][]): ProcessingStep[] {
  return FIVE_STEP_META.map((step, i) => ({ no: step.no, label: step.label, state: states[i] }));
}

/**
 * GIF 하단 caption — steps(오른쪽 로그, 위에서 이미 계산한 바로 그 배열)에서
 * active인 항목을 그대로 찾아 쓴다. progress%를 다시 보고 추론하지 않는다.
 * active가 하나도 없으면(presentation stage 'done') "완료 중" 같은 문구를
 * 새로 만들지 않고 마지막 step(05)의 caption을 그대로 유지한다.
 *
 * 9/23 N2 재검토 후 명확히 남기는 주석 — N4는 "active 시각 항목이 항상
 * 정확히 하나"라는 전제가 이미 성립해서(위 FIVE_STEP_STATES_BY_N4_
 * PRESENTATION_STAGE 참고, render_04/render_05 어느 쪽이든 다른 하나는 항상
 * pending) 그 하나를 caption에 그대로 재사용할 수 있다. 이 전제 자체
 * (render를 04/05로 가르는 RENDER_SUBSTAGE_SPLIT=0.875 및 그 해석 로직)는
 * 이번 caption 작업 이전부터 있던 기존 FE presentation 규칙이며, 이번
 * 작업에서 threshold 값도 stage 해석 로직도 바꾸지 않았다 — caption은 그
 * 결과값(steps)을 읽기만 한다. backend가 render를 04/05 두 stage로
 * 나눠 주는 것이 아니라는 점도 그대로다(OpenAPI 계약엔 여전히 coarse
 * render 하나뿐). N2는 이 전제(단일 active) 자체가 성립하지 않아(같은
 * coarse stage에 시각 항목 2개가 동시 active) 이 함수와 같은 방식을 쓰지
 * 않고 coarse stage 값을 caption에 직접 매핑한다
 * (n2-analysis-view.tsx의 resolveOverlayCaption 참고, 서로 다른 접근이다).
 */
function resolveActiveVisualCaption(steps: ProcessingStep[]): { title: string; description: string } {
  const activeIndex = steps.findIndex((s) => s.state === 'active');
  const meta = FIVE_STEP_META[activeIndex >= 0 ? activeIndex : FIVE_STEP_META.length - 1];
  return { title: meta.visualTitle, description: meta.visualDescription };
}

export function N4ProcessingView({ status }: { status: ApiJobTaskStatus }) {
  // page.tsx가 넘기는 mock 표시 progressOverride는 N2 전용이라(5절 참고,
  // 이번 단계에서 N4로 확장하지 않는다) status.progress를 그대로 쓴다 —
  // stages가 비어 있을 때, 그리고 render 내부 04/05를 가를 때 이 값을 쓴다.
  const presentationStage = resolveN4PresentationStage(status.stages, status.progress);
  const steps = buildFiveSteps(FIVE_STEP_STATES_BY_N4_PRESENTATION_STAGE[presentationStage]);
  const caption = resolveActiveVisualCaption(steps);
  const progressPercent = Math.round((status.progress ?? 0) * 100);
  const failedItems = (status.items ?? []).filter((i) => i.status === 'failed');

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
      progressPercent={progressPercent}
      progressHint={N4_AUTO_ADVANCE_NOTICE}
      pauseButtonTitle={N4_PAUSE_BUTTON_TITLE}
      failedItems={failedItems}
    />
  );
}
