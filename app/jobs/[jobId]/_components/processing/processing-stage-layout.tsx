

// ─────────────────────────────────────────────────────────────────
// N2/N4 공용 processing 화면 레이아웃 (Figma 1821:46419 "N2 분석중" ·
// 1821:48003 "N4 번역중"). 두 화면은 node 단위로 구조가 동일하다(Figma가
// N4의 단계 목록 컴포넌트 이름 자체를 "N2 / Step List"로 재사용하고
// 있을 정도) — 다른 건 copy(화면명/log 텍스트/단계 묶음 라벨)와
// progress 상태뿐이다.
//
// 이 컴포넌트는 순수 presentation이다 — backend stage(ocr/section/verify,
// inpaint/translate/verify/render)를 사용자 단계 묶음 상태로 해석하는 로직은 여기
// 없다. 그 해석은 N2AnalysisView/N4TranslationView 각자의 wrapper가
// 맡고, 이미 계산된 `steps`/`progressPercent`만 props로 받는다 — 두
// 화면의 backend stage 어휘가 서로 다르므로(N2: ocr→section→verify,
// N4: inpaint→translate→verify→render) 해석 로직을 공유하면 오히려
// 어느 한쪽에 맞지 않는 값이 새어 들어갈 위험이 있다.
// ─────────────────────────────────────────────────────────────────

import { ProcessingErrorContent, type ProcessingErrorAbort, type ProcessingErrorState } from './processing-error-content';

export type ProcessingStepState = 'done' | 'active' | 'pending';

/**
 * 사용자 단계 묶음 하나(Figma 1821:46431 · 1821:48015 「N2 / Step List」의 Step 한 칸).
 * 묶음 안에 label 이 여러 줄이어도 번호·dot·상태 글자는 하나씩만 그린다 — label 마다 「진행 중」을 반복하지 않는다.
 */
export interface ProcessingStageGroup {
  no: string;
  labels: readonly string[];
  state: ProcessingStepState;
}

/**
 * 화면에 보이는 「진행 중」은 항상 최대 1개다 — 앞에서부터 처음 active 인 묶음만 남기고 뒤의 active 는 대기로 둔다.
 * 서버 작업이 병렬이어도 표시만 하나로 고른다(서버 작업을 직렬화하지 않는다). N2·N4 가 각자 계산한 상태의 마지막 안전장치다.
 */
export function keepSingleActive(states: readonly ProcessingStepState[]): ProcessingStepState[] {
  let seen = false;
  return states.map((state) => {
    if (state !== 'active') return state;
    if (seen) return 'pending';
    seen = true;
    return state;
  });
}

export interface ProcessingFailedItem {
  taskId?: number;
  unitType?: string;
  unitId?: number | null;
  errorCode?: string | null;
}

export interface ProcessingStageLayoutProps {
  header: {
    /** 화면 제목 — 보이는 화면명은 공통 작업 헤더(JobHeader)가 맡고, 여기서는 화면 읽기용 h1 로만 둔다 */
    title: string;
  };
  visual: {
    /** N2/N4가 같은 GIF 자산(`/process/ai-processing.gif`)을 쓴다 — 별도 복사본을 만들지 않는다. */
    src: string;
    overlayTopLabel: string;
  };
  log: {
    sectionLabel: string;
    heading: string;
    /** 지금 처리 상태(예: 영역별 판정 재시도 대기 중) — 설명 줄 앞에 둔다. 완료 표시 동안에는 넘기지 않는다 */
    status?: string;
    description: string;
  };
  /** Figma 사용자 단계 묶음(N2 3개 · N4 4개). 화면마다 개수는 고정이다 */
  steps: ProcessingStageGroup[];
  progressPercent: number;
  progressHint: string;
  /**
   * 처리 중 [중단](PRD v3.6.4 F-JOB-08 · 화면정의서 N2·N3 — N2 → N1 · N4 → N3, 작업은 삭제하지 않는다). Figma 의 일시 정지 아이콘 자리를
   * 그대로 쓴다 — 일시 정지·이어서 처리가 아니다. 오류 화면 [중단]과 같은 요청·잠금·재조회(useJobAbort)를 쓴다.
   * onAbort 가 없으면(완료 표시 중 등) 누를 수 없다.
   */
  abort?: ProcessingErrorAbort;
  failedItems: ProcessingFailedItem[];
  /** job 전체 실패(jobStatus=failed)일 때만 넘긴다. 패널 내용을 오류 화면으로 바꾼다. 부분 실패는 failedItems 로 표시한다 */
  error?: ProcessingErrorState;
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
// 단계 묶음 한 칸 — Figma 1821:46431(N2) · 1821:48015(N4) · 1821:47221(완료 묶음).
// [dot 10×16(점은 위 3px)] gap 14 [번호 / label… / 상태] (세로 gap 4). 묶음 위아래 여백은 Figma 12px 을 상한으로
// 패널 높이에 맞춰 줄어든다(낮은 창에서 목록·진행률이 패널을 넘지 않게 — 계산은 ProcessingStageLayout 주석).
// - 진행 중: dot 주황, 번호 SemiBold #171717, label #171717, 상태 12 Regular #ff6a38 「진행 중」
// - 완료: dot #171717, 번호 SemiBold #171717, label #171717, 상태 12 Light #999 「완료」
// - 대기: dot 테두리만(#eaeaea), 번호·label #999, 상태 12 Light #999 「대기」
// ─────────────────────────────────────────────────────────────────
function StageGroup({ no, labels, state }: ProcessingStageGroup) {
  const isDone = state === 'done';
  const isActive = state === 'active';

  const dotClass = isActive ? 'bg-[#ff6a38]' : isDone ? 'bg-[#171717]' : 'border border-[#eaeaea] bg-transparent';
  const textColor = isActive || isDone ? 'text-[#171717]' : 'text-[#999]';
  const statusText = isDone ? '완료' : isActive ? '진행 중' : '대기';
  const statusClass = isActive
    ? 'font-normal text-[12px] leading-[14px] tracking-[-0.02em] text-[#ff6a38]'
    : 'font-light text-[12px] leading-[14px] tracking-[-0.04em] text-[#999]';

  return (
    <div
      data-testid="processing-step"
      data-state={state}
      className="flex w-full items-start gap-3.5 py-[clamp(4px,calc(2.4cqh_-_9px),12px)]"
    >
      <div className="flex h-4 w-[10px] shrink-0 items-start pt-[3px]">
        <div data-testid="processing-step-dot" className={`size-[10px] rounded-full ${dotClass}`} aria-hidden="true" />
      </div>
      {/* 줄 높이는 Figma 글자 상자 그대로 — 14px 줄 17 · 12px 상태 14 */}
      <div className={`flex flex-col gap-1 whitespace-nowrap ${textColor}`}>
        <p data-testid="processing-step-no" className={`text-[14px] leading-[17px] tracking-[-0.01em] ${isActive || isDone ? 'font-semibold' : 'font-normal'}`}>
          {no}
        </p>
        {labels.map((label) => (
          <p key={label} data-testid="processing-step-title" className="font-normal text-[14px] leading-[17px] tracking-[-0.01em]">
            {label}
          </p>
        ))}
        <p data-testid="processing-step-status" className={statusClass}>
          {statusText}
        </p>
      </div>
    </div>
  );
}

export function ProcessingStageLayout({
  header,
  visual,
  log,
  steps,
  progressPercent,
  progressHint,
  abort,
  failedItems,
  error,
}: ProcessingStageLayoutProps) {
  const canAbort = Boolean(abort?.onAbort) && !abort?.abortPending;
  return (
    <div className="flex h-full w-full bg-white">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 화면명은 공통 작업 헤더(JobHeader)가 보여 준다 — 여기서는 화면 읽기용 h1 만 둔다(빈 제목 행을 두지 않는다). */}
        <h1 className="sr-only">{header.title}</h1>

        {/* 화면 shell — 회색 패널의 바깥 여백(Figma 1821:46419 · 1821:48003, 1920×1080 에서 패널 x120 y96 1740×924).
            - 위·아래: 헤더(72)는 본문 위에 겹쳐 있으므로 문서 흐름에 다시 더하지 않는다. S0 단계 rail 과 같은 위 96 · 아래 60 이라
              어느 창 높이에서도 패널 위아래 끝이 rail 과 맞는다.
            - 왼쪽: S0 rail 자리(80) 뒤에 더하는 값이다 — 1920 에서 40(패널 x120), 창이 좁아지면 줄되 rail 단계 원·글자(x92 까지)에
              패널이 붙지 않도록 20 아래로는 내려가지 않는다.
            - 오른쪽: 1920 에서 60, 좁은 창에서 45 까지 준다. */}
        <div className="min-h-0 flex-1 pt-[96px] pr-[clamp(45px,3.125vw,60px)] pb-[60px] pl-[clamp(20px,calc(6.25vw_-_80px),40px)]">
          {/* 회색 processing panel. [container-type:size] — 안쪽 크기는 이 패널의 content-box(1920 에서 1612×876) 기준 cqw/cqh 다.
              cq 단위는 컨테이너 자신의 padding 에는 쓸 수 없어 패널 padding 은 vw 로 둔다.
              좌우 padding 은 Figma 68/60(1920). 위아래 24 는 Figma 수치가 아니라 낮은 창에서의 최소 여백이다 — 1920 에서 비주얼·로그는
              세로 가운데 정렬로 Figma 위치에 놓인다. 오류 화면(Figma 793:4890)은 위아래 60(1080 기준, 창 높이에 맞춰 24 까지 준다)이다 — 구분선이 패널 위 60 에서 시작한다.
              내용이 실제로 패널보다 높을 때만 이 패널 안에서 세로 스크롤한다. */}
          <div
            data-testid="processing-panel"
            className={`relative flex h-full min-h-0 w-full min-w-0 [container-type:size] overflow-y-auto rounded-[8px] bg-[#f5f5f5] pr-[clamp(45px,3.13vw,60px)] pl-[clamp(51px,3.54vw,68px)] ${
              error ? 'py-[clamp(24px,5.56vh,60px)]' : 'py-6'
            }`}
          >
            {error ? (
              <ProcessingErrorContent error={error} visualLabel={visual.overlayTopLabel} progressPercent={progressPercent} />
            ) : (
              <>
                {/* 왼쪽 — 분석 비주얼(Figma 「N2 / Analysis Visual」 1044×589). 남는 폭을 모두 받고(flex-1) 높이는 비율로 정한다.
                    오른쪽 margin 은 비주얼 ↔ 구분선(1920 에서 84) + 구분선 1 + 구분선 ↔ 로그(80)를 한 번에 비워 둔다 —
                    구분선은 비주얼과 같은 높이·위치여야 해서(Figma 589, y 동일) 비주얼 상자 안에 절대 위치로 그린다.
                    pt 5 는 Figma 에서 비주얼 중심이 로그 중심보다 2px 아래인 만큼(가운데 정렬 기준)이다. */}
                <div className="mr-[calc(clamp(48px,4.375vw,84px)_+_1px_+_clamp(48px,4.17vw,80px))] flex min-h-0 min-w-0 flex-1 flex-col justify-center pt-[5px]">
                  {/* 비율 1044:589(GIF 원본 1920×1080 과 거의 같다). 창이 낮아 남는 높이가 부족하면 max-h-full 로 높이만 줄고
                      GIF 는 object-contain 이라 잘리지 않는다(남는 자리는 GIF 와 같은 검정 배경). */}
                  <div className="relative aspect-[1044/589] max-h-full w-full">
                    {/* 진행 단계 caption 은 최신 Figma 에 없어 그리지 않는다 — 현재 단계는 오른쪽 로그의 단계 목록·설명 줄이 보여 준다 */}
                    <div data-testid="processing-visual" className="absolute inset-0 overflow-hidden rounded-[8px] bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 애니메이션 보존을 위해 next/image 최적화 대상에서 제외(GIF) */}
                      <img
                        src={visual.src}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 size-full object-contain opacity-[0.97]"
                      />
                      <p className="absolute top-7 left-6 whitespace-pre font-light leading-[normal] text-[12px] tracking-[-0.04em] text-white/[58%]">
                        {visual.overlayTopLabel}
                      </p>
                    </div>
                    {/* 구분선(Figma 「N2 Panel Divider」 1×589) — 비주얼과 같은 높이로 오른쪽 간격만큼 떨어져 있다 */}
                    <div
                      aria-hidden="true"
                      data-testid="processing-divider"
                      className="absolute inset-y-0 left-[calc(100%_+_clamp(48px,4.375vw,84px))] w-px bg-[#eaeaea]"
                    />
                  </div>
                </div>

                {/* 오른쪽 — 진행 로그(Figma 「Frame 300」 403 × N2 571 · N4 630). 두 화면 모두 패널 세로 가운데에 놓이므로
                    (Figma 중심 y 558.5 동일) 화면별 y 를 두지 않고 my-auto 로 가운데 정렬한다 — 내용이 패널보다 높으면
                    auto margin 이 0 이 되어 위가 잘리지 않고 패널 스크롤로 이어진다.
                    폭 25cqw 는 1920 에서 1612 × 25% = 403 이다. 좁은 창에서는 비율로 줄되 가독성을 위해 300 아래로 내려가지 않는다.

                    세로 간격은 패널 content-box 높이(cqh)에 맞춰 줄어든다 — 1920×1080(content 876)에서 Figma 값이고, 1280×720
                    (content 516)에서는 하한에 닿아 N4(묶음 4개)까지 패널 안에 들어간다. 글자·묶음 내용 높이는 줄이지 않는다.
                    - 블록 사이(헤더 → 목록 → 진행률) 54: clamp(16, 9.5cqh − 29, 54)
                    - 단계 묶음 위아래 12: clamp(4, 2.4cqh − 9, 12)  (StageGroup)
                    - 진행률 숫자 → 막대 24: clamp(12, 4cqh − 11, 24) */}
                <div data-testid="processing-log" className="my-auto flex w-[max(300px,25cqw)] shrink-0 flex-col gap-[clamp(16px,calc(9.5cqh_-_29px),54px)]">
                  {/* Figma 「Frame 299」 — label 14 · 12 · heading 24 · 4 · caption 14 */}
                  <div className="flex flex-col gap-3">
                    <p className="font-normal leading-[normal] text-[12px] tracking-[-0.02em] text-[#999]">
                      {log.sectionLabel}
                    </p>
                    <div className="flex flex-col gap-1">
                      <h2 className="font-semibold leading-[normal] text-[20px] tracking-[-0.02em] text-[#171717]">
                        {log.heading}
                      </h2>
                      {/* Figma 「Analysis Log Caption」 한 줄 — [현재 상태 · 세부 설명]. 현재 상태를 앞에 두어 좁은 로그에서
                          말줄임이 생겨도 상태는 보이게 한다. 줄바꿈되면 아래 단계 목록·progress 가 통째로 밀리므로 말줄임으로
                          자르고, 텍스트는 DOM 에 그대로 있어 보조기기는 전체를 읽고 잘린 내용은 title 로 확인한다. */}
                      <p
                        className="truncate font-light leading-[normal] text-[12px] tracking-[-0.04em] text-[#999]"
                        title={log.status ? `${log.status} · ${log.description}` : log.description}
                        data-testid="processing-log-line"
                      >
                        {log.status && (
                          <>
                            <span data-testid="processing-log-status" className="font-normal text-[#171717]">
                              {log.status}
                            </span>
                            {' · '}
                          </>
                        )}
                        <span data-testid="processing-log-description">{log.description}</span>
                      </p>
                    </div>
                  </div>

                  {/* Figma 「N2 / Step List」(N4 도 같은 컴포넌트) — 사용자 단계 묶음 단위로 그린다. 묶음 개수는 화면마다
                      고정이라(N2 3 · N4 4) 처리 중에 진행률 블록 위치가 바뀌지 않는다. 「진행 중」은 최대 1개다(keepSingleActive). */}
                  <div className="flex flex-col" data-testid="processing-step-list">
                    {steps.map((step) => (
                      <StageGroup key={step.no} no={step.no} labels={step.labels} state={step.state} />
                    ))}
                  </div>

                  {/* Figma 「Frame 999」 — [숫자 64 · 일시정지 버튼(아래 맞춤)] 24 [막대 3] 8 [안내 14].
                      예전 「전체 분석」 라벨은 최신 Figma 에 없어 그리지 않고, 진행률 이름은 progressbar 의 aria-label 로 둔다. */}
                  <div className="flex flex-col">
                    <div className="flex items-end justify-between">
                      <div className="flex items-baseline">
                        <span className="font-semibold text-[58px] leading-[64px] text-[#171717]">
                          {progressPercent}
                        </span>
                        <span className="font-medium leading-[normal] text-[18px] tracking-[-0.03em] text-[#999]">%</span>
                      </div>

                      {/* 처리 중 [중단] — Figma 일시 정지 버튼(28×28 · 테두리 #eaeaea · 흰 바탕 · 아이콘)의 위치·크기·모양을 그대로 쓴다.
                          요청 중에는 aria-disabled · aria-busy 로 막고(포커스 유지) 흐리게 둔다. 누를 수 없는 동안(onAbort 없음)은 예전처럼 비활성이다 */}
                      <button
                        type="button"
                        data-testid="processing-abort"
                        aria-label={abort?.abortPending ? '중단하는 중' : '중단'}
                        title="중단"
                        disabled={!abort?.onAbort}
                        aria-disabled={canAbort ? undefined : true}
                        aria-busy={abort?.abortPending ? true : undefined}
                        onClick={canAbort ? abort?.onAbort : undefined}
                        className={`flex size-7 shrink-0 items-center justify-center rounded-[4px] border border-[#eaeaea] bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38] ${
                          canAbort ? 'cursor-pointer' : abort?.abortPending ? 'cursor-progress opacity-60' : 'cursor-not-allowed opacity-60'
                        }`}
                      >
                        <PauseIcon />
                      </button>
                    </div>

                    {/* 396 은 Figma 1920 값을 max-width 로만 쓴다 — 로그 폭이 줄면 막대도 100% 까지 좁아진다 */}
                    <div
                      className="mt-[clamp(12px,calc(4cqh_-_11px),24px)] h-[3px] w-full max-w-[396px] overflow-hidden rounded-full bg-[rgba(112,112,112,0.16)]"
                      role="progressbar"
                      aria-label="전체 진행률"
                      aria-valuenow={progressPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-[#ff6a38] transition-[width] duration-500 ease-out"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    {/* 안내 줄 — 중단 요청 중·중단하지 못함 안내는 이 자리에서 바꿔 보인다(Figma 에 없는 상태라 새 상자를 만들지 않는다) */}
                    {abort?.abortNotice ? (
                      <p role="alert" data-testid="processing-abort-notice" className="mt-2 font-normal leading-[normal] text-[12px] tracking-[-0.04em] text-[#e5484d]">
                        {abort.abortNotice}
                      </p>
                    ) : (
                      <p className="mt-2 font-light leading-[normal] text-[12px] tracking-[-0.04em] text-[#999]">
                        {abort?.abortPending ? '작업을 중단하고 있습니다.' : progressHint}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 부분 실패 안내 — Figma엔 없는 상태다. 서버가 실패 task를
            보고하면 숨기지 않고 배너로 알린다. */}
        {!error && failedItems.length > 0 && (
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
