import { useState } from 'react';

import { parseZoomPercentInput, type N5ViewMode } from '@/lib/n5/viewport';

// ─────────────────────────────────────────────────────────────────
// N5 조작 컨트롤 모음 — ViewModeToggle(번역 전/번역 후 독립 버튼 2개) +
// ZoomControls(-/입력/+) + FitControls(fit width/height). Figma 544:3168
// 기준(9일차, viewport interaction foundation). 라벨은 v3.4.1 요구사항
// 반영: 원문 → 번역 전, 번역문 → 번역 후(10일차).
//
// ViewModeToggle은 11일차부터 n5-viewport.tsx(좌측 뷰어 툴바)가 아니라
// N5Panel(우측 패널) 상단에서 렌더된다 — 그래서 mode/zoom/pan state가 서로
// 다른 조상(N5View/n5-viewport.tsx)에 나뉘어 있어도, 이 파일의 컴포넌트들은
// 여전히 순수 presentational이다(현재 값 표시와 클릭 콜백만 받는다).
//
// 번역 후/번역 전은 하나의 segmented track 안에서 indicator가 좌우로 이동하는
// 구조가 아니다 — 각각 독립된 버튼이고, 클릭하면 두 버튼의 active/inactive
// style만 서로 교환된다. sliding pill/moving indicator/track 배경은 쓰지
// 않는다(스펙 정정, 9일차). 비교 슬라이더(Before/After)도 쓰지 않는다.
//
// 3단계(Figma get_design_context, node 544:3168 "N5 검수"): 실제 버튼 모양은
// rounded-full pill이 아니라 rounded-[4px] 사각 버튼이고(공유 Button 컴포넌트,
// Style=Secondary·Size=SM), gap-[10px]·px-[12px]·py-[8px]다 — 모양은 Figma
// 그대로 반영했다. 다만 버튼 문구는 Figma가 "번역문"/"원문"으로 보여주는데,
// 같은 프레임의 바로 아래(번역근거 카드)에 "뭐 넣자고 했는데 기억이 안남"이라는
// 디자이너의 미완성 placeholder 문구가 그대로 남아 있어 — 이 프레임 자체가
// 문구 확정 전 상태일 가능성이 있다. 기존 "번역 후"/"번역 전"은 v3.4.1
// 요구사항 반영·e2e 커버리지가 있는 확정 결정이라 이번 단계에서는 유지하고,
// 문구 불일치는 사용자 확인이 필요한 항목으로 보고에 남긴다(임의로 두 쪽 중
// 하나를 조용히 덮어쓰지 않는다).
//
// render_image_key가 null(렌더 미완료, 금요일 백 회신)이면 「번역 후」 버튼을
// disabled 처리하고 안내 문구를 보여준다(10일차) — 별도 render_failed류
// 신호는 쓰지 않고, 상위가 renderedUrl null 여부만으로 판단해
// translatedDisabled로 넘긴다.
//
// ZoomControls의 배율 표시는 11일차부터 읽기 전용 span이 아니라 입력
// 가능한 input이다(예: "4", "125") — 타이핑 도중에는 clamp하지 않고
// blur/Enter에서만 parseZoomPercentInput(lib/n5/viewport.ts)으로 한 번에
// 보정한다.
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
      <div data-testid="n5-view-mode-toggle" className="flex items-center gap-[10px]">
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
              className={`rounded-[4px] border px-3 py-2 text-[12px] tracking-[-0.02em] transition-colors duration-150 ${
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
  onSetZoom,
}: {
  /** 1 = 100% */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** 사용자가 직접 입력한 배율(예: "4", "4%", "125")을 커밋할 때 호출된다. */
  onSetZoom: (zoomFraction: number) => void;
}) {
  // draft: 입력 중인 원문 문자열. null이면 "편집 중이 아님" — 이때는 zoom
  // prop을 그대로 표시값으로 쓴다. 타이핑 도중에는 매 키 입력마다 clamp하지
  // 않고, blur/Enter에서만 parseZoomPercentInput으로 한 번에 보정한다.
  const [draft, setDraft] = useState<string | null>(null);
  const committedValue = String(Math.round(zoom * 100));
  const displayValue = draft ?? committedValue;

  const commit = () => {
    if (draft === null) return;
    // 0/음수/NaN/빈 문자열이면 parseZoomPercentInput이 null을 반환한다 — 이
    // 경우 zoom을 바꾸지 않는다(현재 zoom 유지). setDraft(null)만으로도
    // displayValue가 committedValue(현재 zoom 기준 표시값)로 되돌아간다.
    const parsed = parseZoomPercentInput(draft);
    if (parsed !== null) onSetZoom(parsed);
    setDraft(null);
  };

  // 7단계 — Figma(544:3168 재확인)의 zoom control은 배경/그림자/pill이 없는
  // 평평한 한 줄(gap-[8px], text-[#999], tracking-[-0.48px])이다. 이전엔
  // rounded-full 흰 배경 + shadow pill이었다 — 그 스타일은 이번 프레임에서
  // 확인되지 않아 걷어냈다. 입력 가능한 배율(input)과 클릭 확대/축소 기능은
  // 그대로 유지한다(11일차 확정 기능, 디자인만 바꾼다).
  return (
    <div
      data-testid="n5-zoom-controls"
      className="flex items-center gap-2 text-[12px] font-light tracking-[-0.02em] text-[#999]"
    >
      <button
        type="button"
        data-testid="n5-zoom-out"
        aria-label="축소"
        onClick={onZoomOut}
        className="flex size-3 items-center justify-center hover:text-[#171717]"
      >
        −
      </button>
      <span className="flex items-center gap-0.5">
        <input
          data-testid="n5-zoom-value"
          type="text"
          inputMode="decimal"
          aria-label="배율(%)"
          value={displayValue}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setDraft(committedValue)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
          className="w-7 border-none bg-transparent text-center tabular-nums outline-none"
        />
        <span aria-hidden="true">%</span>
      </span>
      <button
        type="button"
        data-testid="n5-zoom-in"
        aria-label="확대"
        onClick={onZoomIn}
        className="flex size-3 items-center justify-center hover:text-[#171717]"
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
