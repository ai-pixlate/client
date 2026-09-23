import { useState } from 'react';

import { parseZoomPercentInput, type N5ViewMode } from '@/lib/n5/viewport';

// ─────────────────────────────────────────────────────────────────
// N5 조작 컨트롤 모음 — ViewModeToggle(번역문/원문 독립 버튼 2개) +
// ZoomControls(-/입력/+) + FitControls(fit width/height, compact icon) +
// PlacementToolbar(하단 배치 편집 툴). Figma 544:3168 기준.
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
// 라벨(재정합): Figma(node 544:3168, "번역문"/"원문")가 실제 정답이었다 —
// 이전 "번역 후"/"번역 전"은 v3.4.1 FE 메모 기준 추정이었는데, Figma를 다시
// 직접 대조한 결과 실제 버튼 문구는 "번역문"/"원문"이 맞다(v3.4.1 메모가
// 낡은 값이었다). mode 값 자체('translated'/'original')는 그대로 유지한다
// — 라벨(사람이 보는 문구)만 바꾸고 상태값(코드가 쓰는 값)은 API/selection
// 로직과 무관하므로 건드릴 이유가 없다.
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
            className={`rounded-[4px] border px-3 py-2 text-[12px] tracking-[-0.02em] transition-colors duration-150 ${
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
      className="pointer-events-auto flex items-center gap-2 text-[12px] font-light tracking-[-0.02em] text-[#999]"
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
// PlacementToolbar — workspace 하단 중앙 "배치 편집 툴"(Figma 686:8207,
// 약 148×48). 텍스트 선택 / 섹션 선택 / 삭제하기 3개 도구.
//
// N5 3차 정렬 — 텍스트 선택/섹션 선택을 실제로 클릭 가능한 tool로 바꿨다.
// 새 API나 선택 데이터를 만들지 않는다 — n5-viewport.tsx가 로컬 UI state
// (selectionTool: 'text'|'section', 기본 'text')로 "지금 클릭이 block
// 선택인지 section 선택인지"만 해석하고, 실제 선택 정본(selectedBlockId/
// selectedSectionId)은 여전히 N5View가 그대로 소유한다. 이 컴포넌트
// 자신은 순수 presentational이다 — activeTool 표시와 두 개 클릭 콜백만
// 받는다.
//
// - 텍스트 선택(기본값): block을 누르면 그 block을, 빈 section 배경을
//   누르면 그 section을 선택한다 — 지금까지의 기본 클릭 동작 그대로다.
// - 섹션 선택: block 위를 눌러도 block이 아니라 그 block이 속한 section만
//   선택한다(block 선택은 만들지 않는다).
// - 삭제하기: 이 코드베이스에 block/section을 실제로 지우는 API나 handler가
//   없다(N3/N5의 "제외하기"는 bucket/isExcluded를 바꿀 뿐 데이터를 지우지
//   않는다 — 같은 기능으로 임의 연결하지 않았다). Figma의 시각 요소는
//   그대로 만들되, 실제 삭제 기능이 없다는 걸 disabled + title로 정직하게
//   보여준다(ProcessingStageLayout의 일시정지 버튼과 같은 기존 패턴).
//
// N5 3차 디테일 정렬 — 아래 세 아이콘은 "의미만 비슷한" 임의 SVG가 아니라
// Figma 실제 asset(node 686:7988/7990/7996)을 다운로드해 path 좌표를
// 그대로 옮긴 것이다(이 프로젝트 관례상 만료되는 Figma 원격 URL을
// 코드에 하드링크하지 않고, 좌표만 옮겨 inline SVG로 재구현한다 — 다른
// 아이콘들과 같은 패턴). 각 아이콘은 Figma가 그 Glyph를 담는 slot
// 크기(Pointer 24×24, Section/Delete 20×20) 그대로 viewBox를 잡았다.
// ─────────────────────────────────────────────────────────────────

/** Figma 686:7988 "Card/Editor/Pointer" — 24×24 glyph slot, stroke 1.5, fill white(버튼 배경과 동색이라 컷아웃처럼 보임). */
function PointerIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 3.6L18.8 13.2L13.76 14.04L16.4 18.96L13.88 20.28L11.24 15.24L8 18V3.6Z"
        fill="white"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Figma 686:7990 — 실제로는 asset이 아니라 순수 사각형 테두리(14×8, 1.25px, 각진 모서리)다. 20×20 glyph slot 중앙에 위치. */
function SectionSelectIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="14" height="8" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

/** Figma 686:7996 "Card/Action/Trash" — 20×20 glyph slot, stroke 1.25. */
function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4.5 6H15.5M8 3.5H12M6 6L6.7 16H13.3L14 6M8.5 8.5V13.5M11.5 8.5V13.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Figma 686:7988 "Tool / Pointer" — 텍스트/block 선택 도구. 48×48, 항상
 * bg-white. 9/23 재확인(686:8230 component set 전체, select/section/trash
 * 3개 variant 대조) — 활성(selected) 상태만 rounded-full(원)+border-orange고,
 * 비활성 상태는 rounded-[6px](각진 사각형)+border-[#eaeaea]다(686:8231
 * "Property 1=section"의 비활성 Pointer가 실제로 이 값). 이전엔 비활성일 때도
 * 항상 rounded-full+border-transparent라 "테두리만 없어진 원"으로 보였는데,
 * Figma는 모양 자체(원↔사각)가 바뀌는 걸 보여준다.
 */
function ToolPointerButton({ isActive, onClick }: { isActive: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="n5-tool-text"
      title="텍스트 선택"
      aria-label="텍스트 선택"
      aria-pressed={isActive}
      onClick={onClick}
      className={`flex size-12 shrink-0 items-center justify-center border bg-white transition-colors ${
        isActive
          ? 'rounded-full border-[#ff6a38] text-[#ff6a38]'
          : 'rounded-[6px] border-[#eaeaea] text-[#171717] hover:bg-[#f5f5f5]'
      }`}
    >
      <PointerIcon />
    </button>
  );
}

/**
 * Figma 686:7989 "After" — 두 Icon Button(686:7990 섹션 선택, 686:7996
 * 삭제)이 하나로 붙어 있는 96×48 그룹. 개별 버튼에 각자 좌/우 모서리만
 * (rounded-bl/tl, rounded-br/tr) 라운드가 걸려 있는 걸 그대로 옮기는 대신,
 * 그룹 wrapper 하나에 overflow-hidden + rounded-[6px]를 줘서 같은 시각
 * 결과(바깥 4모서리만 6px, 가운데 접합부는 각짐)를 얻는다 — 두 버튼을
 * "따로 둥근 버튼"처럼 보이지 않게 하는 핵심이 이 wrapper다. 이 그룹으로
 * 묶인 버튼은 자기 자신에 rounded를 주지 않는다(래퍼의 clip이 전담).
 */
function ConnectedToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex shrink-0 items-stretch overflow-hidden rounded-[6px]">{children}</div>;
}

/**
 * Figma 686:7990 — 48×48, bg-white, border(1px solid). 기본 #eaeaea, 선택
 * 시 rounded-full+#ff6a38(Pointer와 같은 "활성=원, 비활성=각진 사각" 규칙,
 * 686:8231 "Property 1=section"의 활성 Section이 실제로 원이다).
 *
 * `joined`(686:8230 component set 재확인, 9/23) — 이 버튼이 Delete와 96px
 * 짝으로 붙는 경우(activeTool==='text', ConnectedToolGroup 안)에만 true다.
 * 이때는 자기 rounded를 비워 래퍼 clip에 맡긴다. activeTool==='section'이면
 * Section 자신이 활성(원)이 되면서 Pointer/Delete 사이에서 떨어져 나오므로
 * joined가 아니다(어차피 그 상태에서 이 버튼은 항상 active라 rounded-full).
 */
function SectionSelectButton({
  isActive,
  joined,
  onClick,
}: {
  isActive: boolean;
  joined: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="n5-tool-section"
      title="섹션 선택"
      aria-label="섹션 선택"
      aria-pressed={isActive}
      onClick={onClick}
      className={`flex size-12 shrink-0 items-center justify-center border bg-white transition-colors ${
        isActive
          ? 'rounded-full border-[#ff6a38] text-[#ff6a38]'
          : `${joined ? '' : 'rounded-[6px]'} border-[#eaeaea] text-[#171717] hover:bg-[#f5f5f5]`
      }`}
    >
      <SectionSelectIcon />
    </button>
  );
}

/**
 * Figma 686:7996 — 48×48, bg-[#f5f5f5], border 없음. 실제 delete
 * handler/API가 없어(요청 6) disabled를 유지한다 — Figma가 이 인스턴스에서
 * 이미 이 muted 톤(#f5f5f5, border 없음)으로 보여주고 있어 "비활성처럼
 * 보이는 기본 상태"와 "실제 disabled"가 우연히 같은 톤으로 일치한다.
 *
 * `joined` — Section과 96px 짝으로 붙을 때(activeTool==='text')만 true,
 * 그때는 rounded를 비워 ConnectedToolGroup 래퍼 clip에 맡긴다.
 * activeTool==='section'이면 Section이 가운데서 활성화되며 Pointer/Delete가
 * 서로 붙어있지 않게 되므로(686:8231) 이 버튼은 독립된 48×48
 * rounded-[6px] 사각형이 된다.
 */
function DeleteButton({ joined }: { joined: boolean }) {
  return (
    <button
      type="button"
      data-testid="n5-tool-delete"
      title="삭제 기능은 아직 제공되지 않습니다."
      disabled
      aria-disabled="true"
      className={`flex size-12 shrink-0 cursor-not-allowed items-center justify-center bg-[#f5f5f5] text-[#999] ${
        joined ? '' : 'rounded-[6px]'
      }`}
    >
      <TrashIcon />
    </button>
  );
}

/**
 * Figma 686:8230 — 단일 컴포넌트가 아니라 select/section/trash 3-variant
 * component set이다(9/23 재확인). 이 앱은 activeTool: 'text'|'section'만
 * 실제로 도달 가능하므로(delete는 API가 없어 항상 disabled, 실제 활성
 * 상태로 전환되지 않는다) 그 두 variant만 실제 인터랙션으로 구현하되,
 * Figma가 보여준 상태 모델(어떤 버튼이 붙는지/어디에 4px gap이 생기는지/
 * 전체 width가 바뀌는지)은 그대로 따른다:
 *
 *   select(686:8207, activeTool==='text', 148×48)
 *     Pointer(원,active) [4px] After그룹[Section+Delete 96px, 붙어있음]
 *
 *   section(686:8231, activeTool==='section', 152×48)
 *     Pointer(각진,비활성) [4px] Section(원,active) [4px] Delete(각진,비활성)
 *     — Section이 가운데서 활성화되며 Pointer/Delete와 떨어지므로 셋 다
 *       독립 버튼이 되고, 부모의 gap-1(4px)이 사이마다 그대로 적용돼
 *       48×3 + 4×2 = 152가 된다(추가 wrapper 없이 <>Fragment</>로 형제로
 *       풀어놓기만 하면 부모 gap이 자동으로 그 값을 만든다).
 *
 * 실측(1920×1080, headless Chromium, Playwright bounding rect) — text:
 * 148×48, section: 152×48. 두 값 모두 Figma와 일치를 확인했다(보고 참고).
 */
export function PlacementToolbar({
  activeTool,
  onSelectTextTool,
  onSelectSectionTool,
}: {
  activeTool: 'text' | 'section';
  onSelectTextTool: () => void;
  onSelectSectionTool: () => void;
}) {
  const isTextActive = activeTool === 'text';
  return (
    <div data-testid="n5-placement-toolbar" className="flex items-center gap-1">
      <ToolPointerButton isActive={isTextActive} onClick={onSelectTextTool} />
      {isTextActive ? (
        <ConnectedToolGroup>
          <SectionSelectButton isActive={false} joined onClick={onSelectSectionTool} />
          <DeleteButton joined />
        </ConnectedToolGroup>
      ) : (
        <>
          <SectionSelectButton isActive joined={false} onClick={onSelectSectionTool} />
          <DeleteButton joined={false} />
        </>
      )}
    </div>
  );
}
