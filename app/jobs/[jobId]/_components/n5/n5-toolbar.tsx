import type { N5ViewMode } from '@/lib/n5/viewport';

// ─────────────────────────────────────────────────────────────────
// N5 viewport 상단 오버레이 — 원문/번역문 독립 버튼 2개 + zoom(-/%/+) +
// fit width/height. Figma 544:3168 기준(9일차, viewport interaction foundation).
//
// 순수 presentational — zoom/pan/mode state는 상위(n5-viewport.tsx)가 갖고
// 여기는 현재 값 표시와 클릭 콜백만 받는다.
//
// 번역문/원문은 하나의 segmented track 안에서 indicator가 좌우로 이동하는
// 구조가 아니다 — 각각 독립된 버튼이고, 클릭하면 두 버튼의 active/inactive
// style만 서로 교환된다. sliding pill/moving indicator/track 배경은 쓰지
// 않는다(스펙 정정, 9일차).
// ─────────────────────────────────────────────────────────────────

const VIEW_MODE_OPTIONS: { mode: N5ViewMode; label: string }[] = [
  { mode: 'translated', label: '번역문' },
  { mode: 'original', label: '원문' },
];

export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: N5ViewMode;
  onChange: (mode: N5ViewMode) => void;
}) {
  return (
    <div data-testid="n5-view-mode-toggle" className="flex items-center gap-2">
      {VIEW_MODE_OPTIONS.map((option) => {
        const isActive = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            data-testid={`n5-view-mode-${option.mode}`}
            aria-pressed={isActive}
            onClick={() => onChange(option.mode)}
            className={`rounded-full border px-4 py-1.5 text-[12px] tracking-[-0.02em] transition-colors duration-150 ${
              isActive
                ? 'border-[#eaeaea] bg-white text-[#171717]'
                : 'border-transparent bg-[#f5f5f5] text-[#999]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
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
