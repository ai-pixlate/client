import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { ProcessingStageLayout, type ProcessingStep } from './processing/processing-stage-layout';

// ─────────────────────────────────────────────────────────────────
// N2 — 분석중 (Figma node 660:4139 기준, 2026-09-18 재정합)
//
// 레이아웃(rail/헤더/회색 패널/비주얼/로그/progress) 자체는 N4와 완전히
// 동일해(Figma가 N4의 5단계 목록 컴포넌트를 "N2 / Step List"로 그대로
// 재사용할 정도) ./processing/processing-stage-layout.tsx로 뺐다. 이
// 파일에는 N2 고유의 것만 남는다:
// - copy(헤더/헤드라인/로그/5단계 라벨/안내문 텍스트)
// - N2의 backend stage(ocr/section/verify) → 5단계 상태 해석
// - mock 전용 progressOverride/dwell 처리(page.tsx가 계산해 내려줌)
//
// ANALYSIS LOG는 Figma가 항상 고정 5단계(01~05)를 보여준다 — 실제 백엔드는
// OpenAPI JobTaskStatus.stages 계약상 N2에 coarse 3단계(ocr→section→verify)만
// 준다. API를 5단계로 바꾸지 않고, 이 파일 안의 resolveCoarseStage/
// FIVE_STEP_STATES_BY_COARSE_STAGE 두 개로 3→5 presentation 매핑만 흡수한다
// (컴포넌트 JSX 안에는 조건문을 두지 않는다). 지금 mock은 아직 이 3단계를
// 개별 제공하지 않고 단일 'analyze' stage만 주므로, 실제 ocr/section/verify
// key가 하나도 없을 때만 page.tsx가 넘겨주는 mock 표시 progress(0~1)로
// coarse stage를 추정한다(resolvePresentationProgressFallback) — 실제 BE
// stage가 하나라도 있으면 이 fallback은 아예 쓰이지 않고 항상 실제 stage가
// 우선한다.
//
// 이 해석 로직은 N4와 절대 공유하지 않는다 — N4는 backend stage 어휘 자체가
// 다르다(inpaint/translate/verify/render, n4-processing-view.tsx 참고).
// ─────────────────────────────────────────────────────────────────

const HEADLINE_FALLBACK = '상세페이지의 구조와 문맥을 읽고 있습니다.';
const AUTO_ADVANCE_NOTICE = '분석이 끝나면 섹션 확인 단계로 자동 이동합니다.';
const PAUSE_BUTTON_TITLE = '분석 중단 기능은 아직 제공되지 않습니다.';

const FIVE_STEP_META: { no: string; label: string }[] = [
  { no: '01', label: '전체 텍스트 인식' },
  { no: '02', label: '콘텐츠 영역 나누기' },
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

// progressOverride(mock 전용 표시 progress, 0~1)가 있고 실제 ocr/section/
// verify stage가 하나도 없을 때만 쓰는 fallback. 실제 BE 데이터가 존재하면
// resolveCoarseStage가 이 함수를 아예 호출하지 않는다 — 항상 실제 stage가
// 최우선이다.
function resolvePresentationProgressFallback(progress: number | undefined): 'ocr' | 'section' | 'verify' {
  const p = progress ?? 0;
  if (p >= 0.7) return 'verify';
  if (p >= 0.3) return 'section';
  return 'ocr';
}

function resolveCoarseStage(
  stages: ApiJobTaskStatus['stages'],
  presentationProgress?: number,
): keyof typeof FIVE_STEP_STATES_BY_COARSE_STAGE {
  const find = (key: string) => stages?.find((s) => s.key?.toLowerCase() === key);
  const ocr = find('ocr');
  const section = find('section');
  const verify = find('verify');

  if (!ocr && !section && !verify) {
    return resolvePresentationProgressFallback(presentationProgress);
  }

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

export function N2AnalysisView({
  status,
  progressOverride,
}: {
  status: ApiJobTaskStatus;
  /**
   * mock 환경에서 N2 최소 체류(7초)와 진행률을 맞추기 위해 page.tsx가
   * 계산해 넘기는 표시 전용 값(0~1). 실서버/mock 비활성에서는 항상
   * undefined이며, 그 경우 아래에서 그대로 status.progress를 쓴다 —
   * status 자체는 여기서도 변형하지 않는다.
   */
  progressOverride?: number;
}) {
  const steps = buildFiveSteps(FIVE_STEP_STATES_BY_COARSE_STAGE[resolveCoarseStage(status.stages, progressOverride)]);
  const progressPercent = Math.round((progressOverride ?? status.progress ?? 0) * 100);
  const failedItems = (status.items ?? []).filter((i) => i.status === 'failed');

  return (
    <ProcessingStageLayout
      currentStep="N2"
      header={{
        title: '이미지 분석',
        description: '등록한 이미지의 텍스트와 구조를 분석하고 있습니다.',
      }}
      statusTagLabel="진행중"
      visual={{
        // 공용 GIF — N2/N4가 같은 자산을 쓴다(별도 복사본 금지).
        src: '/process/ai-processing.gif',
        headline: HEADLINE_FALLBACK,
        description: '텍스트만 추출하지 않고, 번역에 필요한 섹션과 판단 근거를 함께 정리합니다.',
        overlayTopLabel: 'SCAN  ·  STRUCTURE  ·  CONTEXT',
        overlayBottomTitle: '제품 라벨 자동 제외',
        overlayBottomDescription: '제품 라벨로 인식된 영역은 번역 대상에서 자동으로 제외합니다.',
      }}
      log={{
        sectionLabel: 'ANALYSIS LOG',
        heading: '지금 처리하는 일',
        description: '완료된 항목은 분리하고, 현재 판단만 선명하게 정리 중 입니다.',
      }}
      steps={steps}
      progressPercent={progressPercent}
      progressHint={AUTO_ADVANCE_NOTICE}
      pauseButtonTitle={PAUSE_BUTTON_TITLE}
      failedItems={failedItems}
    />
  );
}
