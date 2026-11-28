/* eslint-disable @next/next/no-img-element -- 고정 크기 Figma 자산은 next/image 최적화 대상이 아니다 */

// ─────────────────────────────────────────────────────────────────
// N2·N4 전체 실패 패널 내용 (Figma 793:4890 · 795:4820). 표시만 맡고 네트워크 동작은 갖지 않는다.
//
// PRD 오류 화면 동작은 [다시 시도]·[중단](F-JOB-08)뿐이다. Figma 시안에 남은 [일시 정지]·[작업취소]는 쓰지 않는다 —
// 작업 취소는 S0 ✕ 가 맡는다. Figma 의 실패 단계 문구·72% 는 예시라 옮기지 않고, 움직이지 않는 Figma 이미지를 쓴다.
//
// [중단]은 POST /jobs/{jobId}/abort(API-JOB-07)에 연결돼 있다 — 요청·재조회는 page.tsx 의 useJobAbort 가 맡고, 여기는 넘겨받은
// 요청 중 상태와 안내 문구만 그린다. [다시 시도]는 새 재시도 계약(jobRetry) 연동 전까지 onRetry 를 넘기지 않아 눌러도 아무 일도 하지 않는다.
// ─────────────────────────────────────────────────────────────────

export interface ProcessingErrorState {
  /** 패널 오른쪽 상태 영역 라벨(ANALYSIS STATUS · TRANSLATION STATUS) */
  sectionLabel: string;
  title: string;
  description: string;
  onRetry?: () => void;
  onAbort?: () => void;
  /** 중단 요청을 보내고 서버 상태를 다시 확인하는 중 — [중단]을 누를 수 없게 하고 진행 문구를 보인다 */
  abortPending?: boolean;
  /** 중단하지 못했거나 결과를 확인하지 못했을 때의 안내. 설명 아래 같은 alert 영역에 둔다(버튼 위치는 그대로) */
  abortNotice?: string | null;
}

/** 화면(N2·N4)이 page.tsx 에서 받아 오류 상태에 그대로 더하는 [중단] 연결 값 */
export type ProcessingErrorAbort = Pick<ProcessingErrorState, 'onAbort' | 'abortPending' | 'abortNotice'>;

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
    // Figma 793:4890(1920): 비주얼 1044×589 와 오른쪽 열 405×589 가 패널 세로 가운데(y264)에 나란히 놓인다.
    // 구분선은 진행 화면과 달리 비주얼 높이가 아니라 패널 위 60 · 아래 100 사이(764)다 — 위아래 60 은 패널 padding(layout),
    // 아래 추가 40 은 구분선 margin 이다. 예전 좌상단 「오류」 칩은 최신 Figma 에 없다(오류는 ERROR!·상태 제목·role=alert 가 알린다).
    // 795:4820(N4 오류)은 예전 헤더 92 · 패널 y116 기준이라 위치값을 옮기지 않고, 같은 컴포넌트로 N2 오류와 같은 최신 shell 에 둔다.
    <div
      data-testid="processing-error"
      className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_1px_max(300px,25.13cqw)] grid-rows-[1fr_auto_1fr] gap-x-[clamp(60px,4.17vw,80px)]"
    >
      <div data-testid="processing-error-divider" className="col-start-2 row-span-3 row-start-1 mb-[clamp(0px,3.7vh,40px)] bg-[#eaeaea]" />

      <div className="relative col-start-1 row-start-2 aspect-[1044/589] w-full max-w-[1044px] overflow-hidden rounded-[8px]">
        <img src="/process/ai-processing-error.jpg" alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover opacity-[0.97]" />
        <p className="absolute top-7 left-6 text-[12px] leading-[normal] font-light tracking-[-0.48px] whitespace-pre text-white/[58%]">{visualLabel}</p>
      </div>

      <div className="col-start-3 row-start-2 flex flex-col justify-between gap-6 leading-[normal]">
        {/* Figma 「Frame 370」 — ERROR! 64 · 4 · 진행율 14 · 24 · 막대 3 */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
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

        {/* Figma 「Frame 969」 — label 14 · 12 · 제목 24 · 4 · 설명 14 · 52 · 버튼 37 */}
        <div className="flex flex-col gap-[52px]">
          <div role="alert" className="flex flex-col gap-3">
            <p className="text-[12px] tracking-[-0.24px] text-[#999]">{error.sectionLabel}</p>
            <div className="flex flex-col gap-1 text-[#171717]">
              <h2 className="text-[20px] font-semibold tracking-[-0.4px]">{error.title}</h2>
              <p data-testid="processing-error-description" className="text-[12px] font-light tracking-[-0.48px]">
                {error.description}
              </p>
            </div>
            {/* 중단 실패·미확인 안내 — Figma 에 없는 상태라 새 상자를 만들지 않고 설명과 같은 글자 크기로 한 줄 더한다.
                색만으로 알리지 않고 문장으로 알린다. 아래 버튼 묶음은 열 바닥에 붙어 있어 위치가 바뀌지 않는다 */}
            {error.abortNotice && (
              <p data-testid="processing-error-abort-notice" className="text-[12px] tracking-[-0.48px] text-[#e5484d]">
                {error.abortNotice}
              </p>
            )}
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
              // 요청 중에는 native disabled 대신 aria-disabled 로 막는다 — 포커스가 버튼에 남아 결과 안내까지 이어서 읽힌다
              onClick={error.abortPending ? undefined : error.onAbort}
              aria-disabled={error.onAbort && !error.abortPending ? undefined : true}
              aria-busy={error.abortPending ? true : undefined}
              className={`${ACTION_BASE} border border-[#eaeaea] bg-white text-[#171717] ${error.abortPending ? 'cursor-progress text-[#999]' : ''}`}
            >
              {/* Figma Card/Action/Pause 16. 시안의 두 번째 자리를 [중단]이 쓴다 */}
              <img
                alt=""
                aria-hidden="true"
                src="/process/icons/pause-16.svg"
                className={`block size-4 max-w-none shrink-0 ${error.abortPending ? 'opacity-40' : ''}`}
              />
              <span className="px-2">{error.abortPending ? '중단하는 중' : '중단'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
