import Link from 'next/link';

import { StepNav, type StepNavStep } from '../step-nav';

// ─────────────────────────────────────────────────────────────────
// N2/N4 공용 processing 화면 레이아웃 (Figma 660:4139 "N2 / 분석중" ·
// 660:4221 "N4 번역중"). 두 화면은 node 단위로 구조가 동일하다(Figma가
// N4의 5단계 목록 컴포넌트 이름 자체를 "N2 / Step List"로 재사용하고
// 있을 정도) — 다른 건 copy(header/headline/log 텍스트/5단계 라벨)와
// progress 상태뿐이다.
//
// 이 컴포넌트는 순수 presentation이다 — backend stage(ocr/section/verify,
// inpaint/translate/verify/render)를 5단계 상태로 해석하는 로직은 여기
// 없다. 그 해석은 N2AnalysisView/N4TranslationView 각자의 wrapper가
// 맡고, 이미 계산된 `steps`/`progressPercent`만 props로 받는다 — 두
// 화면의 backend stage 어휘가 서로 다르므로(N2: ocr→section→verify,
// N4: inpaint→translate→verify→render) 해석 로직을 공유하면 오히려
// 어느 한쪽에 맞지 않는 값이 새어 들어갈 위험이 있다.
// ─────────────────────────────────────────────────────────────────

export type ProcessingStepState = 'done' | 'active' | 'pending';

export interface ProcessingStep {
  no: string;
  label: string;
  state: ProcessingStepState;
}

export interface ProcessingFailedItem {
  taskId?: number;
  unitType?: string;
  unitId?: number | null;
  errorCode?: string | null;
}

export interface ProcessingStageLayoutProps {
  /** 좌측 StepNav의 현재 단계 — N1~N6 공용 StepNav를 그대로 쓴다. */
  currentStep: StepNavStep;
  header: {
    title: string;
    description: string;
  };
  /** 패널 좌상단 "진행중" 같은 상태 태그 문구. */
  statusTagLabel: string;
  visual: {
    /** N2/N4가 같은 GIF 자산(`/process/ai-processing.gif`)을 쓴다 — 별도 복사본을 만들지 않는다. */
    src: string;
    headline: string;
    description: string;
    overlayTopLabel: string;
    overlayBottomTitle: string;
    overlayBottomDescription: string;
  };
  log: {
    sectionLabel: string;
    heading: string;
    description: string;
  };
  /** 항상 고정 5개를 그린다 — 개수가 늘/줄면 진행률 블록이 패널 안에서 밀린다. */
  steps: ProcessingStep[];
  progressPercent: number;
  progressHint: string;
  /** 일시정지 버튼은 비활성 상태로만 존재한다(중단 API가 계약에 없음) — 이유 설명 문구. */
  pauseButtonTitle: string;
  failedItems: ProcessingFailedItem[];
}

function ExitIcon() {
  // Figma("보관함으로 나가기") glyph는 7일 만료 원격 asset이라 커밋
  // 코드에 하드링크하지 않는다 — N1/N2가 이미 같은 위치·크기의 아이콘을
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
// 로그 한 행 — done/active/pending마다 dot·굵기·색·자간이 Figma에서
// 다르게 지정돼 있다(진행 중만 SemiBold+orange, 완료는 Regular+black,
// 대기는 Regular/Light+회색에 dot도 채움 없는 outline). 번호+label은
// Figma 원본처럼 두 칸 띄어 한 문자열로 쓴다(whitespace-pre로 공백을
// 보존해야 브라우저가 붕괴시키지 않는다).
// ─────────────────────────────────────────────────────────────────
function StageRow({ no, label, state }: ProcessingStep) {
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
  // 비례해 오간다 — 뷰포트가 아니라 패널 크기 기준이라 패널이 세로
  // 제약 때문에 줄어들 때도 정확히 같은 비율로 따라온다.
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

export function ProcessingStageLayout({
  currentStep,
  header,
  statusTagLabel,
  visual,
  log,
  steps,
  progressPercent,
  progressHint,
  pauseButtonTitle,
  failedItems,
}: ProcessingStageLayoutProps) {
  return (
    <div className="flex h-full w-full bg-white">
      {/* 좌측 rail — 나가기 버튼 + StepNav (N1과 같은 패턴 재사용). */}
      <div className="relative ml-9 h-full w-[44px] shrink-0">
        <Link
          href="/"
          aria-label="보관함으로 나가기"
          className="absolute top-10 left-1/2 z-20 flex size-10 -translate-x-1/2 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
        >
          <ExitIcon />
        </Link>
        <div className="absolute inset-0 pt-[100px] pb-6">
          <StepNav currentStep={currentStep} />
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 헤더 — Figma("N1 / Header") 그대로 고정값이다. */}
        <div className="shrink-0 px-10 pt-10 pb-6">
          <div className="flex items-center gap-4">
            <h1 className="font-['Pretendard:SemiBold'] text-[20px] tracking-[-0.02em] text-[#171717]">
              {header.title}
            </h1>
            <p className="font-['Pretendard:Regular'] text-[14px] tracking-[-0.01em] text-[#707070]">
              {header.description}
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
              들어맞는다.
            - 하단 gutter(pb)는 Figma 자신도 세로 비율(80/1080≈7.41%)로
              정의돼 있어 `vh`를 쓴다(가로 폭에 반응하면 안 되는 세로
              간격이다). */}
        <div className="min-h-0 flex-1 pt-[clamp(0px,calc(10vh_-_94px),14px)] pr-[clamp(45px,3.125vw,60px)] pb-[clamp(60px,7.41vh,80px)] pl-[clamp(0px,calc(6.25vw_-_80px),40px)]">
          {/* 패널 내부 padding/gap은 vw 기준을 그대로 쓴다(패널 자신이
              [container-type:inline-size]로 자식들의 cqw 기준점이 되는
              동시에, cq 단위는 스펙상 컨테이너 자기 자신의 padding/width에는
              쓸 수 없다 — self-reference라 조용히 상위 컨테이너를 참조하며
              값이 어긋난다). 안쪽 자식들(좌측 컬럼 내부 간격, 우측 컬럼
              폭·간격, 5단계 row 높이, progress 간격)은 전부 cqw로 패널
              자신의 실제 렌더링 폭에 정확히 비례한다. */}
          <div className="relative flex h-full min-h-0 min-w-0 w-full [container-type:inline-size] gap-[clamp(60px,4.17vw,80px)] overflow-y-auto rounded-[8px] bg-[#f5f5f5] pt-[clamp(43.5px,3.02vw,58px)] pr-[clamp(45px,3.13vw,60px)] pb-[clamp(43.5px,3.02vw,58px)] pl-[clamp(51px,3.54vw,68px)]">
            {/* 좌측 — 진행 비주얼. cqw 기준값은 패널의 content-box 폭
                (border-box 1740 − pl68 − pr60 = 1612, 1920 기준)이다 —
                container query 단위는 컨테이너 자신의 padding을 제외한
                content-box만 기준으로 삼는다. 그래서 계수는
                "Figma값 / 16.12"다. */}
            <div className="flex min-w-0 flex-1 flex-col gap-[clamp(40.5px,3.350cqw,54px)]">
              <div className="flex max-w-[820px] flex-col gap-[clamp(15px,1.241cqw,20px)]">
                <div className="flex h-[26px] w-fit items-center justify-center rounded-[6px] bg-[#f5f5f5] px-2">
                  <p className="font-['Pretendard:Regular'] text-[12px] leading-[14px] text-[#171717]">
                    {statusTagLabel}
                  </p>
                </div>
                <div className="flex flex-col gap-[clamp(9px,0.744cqw,12px)]">
                  <p className="font-['Pretendard:SemiBold'] text-[28px] tracking-[-0.015em] text-[#171717]">
                    {visual.headline}
                  </p>
                  <p className="font-['Pretendard:Regular'] text-[14px] tracking-[-0.01em] text-[#999]">
                    {visual.description}
                  </p>
                </div>
              </div>

              {/* 고정 h-[520px] 대신 Figma visual frame 비율(1044:520)을
                  aspect-ratio로 고정한다 — 좌측 컬럼 폭이 뷰포트에 따라
                  줄어들면 높이도 같은 비율로 자연스럽게 따라 줄어든다.
                  object-cover는 그대로 유지해 crop을 허용한다. */}
              <div className="relative aspect-[1044/520] w-full shrink-0 overflow-hidden rounded-[8px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- 애니메이션 보존을 위해 next/image 최적화 대상에서 제외(GIF) */}
                <img
                  src={visual.src}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 size-full object-cover opacity-[0.97]"
                />
                <p className="absolute top-7 left-6 whitespace-pre font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-white/[58%]">
                  {visual.overlayTopLabel}
                </p>
                <div className="absolute right-6 bottom-6 flex max-w-[360px] flex-col items-end gap-2 text-right">
                  <p className="font-['Pretendard:Medium'] text-[13px] text-[#ff6a38]">{visual.overlayBottomTitle}</p>
                  <p className="font-['Pretendard:Regular'] text-[12px] text-white/[58%]">
                    {visual.overlayBottomDescription}
                  </p>
                </div>
              </div>
            </div>

            {/* 구분선 */}
            <div className="w-px shrink-0 self-stretch bg-[#eaeaea]" />

            {/* 우측 — 로그. 폭을 별도 vw 바닥값으로 고정하지 않는다 —
                패널 자체가 Figma 비율(1740:892)로 크기가 정해지므로,
                우측 컬럼도 그 패널 폭의 정확히 같은 비율(403/1740 ≈
                23.16%)만 따라가면 된다. 패널이 비정상적으로 좁아지는
                경우에 대한 안전장치로만 min-width 300px을 둔다. */}
            <div className="flex w-[max(300px,25cqw)] shrink-0 flex-col gap-[clamp(39px,3.226cqw,52px)]">
              <div className="flex max-w-[370px] flex-col gap-[clamp(18px,1.489cqw,24px)]">
                <p className="font-['Pretendard:Regular'] text-[12px] tracking-[-0.02em] text-[#999]">
                  {log.sectionLabel}
                </p>
                <div className="flex flex-col gap-[clamp(9px,0.744cqw,12px)]">
                  <h2 className="font-['Pretendard:SemiBold'] text-[20px] tracking-[-0.02em] text-[#171717]">
                    {log.heading}
                  </h2>
                  <p className="font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]">
                    {log.description}
                  </p>
                </div>
              </div>

              {/* 항상 고정 5단계를 그린다(Figma "N2 / Step List", N4도
                  같은 컴포넌트를 재사용) — 데이터 개수만큼 map하지
                  않는다. 이 목록 높이가 늘/줄면 아래 진행률 블록이 패널
                  위아래로 밀리므로, 개수를 고정해야 진행률이 항상 같은
                  위치(패널 하단부)에 남는다. */}
              <div className="flex flex-col">
                {steps.map((step) => (
                  <StageRow key={step.no} no={step.no} label={step.label} state={step.state} />
                ))}
              </div>

              {/* progress 내부 3개 관계(퍼센트↔전체 분석 / 전체 분석↔bar /
                  bar↔안내문)는 Figma 원본에서 서로 다른 간격이다 — 하나의
                  공유 gap으로 뭉치지 않고 각 관계를 독립된 clamp로 둔다. */}
              <div className="flex flex-col">
                <div className="flex flex-col gap-[clamp(4.5px,0.372cqw,6px)]">
                  {/* 퍼센트 숫자와 일시정지 버튼이 Figma에서 같은 줄에
                      놓여 있어 같은 flex row로 묶는다 — 버튼을 별도
                      absolute 좌표로 흉내내지 않는다. */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline">
                      <span className="font-['Pretendard:SemiBold'] text-[58px] leading-[64px] text-[#171717]">
                        {progressPercent}
                      </span>
                      <span className="font-['Pretendard:Medium'] text-[18px] tracking-[-0.03em] text-[#999]">%</span>
                    </div>

                    {/* 중단 API가 계약에 없어(범위 밖) 클릭해도 아무 일도
                        하지 않는 버튼을 만들지 않는다. "보여주되 비활성 +
                        이유 설명"으로 최소 보완한다. */}
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      title={pauseButtonTitle}
                      className="flex size-7 shrink-0 cursor-not-allowed items-center justify-center rounded-[4px] border border-[#eaeaea] bg-white opacity-60"
                    >
                      <PauseIcon />
                    </button>
                  </div>
                  <p className="font-['Pretendard:Light'] text-[12px] tracking-[-0.04em] text-[#999]">전체 분석</p>
                </div>

                {/* 396px은 Figma 1920 실측값을 max-width로만 쓴다 — 우측
                    panel 폭이 줄어들면 bar도 100%까지 자연스럽게
                    좁아진다. 위쪽 간격(전체 분석 ↔ bar)은 Figma에서 세
                    관계 중 가장 크다. */}
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
                  {progressHint}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 부분 실패 안내 — Figma엔 없는 상태다. 서버가 실패 task를
            보고하면 숨기지 않고 배너로 알린다. */}
        {failedItems.length > 0 && (
          <div className="shrink-0 px-10 pb-6">
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <p className="mb-2 text-sm font-medium text-orange-700">일부 항목을 처리하지 못했습니다</p>
              <ul className="space-y-1">
                {failedItems.map((item, index) => (
                  <li key={item.taskId ?? index} className="text-xs text-orange-600">
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
