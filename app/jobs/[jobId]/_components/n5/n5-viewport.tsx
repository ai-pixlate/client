'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from 'react';

import { TypesetBlock } from '@/app/_components/typeset/typeset-block';
import { isApiMockingEnabled } from '@/lib/api/session';
import { isTypesetQaUrl, type TypesetRenderModel } from '@/lib/n5/typeset-render-model';
import { isTypesetRole } from '@/lib/n5/typeset-rules';
import { canRestoreSectionInN5, getBaseFontScale, getSectionCanvasHeaderHeight, getTranslatedBaseBox } from '@/lib/n5/adapter';
import type { SectionInputSync } from '@/lib/n5/adapter';
import { resolvePreviewSectionDisplay, type PreviewSectionDisplaySource } from '@/lib/n5/preview-state';
import type { TypesetFontGate } from './use-typeset-font-gate';
import { computeBlockOverlaps, type BlockOverlap } from '@/lib/n5/overlap';
import type { BlockViewModel, JobMetaViewModel, PreviewSectionViewModel, PreviewViewModel, SectionStatusViewModel } from '@/lib/n5/adapter';
import type { BoundingBox } from '@/lib/api/types';
import { N5_SAVE_NOTICE_MESSAGES } from '@/lib/n5/messages';
import {
  FONT_HANDLE_CENTER_TOP_PX,
  getBlockDisplayRect,
  getCompactRightResizeZone,
  isCompactResizeHeight,
  getBlockHitRect,
  getFontScaleToolbarLeft,
  overlapsFontHandleHitArea,
  screenDeltaToBboxDelta,
  type DisplayRect,
} from '@/lib/n5/coordinates';
import {
  canDecreaseScale,
  canIncreaseScale,
  moveBoxWithCenterSnap,
  N5_FONT_SCALE_STEP,
  N5_SNAP_ACQUIRE_SCREEN_PX,
  N5_SNAP_RELEASE_SCREEN_PX,
  resizeBoxWithinSection,
  startCenterSnapLock,
  type CenterSnapLock,
  type ResizeHandle,
} from '@/lib/n5/layout-edit';
import { CanvasSectionStatus } from './n5-section-status';
import {
  ZOOM_BUTTON_STEP,
  computeWheelZoomFactor,
  computeZoomAroundPoint,
  computeUsableViewportSize,
  computeFitWidthScale,
  computeFitHeightScale,
  computeCenteredPan,
  computeScrollThumb,
  clampPan,
  type N5ViewMode,
  type Point,
  type Size,
} from '@/lib/n5/viewport';
import {
  BLOCK_FONT_SCALE_TOOLBAR_SIZE,
  BlockFontScaleToolbar,
  ZoomControls,
  FitControls,
  UndoRedoControls,
} from './n5-toolbar';
import { isTypingTarget, type N5EditSessionApi } from './use-n5-edit-session';

// ─────────────────────────────────────────────────────────────────
// N5 — 캔버스형 viewport (Figma 544:3168 "N5 검수" 기준)
//
// 3단계(v3.4.2 실제 계약 연결): GET /jobs/{jobId}/preview는 sourceImage 하나를
// 통째로 내려주던 구 계약과 다르다 — 섹션마다 이미 own originalUrl/renderedUrl이
// 개별 발급된다. 그래서 이전의 naturalWidth 측정(useNaturalWidths) + 단일
// sourceImage를 backgroundPosition으로 잘라 쓰는 구조를 전부 없앴다. 이제 각
// section을 own 이미지로 그대로 그리기만 하면 된다 — section.width/height(원본
// px)에 preview.scale을 곱해 크기를 정하고, section 목록을 sectionOrder 순서로
// 쌓는다(단순 document flow, absolute 배치 아님 — 이전 구조와 동일).
//
// zoom/pan/fit(transform 하나만 정본, native scroll 없음)과 F-CFM-14(N5 제외
// section 오버레이)는 계약 변경과 무관하므로 그대로 유지한다. mode(번역 전/후)도
// 여전히 상위(N5View)가 소유하고 이 컴포넌트는 prop으로만 받는다 — 토글해도
// zoom/pan은 건드리지 않으므로 "토글 전환 시 zoom/pan 유지" 계약이 그대로다.
//
// renderedUrl===null(PreviewSectionViewModel.render.status !== 'ready')을 실패로
// 단정하지 않는다 — Adapter(resolveSectionRenderState)가 이미 제외/렌더전을
// 구분해 뒀고, 여기서는 그 결과만 그대로 표시한다.
//
// F-CFM-13(이번 반영, Figma 544:3168 갱신본): 좌/우가 selectedBlockId/
// selectedSectionId 하나를 공유한다(N5View가 정본 소유, 이 컴포넌트는 prop +
// 콜백만 받는다). block bbox는 section-local 좌표라 getBlockDisplayRect(bbox,
// displayTop=0, scale)로 변환한다 — 이미 section 자신의 slice(own 이미지) 안에
// absolute로 얹으므로, 전체 canvas 기준 누적 displayTop을 더할 필요가 없다
// (3단계에서 section별 own 이미지 구조로 바뀌면서 이 부분이 단순해졌다).
//
// 선택 UI는 Figma가 실제로 보여준 값만 쓴다 — 선택된 block: 채움 없는 1px
// orange 테두리 + 번호 배지 색(BlockPinBadge, 우측 panel의 BlockNumberBadge와 같은 규칙) +
// 핸들 8개·글자크기 action handle과 툴바(BlockSelectionChrome, 저장 계약 없음).
// 선택된 section: 슬라이스 바로 위에 뜨는 "SectionN" 태그
// (Tag/Selectable, border-[#ff6a38] bg-white text-[#ff6a38]). 선택 안 된
// section에는 이 태그 자체를 렌더하지 않는다 — Figma가 "기본(미선택)"
// variant를 보여주지 않아 값을 추측하지 않기 위함이고, absolute 배치라 넣고
// 빼도 레이아웃(스크롤/줌) reflow가 없다.
//
// section 배경(태그가 없는 빈 영역)을 클릭하면 그 section만 선택한다(block
// 선택은 해제). block hitbox는 stopPropagation으로 이 section 클릭과 분리한다
// (선택·제외 조작이 서로 충돌하지 않게 — CLAUDE.md 클릭 영역 분리 원칙).
//
// 10/19 — block 클릭 영역 확대. 이전엔 클릭 영역이 OCR bbox × scale과 같아서
// 글씨가 작거나 축소해서 볼 때 여러 번 눌러야 선택됐다. 이제 block마다 두
// 사각형을 따로 둔다.
// - visual rect: bbox 그대로(선택 테두리, keyboard focus, 기존 testid).
// - hit rect: 화면 기준 8px 바깥 여백 + 최소 32px. 보이지 않는 클릭 전용 층이다
//   (lib/n5/coordinates.ts getBlockHitRect, section 밖으로는 나가지 않는다).
// 인접 block의 hit rect가 겹쳐도 엉뚱한 block이 잡히지 않도록 쌓는 순서를
// 정했다: 모든 hit rect(z-1, 작은 block이 위) < 모든 visual rect(z-2) < 번호
// 배지(z-10). 즉 실제 bbox 안을 누르면 항상 그 block이 선택되고, 여백끼리
// 겹치는 곳에서는 작은 block이 우선한다. 번호 배지도 같은 선택 동작을 한다.
// 세 층 모두 stopPropagation으로 부모 section 클릭이 뒤따라 선택을 덮어쓰지
// 않게 한다. section tool일 때는 세 층 모두 기존 정책대로 section을 선택한다.
//
// F-CFM-13 양방향 이동(PRD v3.4.2 수용기준 2·3, 9/24 반영) — 이전엔 우측→좌측
// 방향이 "표시만"(자동 pan 없음)이었다. selectedBlockId/selectedSectionId는
// 이미 N5View가 소유한 하나의 공유 상태이고, 우측(n5-panel.tsx BlockRow의
// card 클릭/textarea 포커스)에서 이 상태가 바뀌어도 이 컴포넌트는 그 값을
// highlight 표시(BlockOverlay/SectionSelectedTag의 isSelected)에만 쓰고
// pan은 전혀 움직이지 않았다 — 좌→우(패널 자동 스크롤, n5-panel.tsx)만
// 구현돼 있고 반대 방향이 미완성이었다(정확한 원인은 아래 selectionAutoMove
// effect 주석 참고). 이제 selectedBlockId(우선)/selectedSectionId가 가리키는
// block/section의 canvas-space rect를 계산해 이미 화면에 충분히 보이면
// 그대로 두고, 화면 밖이면 그 rect가 보이는 위치로 pan만 옮긴다(zoom은
// 그대로). 텍스트 입력 중이나 PATCH/rerender로 blocks가 재조회될 때는
// 재계산하지 않지만, 이미 선택된 같은 block/section을 사용자가 다시
// 클릭했을 때는(값 자체는 안 바뀌어도) 다시 계산한다 — revealRequestSeq
// (n5-view.tsx 소유, 아래 selectionAutoMove effect 주석 참고)가 그 구분을
// 담당한다. 좌측→우측 자동 스크롤은 여전히 n5-panel.tsx가 담당한다(이
// 파일은 손대지 않았다).
// ─────────────────────────────────────────────────────────────────

interface CanvasSlice {
  sectionId: number;
  sectionOrder: number;
  /** scale 적용된 표시 높이 */
  height: number;
  /** scale 적용된 표시 폭 */
  width: number;
  originalUrl: string | null;
  render: PreviewSectionViewModel['render'];
  /** 서버 결과 이미지(이전 결과 포함). 최신 여부는 display 로 본다 */
  renderedUrl: string | null;
  /** renderInput 배경(글자 없는 바탕) */
  background: PreviewSectionViewModel['background'];
  /** 「번역 후」 표시 소스(lib/n5/preview-state.ts resolvePreviewSectionDisplay) — renderedUrl·renderInput·isCurrent 를 여기서 다시 판단하지 않는다 */
  display: PreviewSectionDisplaySource;
  /** 서버 bucket/excludedStage 파생(render.status==='excluded') — 제외 여부의 정본 */
  isExcluded: boolean;
  /** N5 [되돌리기] 가능 여부. N3 에서 제외된 섹션은 false(canRestoreSectionInN5) */
  canRestore: boolean;
}

/**
 * PreviewSectionViewModel 목록(이미 sectionOrder 오름차순, Adapter가 정렬)으로부터
 * 캔버스에 그릴 slice 목록을 만든다. F-CFM-14 — N5에서 제외된 section도 slice로
 * 남겨 같은 자리·같은 높이를 유지하고, 그 위에 회색 오버레이만 덮는다(구 구조와
 * 동일한 정책, 걸러내지 않는다).
 */
function buildSectionSlices(
  sections: PreviewSectionViewModel[],
  scale: number,
  displayOf: (section: PreviewSectionViewModel) => PreviewSectionDisplaySource,
): CanvasSlice[] {
  return sections.map((section) => ({
    sectionId: section.id,
    sectionOrder: section.sectionOrder,
    height: section.height * scale,
    width: section.width * scale,
    originalUrl: section.originalUrl,
    render: section.render,
    renderedUrl: section.renderedUrl,
    background: section.background,
    display: displayOf(section),
    isExcluded: section.render.status === 'excluded',
    canRestore: canRestoreSectionInN5(section),
  }));
}

/** Figma Tag/Selectable(Selected) */
function SectionTagLabel({ sectionOrder }: { sectionOrder: number }) {
  return (
    <div
      data-testid="n5-section-selected-tag"
      className="flex h-7 w-fit items-center justify-center rounded-[6px] border border-[#ff6a38] bg-white px-2 text-[12px] leading-[14px] whitespace-nowrap text-[#ff6a38]"
    >
      Section{sectionOrder}
    </div>
  );
}

/** 선택된 section 위에 뜨는 태그(Figma 903:7235 — section 위 gap 4). 이미지 위 overlay라 위치를 밀지 않는다 */
function SectionSelectedTag({ sectionOrder }: { sectionOrder: number }) {
  return (
    <div className="absolute -top-[33px] left-0 z-10">
      <SectionTagLabel sectionOrder={sectionOrder} />
    </div>
  );
}

/** 첫 section의 태그가 canvas 위 여백에 걸치는 만큼(정상 화면의 태그 위치 y123과 같게 한다) */
const FIRST_SECTION_HEADER_OVERHANG_PX = 33;

/** 상태 공간 중 문서 흐름에서 차지하는 높이 */
function sectionFlowHeaderHeight(headerHeight: number, sliceIndex: number): number {
  if (headerHeight === 0) return 0;
  return sliceIndex === 0 ? headerHeight - FIRST_SECTION_HEADER_OVERHANG_PX : headerHeight;
}

/**
 * section 상태가 있으면 이미지 위 공간을 실제로 차지한다(Figma 1244:8444 — 태그, 16 아래 상태 행, 4 아래 이미지).
 * 이미지 좌표를 밀어내므로 canvas 높이·선택 위치 계산도 sectionFlowHeight 로 이 공간을 함께 센다.
 */
function SectionStatusHeader({
  height,
  overhang,
  sectionOrder,
  isSelected,
  status,
  width,
}: {
  height: number;
  overhang: number;
  sectionOrder: number;
  isSelected: boolean;
  status: SectionStatusViewModel;
  width: number;
}) {
  return (
    <div
      data-testid={`n5-section-header-${sectionOrder}`}
      className="relative z-10 shrink-0"
      style={{ height, width, marginTop: -overhang }}
    >
      {isSelected && <SectionTagLabel sectionOrder={sectionOrder} />}
      <div className="absolute top-11 left-0">
        <CanvasSectionStatus status={status} />
      </div>
    </div>
  );
}

/**
 * 7단계 — Figma(544:3168 재확인)는 좌측 canvas의 각 block 좌상단에도 우측
 * panel과 같은 번호 배지(BlockNumberBadge, n5-panel.tsx)를 보여준다. 이전엔
 * canvas 쪽에 번호 배지가 전혀 없었다 — 색/모양은 우측 배지와 동일하게
 * 맞추고, block rect의 좌상단 모서리에 걸치도록 배치한다(Figma가 보여준
 * "텍스트 바로 옆" 위치를 일반화한 규칙).
 */
/** n5-panel.tsx BlockNumberBadge와 같은 규칙 — leading-none으로 폰트
 *  line-height가 만드는 수직 오프셋을 없애 숫자를 정중앙에 둔다(N5 3차
 *  디테일 정렬, 좌/우 배지가 같은 컴포넌트 톤을 공유하므로 동일하게 고친다). */
function BlockPinBadge({ index, isSelected }: { index: number; isSelected: boolean }) {
  return (
    <span
      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] leading-none ${
        isSelected ? 'bg-[#ff6a38] text-white' : 'border border-[#eaeaea] bg-white text-[#171717]'
      }`}
    >
      {index}
    </span>
  );
}

/** 화면 px 기준 hit 여백/최소 크기 — getBlockHitRect가 현재 zoom으로 canvas 좌표로 바꾼다. */
const BLOCK_HIT_PADDING_PX = 8;
const BLOCK_HIT_MIN_SIZE_PX = 32;

/** visual rect와 hit rect를 함께 들고 다니는 block 단위 묶음(같은 section 안). */
interface BlockRects {
  block: BlockViewModel;
  visualRect: DisplayRect;
  hitRect: DisplayRect;
}

function buildBlockRects(
  blocks: BlockViewModel[],
  scale: number,
  zoom: number,
  bounds: { width: number; height: number },
): BlockRects[] {
  const result: BlockRects[] = [];
  for (const block of blocks) {
    if (!block.bbox) continue;
    const visualRect = getBlockDisplayRect(block.bbox, 0, scale);
    const hitRect = getBlockHitRect(visualRect, {
      paddingPx: BLOCK_HIT_PADDING_PX,
      minSizePx: BLOCK_HIT_MIN_SIZE_PX,
      zoom,
      bounds,
    });
    result.push({ block, visualRect, hitRect });
  }
  return result;
}

/** hit rect를 그리는 순서 — 큰 block 먼저, 작은 block을 나중에(위에) 둔다. */
function orderForHitLayer(rects: BlockRects[]): BlockRects[] {
  const area = (r: DisplayRect) => r.width * r.height;
  return [...rects].sort((a, b) => area(b.visualRect) - area(a.visualRect));
}

function stopAndRun(onSelect: () => void) {
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  };
}

/** 보이지 않는 클릭 전용 층. 접근성 트리와 tab 순서에는 visual rect만 남긴다. */
function BlockHitArea({ blockId, hitRect, onSelect }: { blockId: number; hitRect: DisplayRect; onSelect: () => void }) {
  return (
    <div
      aria-hidden="true"
      data-testid={`n5-block-hit-${blockId}`}
      onClick={stopAndRun(onSelect)}
      className="absolute z-[1] cursor-pointer"
      style={{ left: hitRect.left, top: hitRect.top, width: hitRect.width, height: hitRect.height }}
    />
  );
}

interface BlockBodyDragHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, block: BlockViewModel) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (e: React.PointerEvent<HTMLDivElement>) => void;
}

function BlockOverlay({
  block,
  visualRect,
  index,
  isSelected,
  fontScale,
  onSelect,
  drag,
}: {
  block: BlockViewModel;
  visualRect: DisplayRect;
  index: number;
  isSelected: boolean;
  /** 사용자 글자 배율(세션 local). 화면에 보이지 않는 테스트 hook으로만 내보낸다 */
  fontScale: number;
  /** block을 선택하는 클릭 동작 */
  onSelect: () => void;
  /** 본체 끌어 옮기기. 「번역 후」 화면에서만 있다 */
  drag: BlockBodyDragHandlers | null;
}) {
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        data-testid={`n5-block-overlay-${block.id}`}
        data-font-scale={fontScale}
        onClick={stopAndRun(onSelect)}
        onPointerDown={drag ? (e) => drag.onPointerDown(e, block) : undefined}
        onPointerMove={drag?.onPointerMove}
        onPointerUp={drag?.onPointerEnd}
        onPointerCancel={drag?.onPointerEnd}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }}
        className={`absolute z-[2] ${isSelected ? 'border border-[#ff6a38]' : ''} ${drag ? 'cursor-move' : 'cursor-pointer'}`}
        style={{ left: visualRect.left, top: visualRect.top, width: visualRect.width, height: visualRect.height }}
      />
      <div
        aria-hidden="true"
        data-testid={`n5-block-pin-${block.id}`}
        onClick={stopAndRun(onSelect)}
        // 선택된 block은 번호를 다시 누를 일이 없다 — 아래 왼쪽 위 손잡이를 끌 수 있게 통과시킨다
        className={`absolute z-10 ${isSelected ? 'pointer-events-none' : 'cursor-pointer'}`}
        // 9/23 재확인 — rect.left/top은 preview.scale(소수)이 곱해진 값이라
        // 그대로 쓰면 배지가 소수 px 위치에 놓인다. Playwright로 Pretendard
        // leading-none 배지의 실제 glyph-vs-circle 중심 오차를 측정한 결과
        // (숫자 1~9 전량, 소수/정수 offset 양쪽 모두) dx/dy가 0.01px 이내로
        // 이미 사실상 완전히 중앙이었다 — 배지 자체의 flex 정렬은 깨져있지
        // 않다. 다만 소수 px 위치는 브라우저마다 서브픽셀 렌더링 방식이 달라
        // 미세한 흐림/치우침 인상을 줄 수 있어, 정수 px로 스냅한다(패딩/
        // translate로 임의 보정한 값이 아니라 위치 자체를 반올림한 것).
        style={{ left: Math.round(visualRect.left - 8), top: Math.round(visualRect.top - 8) }}
      >
        <BlockPinBadge index={index} isSelected={isSelected} />
      </div>
    </>
  );
}

const HANDLE_POSITIONS: { key: ResizeHandle; x: number; y: number; cursor: string }[] = [
  { key: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { key: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { key: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { key: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
  { key: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { key: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { key: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { key: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
];

// Figma 1512:23496 실측(화면 px) — action handle 중심은 block 오른쪽 변 위, block 위에서 18. 툴바는 block 오른쪽 25
/** 이만큼 움직여야 클릭이 아니라 끌기로 본다(화면 px) */
const BLOCK_DRAG_START_DISTANCE_PX = 3;
const FONT_HANDLE_SIZE_PX = 12;
const FONT_TOOLBAR_GAP_PX = 25;
const FONT_TOOLBAR_TAIL_WIDTH_PX = 11;

/**
 * 선택 block의 핸들 8개·글자크기 action handle·툴바(Figma 1512:23496). section 밖 canvas overlay에 그려서
 * section 경계와 무관하고, canvas transform을 함께 받아 zoom·pan을 그대로 따라간다. 화면 크기는 zoom과 무관하다.
 *
 * 핸들 8개(F-CFM-15)는 영역 크기만 바꾸고 section 밖으로 넓히지 못한다. [+][-]는 글자 배율과 박스를 함께 바꾼다.
 * 둘 다 이 세션의 local 초안만 바꾼다 — 저장 계약이 없어 서버 요청을 만들지 않는다. 캔버스의 글자는 서버 렌더 이미지라
 * 재렌더 계약이 생기기 전에는 이미지 속 글자 크기가 바뀌지 않는다.
 * 툴바 열림 상태는 block 하나의 상태라 호출부가 key를 block id로 준다. block이 바뀌거나 선택 UI가 사라지면 닫힌다.
 */
function BlockSelectionChrome({
  bbox,
  section,
  scale,
  onResize,
  onResizeCommit,
  isEditLocked,
  onDragActiveChange,
  fontScale,
  onFontScaleChange,
  fitAutoHeight,
  autoHeightOverflow,
  rect,
  zoom,
  panX,
  usableWidth,
}: {
  /** 현재 표시 중인 bbox(section-local 원본 px) */
  bbox: BoundingBox;
  /** 소속 section 크기(원본 px) */
  section: Size;
  /** preview scale */
  scale: number;
  onResize: (next: BoundingBox) => void;
  /** 손을 놓았을 때 한 번 — 실행 취소 한 단계 */
  onResizeCommit: (before: BoundingBox, after: BoundingBox) => void;
  /** 서버 실행 취소·다시 실행 진행 중 — 새 조작을 시작하지 않는다 */
  isEditLocked: boolean;
  /** 끄는 동안 실행 취소·다시 실행이 끼어들지 않게 알린다 */
  onDragActiveChange: (active: boolean) => void;
  /** 현재 사용자 글자 배율 */
  fontScale: number;
  onFontScaleChange: (direction: 'increase' | 'decrease') => void;
  /**
   * Auto Height(Figma Text) — 조판이 요구하는 높이로 맞춘 박스. 이 값이 있으면 폭만 사용자가 정한다: 모서리의 세로 이동은
   * 쓰지 않고, 세로 전용 n·s 손잡이는 끌리지 않는다. 잴 수 없는 block은 null이고 8방향 자유 조절을 그대로 쓴다.
   */
  fitAutoHeight: ((box: BoundingBox) => BoundingBox | null) | null;
  /** 줄바꿈 결과가 section 아래를 넘어 박스에 다 들어가지 않는다(글자를 줄이거나 자르지 않는다) */
  autoHeightOverflow: boolean;
  /** canvas 기준 block 위치 */
  rect: DisplayRect;
  zoom: number;
  panX: number;
  /** viewport padding 안쪽 폭. pan과 같은 좌표계라 오른쪽 padding을 남기고 멈춘다 */
  usableWidth: number;
}) {
  const [isToolbarOpen, setIsToolbarOpen] = useState(false);
  // 끄는 동안의 조작 방식. 높이·zoom이 바뀌어 compact 경계를 넘어도 손을 놓을 때까지 시작한 방식(과 잡은 요소)을 유지한다
  const [activeDragMode, setActiveDragMode] = useState<'normal' | 'compact' | null>(null);
  // 끌기 시작 시점의 값. pointer capture로 손잡이 밖에서도 이어지고, 해제되면 함께 지운다
  const dragRef = useRef<{
    pointerId: number;
    handle: ResizeHandle;
    startClient: { x: number; y: number };
    startBbox: BoundingBox;
    startZoom: number;
    lastBbox: BoundingBox;
  } | null>(null);
  // 끌기 중 선택 UI가 사라지면 pointerup을 받지 못한다 — 잠금이 남지 않게 함께 푼다
  useEffect(() => () => onDragActiveChange(false), [onDragActiveChange]);

  function handleResizePointerDown(e: React.PointerEvent<HTMLSpanElement>, handle: ResizeHandle) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (isEditLocked || (fitAutoHeight && (handle === 'n' || handle === 's'))) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragActiveChange(true);
    setActiveDragMode(isCompact ? 'compact' : 'normal');
    dragRef.current = {
      pointerId: e.pointerId,
      handle,
      startClient: { x: e.clientX, y: e.clientY },
      startBbox: bbox,
      startZoom: zoom,
      lastBbox: bbox,
    };
  }

  function handleResizePointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const delta = screenDeltaToBboxDelta(
      { x: e.clientX - drag.startClient.x, y: e.clientY - drag.startClient.y },
      scale,
      drag.startZoom,
    );
    // null이면 폭·높이가 0 이하가 되는 위치다 — 직전 유효한 박스를 그대로 둔다
    const next = resizeBoxWithinSection(drag.startBbox, drag.handle, fitAutoHeight ? { x: delta.x, y: 0 } : delta, section);
    if (next) {
      const fitted = fitAutoHeight?.(next) ?? next;
      drag.lastBbox = fitted;
      onResize(fitted);
    }
  }

  function handleResizePointerEnd(e: React.PointerEvent<HTMLSpanElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    dragRef.current = null;
    onDragActiveChange(false);
    setActiveDragMode(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // 시스템이 끌기를 취소하면 시작 전 상태로 돌리고 이력에 남기지 않는다
    if (e.type === 'pointercancel') onResize(drag.startBbox);
    else onResizeCommit(drag.startBbox, drag.lastBbox);
  }

  const inverseScale = `scale(${1 / zoom})`;
  const blockLeft = panX + rect.left * zoom;
  const blockRight = blockLeft + rect.width * zoom;
  const toolbarLeft = getFontScaleToolbarLeft({
    blockLeft,
    blockRight,
    toolbarWidth: BLOCK_FONT_SCALE_TOOLBAR_SIZE.width,
    gap: FONT_TOOLBAR_GAP_PX,
    maxRight: usableWidth,
  });
  // 위치는 block 높이와 무관하다. 낮은 block에서 겹치는 오른쪽 손잡이는 위치가 아니라 누르는 영역으로 나눈다
  const blockScreenHeight = rect.height * zoom;
  // compact — 낮게 보이는 Auto Height block은 오른쪽 손잡이(ne·e·se)를 따로 잡지 않고 오른쪽 변 전체가 가로 resize(e)를 받는다.
  // 높이는 줄바꿈이 정하므로 세 손잡이의 차이는 폭뿐이다. 잴 수 없는 block은 모서리가 높이를 바꾸므로 기존 방식을 쓴다
  const isCompact = activeDragMode ? activeDragMode === 'compact' : fitAutoHeight != null && isCompactResizeHeight(blockScreenHeight);
  const compactZone = isCompact ? getCompactRightResizeZone(rect, zoom) : null;
  const overlapsHandle = (x: number, y: number) => !isCompact && x === 1 && overlapsFontHandleHitArea(blockScreenHeight * y);
  const isFontHandleHitNarrowed = isCompact || HANDLE_POSITIONS.some(({ x, y }) => overlapsHandle(x, y));
  const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      data-testid="n5-block-selection"
      data-auto-height={fitAutoHeight ? 'true' : 'false'}
      data-auto-height-overflow={autoHeightOverflow}
      data-resize-mode={isCompact ? 'compact' : 'normal'}
      className="pointer-events-none absolute inset-0"
    >
      {/* 쌓는 순서: 핸들은 번호 배지(z-10) 아래, 툴바와 action handle은 그 위. 툴바가 밀려 겹쳐도 handle로 닫을 수 있다 */}
      {HANDLE_POSITIONS.map(({ key, x, y, cursor }) => (
        <span
          key={key}
          aria-hidden="true"
          data-testid={`n5-block-handle-${key}`}
          // 8px는 잡기에 작아 before로 잡는 영역만 넓힌다. pointer만 쓰는 조작이라 aria-hidden을 유지한다
          // compact의 오른쪽 손잡이는 보이기만 하고, 누르는 것은 오른쪽 resize 영역이 받는다
          className={`${isCompact && x === 1 ? 'pointer-events-none' : 'pointer-events-auto'} absolute z-[5] box-border size-[7.667px] touch-none rounded-[1.355px] border border-[#ff6a38] bg-white before:absolute ${
            overlapsHandle(x, y) ? 'before:-inset-x-[12px] before:-inset-y-[4px]' : 'before:-inset-[4px]'
          }`}
          style={{
            left: rect.left + rect.width * x,
            top: rect.top + rect.height * y,
            transform: `translate(-50%, -50%) ${inverseScale}`,
            cursor: fitAutoHeight && (key === 'n' || key === 's') ? 'default' : cursor,
          }}
          onPointerDown={(e) => handleResizePointerDown(e, key)}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onClick={stopPropagation}
        />
      ))}
      {compactZone && (
        <span
          aria-hidden="true"
          data-testid="n5-block-resize-zone-right"
          className="pointer-events-auto absolute z-[5] cursor-ew-resize touch-none"
          style={{ left: compactZone.left, top: compactZone.top, width: compactZone.width, height: compactZone.height }}
          onPointerDown={(e) => handleResizePointerDown(e, 'e')}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onClick={stopPropagation}
        />
      )}
      <button
        type="button"
        data-testid="n5-font-scale-handle"
        aria-label="글자크기 조절"
        aria-expanded={isToolbarOpen}
        // 12px는 누르기에 작아 before로 누르는 영역을 16px로 넓힌다. 오른쪽 손잡이와 겹치는 낮은 block·compact에서는 보이는 12px만 받는다
        className={`pointer-events-auto absolute z-[21] cursor-pointer rounded-[2.6px] bg-[#ff6a38] before:absolute ${
          isFontHandleHitNarrowed ? 'before:inset-0' : 'before:-inset-0.5'
        } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]`}
        style={{
          left: rect.left + rect.width,
          top: rect.top + FONT_HANDLE_CENTER_TOP_PX / zoom,
          width: FONT_HANDLE_SIZE_PX,
          height: FONT_HANDLE_SIZE_PX,
          transform: `translate(-50%, -50%) ${inverseScale}`,
        }}
        onPointerDown={stopPropagation}
        onClick={(e) => {
          e.stopPropagation();
          setIsToolbarOpen((open) => !open);
        }}
        // Space는 window에서 pan 키로 먼저 잡는다. 이 버튼에서는 버튼 동작으로 쓴다
        onKeyDown={(e) => {
          if (e.code === 'Space') e.stopPropagation();
        }}
      />
      {isToolbarOpen && (
        <div
          className="pointer-events-auto absolute z-20"
          onPointerDown={stopPropagation}
          onClick={stopPropagation}
          style={{
            left: (toolbarLeft - panX) / zoom,
            top: rect.top + (FONT_HANDLE_CENTER_TOP_PX - BLOCK_FONT_SCALE_TOOLBAR_SIZE.height / 2) / zoom,
            transform: inverseScale,
            transformOrigin: '0 0',
          }}
        >
          <BlockFontScaleToolbar
            showTail={toolbarLeft - blockRight >= FONT_HANDLE_SIZE_PX / 2 + FONT_TOOLBAR_TAIL_WIDTH_PX}
            canIncrease={!isEditLocked && canIncreaseScale({ box: bbox, currentScale: fontScale, step: N5_FONT_SCALE_STEP, section })}
            canDecrease={!isEditLocked && canDecreaseScale({ box: bbox, currentScale: fontScale, step: N5_FONT_SCALE_STEP, section })}
            onIncrease={() => onFontScaleChange('increase')}
            onDecrease={() => onFontScaleChange('decrease')}
          />
        </div>
      )}
    </div>
  );
}

interface SnapGuideState {
  sectionId: number;
  snappedX: boolean;
  snappedY: boolean;
}

/** 끌기 중 가운데선에 붙어 있을 때만 그 section의 중앙선을 보인다. 두께는 zoom과 무관하게 화면 1px */
function SnapGuides({ snappedX, snappedY, zoom }: { snappedX: boolean; snappedY: boolean; zoom: number }) {
  const thickness = 1 / zoom;
  return (
    <>
      {snappedX && (
        <div
          aria-hidden="true"
          data-testid="n5-snap-guide-x"
          className="pointer-events-none absolute inset-y-0 left-1/2 z-[3] -translate-x-1/2 bg-[#ff6a38]"
          style={{ width: thickness }}
        />
      )}
      {snappedY && (
        <div
          aria-hidden="true"
          data-testid="n5-snap-guide-y"
          className="pointer-events-none absolute inset-x-0 top-1/2 z-[3] -translate-y-1/2 bg-[#ff6a38]"
          style={{ height: thickness }}
        />
      )}
    </>
  );
}

interface SnapDebugValues {
  blockId: number;
  pointer: { x: number; y: number };
  start: { x: number; y: number };
  raw: BoundingBox;
  candidate: BoundingBox;
  section: Size;
  acquirePx: number;
  releasePx: number;
  snappedX: boolean;
  snappedY: boolean;
  scale: number;
  zoom: number;
}

/** snap 진단(Mock 전용, ?debugSnap=1) — 끌기 중 계산 값. 이벤트를 받지 않는다 */
function SnapDebugHud({ values: v }: { values: SnapDebugValues | null }) {
  const n = (value: number) => (Math.round(value * 10) / 10).toString();
  const rect = (b: BoundingBox) => `${n(b.x)}, ${n(b.y)}, ${n(b.width)}, ${n(b.height)}`;
  const rows: [string, string][] = v
    ? [
        ['Block', String(v.blockId)],
        ['pointer', `${n(v.pointer.x)}, ${n(v.pointer.y)}`],
        ['drag start', `${n(v.start.x)}, ${n(v.start.y)}`],
        ['raw bbox', rect(v.raw)],
        ['candidate', rect(v.candidate)],
        ['section center', `${n(v.section.width / 2)}, ${n(v.section.height / 2)}`],
        ['block center', `${n(v.candidate.x + v.candidate.width / 2)}, ${n(v.candidate.y + v.candidate.height / 2)}`],
        ['deltaToCenterX', n(v.section.width / 2 - v.candidate.x - v.candidate.width / 2)],
        ['deltaToCenterY', n(v.section.height / 2 - v.candidate.y - v.candidate.height / 2)],
        ['acquire / release', `${v.acquirePx} / ${v.releasePx} px`],
        ['snappedX', String(v.snappedX)],
        ['snappedY', String(v.snappedY)],
        ['previewScale', String(v.scale)],
        ['zoom', n(v.zoom)],
      ]
    : [];
  return (
    <div
      data-testid="n5-snap-hud"
      data-snapped-x={v?.snappedX}
      data-snapped-y={v?.snappedY}
      className="pointer-events-none absolute top-[84px] left-8 z-10 w-[300px] rounded-[6px] border border-[#eaeaea] bg-white p-3 text-[11px] leading-[16px] text-[#171717]"
    >
      <p className="font-medium">snap 진단</p>
      {v ? (
        rows.map(([label, value]) => (
          <p key={label} className="flex justify-between gap-2">
            <span className="text-[#707070]">{label}</span>
            <span>{value}</span>
          </p>
        ))
      ) : (
        <p className="text-[#707070]">block 본체를 끌어 보세요</p>
      )}
    </div>
  );
}

/** 겹침 진단(Mock 전용) — 겹친 block은 점선과 번호, 겹친 영역은 옅은 주황. 이벤트를 받지 않아 실제 선택에 영향이 없다 */
function OverlapDiagnosticLayer({
  overlaps,
  scale,
  zoom,
  blockIndexById,
}: {
  overlaps: BlockOverlap[];
  scale: number;
  zoom: number;
  blockIndexById: Map<number, number>;
}) {
  return (
    <>
      {overlaps.map(({ blockId, box, intersection }) => {
        const other = getBlockDisplayRect(box, 0, scale);
        const shared = getBlockDisplayRect(intersection, 0, scale);
        return (
          <Fragment key={blockId}>
            <div
              aria-hidden="true"
              data-testid={`n5-overlap-block-${blockId}`}
              className="pointer-events-none absolute z-[3] border border-dashed border-[#707070]"
              style={{ left: other.left, top: other.top, width: other.width, height: other.height }}
            >
              <span
                className="absolute top-0 right-0 bg-white px-1 text-[11px] leading-[normal] whitespace-nowrap text-[#707070]"
                style={{ transform: `scale(${1 / zoom})`, transformOrigin: '100% 0' }}
              >
                Block {blockIndexById.get(blockId) ?? ''}
              </span>
            </div>
            <div
              aria-hidden="true"
              data-testid={`n5-overlap-area-${blockId}`}
              className="pointer-events-none absolute z-[3] bg-[#ff6a38]/25"
              style={{ left: shared.left, top: shared.top, width: shared.width, height: shared.height }}
            />
          </Fragment>
        );
      })}
    </>
  );
}

function ImageLayer({
  slices,
  blocksBySection,
  blockIndexById,
  sectionStatusById,
  sectionHeaderHeightById,
  snapGuide,
  overlapDiagnostic,
  mode,
  blockDrag,
  consumeDragClick,
  pendingSectionIds,
  failedSectionId,
  isEditLocked,
  baseFontScaleById,
  typesetModelsBySection,
  isTypesetQa: isTypesetQaMode,
  onExcludeSection,
  onRestoreSection,
  scale,
  zoom,
  selectedBlockId,
  selectedSectionId,
  onSelectBlock,
  onSelectSection,
}: {
  slices: CanvasSlice[];
  blocksBySection: Map<number, BlockViewModel[]>;
  /** 우측 panel과 같은 번호(BlockNumberBadge)를 canvas 배지에도 쓰기 위한 공유 인덱스 */
  blockIndexById: Map<number, number>;
  sectionStatusById: ReadonlyMap<number, SectionStatusViewModel>;
  /** 이미지 위 상태 공간 높이(없으면 0) */
  sectionHeaderHeightById: ReadonlyMap<number, number>;
  /** 끌기 중 가운데선에 붙어 있는 축 */
  snapGuide: SnapGuideState | null;
  /** 겹침 진단(Mock 전용) */
  overlapDiagnostic: { sectionId: number; overlaps: BlockOverlap[] } | null;
  mode: N5ViewMode;
  blockDrag: BlockBodyDragHandlers | null;
  /** 방금 끝난 끌기가 만든 click이면 true — 그 click은 선택으로 치지 않는다 */
  consumeDragClick: () => boolean;
  /** SEC-03 저장 중인 sectionId — 그 섹션의 제외하기/되돌리기만 잠시 막는다(다른 섹션은 그대로). */
  pendingSectionIds: ReadonlySet<number>;
  /** 마지막 SEC-03 저장이 실패한 sectionId — 그 섹션 위에 실패 안내를 띄운다. */
  failedSectionId: number | null;
  /** 서버 실행 취소·다시 실행 진행 중 — 제외하기·되돌리기를 잠시 막는다 */
  isEditLocked: boolean;
  /** 초안이 있으면 초안, 없으면 저장 입력의 절대 글자 배율 */
  baseFontScaleById: (blockId: number) => number;
  /**
   * HTML 조판 블록(섹션별). 일반 N5 는 renderInput 이 최신·일치인 섹션(display=typeset)만 있고, 그 섹션은 renderedUrl 대신
   * background.url 위에 그린다. QA(?qaTypeset=1)는 그 밖의 포함 섹션도 역할 기본값으로 흰 면 위에 그린다(진단용).
   */
  typesetModelsBySection: ReadonlyMap<number, TypesetRenderModel[]>;
  isTypesetQa: boolean;
  onExcludeSection: (sectionId: number) => void;
  onRestoreSection: (sectionId: number) => void;
  scale: number;
  /** 현재 canvas zoom — block hit 여백을 화면 px 기준으로 유지하는 데만 쓴다. */
  zoom: number;
  selectedBlockId: number | null;
  selectedSectionId: number | null;
  onSelectBlock: (block: BlockViewModel) => void;
  onSelectSection: (sectionId: number) => void;
}) {
  return (
    <>
      {slices.map((slice, sliceIndex) => {
        const headerHeight = sectionHeaderHeightById.get(slice.sectionId) ?? 0;
        const status = sectionStatusById.get(slice.sectionId);
        const renderFailed = status?.failedStages.includes('render') ?? false;
        const isExcluded = slice.isExcluded;
        const { display } = slice;
        const typesetModels = mode === 'translated' && !isExcluded ? typesetModelsBySection.get(slice.sectionId) ?? null : null;
        // QA 진단 — renderInput 조판이 아닌 섹션을 역할 기본값으로 흰 면 위에 그린다
        const isQaFallback = isTypesetQaMode && typesetModels !== null && display !== 'local-typeset';
        // 「번역 후」 표시 — 소스는 resolvePreviewSectionDisplay 한 곳에서 정한다
        // - local-typeset: renderInput 배경 + HTML 글자(글자가 구워진 renderedUrl 과 겹치지 않는다)
        // - current/previous-rendered-image: 서버 결과 이미지(새 번역문 HTML 을 얹지 않는다) / original-image: 결과 없음 → 원본
        // - legacy: 이번 계약 키가 없는 응답 — 기존 renderedUrl 기준. 렌더링 실패 섹션은 원본 그대로 결과물에 들어간다(PRD N4 부분 실패)
        const translatedUrl = isQaFallback
          ? null
          : display === 'local-typeset'
            ? (slice.background?.url ?? null)
            : display === 'current-rendered-image' || display === 'previous-rendered-image'
              ? slice.renderedUrl
              : display === 'original-image'
                ? slice.originalUrl
                : slice.render.status === 'ready'
                  ? slice.render.url
                  : renderFailed
                    ? slice.originalUrl
                    : null;
        const url = mode === 'original' ? slice.originalUrl : translatedUrl;
        const isSaving = pendingSectionIds.has(slice.sectionId);
        // 이번 계약 키가 없는(legacy) 응답만 — 결과 없이 진행 중이면 빈 면에 진행 문구를 보인다(기존 표시)
        const isPending = mode === 'translated' && !isQaFallback && !isExcluded && display === 'legacy' && slice.render.status === 'unresolved' && !renderFailed;
        const previewState = mode === 'translated' ? status?.previewState ?? null : null;
        const blockRects = isExcluded
          ? []
          : buildBlockRects(blocksBySection.get(slice.sectionId) ?? [], scale, zoom, slice);
        const selectHandlerOf = (block: BlockViewModel) => () => {
          if (!consumeDragClick()) onSelectBlock(block);
        };
        return (
          <Fragment key={slice.sectionId}>
          {headerHeight > 0 && status && (
            <SectionStatusHeader
              height={headerHeight}
              overhang={sliceIndex === 0 ? FIRST_SECTION_HEADER_OVERHANG_PX : 0}
              sectionOrder={slice.sectionOrder}
              isSelected={slice.sectionId === selectedSectionId}
              status={status}
              width={slice.width}
            />
          )}
          <div
            data-testid={`n5-slice-${mode}-${slice.sectionId}`}
            data-preview-display={mode === 'translated' ? display : undefined}
            data-preview-input-state={previewState?.input}
            data-preview-render-state={previewState?.render}
            data-preview-syncing={previewState?.syncing ? 'true' : undefined}
            data-qa-typeset={isQaFallback ? 'role-default' : undefined}
            data-background-source={mode === 'translated' && display === 'local-typeset' ? slice.background?.source : undefined}
            role="button"
            tabIndex={0}
            // Figma(544:3168)는 section마다 테두리로 구획을 나눈다. border는 안쪽 원점을 1px 밀어 bbox·이미지·중앙선이
            // 어긋나므로, 크기에 영향이 없는 inset 그림자로 그린다.
            className="relative shrink-0 cursor-pointer shadow-[inset_0_0_0_1px_#eaeaea]"
            onClick={() => {
              if (!consumeDragClick()) onSelectSection(slice.sectionId);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onSelectSection(slice.sectionId);
            }}
            style={{
              height: slice.height,
              width: slice.width,
              backgroundColor: isQaFallback ? '#ffffff' : '#e5e5e5',
              backgroundImage: url ? `url(${url})` : 'none',
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
            }}
          >
            {typesetModels && (
              // TypesetBlock 은 가장 가까운 positioned 조상을 section 원점으로 삼아 원본 px 로 그린다 — 이미지와 같은 배율 하나만 준다.
              // z-[1]: section 아래로 넘친 글이 다음 section 면에 가리지 않게 한다. 넘침의 정본은 서버 결과이고 이 글은 편집 중 확인용이다
              <div
                data-testid={`n5-text-layer-${slice.sectionId}`}
                aria-hidden="true"
                className="pointer-events-none absolute top-0 left-0 z-[1]"
                style={{ width: slice.width / scale, height: slice.height / scale, transform: `scale(${scale})`, transformOrigin: '0 0' }}
              >
                {typesetModels.map((model) => (
                  <TypesetBlock key={model.blockId} model={model} />
                ))}
              </div>
            )}
            {isPending && (
              <div className="absolute inset-0 flex items-center justify-center text-center text-[12px] text-[#999]">
                {status?.progressLabel ?? '렌더 대기 중'}
              </div>
            )}
            {snapGuide?.sectionId === slice.sectionId && (
              <SnapGuides snappedX={snapGuide.snappedX} snappedY={snapGuide.snappedY} zoom={zoom} />
            )}
            {overlapDiagnostic?.sectionId === slice.sectionId && (
              <OverlapDiagnosticLayer
                overlaps={overlapDiagnostic.overlaps}
                scale={scale}
                zoom={zoom}
                blockIndexById={blockIndexById}
              />
            )}
            {orderForHitLayer(blockRects).map(({ block, hitRect }) => (
              <BlockHitArea key={block.id} blockId={block.id} hitRect={hitRect} onSelect={selectHandlerOf(block)} />
            ))}
            {blockRects.map(({ block, visualRect }) => (
              <BlockOverlay
                key={block.id}
                block={block}
                visualRect={visualRect}
                index={blockIndexById.get(block.id) ?? 0}
                isSelected={block.id === selectedBlockId}
                fontScale={baseFontScaleById(block.id)}
                onSelect={selectHandlerOf(block)}
                drag={blockDrag}
              />
            ))}
            {!isExcluded && headerHeight === 0 && slice.sectionId === selectedSectionId && (
              <SectionSelectedTag sectionOrder={slice.sectionOrder} />
            )}
            {isExcluded ? (
              // F-CFM-14: slice의 height/width는 절대 건드리지 않는다 — 오버레이는
              // 같은 slice 내부에 absolute로 얹을 뿐이라, 스택 재배치가 일어나지 않는다.
              <div
                data-testid={`n5-section-excluded-${slice.sectionId}`}
                className="absolute inset-0 flex items-center justify-center"
                style={{ backgroundColor: 'rgba(23, 23, 23, 0.55)' }}
              >
                {/* N3 에서 제외된 섹션은 N5 에서 되살리지 않는다(SEC-03: 409 INVALID_STATE) — 버튼을 내지 않는다 */}
                {slice.canRestore && (
                  <button
                    type="button"
                    data-testid={`n5-section-restore-${slice.sectionId}`}
                    disabled={isSaving || isEditLocked}
                    aria-busy={isSaving}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRestoreSection(slice.sectionId);
                    }}
                    className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-[#171717] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)] hover:bg-gray-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                  >
                    되돌리기
                  </button>
                )}
              </div>
            ) : (
              <div className="absolute top-2 right-2 z-10">
                <button
                  type="button"
                  data-testid={`n5-section-exclude-${slice.sectionId}`}
                  disabled={isSaving || isEditLocked}
                  aria-busy={isSaving}
                  onClick={(e) => {
                    e.stopPropagation();
                    onExcludeSection(slice.sectionId);
                  }}
                  className="rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-[#171717] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)] hover:bg-white disabled:cursor-not-allowed disabled:hover:bg-white/90"
                >
                  제외하기
                </button>
              </div>
            )}
            {failedSectionId === slice.sectionId && (
              // 저장 실패 안내 — 화면은 이미 마지막 저장 상태(서버 정본)다. 문구는 PM 확정값(lib/n5/messages.ts).
              <p
                role="alert"
                data-testid={`n5-section-save-error-${slice.sectionId}`}
                className="absolute right-2 bottom-2 left-2 z-10 rounded-[6px] border border-[#eaeaea] bg-white px-3 py-2 text-[11px] text-red-500"
              >
                {N5_SAVE_NOTICE_MESSAGES['edit-failed']}
              </p>
            )}
          </div>
          </Fragment>
        );
      })}
    </>
  );
}

/** 캔버스 스크롤 위치 표시(Figma 655:6232·6235). pan과 연결된 표시 전용이고, 영역에 마우스·포커스가 있을 때만 보인다 */
function CanvasScrollIndicator({
  axis,
  pan,
  scaledSize,
  usableSize,
}: {
  axis: 'vertical' | 'horizontal';
  pan: number;
  scaledSize: number;
  usableSize: number;
}) {
  const thumb = computeScrollThumb(pan, scaledSize, usableSize);
  if (!thumb) return null;
  const isVertical = axis === 'vertical';
  return (
    <div
      aria-hidden="true"
      data-testid={`n5-scroll-${axis}`}
      className={`pointer-events-none absolute z-10 rounded-[2px] opacity-0 transition-opacity group-focus-within/viewport:opacity-100 group-hover/viewport:opacity-100 ${
        isVertical ? 'top-[82px] right-0 bottom-[244px] w-[11px]' : 'right-[67px] bottom-0 left-0 h-[11px]'
      }`}
    >
      <div
        className={`absolute rounded-[2px] bg-[#999] ${isVertical ? 'left-1 w-[3px]' : 'top-1 h-[3px]'}`}
        style={
          isVertical
            ? { top: `${thumb.start * 100}%`, height: `${thumb.size * 100}%` }
            : { left: `${thumb.start * 100}%`, width: `${thumb.size * 100}%` }
        }
      />
    </div>
  );
}

/** workspace 좌상단 정보(Figma 「N3 섹션 상단」 1507:21672, x152 y46). 실제 값이 있는 항목만 그린다 */
function JobMetaTags({ meta }: { meta: JobMetaViewModel }) {
  const tags = [meta.regulatoryClassLabel, meta.categoryLabel].filter((label): label is string => !!label);
  if (!meta.countryLabel && tags.length === 0) return null;
  return (
    <div data-testid="n5-job-meta" className="pointer-events-none absolute top-[46px] left-8 z-10 flex items-center gap-3">
      {meta.countryLabel && <p className="text-[12px] leading-[normal] tracking-[-0.02em] whitespace-nowrap text-black">{meta.countryLabel}</p>}
      {tags.length > 0 && (
        <div className="flex items-center gap-0.5">
          {tags.map((label) => (
            <span
              key={label}
              className="flex h-7 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-2 text-[12px] leading-[14px] whitespace-nowrap text-[#171717]"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function readPadding(el: HTMLElement) {
  const style = getComputedStyle(el);
  return {
    left: parseFloat(style.paddingLeft) || 0,
    right: parseFloat(style.paddingRight) || 0,
    top: parseFloat(style.paddingTop) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
  };
}

interface Transform {
  zoom: number;
  pan: Point;
}

const INITIAL_TRANSFORM: Transform = { zoom: 1, pan: { x: 0, y: 0 } };

export function N5Viewport({
  preview,
  blocks: serverBlocks,
  sectionStatusById,
  jobMeta,
  viewMode,
  selectedBlockId,
  selectedSectionId,
  revealRequestSeq,
  onSelectBlock,
  onSelectSection,
  editSession,
  syncBySection,
  isFontReady,
}: {
  preview: PreviewViewModel;
  blocks: BlockViewModel[];
  /** 섹션별 지문 A/B 일치(N5View) — 같은 저장 입력으로 연결된 섹션만 renderInput 조판을 쓴다 */
  syncBySection: ReadonlyMap<number, SectionInputSync>;
  /** 서버 style 글꼴 준비 여부 */
  isFontReady: TypesetFontGate;
  sectionStatusById: ReadonlyMap<number, SectionStatusViewModel>;
  jobMeta: JobMetaViewModel;
  /** 11일차부터 이 컴포넌트가 소유하지 않는다 — 토글 UI가 N5Panel로 이동했다. */
  viewMode: N5ViewMode;
  /** F-CFM-13 — 정본은 N5View(상위)가 소유한다. 이 컴포넌트는 prop/콜백만 받는다. */
  selectedBlockId: number | null;
  selectedSectionId: number | null;
  /**
   * selection "값"이 아니라 "지금 이 위치를 다시 보여달라"는 일회성 요청
   * 횟수다(n5-view.tsx 참고) — 같은 block/section을 다시 선택해도 값 자체는
   * 안 바뀌지만 이 숫자는 매번 증가하므로, 아래 selectionAutoMove effect는
   * 이 값을 기준으로 "재실행해야 하는지"를 판단한다.
   */
  revealRequestSeq: number;
  onSelectBlock: (block: BlockViewModel) => void;
  onSelectSection: (sectionId: number) => void;
  /** N5 편집 세션(N5Loaded 소유) — 이력·박스 초안·섹션 저장의 정본이다 */
  editSession: N5EditSessionApi;
}) {
  const [transform, setTransform] = useState<Transform>(INITIAL_TRANSFORM);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  // 스크롤 표시 막대와 글자크기 툴바 위치 전용(렌더 중 DOM을 읽지 않으려고 둔다). pan·zoom 계산은 그때그때 DOM을 측정한다
  const [usableSize, setUsableSize] = useState<Size>({ width: 0, height: 0 });

  const viewportRef = useRef<HTMLDivElement>(null);
  const spaceHeldRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ pointer: Point; pan: Point } | null>(null);

  // pointerdown 시점의 최신 transform.pan을 읽기 위한 ref — handlePointerDown을
  // useCallback([]) 로 한 번만 만들면서도 최신 pan 값을 참조하기 위함이다.
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  // F-CFM-14 — 제외·되돌리기 후 프리뷰가 다시 와도 slice 높이는 section.height × scale
  // 그대로다(bucket 과 무관). 서버 displayTop(include 만 누적)은 쓰지 않고 모든 섹션을
  // 순서대로 쌓으므로, 제외된 섹션도 같은 자리·같은 높이를 유지한다(스택 재배치 없음).
  // 「번역 후」 표시 — 정상 입력 + 지문 A=B + 최신 결과 + 서버 style 정상·글꼴 준비일 때만 renderInput 조판을 쓴다
  const slices = useMemo(
    () =>
      buildSectionSlices(preview.sections, preview.scale, (section) =>
        resolvePreviewSectionDisplay({
          input: section.input,
          render: section.renderState,
          match: syncBySection.get(section.id)?.match ?? 'incomparable',
          canTypeset:
            syncBySection.get(section.id)?.bound === true &&
            section.background != null &&
            section.renderBlocks.every((block) => block.style != null && isFontReady(block.style)),
        }),
      ),
    [preview.sections, preview.scale, syncBySection, isFontReady],
  );

  // 손잡이·본체 끌기로 바꾼 bbox(위치·크기 전부) — 세션 local 초안이다(use-n5-edit-session.ts). 저장 계약이 없어 서버로
  // 보내지 않고, 새로고침하면 사라진다. F-CFM-15 조정은 「번역 후」 화면의 것이라 「번역 전」에는 원본 bbox를 보인다.
  const { bboxDrafts, setBboxDraft, commitBoxEdit, setLayoutDragging, isEditLocked, fitAutoHeight } = editSession;
  // 「번역 후」 박스 = 세션 초안 > 저장 입력(renderInput 적용 박스) > 원본 bbox
  const blocks = useMemo(
    () =>
      viewMode !== 'translated'
        ? serverBlocks
        : serverBlocks.map((block) => {
            const box = bboxDrafts.get(block.id) ?? getTranslatedBaseBox(block);
            return box === block.bbox ? block : { ...block, bbox: box };
          }),
    [serverBlocks, bboxDrafts, viewMode],
  );

  const blocksBySection = useMemo(() => {
    const map = new Map<number, BlockViewModel[]>();
    for (const block of blocks) {
      const list = map.get(block.sectionId);
      if (list) list.push(block);
      else map.set(block.sectionId, [block]);
    }
    return map;
  }, [blocks]);

  // 번호는 section-local index다(section마다 1부터 다시 시작) — job 전체
  // 기준으로 계속 증가하는 전역 번호를 화면 번호로 쓰지 않는다. 우측
  // panel(n5-panel.tsx groupBlocksBySection)도 같은 규칙(section 안
  // blockIndex+1)으로 계산하므로 좌/우 배지 숫자가 항상 일치한다.
  const blockIndexById = useMemo(() => {
    const map = new Map<number, number>();
    for (const slice of slices) {
      let index = 0;
      for (const block of blocksBySection.get(slice.sectionId) ?? []) {
        index += 1;
        map.set(block.id, index);
      }
    }
    return map;
  }, [slices, blocksBySection]);

  // F-CFM-13 — block bbox는 section-local 좌표라(getBlockDisplayRect의
  // displayTop=0 그대로) canvas 전체 기준 위치를 구하려면 그 block이 속한
  // slice보다 앞서 쌓인 slice들의 height 합(cumulative Y)을 더해야 한다.
  // slices는 이미 sectionOrder 오름차순이고 `flex-col items-start`로 위→아래
  // 단순 document flow로 쌓이므로(각 slice의 x는 항상 0), Y축 offset만
  // 계산하면 된다 — BlockOverlay(CSS 렌더용, displayTop=0)와는 다른 값이다.
  // section 상태가 이미지 위에 차지하는 공간(Figma 1244:8444). 제외된 section은 회색 오버레이만 얹으므로 두지 않는다.
  const sectionHeaderHeightById = useMemo(() => {
    const map = new Map<number, number>();
    for (const slice of slices) {
      if (!slice.isExcluded) map.set(slice.sectionId, getSectionCanvasHeaderHeight(sectionStatusById.get(slice.sectionId)));
    }
    return map;
  }, [slices, sectionStatusById]);

  const sliceOffsetYById = useMemo(() => {
    const map = new Map<number, number>();
    let cursor = 0;
    slices.forEach((slice, index) => {
      cursor += sectionFlowHeaderHeight(sectionHeaderHeightById.get(slice.sectionId) ?? 0, index);
      map.set(slice.sectionId, cursor);
      cursor += slice.height;
    });
    return map;
  }, [slices, sectionHeaderHeightById]);

  // 선택 UI는 section 밖 canvas overlay에 그린다.
  const selectedBlockBbox = blocks.find((b) => b.id === selectedBlockId)?.bbox ?? null;
  const selectedBlockCanvasRect = useMemo<DisplayRect | null>(() => {
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block?.bbox) return null;
    const slice = slices.find((s) => s.sectionId === block.sectionId);
    if (!slice || slice.isExcluded) return null;
    const rect = getBlockDisplayRect(block.bbox, 0, preview.scale);
    return {
      ...rect,
      top: rect.top + (sliceOffsetYById.get(slice.sectionId) ?? 0),
    };
  }, [blocks, selectedBlockId, slices, sliceOffsetYById, preview.scale]);

  // canvas(원본, zoom과 무관한) 크기 — fit 계산의 기준값. 매 렌더 다시 측정하지 않는다.
  const canvasSize = useMemo<Size>(
    () => ({
      width: Math.max(preview.containerWidth, slices.reduce((max, s) => Math.max(max, s.width), 0)),
      height: slices.reduce(
        (sum, s, index) => sum + s.height + sectionFlowHeaderHeight(sectionHeaderHeightById.get(s.sectionId) ?? 0, index),
        0,
      ),
    }),
    [preview.containerWidth, slices, sectionHeaderHeightById],
  );

  // wheel/pointer 핸들러는 useCallback([])/useEffect([])로 한 번만 만들어
  // el(viewportRef)을 재사용한다 — 그 안에서 canvasSize를 직접 closure로
  // 참조하면 오래된 값에 갇힌다. transformRef와 같은 이유로 ref에 최신값을
  // 미러링해 둔다. canvasSize.width/height가 모두 0이면 "표시할 이미지가
  // 없는" 상태다 — 이때 wheel/drag는 완전히 비활성화된다(zoom/fit 버튼은
  // 애초에 이 조건일 때 렌더되지 않는다).
  const canvasSizeRef = useRef(canvasSize);
  useEffect(() => {
    canvasSizeRef.current = canvasSize;
  }, [canvasSize]);

  // 9/23 재도입 — 최초 진입 시 section을 viewport 가용 가로 영역 기준으로
  // 가운데 정렬한다(세로는 기존 top 정렬 INITIAL_TRANSFORM.y=0 그대로 유지,
  // pan.x만 다룬다). 이전 시도가 겪은 회귀(좁은 뷰포트에서 우상단 zoom/fit
  // 컨트롤의 "빈" 영역이 그 아래 section의 "제외하기" 버튼 클릭을 가로챔)는
  // 이번엔 centering을 포기하는 대신, 그 컨트롤들의 바깥 absolute wrapper를
  // pointer-events-none으로 바꾸고 실제 버튼(ZoomControls/FitControls 루트,
  // n5-toolbar.tsx)만 pointer-events-auto로 다시 켜서 근본 원인(빈 영역이
  // 클릭을 가로채는 것)을 없앴다 — 아래 JSX 참고.
  //
  // hasInteractedRef — 사용자가 pan/zoom/fit을 한 번이라도 직접 조작하면
  // true로 바뀌고, 이후로는 resize가 나도(사이드바 폭 변화 등) 다시
  // 가운데로 끌고 오지 않는다("초기 positioning O, 계속 강제 centering X").
  const hasInteractedRef = useRef(false);

  // DOM이 실제로 측정 가능한 시점(레이아웃 이후)에만 계산한다 — 대충 추정한
  // 값으로 먼저 그렸다가 나중에 튀지 않도록 useLayoutEffect(페인트 전
  // 동기 실행) + ResizeObserver(그 뒤에도 실제 렌더 크기가 바뀌면 재계산)를
  // 함께 쓴다.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function centerHorizontallyIfUntouched() {
      const usable = computeUsableViewportSize(el!.clientWidth, el!.clientHeight, readPadding(el!));
      setUsableSize(usable);
      if (hasInteractedRef.current) return;
      const canvas = canvasSizeRef.current;
      if (canvas.width <= 0) return;
      const centered = computeCenteredPan(canvas, transformRef.current.zoom, usable);
      setTransform((prev) => ({ ...prev, pan: { x: centered.x, y: prev.pan.y } }));
    }

    centerHorizontallyIfUntouched(); // 최초 1회 — 이미 레이아웃이 끝난 뒤라 바로 정확한 값을 쓴다

    const resizeObserver = new ResizeObserver(() => centerHorizontallyIfUntouched());
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, []);

  // F-CFM-13 우→좌 자동 이동(9/24) — 지금까지 이 effect가 없었던 게 정확한
  // 원인이다: selectedBlockId/selectedSectionId는 이미 N5View가 소유한 공유
  // state이고 우측(n5-panel.tsx)에서도 정상적으로 바뀌는데, 이 컴포넌트는
  // 그 값을 BlockOverlay/SectionSelectedTag의 isSelected(단순 표시)에만
  // 쓸 뿐 pan을 옮기는 코드 자체가 없었다 — "표시만 한다"는 이전 설계
  // 결정을 그대로 구현해 둔 것이었지, 버그로 방치된 게 아니다. PRD
  // F-CFM-13이 양방향을 Must로 요구해 이번에 추가한다.
  //
  // lastHandledRevealSeqRef(9/24 edge case 보정) — 원래는 selectedBlockId/
  // selectedSectionId "값이 실제로 바뀐 시점"에만 반응하도록 값 자체를 key로
  // 썼었다. 그런데 그 방식은 "이미 선택된 같은 block/section을 사용자가
  // 우측에서 다시 클릭"하는 경우를 처리하지 못한다 — selection 값이 그대로면
  // key도 그대로라 effect가 조용히 skip돼, 그 사이 사용자가 좌측을 수동
  // pan으로 화면 밖으로 보냈어도 다시 끌어오지 못한다(F-CFM-13 재현 e2e
  // "G" 테스트로 확인). 대신 selection 값과 별개로 매 위치-이동 요청마다
  // 증가하는 revealRequestSeq(n5-view.tsx 소유)를 key로 쓴다 — 이러면
  // "같은 block 재클릭"도 매번 새 seq를 받아 effect가 다시 실행된다.
  // block 내부 TranslationEditor의 draft/revision/textarea 값이나 blocks
  // 배열 reference(PATCH 후 invalidate로 바뀜)는 revealRequestSeq를 전혀
  // 건드리지 않으므로, 같은 block을 계속 편집(타이핑)하거나 PATCH/rerender로
  // blocks가 재조회돼도 이 effect는 실행되지만 seq가 같아 즉시 반환한다 —
  // pan을 다시 계산하지 않는다(요청 5·6).
  const lastHandledRevealSeqRef = useRef<number | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (selectedBlockId == null && selectedSectionId == null) {
      lastHandledRevealSeqRef.current = null;
      return;
    }

    if (lastHandledRevealSeqRef.current === revealRequestSeq) return; // 이미 처리한 요청이다
    lastHandledRevealSeqRef.current = revealRequestSeq;

    // block 선택이 section 선택보다 우선한다(PRD 3 — "section 위치보다 block
    // bbox가 우선"). block에 bbox가 없으면(비정상 데이터) section으로
    // fallback하지 않는다 — 그 block 자체가 위치를 특정할 수 없다는 뜻이라
    // 조용히 아무것도 하지 않는다(임의로 다른 위치로 보내지 않는다).
    let targetRect: DisplayRect | null = null;
    if (selectedBlockId != null) {
      const block = blocks.find((b) => b.id === selectedBlockId);
      if (block?.bbox) {
        const offsetY = sliceOffsetYById.get(block.sectionId) ?? 0;
        const local = getBlockDisplayRect(block.bbox, 0, preview.scale);
        targetRect = { left: local.left, top: offsetY + local.top, width: local.width, height: local.height };
      }
    } else if (selectedSectionId != null) {
      const slice = slices.find((s) => s.sectionId === selectedSectionId);
      if (slice) {
        targetRect = { left: 0, top: sliceOffsetYById.get(selectedSectionId) ?? 0, width: slice.width, height: slice.height };
      }
    }
    if (!targetRect) return;

    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    const { zoom, pan } = transformRef.current;

    // canvas-space rect를 현재 pan/zoom으로 화면(뷰포트) 좌표로 변환한다.
    const screenLeft = pan.x + targetRect.left * zoom;
    const screenTop = pan.y + targetRect.top * zoom;
    const screenRight = screenLeft + targetRect.width * zoom;
    const screenBottom = screenTop + targetRect.height * zoom;

    // 이미 충분히 보이면 이동하지 않는다(요청 4) — margin 없이 usable
    // 영역에 완전히 들어가 있는지만 본다(부동소수 오차만 허용). fit-height
    // 등으로 이미 전체 canvas가 화면에 들어와 있는 상태에서 block/section을
    // 눌러도 pan/zoom이 그대로 유지돼야 하는 기존 계약(e2e "zoom/pan
    // 불변")을 그대로 지킨다 — margin을 주면 "화면 안인데도 이동"하는
    // 경우가 생겨 그 계약을 깬다.
    const EPSILON = 0.5;
    const alreadyVisible =
      screenLeft >= -EPSILON &&
      screenTop >= -EPSILON &&
      screenRight <= usable.width + EPSILON &&
      screenBottom <= usable.height + EPSILON;
    if (alreadyVisible) return;

    // 화면 밖이면 뷰포트 중앙으로 옮긴다("완전 정중앙 강제"가 아니라 화면
    // 밖일 때만의 fallback이다, 요청 4) — zoom은 건드리지 않고 pan만 다시
    // 계산한다.
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const nextPan: Point = {
      x: usable.width / 2 - targetCenterX * zoom,
      y: usable.height / 2 - targetCenterY * zoom,
    };
    // 이 이동 자체를 "사용자가 pan을 직접 조작한 것"과 동일하게 취급한다 —
    // 그러지 않으면 이후 창 리사이즈에서 초기 가로 중앙 정렬(위 effect)이
    // 지금 막 옮긴 선택 위치를 되돌려버린다.
    hasInteractedRef.current = true;
    setTransform((prev) => ({ ...prev, pan: clampPan(nextPan, canvasSizeRef.current, prev.zoom, usable) }));
  }, [selectedBlockId, selectedSectionId, revealRequestSeq, blocks, slices, sliceOffsetYById, preview.scale]);

  // ── Space 키 상태 추적 — 텍스트 입력창에 focus가 있으면 pan을 발동하지 않는다 ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return;
      e.preventDefault();
      if (spaceHeldRef.current) return; // key repeat 무시
      spaceHeldRef.current = true;
      setIsSpaceHeld(true);
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      spaceHeldRef.current = false;
      setIsSpaceHeld(false);
    }

    function handleBlur() {
      spaceHeldRef.current = false;
      setIsSpaceHeld(false);
      isPanningRef.current = false;
      setIsPanning(false);
      panStartRef.current = null;
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // ── Wheel — transform.pan/zoom을 움직이는 유일한 입력 경로.
  //    Ctrl/Cmd+Wheel = pointer 중심 zoom, 그 외(Shift 포함)는 canvas pan.
  //    native scrollTop/overflow-y-auto는 새로 만들지 않는다 — pan은 항상
  //    transform.pan 하나만 정본으로 쓴다. 두 경로 모두 마지막에 clampPan을
  //    거친다(pan 경계). ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      if (canvasSizeRef.current.width <= 0 && canvasSizeRef.current.height <= 0) return; // 빈 상태 — 조작 비활성화
      hasInteractedRef.current = true; // 사용자가 직접 조작 — 이후 자동 중앙 정렬 중단

      if (e.ctrlKey || e.metaKey) {
        const rect = el!.getBoundingClientRect();
        const padding = readPadding(el!);
        // pan 원점은 padding 안쪽(canvas 시작점)이다
        const pointer: Point = { x: e.clientX - rect.left - padding.left, y: e.clientY - rect.top - padding.top };
        const usable = computeUsableViewportSize(el!.clientWidth, el!.clientHeight, readPadding(el!));
        setTransform((prev) => {
          const nextZoomRaw = prev.zoom * computeWheelZoomFactor(e.deltaY);
          const result = computeZoomAroundPoint(prev.zoom, prev.pan, pointer, nextZoomRaw);
          return { zoom: result.zoom, pan: clampPan(result.pan, canvasSizeRef.current, result.zoom, usable) };
        });
        return;
      }

      const usable = computeUsableViewportSize(el!.clientWidth, el!.clientHeight, readPadding(el!));
      setTransform((prev) => {
        const rawPan: Point = e.shiftKey
          ? { x: prev.pan.x - e.deltaY, y: prev.pan.y }
          : { x: prev.pan.x - e.deltaX, y: prev.pan.y - e.deltaY };
        return { ...prev, pan: clampPan(rawPan, canvasSizeRef.current, prev.zoom, usable) };
      });
    }

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!spaceHeldRef.current) return;
    if (canvasSizeRef.current.width <= 0 && canvasSizeRef.current.height <= 0) return; // 빈 상태 — pan 비활성화
    e.preventDefault();
    hasInteractedRef.current = true; // 사용자가 직접 조작 — 이후 자동 중앙 정렬 중단
    e.currentTarget.setPointerCapture(e.pointerId);
    isPanningRef.current = true;
    setIsPanning(true);
    panStartRef.current = { pointer: { x: e.clientX, y: e.clientY }, pan: transformRef.current.pan };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current || !panStartRef.current) return;
    const { pointer, pan } = panStartRef.current;
    const nextPan: Point = {
      x: pan.x + (e.clientX - pointer.x),
      y: pan.y + (e.clientY - pointer.y),
    };
    const el = viewportRef.current;
    setTransform((prev) => {
      if (!el) return { ...prev, pan: nextPan };
      const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
      return { ...prev, pan: clampPan(nextPan, canvasSizeRef.current, prev.zoom, usable) };
    });
  }, []);

  const endPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    setIsPanning(false);
    panStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const handleZoomButton = useCallback((direction: 1 | -1) => {
    const el = viewportRef.current;
    if (!el) return;
    hasInteractedRef.current = true; // 사용자가 직접 조작 — 이후 자동 중앙 정렬 중단
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    const center: Point = { x: usable.width / 2, y: usable.height / 2 };
    setTransform((prev) => {
      const result = computeZoomAroundPoint(prev.zoom, prev.pan, center, prev.zoom + direction * ZOOM_BUTTON_STEP);
      return { zoom: result.zoom, pan: clampPan(result.pan, canvasSizeRef.current, result.zoom, usable) };
    });
  }, []);

  const handleSetZoom = useCallback((nextZoom: number) => {
    const el = viewportRef.current;
    if (!el) return;
    hasInteractedRef.current = true; // 사용자가 직접 조작 — 이후 자동 중앙 정렬 중단
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    const center: Point = { x: usable.width / 2, y: usable.height / 2 };
    setTransform((prev) => {
      const result = computeZoomAroundPoint(prev.zoom, prev.pan, center, nextZoom);
      return { zoom: result.zoom, pan: clampPan(result.pan, canvasSizeRef.current, result.zoom, usable) };
    });
  }, []);

  const handleFitWidth = useCallback(() => {
    const el = viewportRef.current;
    if (!el || canvasSize.width <= 0) return;
    hasInteractedRef.current = true; // 사용자가 직접 조작 — 이후 자동 중앙 정렬 중단
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    const zoom = computeFitWidthScale(usable, canvasSize);
    setTransform({ zoom, pan: computeCenteredPan(canvasSize, zoom, usable) });
  }, [canvasSize]);

  const handleFitHeight = useCallback(() => {
    const el = viewportRef.current;
    if (!el || canvasSize.height <= 0) return;
    hasInteractedRef.current = true; // 사용자가 직접 조작 — 이후 자동 중앙 정렬 중단
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    const zoom = computeFitHeightScale(usable, canvasSize);
    setTransform({ zoom, pan: computeCenteredPan(canvasSize, zoom, usable) });
  }, [canvasSize]);

  // ── 본체 끌어 옮기기(F-CFM-15) — 누르면 선택, 누른 채 끌면 옮긴다. section 안으로 제한하고 가운데선에 붙인다.
  const selectedSection = preview.sections.find(
    (s) => s.id === blocks.find((b) => b.id === selectedBlockId)?.sectionId,
  );
  const blockDragRef = useRef<{
    pointerId: number;
    block: BlockViewModel;
    section: Size;
    startClient: Point;
    startBbox: BoundingBox;
    zoom: number;
    moved: boolean;
    snapLock: CenterSnapLock;
    lastCandidate: BoundingBox | null;
    lastBbox: BoundingBox;
  } | null>(null);
  const dragClickPendingRef = useRef(false);
  const [snapGuide, setSnapGuide] = useState<SnapGuideState | null>(null);

  // 겹침 진단 — Mock에서 ?debugOverlap=1 또는 ?mockScenario=n5-overlap일 때만 켠다. 표시 전용이고 선택·hit testing을 바꾸지 않는다.
  const [isOverlapDebug] = useState(() => {
    if (typeof window === 'undefined' || !isApiMockingEnabled()) return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('debugOverlap') === '1' || params.get('mockScenario') === 'n5-overlap';
  });
  // snap 진단 — Mock에서 ?debugSnap=1일 때만 끌기 중 계산 값을 그대로 보인다
  const [isSnapDebug] = useState(() => {
    if (typeof window === 'undefined' || !isApiMockingEnabled()) return false;
    return new URLSearchParams(window.location.search).get('debugSnap') === '1';
  });
  const [snapDebug, setSnapDebug] = useState<SnapDebugValues | null>(null);
  // 조판 진단 — Mock에서 ?qaTypeset=1일 때만 켠다. 진단 표시와, renderInput 조판이 아닌 섹션의 역할 기본값 조판을 더한다
  const [isTypesetQa] = useState(() => typeof window !== 'undefined' && isApiMockingEnabled() && isTypesetQaUrl(window.location.href));
  const { translationDrafts, fontScaleDrafts } = editSession;
  const baseFontScaleById = useCallback(
    (blockId: number) => {
      const block = serverBlocks.find((candidate) => candidate.id === blockId);
      return fontScaleDrafts.get(blockId) ?? (block ? getBaseFontScale(block) : 1);
    },
    [serverBlocks, fontScaleDrafts],
  );
  const typesetModelsBySection = useMemo(() => {
    const bySection = new Map<number, TypesetRenderModel[]>();
    const blockById = new Map(serverBlocks.map((block) => [block.id, block]));
    for (const slice of slices) {
      const section = preview.sections.find((s) => s.id === slice.sectionId);
      if (!section || slice.isExcluded) continue;
      if (slice.display === 'local-typeset') {
        // 저장 입력(renderInput) 위에 세션 local 편집값만 덮는다 — 글: 미저장 초안 > 저장 후 최신 block 글 > renderInput 글
        bySection.set(
          section.id,
          section.renderBlocks.flatMap((renderBlock) => {
            if (!renderBlock.style) return [];
            const block = blockById.get(renderBlock.blockId);
            return [
              {
                blockId: renderBlock.blockId,
                sectionId: section.id,
                revision: renderBlock.revision,
                text: translationDrafts.get(renderBlock.blockId)?.draft ?? block?.translatedText ?? renderBlock.text,
                // 서버 style 이 있으면 역할은 그리기에 쓰이지 않는다
                role: block && isTypesetRole(block.role) ? block.role : 'body',
                originalBBox: renderBlock.box,
                adjustedBBox: bboxDrafts.get(renderBlock.blockId) ?? null,
                sourceImageWidth: section.width,
                userFontScale: fontScaleDrafts.get(renderBlock.blockId) ?? renderBlock.style.fontScale,
                textAlign: renderBlock.style.align,
                serverStyle: renderBlock.style,
                excluded: false,
              } satisfies TypesetRenderModel,
            ];
          }),
        );
        continue;
      }
      if (!isTypesetQa) continue;
      bySection.set(
        section.id,
        serverBlocks.flatMap((block) =>
          block.sectionId === section.id && block.bbox && isTypesetRole(block.role)
            ? [
                {
                  blockId: block.id,
                  sectionId: block.sectionId,
                  revision: block.revision,
                  text: translationDrafts.get(block.id)?.draft ?? block.translatedText,
                  role: block.role,
                  originalBBox: block.bbox,
                  adjustedBBox: bboxDrafts.get(block.id) ?? null,
                  sourceImageWidth: section.width,
                  userFontScale: fontScaleDrafts.get(block.id) ?? 1,
                  textAlign: block.textAlign,
                  excluded: false,
                } satisfies TypesetRenderModel,
              ]
            : [],
        ),
      );
    }
    return bySection;
  }, [slices, isTypesetQa, serverBlocks, preview.sections, bboxDrafts, translationDrafts, fontScaleDrafts]);

  const selectedBlockForOverlap = blocks.find((b) => b.id === selectedBlockId);
  // 선택 block의 Auto Height 가능 여부와 지금 박스의 넘침. 잴 수 없으면 null이고 자유 크기 조절을 쓴다
  const selectedAutoFit =
    viewMode === 'translated' && selectedBlockForOverlap?.bbox ? fitAutoHeight(selectedBlockForOverlap, selectedBlockForOverlap.bbox) : null;
  const overlapDiagnostic =
    isOverlapDebug && selectedBlockForOverlap?.bbox
      ? {
          sectionId: selectedBlockForOverlap.sectionId,
          overlaps: computeBlockOverlaps(
            { id: selectedBlockForOverlap.id, bbox: selectedBlockForOverlap.bbox },
            blocks.filter((b) => b.sectionId === selectedBlockForOverlap.sectionId),
          ),
        }
      : null;

  const consumeDragClick = useCallback(() => {
    const pending = dragClickPendingRef.current;
    dragClickPendingRef.current = false;
    return pending;
  }, []);

  const blockDrag: BlockBodyDragHandlers | null =
    viewMode !== 'translated'
      ? null
      : {
          onPointerDown(e, block) {
            dragClickPendingRef.current = false;
            if (e.button !== 0 || spaceHeldRef.current || !block.bbox || isEditLocked) return; // Space는 pan이 쓴다
            const section = preview.sections.find((s) => s.id === block.sectionId);
            if (!section) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setLayoutDragging(true);
            blockDragRef.current = {
              pointerId: e.pointerId,
              block,
              section,
              startClient: { x: e.clientX, y: e.clientY },
              startBbox: block.bbox,
              zoom: transform.zoom,
              moved: false,
              snapLock: startCenterSnapLock(
                block.bbox,
                section,
                screenDeltaToBboxDelta({ x: N5_SNAP_ACQUIRE_SCREEN_PX, y: 0 }, preview.scale, transform.zoom).x,
              ),
              lastCandidate: block.bbox,
              lastBbox: block.bbox,
            };
          },
          onPointerMove(e) {
            const drag = blockDragRef.current;
            if (!drag || drag.pointerId !== e.pointerId) return;
            e.stopPropagation();
            const screenDelta = { x: e.clientX - drag.startClient.x, y: e.clientY - drag.startClient.y };
            if (!drag.moved) {
              if (Math.hypot(screenDelta.x, screenDelta.y) < BLOCK_DRAG_START_DISTANCE_PX) return; // 아직 클릭이다
              drag.moved = true;
              if (drag.block.id !== selectedBlockId) onSelectBlock(drag.block);
            }
            const delta = screenDeltaToBboxDelta(screenDelta, preview.scale, drag.zoom);
            const toOriginal = (px: number) => screenDeltaToBboxDelta({ x: px, y: 0 }, preview.scale, drag.zoom).x;
            const result = moveBoxWithCenterSnap(
              drag.startBbox,
              delta,
              drag.section,
              { acquire: toOriginal(N5_SNAP_ACQUIRE_SCREEN_PX), release: toOriginal(N5_SNAP_RELEASE_SCREEN_PX) },
              drag.snapLock,
              drag.lastCandidate,
            );
            drag.snapLock = result;
            drag.lastCandidate = result.candidate;
            drag.lastBbox = result.box;
            setBboxDraft(drag.block.id, result.box);
            if (isSnapDebug) {
              const acquirePx = N5_SNAP_ACQUIRE_SCREEN_PX;
              setSnapDebug({
                blockId: drag.block.id,
                pointer: { x: e.clientX, y: e.clientY },
                start: drag.startClient,
                raw: { ...drag.startBbox, x: drag.startBbox.x + delta.x, y: drag.startBbox.y + delta.y },
                candidate: result.candidate,
                section: drag.section,
                acquirePx,
                releasePx: N5_SNAP_RELEASE_SCREEN_PX,
                snappedX: result.snappedX,
                snappedY: result.snappedY,
                scale: preview.scale,
                zoom: drag.zoom,
              });
            }
            setSnapGuide(
              result.snappedX || result.snappedY
                ? { sectionId: drag.block.sectionId, snappedX: result.snappedX, snappedY: result.snappedY }
                : null,
            );
          },
          onPointerEnd(e) {
            const drag = blockDragRef.current;
            if (!drag || drag.pointerId !== e.pointerId) return;
            e.stopPropagation();
            blockDragRef.current = null;
            setLayoutDragging(false);
            setSnapGuide(null);
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            if (!drag.moved) return;
            dragClickPendingRef.current = e.type === 'pointerup'; // 끌기 뒤 따라오는 click은 선택으로 치지 않는다
            if (e.type === 'pointercancel') setBboxDraft(drag.block.id, drag.startBbox); // 시스템 취소는 시작 위치로, 이력 없음
            else commitBoxEdit('box-move', drag.block.id, drag.startBbox, drag.lastBbox);
          },
        };

  const cursor = isPanning ? 'grabbing' : isSpaceHeld ? 'grab' : 'default';

  return (
    <div
      ref={viewportRef}
      data-testid="n5-viewport"
      // 위 여백은 canvas 시작 위치다(Figma 1080에서 y156). 그 위로 상단 정보와 Section 태그가 놓인다
      className="group/viewport relative h-full min-w-0 flex-1 touch-none overflow-hidden select-none rounded-[6px] bg-[#f5f5f5] px-6 pt-[clamp(110px,14.45vh,156px)] pb-6"
      style={{ cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      {slices.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          표시할 include section이 없습니다.
        </div>
      ) : (
        <>
          {/* 9/23 — 바깥 wrapper 자체는 pointer-events-none이다. ZoomControls/
              FitControls 두 그룹 "사이"의 빈 gap-2 영역까지 이 div의 클릭
              가능 영역이 돼 버리면(원래 기본값), 초기 가로 중앙 정렬을 켰을
              때 그 빈 영역 아래 놓이는 section의 "제외하기" 버튼 클릭을
              가로채는 회귀가 있었다(위 hasInteractedRef 주석 참고). 실제
              버튼이 있는 두 컴포넌트 루트에만 pointer-events-auto를 다시
              켜서(n5-toolbar.tsx), 빈 영역은 클릭이 아래 canvas로 그대로
              통과하게 한다. */}
          <JobMetaTags meta={jobMeta} />
          {isSnapDebug && <SnapDebugHud values={snapDebug} />}
          {isTypesetQa && viewMode === 'translated' && (
            <div
              data-testid="n5-qa-badge"
              className="pointer-events-none absolute top-[84px] left-8 z-10 flex flex-col gap-0.5 rounded-[6px] border border-[#eaeaea] bg-white px-3 py-2 text-[12px] leading-[normal] text-[#171717]"
            >
              <p className="font-medium">조판 진단(Mock)</p>
              <p className="text-[#707070]">
                최신 renderInput 섹션은 서버 배경과 style로, 그 밖의 섹션은 흰 면 위에 역할 기본값으로 그립니다.
              </p>
              {selectedAutoFit?.overflow && (
                <p data-testid="n5-qa-overflow" className="text-[#ff6a38]">
                  선택 block의 글이 section 아래로 넘칩니다.
                </p>
              )}
            </div>
          )}
          {isOverlapDebug && (
            <div
              data-testid="n5-overlap-hud"
              className="pointer-events-none absolute top-[84px] left-8 z-10 flex w-[200px] flex-col gap-1 rounded-[6px] border border-[#eaeaea] bg-white p-3 text-[12px] leading-[normal] text-[#171717]"
            >
              <p className="font-medium">겹침 진단</p>
              {!overlapDiagnostic ? (
                <p className="text-[#707070]">block을 선택하세요</p>
              ) : overlapDiagnostic.overlaps.length === 0 ? (
                <p className="text-[#707070]">겹치는 block 없음</p>
              ) : (
                overlapDiagnostic.overlaps.map(({ blockId, intersection }) => (
                  <p key={blockId} data-testid={`n5-overlap-label-${blockId}`}>
                    Block {blockIndexById.get(selectedBlockId ?? -1)} ↔ Block {blockIndexById.get(blockId)}
                    <br />
                    <span className="text-[#707070]">
                      겹침 {Math.round(intersection.width)} × {Math.round(intersection.height)} px
                    </span>
                  </p>
                ))
              )}
            </div>
          )}

          {/* Figma 602:5437 — 배율은 x1281 y20(오른쪽 28). Figma에 없는 맞춤 버튼은 그 왼쪽의 보조 도구로 둔다 */}
          <div className="pointer-events-none absolute top-5 right-7 z-10 flex items-start gap-2">
            <div className="-mt-[3px]">
              <FitControls onFitWidth={handleFitWidth} onFitHeight={handleFitHeight} />
            </div>
            <ZoomControls
              zoom={transform.zoom}
              onZoomIn={() => handleZoomButton(1)}
              onZoomOut={() => handleZoomButton(-1)}
              onSetZoom={handleSetZoom}
            />
          </div>

          <CanvasScrollIndicator axis="vertical" pan={transform.pan.y} scaledSize={canvasSize.height * transform.zoom} usableSize={usableSize.height} />
          <CanvasScrollIndicator axis="horizontal" pan={transform.pan.x} scaledSize={canvasSize.width * transform.zoom} usableSize={usableSize.width} />

          {/* N5 4차 정리 — 캔버스 전체를 덮던 상시 안내("번역문 미리보기가
              아직 생성되지 않았습니다")는 제거했다. render 없는 section에는
              원래도 그 section 자신의 "렌더 대기 중" 오버레이가 있는데(아래
              ImageLayer의 isPending), 일부 section만 렌더가 안 된 경우에도
              캔버스 전체가 "미리보기 자체가 없다"처럼 보이는 중복·과장된
              표현이었다 — section-local 표시 하나로 충분하다. */}

          {/* Figma 544:3168 「After」(1512:23333) — 캔버스 좌하단 독립 그룹. 캔버스 왼쪽 24px(viewport
              padding과 같은 값), 화면 아래 31px. viewport 기준이라 우측 검수 패널 폭과 무관하다.
              viewport의 pointer·pan·zoom 처리에는 연결하지 않는다. */}
          <div data-testid="n5-undo-redo-wrap" className="absolute bottom-[31px] left-6 z-10">
            {/* Figma에 실패 표현이 없어 섹션 저장 실패 안내와 같은 형식으로 버튼 위에 둔다 */}
            {editSession.notice && (
              <p
                role="alert"
                data-testid="n5-history-notice"
                className="absolute bottom-[56px] left-0 w-[280px] rounded-[6px] border border-[#eaeaea] bg-white px-3 py-2 text-[11px] text-red-500"
              >
                {N5_SAVE_NOTICE_MESSAGES[editSession.notice]}
              </p>
            )}
            <UndoRedoControls
              canUndo={editSession.canUndo}
              canRedo={editSession.canRedo}
              onUndo={editSession.undo}
              onRedo={editSession.redo}
            />
          </div>

          <div
            data-testid="n5-canvas"
            // data-zoom/pan-*은 화면에 보이지 않는 테스트 전용 hook이다 — e2e가
            // transform CSS 문자열을 파싱하지 않고 현재 zoom/pan 값을 읽을 수 있게 한다.
            data-zoom={transform.zoom}
            data-pan-x={transform.pan.x}
            data-pan-y={transform.pan.y}
            className="flex flex-col items-start"
            style={{
              width: canvasSize.width,
              height: canvasSize.height,
              transform: `translate(${transform.pan.x}px, ${transform.pan.y}px) scale(${transform.zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <ImageLayer
              slices={slices}
              blocksBySection={blocksBySection}
              blockIndexById={blockIndexById}
              sectionStatusById={sectionStatusById}
              sectionHeaderHeightById={sectionHeaderHeightById}
              snapGuide={snapGuide}
              overlapDiagnostic={overlapDiagnostic}
              mode={viewMode}
              blockDrag={blockDrag}
              consumeDragClick={consumeDragClick}
              pendingSectionIds={editSession.pendingSectionIds}
              failedSectionId={editSession.failedSectionId}
              isEditLocked={isEditLocked}
              baseFontScaleById={baseFontScaleById}
              typesetModelsBySection={typesetModelsBySection}
              isTypesetQa={isTypesetQa}
              onExcludeSection={(sectionId) => editSession.saveSectionBucket(sectionId, 'exclude')}
              onRestoreSection={(sectionId) => editSession.saveSectionBucket(sectionId, 'include')}
              scale={preview.scale}
              zoom={transform.zoom}
              selectedBlockId={selectedBlockId}
              selectedSectionId={selectedSectionId}
              onSelectBlock={onSelectBlock}
              onSelectSection={onSelectSection}
            />
            {/* 조정 UI는 「번역 후」 화면에만 있다(F-CFM-15). 「번역 전」은 선택 테두리·번호만 남는다 */}
            {viewMode === 'translated' && selectedBlockCanvasRect && selectedBlockBbox && selectedBlockId != null && selectedSection && (
              <BlockSelectionChrome
                key={selectedBlockId}
                bbox={selectedBlockBbox}
                section={selectedSection}
                scale={preview.scale}
                onResize={(next) => setBboxDraft(selectedBlockId, next)}
                onResizeCommit={(before, after) => commitBoxEdit('box-resize', selectedBlockId, before, after)}
                isEditLocked={isEditLocked}
                onDragActiveChange={setLayoutDragging}
                fontScale={baseFontScaleById(selectedBlockId)}
                fitAutoHeight={
                  selectedAutoFit && selectedBlockForOverlap
                    ? (box) => fitAutoHeight(selectedBlockForOverlap, box)?.box ?? null
                    : null
                }
                autoHeightOverflow={selectedAutoFit?.overflow ?? false}
                onFontScaleChange={(direction) => {
                  const block = serverBlocks.find((candidate) => candidate.id === selectedBlockId);
                  if (block) editSession.changeFontScale(block, direction);
                }}
                rect={selectedBlockCanvasRect}
                zoom={transform.zoom}
                panX={transform.pan.x}
                usableWidth={usableSize.width}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
