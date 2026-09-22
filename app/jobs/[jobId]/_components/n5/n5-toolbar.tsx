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
    <div data-testid="n5-fit-controls" className="flex items-center gap-1">
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
 * bg-white, rounded-[24px](=48px 박스에서 rounded-full과 동일한 완전
 * 원). 선택(active) 상태는 orange 배경이 아니라 "border만 orange로
 * 바뀌는" 것이 Figma가 실제로 보여준 값이다(686:8207 "Property 1=select"
 * — Selected tool은 흰 배경 유지, border/아이콘 색만 orange) — 요청 2·6이
 * 지적한 "단순 orange icon만 적용"이 아니라 컴포넌트 전체 상태(배경 유지 +
 * border 전환)를 그대로 따른다. 비활성 기본은 border-transparent(테두리
 * 없어 보임) — 이 상태의 border 색은 Figma에 명시된 값이 없어(이 인스턴스는
 * 항상 selected로만 캡처돼 있음) 중립적으로 투명 처리했다.
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
      className={`flex size-12 shrink-0 items-center justify-center rounded-full border bg-white transition-colors ${
        isActive ? 'border-[#ff6a38] text-[#ff6a38]' : 'border-transparent text-[#171717] hover:bg-[#f5f5f5]'
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
 * "따로 둥근 버튼"처럼 보이지 않게 하는 핵심이 이 wrapper다.
 */
function ConnectedToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex shrink-0 items-stretch overflow-hidden rounded-[6px]">{children}</div>;
}

/** Figma 686:7990 — 48×48, bg-white, border(1px solid). 기본 #eaeaea, 선택 시 #ff6a38(Pointer와 같은 "배경 유지+border 전환" 규칙). */
function SectionSelectButton({ isActive, onClick }: { isActive: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="n5-tool-section"
      title="섹션 선택"
      aria-label="섹션 선택"
      aria-pressed={isActive}
      onClick={onClick}
      className={`flex size-12 items-center justify-center border bg-white transition-colors ${
        isActive ? 'border-[#ff6a38] text-[#ff6a38]' : 'border-[#eaeaea] text-[#171717] hover:bg-[#f5f5f5]'
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
 */
function DeleteButton() {
  return (
    <button
      type="button"
      data-testid="n5-tool-delete"
      title="삭제 기능은 아직 제공되지 않습니다."
      disabled
      aria-disabled="true"
      className="flex size-12 cursor-not-allowed items-center justify-center bg-[#f5f5f5] text-[#999]"
    >
      <TrashIcon />
    </button>
  );
}

/**
 * Figma 686:8207 "Property 1=select" 인스턴스(686:8237로 N5 화면에
 * 배치) 전체를 그대로 옮긴 컴포넌트다 — 아이콘 3개를 스타일 없이 나열한
 * 것이 아니라, Figma 노드 트리와 1:1 대응하는 하위 컴포넌트로 구성했다:
 *
 *   PlacementToolbar (686:8207, 148×48, gap-[4px])
 *   ├─ ToolPointerButton (686:7988, 48×48)
 *   └─ ConnectedToolGroup (686:7989 "After", 96×48)
 *      ├─ SectionSelectButton (686:7990, 48×48)
 *      └─ DeleteButton (686:7996, 48×48)
 *
 * 실측(1920×1080, headless Chromium): 전체 148×48, Pointer↔After group
 * gap 4px, After group 96×48 — 전부 Figma 값과 일치를 확인했다(보고
 * 참고).
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
  return (
    <div data-testid="n5-placement-toolbar" className="flex items-center gap-1">
      <ToolPointerButton isActive={activeTool === 'text'} onClick={onSelectTextTool} />
      <ConnectedToolGroup>
        <SectionSelectButton isActive={activeTool === 'section'} onClick={onSelectSectionTool} />
        <DeleteButton />
      </ConnectedToolGroup>
    </div>
  );
}
