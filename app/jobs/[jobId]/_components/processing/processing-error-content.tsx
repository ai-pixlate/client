/* eslint-disable @next/next/no-img-element -- 고정 크기 Figma 자산은 next/image 최적화 대상이 아니다 */

// ─────────────────────────────────────────────────────────────────
// N2·N4 전체 실패 패널 내용 (Figma 793:4890 · 795:4820). 표시만 맡고 네트워크 동작은 갖지 않는다.
//
// PRD 오류 화면 동작은 [다시 시도]·[중단](F-JOB-08)뿐이다. Figma 시안에 남은 [일시 정지]·[작업취소]는 쓰지 않는다 —
// 작업 취소는 S0 ✕ 가 맡는다. Figma 의 실패 단계 문구·72% 는 예시라 옮기지 않고, 움직이지 않는 Figma 이미지를 쓴다.
//
// onRetry·onAbort 는 abort/resume API 가 연결되면 넘긴다. 지금은 넘기지 않으므로 모습은 그대로 두고 눌러도 아무 일도 하지 않는다.
// ─────────────────────────────────────────────────────────────────

export interface ProcessingErrorState {
  /** 패널 오른쪽 상태 영역 라벨(ANALYSIS STATUS · TRANSLATION STATUS) */
  sectionLabel: string;
  title: string;
  description: string;
  onRetry?: () => void;
  onAbort?: () => void;
}

const ACTION_BASE =
  'box-border flex h-[37px] min-w-0 flex-1 items-center justify-center rounded-[6px] px-5 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]';

export function ProcessingErrorContent({
  error,
  visualLabel,
  progressPercent,
}: {
  error: ProcessingErrorState;
  visualLabel: string;
  /** 실패 시점에 멈춘 표시 진행률 */
  progressPercent: number;
}) {
  return (
    <div
      data-testid="processing-error"
      className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_1px_max(300px,25.13cqw)] grid-rows-[1fr_auto_1fr] gap-x-[clamp(60px,4.17vw,80px)]"
    >
      <div className="col-start-1 row-start-1 mt-0.5 flex h-[26px] w-[60px] items-center justify-center rounded-[6px] bg-[#fff0eb] px-2">
        <p className="text-[12px] leading-[14px] text-[#e5484d]">오류</p>
      </div>

      <div className="col-start-2 row-span-3 row-start-1 bg-[#eaeaea]" />

      <div className="relative col-start-1 row-start-2 aspect-[1044/520] w-full max-w-[1044px] overflow-hidden rounded-[8px]">
        <img src="/process/ai-processing-error.jpg" alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover opacity-[0.97]" />
        <p className="absolute top-7 left-6 text-[12px] leading-[normal] font-light tracking-[-0.48px] whitespace-pre text-white/[58%]">{visualLabel}</p>
      </div>

      <div className="col-start-3 row-start-2 flex flex-col justify-between gap-6 leading-[normal]">
        <div className="flex flex-col gap-9">
          <div className="flex flex-col gap-1.5">
            <p className="text-[58px] leading-[64px] font-semibold text-[#e5484d]">ERROR!</p>
            <p data-testid="processing-error-progress" className="text-[12px] font-light tracking-[-0.48px] text-[#999]">
              진행율: {progressPercent}%
            </p>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-[3px] w-full max-w-[396px] overflow-hidden rounded-[2px] bg-[rgba(112,112,112,0.16)]"
          >
            <div className="h-full rounded-[2px] bg-[#e5484d]" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <div className="flex flex-col gap-11">
          <div role="alert" className="flex flex-col gap-6">
            <p className="text-[12px] tracking-[-0.24px] text-[#999]">{error.sectionLabel}</p>
            <div className="flex flex-col gap-3 text-[#171717]">
              <h2 className="text-[20px] font-semibold tracking-[-0.4px]">{error.title}</h2>
              <p data-testid="processing-error-description" className="text-[12px] font-light tracking-[-0.48px]">
                {error.description}
              </p>
            </div>
          </div>

          <div className="flex w-full max-w-[405px] gap-5">
            <button
              type="button"
              data-testid="processing-error-retry"
              onClick={error.onRetry}
              aria-disabled={error.onRetry ? undefined : true}
              className={`${ACTION_BASE} bg-[#171717] text-white`}
            >
              {/* Figma Card/Action/Retry 16 */}
              <span aria-hidden="true" className="relative block size-4 shrink-0 overflow-hidden">
                <span className="absolute top-[18.75%] right-[20.79%] bottom-[21.25%] left-1/4 block">
                  <span className="absolute inset-[-4.77%_-7.21%_-6.51%_-7.21%] block">
                    <img alt="" src="/process/icons/retry-16.svg" className="block size-full max-w-none" />
                  </span>
                </span>
              </span>
              <span className="px-2">다시 시도</span>
            </button>
            <button
              type="button"
              data-testid="processing-error-abort"
              onClick={error.onAbort}
              aria-disabled={error.onAbort ? undefined : true}
              className={`${ACTION_BASE} border border-[#eaeaea] bg-white text-[#171717]`}
            >
              {/* Figma Card/Action/Pause 16. 시안의 두 번째 자리를 [중단]이 쓴다 */}
              <img alt="" aria-hidden="true" src="/process/icons/pause-16.svg" className="block size-4 max-w-none shrink-0" />
              <span className="px-2">중단</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
