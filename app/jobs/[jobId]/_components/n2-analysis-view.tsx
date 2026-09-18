import Link from 'next/link';

import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { StepNav } from './step-nav';

// ─────────────────────────────────────────────────────────────────
// N2 — 분석중 (Figma node 660:4139 기준, 2026-09-18 재정합)
//
// 좌측 StepNav 레일 + 본문(좌: 분석 비주얼 · 우: ANALYSIS LOG) 2단 구조.
// page.tsx가 이 화면일 때는 공용 header bar를 숨기므로(N3/N5/N6와 동일
// 패턴) 여기서 헤더·나가기 버튼까지 전부 자체적으로 그린다.
//
// ANALYSIS LOG는 Figma가 항상 고정 5단계(01~05)를 보여준다 — 실제 백엔드는
// OpenAPI JobTaskStatus.stages 계약상 N2에 coarse 3단계(ocr→section→verify)만
// 준다. API를 5단계로 바꾸지 않고, 이 파일 안의 resolveCoarseStage/
// FIVE_STEP_STATES_BY_COARSE_STAGE 두 개로 3→5 presentation 매핑만 흡수한다
// (컴포넌트 JSX 안에는 조건문을 두지 않는다). 지금 mock은 아직 이 3단계를
// 개별 제공하지 않고 단일 'analyze' stage만 주므로, coarse stage를 식별할
// 수 없을 때는 실제로 모르는 진행을 완료로 부풀리지 않도록 가장 보수적인
// 값(OCR 진행 중)으로 취급한다.
// ─────────────────────────────────────────────────────────────────

const HEADLINE_FALLBACK = '상세페이지의 구조와 문맥을 읽고 있습니다.';
const AUTO_ADVANCE_NOTICE = '분석이 끝나면 섹션 확인 단계로 자동 이동합니다.';

type FiveStepState = 'done' | 'active' | 'pending';

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
const FIVE_STEP_STATES_BY_COARSE_STAGE: Record<'ocr' | 'section' | 'verify' | 'done', FiveStepState[]> = {
  ocr: ['active', 'pending', 'pending', 'pending', 'pending'],
  section: ['done', 'active', 'active', 'pending', 'pending'],
  verify: ['done', 'done', 'done', 'active', 'active'],
  done: ['done', 'done', 'done', 'done', 'done'],
};

function resolveCoarseStage(
  stages: ApiJobTaskStatus['stages'],
): keyof typeof FIVE_STEP_STATES_BY_COARSE_STAGE {
  const find = (key: string) => stages?.find((s) => s.key?.toLowerCase() === key);
  const ocr = find('ocr');
  const section = find('section');
  const verify = find('verify');

  if (verify?.status === 'done') return 'done';
  if (verify?.status === 'running') return 'verify';
  if (section?.status === 'running') return 'section';
  if (ocr?.status === 'running') return 'ocr';
  if (section?.status === 'done') return 'verify';
  if (ocr?.status === 'done') return 'section';
  return 'ocr';
}

function buildFiveSteps(states: FiveStepState[]) {
  return FIVE_STEP_META.map((step, i) => ({ ...step, state: states[i] }));
}

// previewStep=N2 전용 — Figma 660:4139가 실제로 보여주는 스냅샷과 동일하게
// 고정한다(01~03 완료 · 04 진행 중 · 05 대기 · 72%). mock task 진행이나
// 실제 API 데이터는 건드리지 않고, 이 화면의 표시값만 디자인 확인용으로
// 대체한다.
const PREVIEW_FIVE_STEP_STATES: FiveStepState[] = ['done', 'done', 'done', 'active', 'pending'];
const PREVIEW_PROGRESS_PERCENT = 72;

function ExitIcon() {
  // Figma(849:7235 "보관함으로 나가기") glyph는 7일 만료 원격 asset이라
  // 커밋 코드에 하드링크하지 않는다 — N1이 이미 같은 위치·크기의 아이콘을
  // 이 inline SVG로 재구현해 뒀으므로 그 패턴을 그대로 재사용한다.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="2.5" y="1.5" width="2.2" height="9" rx="0.8" fill="#171717" />
      <rect x="7.3" y="1.5" width="2.2" height="9" rx="0.8" fill="#171717" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// ANALYSIS LOG 한 행 — done/active/pending마다 dot·굵기·색·자간이 Figma에서
// 다르게 지정돼 있다(진행 중만 SemiBold+orange, 완료는 Regular+black 텍스트,
// 대기는 Regular/Light+회색에 dot도 채움 없는 outline). 번호+label은 Figma
// 원본처럼 두 칸 띄어 한 문자열로 쓴다(whitespace-pre로 공백을 보존해야
// 브라우저가 붕괴시키지 않는다).
// ─────────────────────────────────────────────────────────────────
function StageRow({ no, label, state }: { no: string; label: string; state: FiveStepState }) {
  const isDone = state === 'done';
  const isActive = state === 'active';

  const dotClass = isActive ? 'bg-[#ff6a38]' : isDone ? 'bg-[#171717]' : 'border border-[#eaeaea] bg-transparent';

  const titleClass = isActive
    ? "font-['Pretendard:SemiBold'] text-[14px] text-[#171717]"
    : `font-['Pretendard:Regular'] text-[14px] tracking-[-0.01em] ${isDone ? 'text-[#171717]' : 'text-[#999]'}`;

  const captionText = isDone ? '완료' : isActive ? '진행 중' : '대기';
  const captionClass = isActive
    ? "font-['Pretendard:Regular'] text-[12px] text-[#ff6a38]"
    : "font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]";

  // 68px(Figma 1920 기준)~51px(75%) 사이를 패널 자신의 렌더링 폭(cqw)에
  // 비례해 오간다 — 뷰포트가 아니라 패널 크기 기준이라 패널이 세로 제약
  //때문에 줄어들 때도 정확히 같은 비율로 따라온다. 텍스트 크기·줄간격은
  // 그대로 둔다(요청사항: "text line-height가 답답해지지 않게").
  return (
    <div className="flex h-[clamp(51px,4.219cqw,68px)] w-full items-center gap-3.5">
      <div className={`size-[10px] shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className={`whitespace-pre ${titleClass}`}>{`${no}  ${label}`}</p>
        <p className={captionClass}>{captionText}</p>
      </div>
    </div>
  );
}

export function N2AnalysisView({
  status,
  isPreview = false,
}: {
  status: ApiJobTaskStatus;
  /** previewStep=N2(page.tsx) 전용 — Figma 스냅샷과 동일한 고정 진행 상태로 보여준다. */
  isPreview?: boolean;
}) {
  const fiveSteps = isPreview
    ? buildFiveSteps(PREVIEW_FIVE_STEP_STATES)
    : buildFiveSteps(FIVE_STEP_STATES_BY_COARSE_STAGE[resolveCoarseStage(status.stages)]);
  const progressPercent = isPreview ? PREVIEW_PROGRESS_PERCENT : Math.round((status.progress ?? 0) * 100);
  const failedItems = (status.items ?? []).filter((i) => i.status === 'failed');

  return (
    <div className="flex h-full w-full bg-white">
      {/* 좌측 rail — N1과 같은 "보관함으로 나가기" 버튼 + StepNav 조합
          (Figma의 top:calc(50%+40px) 공식은 짧은 뷰포트에서 나가기 버튼과
          겹친다는 걸 N1에서 이미 확인했다 — 그 fix를 그대로 재사용한다). */}
      <div className="relative ml-9 h-full w-[44px] shrink-0">
        <Link
          href="/"
          aria-label="보관함으로 나가기"
          className="absolute top-10 left-1/2 z-20 flex size-10 -translate-x-1/2 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
        >
          <ExitIcon />
        </Link>
        <div className="absolute inset-0 pt-[100px] pb-6">
          <StepNav currentStep="N2" />
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 헤더 — Figma(660:4168 "N1 / Header") 그대로 고정값이다. 이전에
            여기 padding까지 반응형 clamp를 걸었던 걸 되돌린다 — 요청 대상은
            이 헤더가 아니라 아래 회색 패널 안의 title/description이었다.
            노트북이라고 이 헤더 위치·간격을 임의로 좁히지 않는다. */}
        <div className="shrink-0 px-10 pt-10 pb-6">
          <div className="flex items-center gap-4">
            <h1 className="font-['Pretendard:SemiBold'] text-[20px] tracking-[-0.02em] text-[#171717]">이미지 분석</h1>
            <p className="font-['Pretendard:Regular'] text-[14px] tracking-[-0.01em] text-[#707070]">
              등록한 이미지의 텍스트와 구조를 분석하고 있습니다.
            </p>
          </div>
        </div>

        {/* 본문 — 패널에 aspect-ratio를 강제하지 않는다. 1740×892는 1920
            viewport에서 "이 gutter들로 남는 공간을 채운 결과값"이지, 모든
            viewport에서 지켜야 할 이미지 비율이 아니다(실측 확인: 이전에
            aspect-ratio + max-height로 강제했더니 세로가 짧은 노트북에서
            높이가 병목이 되어 폭까지 같이 줄어들고, 결과적으로 Figma보다
            훨씬 좁은 패널이 화면 가운데 떠버렸다).

            대신 StepNav 오른쪽 workspace 안에서 gutter만 두고, 패널은 그
            gutter 안 남는 공간을 가로·세로 모두 그대로 채운다
            (`w-full h-full`) — `items-center`/`justify-center`로 가운데
            띄우지 않는다.

            중요: 목표는 "gutter 몇 px"가 아니라 panel의 절대 bbox가
            Figma 비율(x=6.25vw, y=10vh, right=3.125vw)에 수렴하는 것이다.
            - 좌측 gutter(pl)는 StepNav rail(고정 80px)을 지나고 나서
              추가로 더해지는 값이므로, 순수 `vw` 비율로는 rail 몫이
              이중으로 더해져 1440/1536처럼 좁은 화면에서 패널이 필요
              이상으로 안쪽에 처박힌다(실측: 1440에서 x=110, 목표는 90).
              그래서 `calc(6.25vw - 80px)`로 rail 몫을 먼저 상쇄한다 —
              1920에서 40px(=120-80)로 정확히 Figma와 같아지고, 1440에서는
              10px(=90-80)까지 자연스럽게 줄어든다.
            - 상단 gutter(pt)도 같은 이유로 `calc(10vh - 94px)`을 쓴다.
              94px는 헤더 블록의 실제 렌더링 높이(px-10/pt-10/pb-6 고정,
              실측 confirmed)다 — 헤더를 건드리지 않는 한 이 상수는
              바뀌지 않는다. 1920에서 14px(=108-94)로 Figma의 절대 y=108과
              정확히 맞고, viewport가 짧아 10vh가 94px보다 작아지는
              900/864급에서는 0으로 clamp돼(더 뺄 여백이 없다) panel_y가
              94px에 수렴한다 — Figma 비율(90/86)보다 4~8px 낮을 뿐이며,
              헤더 자체를 줄이지 않는 한 이게 가능한 최솟값이다.
            - 우측 gutter(pr)는 rail 같은 상쇄 대상이 없어 순수 비율
              (3.125vw)만으로 이미 1920/1536/1440 목표(60/48/45)에 그대로
              들어맞는다(요청에서도 "right는 맞다"고 확인됨).
            - 하단 gutter(pb)는 Figma 자신도 세로 비율(80/1080≈7.41%)로
              정의돼 있어 `vw`가 아니라 `vh`로 고친다(이전 버전은 실수로
              `vw`를 썼다 — 세로 간격인데 가로 폭에 반응하는 버그였다). */}
        <div className="min-h-0 flex-1 pt-[clamp(0px,calc(10vh_-_94px),14px)] pr-[clamp(45px,3.125vw,60px)] pb-[clamp(60px,7.41vh,80px)] pl-[clamp(0px,calc(6.25vw_-_80px),40px)]">
          {/* 패널 내부 padding/gap은 vw 기준을 그대로 쓴다(패널 자신이
              [container-type:inline-size]로 자식들의 cqw 기준점이 되는
              동시에, cq 단위는 스펙상 컨테이너 자기 자신의 padding/width에는
              쓸 수 없다 — self-reference라 조용히 상위 컨테이너를 참조하며
              값이 어긋난다는 걸 실측으로 확인했다). 안쪽 자식들(좌측 컬럼
              내부 간격, 우측 컬럼 폭·간격, 5단계 row 높이, progress 간격)은
              전부 cqw로 패널 자신의 실제 렌더링 폭에 정확히 비례한다 — 그
              값들은 아래에서 개별적으로 처리한다. */}
          <div className="relative flex h-full min-h-0 min-w-0 w-full [container-type:inline-size] gap-[clamp(60px,4.17vw,80px)] overflow-y-auto rounded-[8px] bg-[#f5f5f5] pt-[clamp(43.5px,3.02vw,58px)] pr-[clamp(45px,3.13vw,60px)] pb-[clamp(43.5px,3.02vw,58px)] pl-[clamp(51px,3.54vw,68px)]">
            {/* 좌측 — 분석 비주얼. cqw 기준값은 패널의 content-box 폭
                (border-box 1740 − pl68 − pr60 = 1612, 1920 기준)이다 —
                container query 단위는 컨테이너 자신의 padding을 제외한
                content-box만 기준으로 삼는다(실측으로 확인). 그래서
                계수는 "Figma값 / 16.12"다. */}
            <div className="flex min-w-0 flex-1 flex-col gap-[clamp(40.5px,3.350cqw,54px)]">
              <div className="flex max-w-[820px] flex-col gap-[clamp(15px,1.241cqw,20px)]">
                <div className="flex h-[26px] w-fit items-center justify-center rounded-[6px] bg-[#f5f5f5] px-2">
                  <p className="font-['Pretendard:Regular'] text-[12px] leading-[14px] text-[#171717]">진행중</p>
                </div>
                <div className="flex flex-col gap-[clamp(9px,0.744cqw,12px)]">
                  <p className="font-['Pretendard:SemiBold'] text-[28px] tracking-[-0.015em] text-[#171717]">
                    {HEADLINE_FALLBACK}
                  </p>
                  <p className="font-['Pretendard:Regular'] text-[14px] tracking-[-0.01em] text-[#999]">
                    텍스트만 추출하지 않고, 번역에 필요한 섹션과 판단 근거를 함께 정리합니다.
                  </p>
                </div>
              </div>

              {/* 공용 GIF — N2/N4가 같은 자산을 쓴다(별도 복사본 금지).
                  고정 h-[520px] 대신 Figma visual frame 비율(1044:520)을
                  aspect-ratio로 고정한다 — 좌측 컬럼 폭이 뷰포트에 따라
                  줄어들면 높이도 같은 비율로 자연스럽게 따라 줄어든다.
                  1920에서는 폭이 1044px에 수렴하므로 결과 높이도 520px과
                  거의 같다. object-cover는 그대로 유지해 crop을 허용한다. */}
              <div className="relative aspect-[1044/520] w-full shrink-0 overflow-hidden rounded-[8px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- 애니메이션 보존을 위해 next/image 최적화 대상에서 제외(GIF) */}
                <img
                  src="/process/ai-processing.gif"
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 size-full object-cover opacity-[0.97]"
                />
                <p className="absolute top-7 left-6 whitespace-pre font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-white/[58%]">
                  {`SCAN  ·  STRUCTURE  ·  CONTEXT`}
                </p>
                <div className="absolute right-6 bottom-6 flex max-w-[360px] flex-col items-end gap-2 text-right">
                  <p className="font-['Pretendard:Medium'] text-[13px] text-[#ff6a38]">제품 라벨 자동 제외</p>
                  <p className="font-['Pretendard:Regular'] text-[12px] text-white/[58%]">
                    제품 라벨로 인식된 영역은 번역 대상에서 자동으로 제외합니다.
                  </p>
                </div>
              </div>
            </div>

            {/* 구분선 */}
            <div className="w-px shrink-0 self-stretch bg-[#eaeaea]" />

            {/* 우측 — ANALYSIS LOG. 폭을 별도 vw 바닥값(340px)으로 고정하지
                않는다 — 패널 자체가 이제 Figma 비율(1740:892)로 크기가
                정해지므로, 우측 컬럼도 그 패널 폭의 정확히 같은 비율
                (403/1740 ≈ 23.16%)만 그대로 따라가면 된다("403→340 숫자를
                유지할 필요 없다, Figma처럼 보이는 게 우선" 요구사항).
                패널이 비정상적으로 좁아지는 경우에 대한 안전장치로만
                min-width 300px을 둔다. */}
            <div className="flex w-[max(300px,25cqw)] shrink-0 flex-col gap-[clamp(39px,3.226cqw,52px)]">
              <div className="flex max-w-[370px] flex-col gap-[clamp(18px,1.489cqw,24px)]">
                <p className="font-['Pretendard:Regular'] text-[12px] tracking-[-0.02em] text-[#999]">ANALYSIS LOG</p>
                <div className="flex flex-col gap-[clamp(9px,0.744cqw,12px)]">
                  <h2 className="font-['Pretendard:SemiBold'] text-[20px] tracking-[-0.02em] text-[#171717]">
                    지금 처리하는 일
                  </h2>
                  <p className="font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]">
                    완료된 항목은 분리하고, 현재 판단만 선명하게 정리 중 입니다.
                  </p>
                </div>
              </div>

              {/* 항상 고정 5단계를 그린다(Figma 661:4301 "N2 / Step List") —
                  데이터 개수만큼 map하지 않는다. 이 목록 높이가 늘/줄면
                  아래 진행률 블록이 패널 위아래로 밀리므로, 개수를 고정해야
                  진행률이 항상 같은 위치(패널 하단부)에 남는다. */}
              <div className="flex flex-col">
                {fiveSteps.map((step) => <StageRow key={step.no} no={step.no} label={step.label} state={step.state} />)}
              </div>

              {/* progress 내부 3개 관계(72%↔전체 분석 / 전체 분석↔bar /
                  bar↔안내문)는 Figma 원본에서 서로 다른 간격이다(node
                  663:4332 grid의 margin-top 0/120/147으로 역산: 6px /
                  38px / 24px). 하나의 공유 gap으로 뭉치지 않고 각 관계를
                  독립된 clamp로 둔다 — 1920에서는 위 세 값 그대로이고,
                  1440에서는 각각 75%까지 줄어든다. */}
              <div className="flex flex-col">
                <div className="flex flex-col gap-[clamp(4.5px,0.372cqw,6px)]">
                  {/* 퍼센트 숫자와 일시정지 버튼이 Figma에서 같은 줄에
                      놓여 있어(663:4332 + 918:7324) 같은 flex row로 묶는다 —
                      버튼을 별도 absolute 좌표로 흉내내지 않는다. */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline">
                      <span className="font-['Pretendard:SemiBold'] text-[58px] leading-[64px] text-[#171717]">
                        {progressPercent}
                      </span>
                      <span className="font-['Pretendard:Medium'] text-[18px] tracking-[-0.03em] text-[#999]">%</span>
                    </div>

                    {/* Figma(918:7324)의 일시정지 아이콘 — 분석 중단 API가
                        계약에 없어(오늘 범위 밖) 클릭해도 아무 일도 하지
                        않는 버튼을 만들지 않는다. N1의 "이미지 연속 여부"
                        토글과 같은 방식(보여주되 비활성 + 이유 설명)으로
                        최소 보완한다. */}
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      title="분석 중단 기능은 아직 제공되지 않습니다."
                      className="flex size-7 shrink-0 cursor-not-allowed items-center justify-center rounded-[4px] border border-[#eaeaea] bg-white opacity-60"
                    >
                      <PauseIcon />
                    </button>
                  </div>
                  <p className="font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]">전체 분석</p>
                </div>

                {/* 396px은 Figma 1920 실측값을 max-width로만 쓴다 — 우측
                    panel 폭이 줄어들면 bar도 100%까지 자연스럽게 좁아진다
                    (요청사항: "396px은 max-width로 사용"). 위쪽 간격(전체
                    분석 ↔ bar)은 Figma에서 세 관계 중 가장 크다(38px). */}
                <div
                  className="mt-[clamp(28.5px,2.357cqw,38px)] h-[3px] w-full max-w-[396px] overflow-hidden rounded-full bg-[rgba(112,112,112,0.16)]"
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-[#ff6a38] transition-[width] duration-500 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <p className="mt-[clamp(18px,1.489cqw,24px)] font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]">
                  {AUTO_ADVANCE_NOTICE}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 부분 실패 안내 — Figma엔 없는 상태다. 서버가 실패 task를 보고하면
            숨기지 않고 기존 배너 패턴(N4ProcessingView와 동일)으로 알린다. */}
        {failedItems.length > 0 && (
          <div className="shrink-0 px-10 pb-6">
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <p className="mb-2 text-sm font-medium text-orange-700">일부 항목을 처리하지 못했습니다</p>
              <ul className="space-y-1">
                {failedItems.map((item) => (
                  <li key={item.taskId} className="text-xs text-orange-600">
                    {item.unitType} #{item.unitId} — {item.errorCode ?? '알 수 없는 오류'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
