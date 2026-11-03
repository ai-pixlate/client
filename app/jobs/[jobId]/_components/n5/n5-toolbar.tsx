import { useState } from 'react';

import { parseZoomPercentInput, type N5ViewMode } from '@/lib/n5/viewport';

// ─────────────────────────────────────────────────────────────────
// N5 조작 컨트롤 모음 — ViewModeToggle(번역 후/번역 전 독립 버튼 2개) +
// ZoomControls(-/입력/+) + FitControls(fit width/height, compact icon). Figma 544:3168 기준.
//
// ViewModeToggle은 N5Panel(우측 패널) 상단 헤더에서 렌더된다 — mode/zoom/pan
// state가 서로 다른 조상(N5View/n5-viewport.tsx)에 나뉘어 있어도, 이 파일의
// 컴포넌트들은 여전히 순수 presentational이다(현재 값 표시와 클릭 콜백만
// 받는다).
//
// 번역문/원문은 하나의 segmented track 안에서 indicator가 좌우로 이동하는
// 구조가 아니다 — 각각 독립된 버튼이고, 클릭하면 두 버튼의 active/inactive
// style만 서로 교환된다. sliding pill/moving indicator/track 배경은 쓰지
// 않는다. before/after 비교 슬라이더도 아니다 — 같은 block을 번역문 view와
// 원문 view 사이에서 전환하는 기능이다(재정합, N5 2차 정렬).
//
// 라벨: 현재 Figma(node 544:3168)와 PRD v3.5.10은 "번역 후"/"번역 전"이다
// (한때 Figma가 "번역문"/"원문"이었던 시기가 있었다). mode 값 자체
// ('translated'/'original')는 그대로 유지한다 — 라벨(사람이 보는 문구)만
// 바꾸고 상태값(코드가 쓰는 값)은 API/selection 로직과 무관하므로 건드릴
// 이유가 없다.
//
// N5 3차 정렬 — render_image_key가 null(번역 렌더 이미지 미완료)이어도 이
// 토글은 더 이상 disabled 처리하지 않는다. "번역 렌더 이미지가 없다"와
// "번역문 텍스트 검수가 불가능하다"는 서로 다른 개념이다 — 렌더 이미지가
// 없어도 번역문 텍스트(trans1) 확인·수정은 항상 가능해야 한다. 렌더
// 이미지가 없다는 사실은 이 토글이 아니라(disabled 처리하지 않는다)
// render 없는 개별 section 자신의 "렌더 대기 중" 표시(n5-viewport.tsx
// ImageLayer의 isPending)로만 보여준다 — 한때 캔버스 전체를 덮는 별도
// 안내 문구도 있었으나(N5 3차 정렬), 일부 section만 준비 안 된 경우에도
// 전체가 안 되는 것처럼 보이는 중복 표현이라 4차 정리에서 없앴다.
//
// ZoomControls의 배율 표시는 읽기 전용 span이 아니라 입력 가능한 input이다
// (예: "4", "125") — 타이핑 도중에는 clamp하지 않고 blur/Enter에서만
// parseZoomPercentInput(lib/n5/viewport.ts)으로 한 번에 보정한다.
//
// FitControls(재정합): Figma(544:3168)에 이 컨트롤이 별도로 없다 — 이전엔
// "가로 맞춤"/"세로 맞춤" 큰 텍스트 버튼이라 위계가 검수 콘텐츠보다 눈에
// 띄었다. N5는 검수 도구지 편집 캔버스가 아니므로, zoom control과 같은
// 톤(작은 아이콘 버튼 + title 툴팁, orange 없음)으로 낮췄다 — 기능(클릭
// 시 fit width/height)은 그대로 유지한다.
// ─────────────────────────────────────────────────────────────────

const VIEW_MODE_OPTIONS: { mode: N5ViewMode; label: string }[] = [
  { mode: 'translated', label: '번역 후' },
  { mode: 'original', label: '번역 전' },
];

export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: N5ViewMode;
  onChange: (mode: N5ViewMode) => void;
}) {
  return (
    <div data-testid="n5-view-mode-toggle" className="flex items-center gap-[10px]">
      {VIEW_MODE_OPTIONS.map((option) => {
        const isActive = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            data-testid={`n5-view-mode-${option.mode}`}
            aria-pressed={isActive}
            onClick={() => onChange(option.mode)}
            // Figma 1256:6919·6920 — 74×30, 활성 흰 바탕+테두리, 비활성 #f5f5f5. 글자는 둘 다 #171717
            className={`flex h-[30px] w-[74px] items-center justify-center rounded-[4px] border text-[12px] leading-[normal] tracking-[-0.02em] text-[#171717] transition-colors duration-150 ${
              isActive ? 'border-[#eaeaea] bg-white' : 'border-transparent bg-[#f5f5f5]'
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
      // 9/23 — n5-viewport.tsx가 이 컴포넌트를 pointer-events-none 바깥
      // wrapper 안에서 쓴다(그 wrapper의 "빈" 영역이 캔버스 클릭을 가로채지
      // 않게 하려는 목적). 실제 컨트롤이 있는 이 루트는 auto로 되돌린다.
      // Figma 602:5437 — 66×14, gap 8, 12 Light #999, 자간 -4%
      className="pointer-events-auto flex h-[14px] items-center gap-2 text-[12px] leading-[14px] font-light tracking-[-0.04em] text-[#999]"
    >
      <button
        type="button"
        data-testid="n5-zoom-out"
        aria-label="축소"
        onClick={onZoomOut}
        className="flex size-3 items-center justify-center hover:text-[#171717]"
      >
        <ZoomGlyph isPlus={false} />
      </button>
      <span className="flex items-center">
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
          className="h-[14px] min-w-[1ch] border-none bg-transparent text-right tabular-nums outline-none [field-sizing:content]"
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
        <ZoomGlyph isPlus />
      </button>
    </div>
  );
}

/** Figma Card/Action/Plus·Minus 12px — glyph는 inset 20%(가운데 7.2px) 안에 있다 */
function ZoomGlyph({ isPlus }: { isPlus: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d={isPlus ? 'M2.4 6H9.6M6 2.4V9.6' : 'M2.4 6H9.6'} stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" />
    </svg>
  );
}

function FitWidthIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M1 6H11M1 6L3.2 3.8M1 6L3.2 8.2M11 6L8.8 3.8M11 6L8.8 8.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FitHeightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M6 1V11M6 1L3.8 3.2M6 1L8.2 3.2M6 11L3.8 8.8M6 11L8.2 8.8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 재정합 — Figma(544:3168)에는 fit width/height 컨트롤이 없다. N5의 주요
 * 위계(검수 콘텐츠 → section/block 선택 → 확인/수정 → 저장)에서 이 기능은
 * zoom과 같은 급의 유틸리티일 뿐이라, 이전의 "가로 맞춤/세로 맞춤" 큰 텍스트
 * pill 대신 ZoomControls와 같은 톤(작은 아이콘 버튼, orange 없음, title
 * 툴팁으로만 기능명 제공)으로 낮췄다 — 클릭 기능(fit width/height)과
 * data-testid는 그대로 유지한다.
 */
export function FitControls({
  onFitWidth,
  onFitHeight,
}: {
  onFitWidth: () => void;
  onFitHeight: () => void;
}) {
  return (
    <div data-testid="n5-fit-controls" className="pointer-events-auto flex items-center gap-1">
      <button
        type="button"
        data-testid="n5-fit-width"
        title="가로에 맞춤"
        onClick={onFitWidth}
        className="flex size-5 items-center justify-center rounded-[4px] text-[#999] transition-colors hover:bg-[#f5f5f5] hover:text-[#171717]"
      >
        <FitWidthIcon />
      </button>
      <button
        type="button"
        data-testid="n5-fit-height"
        title="세로에 맞춤"
        onClick={onFitHeight}
        className="flex size-5 items-center justify-center rounded-[4px] text-[#999] transition-colors hover:bg-[#f5f5f5] hover:text-[#171717]"
      >
        <FitHeightIcon />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// BlockFontScaleToolbar — 선택 block의 글자크기 조작(Figma 1507:21925). 크기 119×38.
//
// 글자 크기 저장 계약(단위·기준점·재렌더)이 아직 없어 버튼은 disabled다. 삭제하기·실행 취소와
// 같은 disabled + title 패턴이고, 서버 요청을 만들지 않는다.
// ─────────────────────────────────────────────────────────────────

export const BLOCK_FONT_SCALE_TOOLBAR_SIZE = { width: 119, height: 38 };

const FONT_SCALE_COMING_SOON = '글자 크기 조정은 아직 저장할 수 없습니다.';

function FontScaleButton({ testId, label, isPlus }: { testId: string; label: string; isPlus: boolean }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={FONT_SCALE_COMING_SOON}
      disabled
      className="flex size-7 shrink-0 cursor-not-allowed items-center justify-center rounded-[4px] bg-[#f5f5f5] text-[#999]"
    >
      <ZoomGlyph isPlus={isPlus} />
    </button>
  );
}

export function BlockFontScaleToolbar({ showTail }: { showTail: boolean }) {
  return (
    <div
      data-testid="n5-font-scale-toolbar"
      role="group"
      aria-label="글자크기"
      className="relative flex items-center gap-1 rounded-[8px] border border-[#ff6a38] bg-white py-1 pr-1 pl-2"
      style={{ width: BLOCK_FONT_SCALE_TOOLBAR_SIZE.width }}
    >
      <p className="flex-1 text-[12px] leading-[normal] font-light tracking-[-0.04em] whitespace-nowrap text-[#ff6a38]">글자크기</p>
      <FontScaleButton testId="n5-font-scale-increase" label="글자 크게" isPlus />
      <FontScaleButton testId="n5-font-scale-decrease" label="글자 작게" isPlus={false} />
      {/* action handle을 가리키는 꼬리. workspace 끝에서 밀려 handle과 겹치면 그리지 않는다 */}
      {showTail && (
        <svg
          width="11"
          height="12"
          viewBox="0 0 11 12"
          fill="none"
          aria-hidden="true"
          className="absolute top-1/2 right-[calc(100%-1px)] -translate-y-1/2"
        >
          <path d="M10.5 0.5L0.8 6L10.5 11.5" fill="white" stroke="#ff6a38" />
          <path d="M11 1V11" stroke="white" strokeWidth="1.5" />
        </svg>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// UndoRedoControls — 캔버스 좌하단 독립 그룹(Figma 544:3168 「After」 1512:23333).
// 활성 여부와 동작은 N5Viewport의 이력(lib/n5/history.ts)이 정한다. 비활성 글자색은 Figma에 없어 다른 비활성과 같은 #999로 보완했다.
// ─────────────────────────────────────────────────────────────────

/** Figma 53:1249 「Card/Action/Undo」 20px glyph — 원격 asset 좌표를 20×20 slot 위치 그대로 옮겼다 */
function UndoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <g transform="translate(2.75 5.25)" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.25 0.75L0.75 4.25L4.25 7.75" />
        <path d="M1.25 4.25H7.75C9.07608 4.25 10.3479 4.77678 11.2855 5.71447C12.2232 6.65215 12.75 7.92392 12.75 9.25" />
      </g>
    </svg>
  );
}

/** Figma 53:1270 「Card/Action/Redo」 20px glyph */
function RedoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <g transform="translate(3.75 5.25)" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.25 0.75L12.75 4.25L9.25 7.75" />
        <path d="M12.25 4.25H5.75C4.42392 4.25 3.15215 4.77678 2.21447 5.71447C1.27678 6.65215 0.75 7.92392 0.75 9.25" />
      </g>
    </svg>
  );
}

function UndoRedoButton({
  testId,
  label,
  enabled,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  enabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      disabled={!enabled}
      onClick={onClick}
      className="flex size-12 shrink-0 items-center justify-center border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-[#999] disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}

export function UndoRedoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div data-testid="n5-undo-redo" role="group" aria-label="실행 취소·다시 실행" className="flex items-start">
      <UndoRedoButton testId="n5-undo" label="실행 취소" enabled={canUndo} onClick={onUndo}>
        <UndoIcon />
      </UndoRedoButton>
      <UndoRedoButton testId="n5-redo" label="다시 실행" enabled={canRedo} onClick={onRedo}>
        <RedoIcon />
      </UndoRedoButton>
    </div>
  );
}
