import type { N5ViewMode } from '@/lib/n5/viewport';

// ─────────────────────────────────────────────────────────────────
// N5 viewport 상단 오버레이 — 번역 전/번역 후 독립 버튼 2개 + zoom(-/%/+) +
// fit width/height. Figma 544:3168 기준(9일차, viewport interaction foundation).
// 라벨은 v3.4.1 요구사항 반영: 원문 → 번역 전, 번역문 → 번역 후(10일차).
//
// 순수 presentational — zoom/pan/mode state는 상위(n5-viewport.tsx)가 갖고
// 여기는 현재 값 표시와 클릭 콜백만 받는다.
//
// 번역 후/번역 전은 하나의 segmented track 안에서 indicator가 좌우로 이동하는
// 구조가 아니다 — 각각 독립된 버튼이고, 클릭하면 두 버튼의 active/inactive
// style만 서로 교환된다. sliding pill/moving indicator/track 배경은 쓰지
// 않는다(스펙 정정, 9일차). 비교 슬라이더(Before/After)도 쓰지 않는다.
//
// render_image_key가 null(렌더 미완료, 금요일 백 회신)이면 「번역 후」 버튼을
// disabled 처리하고 안내 문구를 보여준다(10일차) — 별도 render_failed류
// 신호는 쓰지 않고, 상위(n5-viewport.tsx)가 renderedUrl null 여부만으로
// 판단해 translatedDisabled로 넘긴다.
// ─────────────────────────────────────────────────────────────────

const VIEW_MODE_OPTIONS: { mode: N5ViewMode; label: string }[] = [
  { mode: 'translated', label: '번역 후' },
  { mode: 'original', label: '번역 전' },
];

const RENDER_MISSING_MESSAGE = '번역 렌더 결과가 아직 없어 번역 후를 볼 수 없습니다.';

export function ViewModeToggle({
  mode,
  onChange,
  translatedDisabled = false,
}: {
  mode: N5ViewMode;
  onChange: (mode: N5ViewMode) => void;
  /** render_image_key가 없어 번역 후 렌더 결과가 아직 없을 때 true (v3.4.1) */
  translatedDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div data-testid="n5-view-mode-toggle" className="flex items-center gap-2">
        {VIEW_MODE_OPTIONS.map((option) => {
          const isActive = mode === option.mode;
          const isDisabled = option.mode === 'translated' && translatedDisabled;
          return (
            <button
              key={option.mode}
              type="button"
              data-testid={`n5-view-mode-${option.mode}`}
              aria-pressed={isActive}
              disabled={isDisabled}
              title={isDisabled ? RENDER_MISSING_MESSAGE : undefined}
              onClick={() => onChange(option.mode)}
              className={`rounded-full border px-4 py-1.5 text-[12px] tracking-[-0.02em] transition-colors duration-150 ${
                isDisabled
                  ? 'cursor-not-allowed border-transparent bg-[#f5f5f5] text-[#ccc]'
                  : isActive
                    ? 'border-[#eaeaea] bg-white text-[#171717]'
                    : 'border-transparent bg-[#f5f5f5] text-[#999]'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {translatedDisabled && (
        <p data-testid="n5-render-missing-notice" className="text-[11px] text-[#999]">
          {RENDER_MISSING_MESSAGE}
        </p>
      )}
    </div>
  );
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
}: {
  /** 1 = 100% */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <div
      data-testid="n5-zoom-controls"
      className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12px] text-[#171717] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)]"
    >
      <button
        type="button"
        data-testid="n5-zoom-out"
        aria-label="축소"
        onClick={onZoomOut}
        className="flex size-4 items-center justify-center text-[#999] hover:text-[#171717]"
      >
        −
      </button>
      <span data-testid="n5-zoom-value" className="w-9 text-center tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        data-testid="n5-zoom-in"
        aria-label="확대"
        onClick={onZoomIn}
        className="flex size-4 items-center justify-center text-[#999] hover:text-[#171717]"
      >
        +
      </button>
    </div>
  );
}

export function FitControls({
  onFitWidth,
  onFitHeight,
}: {
  onFitWidth: () => void;
  onFitHeight: () => void;
}) {
  return (
    <div
      data-testid="n5-fit-controls"
      className="flex items-center gap-1 rounded-full bg-white px-1.5 py-1.5 text-[12px] text-[#171717] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)]"
    >
      <button
        type="button"
        data-testid="n5-fit-width"
        title="가로에 맞춤"
        onClick={onFitWidth}
        className="rounded-full px-2.5 py-1 hover:bg-[#f5f5f5]"
      >
        가로 맞춤
      </button>
      <button
        type="button"
        data-testid="n5-fit-height"
        title="세로에 맞춤"
        onClick={onFitHeight}
        className="rounded-full px-2.5 py-1 hover:bg-[#f5f5f5]"
      >
        세로 맞춤
      </button>
    </div>
  );
}
