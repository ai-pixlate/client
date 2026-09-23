'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { BlockViewModel, PreviewSectionViewModel, PreviewViewModel } from '@/lib/n5/adapter';
import { getBlockDisplayRect, type DisplayRect } from '@/lib/n5/coordinates';
import {
  ZOOM_BUTTON_STEP,
  computeWheelZoomFactor,
  computeZoomAroundPoint,
  computeUsableViewportSize,
  computeFitWidthScale,
  computeFitHeightScale,
  computeCenteredPan,
  clampPan,
  type N5ViewMode,
  type Point,
  type Size,
} from '@/lib/n5/viewport';
import { ZoomControls, FitControls, PlacementToolbar } from './n5-toolbar';

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
// orange 테두리(Selection 컴포넌트, border-[#ff6a38]) + 번호 배지 색(아래
// BlockPinBadge, 7단계 544:3168 재확인분 — 우측 panel의 BlockNumberBadge와
// 같은 규칙). 선택된 section: 슬라이스 좌상단에 뜨는 "SectionN" 태그
// (Tag/Selectable, border-[#ff6a38] bg-white text-[#ff6a38]). 선택 안 된
// section에는 이 태그 자체를 렌더하지 않는다 — Figma가 "기본(미선택)"
// variant를 보여주지 않아 값을 추측하지 않기 위함이고, absolute 배치라 넣고
// 빼도 레이아웃(스크롤/줌) reflow가 없다.
//
// section 배경(태그가 없는 빈 영역)을 클릭하면 그 section만 선택한다(block
// 선택은 해제). block hitbox는 stopPropagation으로 이 section 클릭과 분리한다
// (선택·제외 조작이 서로 충돌하지 않게 — CLAUDE.md 클릭 영역 분리 원칙).
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
  isExcluded: boolean;
}

/**
 * PreviewSectionViewModel 목록(이미 sectionOrder 오름차순, Adapter가 정렬)으로부터
 * 캔버스에 그릴 slice 목록을 만든다. F-CFM-14 — N5에서 제외된 section도 slice로
 * 남겨 같은 자리·같은 높이를 유지하고, 그 위에 회색 오버레이만 덮는다(구 구조와
 * 동일한 정책, 걸러내지 않는다).
 */
function buildSectionSlices(sections: PreviewSectionViewModel[], scale: number): CanvasSlice[] {
  return sections.map((section) => ({
    sectionId: section.id,
    sectionOrder: section.sectionOrder,
    height: section.height * scale,
    width: section.width * scale,
    originalUrl: section.originalUrl,
    render: section.render,
    isExcluded: section.render.status === 'excluded',
  }));
}

/** 선택된 section 좌상단에 뜨는 태그. Figma Tag/Selectable(Selected) 값 그대로. */
function SectionSelectedTag({ sectionOrder }: { sectionOrder: number }) {
  return (
    <div
      data-testid="n5-section-selected-tag"
      className="absolute top-2 left-2 z-10 flex h-7 items-center justify-center rounded-[6px] border border-[#ff6a38] bg-white px-2 text-[12px] text-[#ff6a38]"
    >
      Section{sectionOrder}
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

function BlockOverlay({
  block,
  index,
  scale,
  isSelected,
  onSelect,
}: {
  block: BlockViewModel;
  index: number;
  scale: number;
  isSelected: boolean;
  /** ImageLayer가 현재 selectionTool에 맞춰 이미 만들어 둔 클릭 동작(block 선택 또는 section 선택)을 그대로 받는다. */
  onSelect: () => void;
}) {
  if (!block.bbox) return null;
  const rect = getBlockDisplayRect(block.bbox, 0, scale);
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        data-testid={`n5-block-overlay-${block.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }}
        className={`absolute cursor-pointer ${isSelected ? 'border border-[#ff6a38]' : ''}`}
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      />
      <div
        data-testid={`n5-block-pin-${block.id}`}
        className="pointer-events-none absolute z-10"
        // 9/23 재확인 — rect.left/top은 preview.scale(소수)이 곱해진 값이라
        // 그대로 쓰면 배지가 소수 px 위치에 놓인다. Playwright로 Pretendard
        // leading-none 배지의 실제 glyph-vs-circle 중심 오차를 측정한 결과
        // (숫자 1~9 전량, 소수/정수 offset 양쪽 모두) dx/dy가 0.01px 이내로
        // 이미 사실상 완전히 중앙이었다 — 배지 자체의 flex 정렬은 깨져있지
        // 않다. 다만 소수 px 위치는 브라우저마다 서브픽셀 렌더링 방식이 달라
        // 미세한 흐림/치우침 인상을 줄 수 있어, 정수 px로 스냅한다(패딩/
        // translate로 임의 보정한 값이 아니라 위치 자체를 반올림한 것).
        style={{ left: Math.round(rect.left - 10), top: Math.round(rect.top - 10) }}
      >
        <BlockPinBadge index={index} isSelected={isSelected} />
      </div>
    </>
  );
}

function ImageLayer({
  slices,
  blocksBySection,
  blockIndexById,
  mode,
  selectionTool,
  excludedSectionIds,
  onExcludeSection,
  onRestoreSection,
  scale,
  selectedBlockId,
  selectedSectionId,
  onSelectBlock,
  onSelectSection,
}: {
  slices: CanvasSlice[];
  blocksBySection: Map<number, BlockViewModel[]>;
  /** 우측 panel과 같은 번호(BlockNumberBadge)를 canvas 배지에도 쓰기 위한 공유 인덱스 */
  blockIndexById: Map<number, number>;
  mode: N5ViewMode;
  /** 하단 배치 편집 toolbar의 현재 활성 도구. 'section'일 때는 block을 눌러도
   *  그 block이 아니라 소속 section만 선택한다(block 선택은 유지/해제하지
   *  않고, 애초에 block 클릭 자체를 section 클릭으로 취급한다). */
  selectionTool: 'text' | 'section';
  /** F-CFM-14 — 로컬로 제외 처리된 sectionId 집합. slice 자체는 그대로 두고 위에 오버레이만 덮는다. */
  excludedSectionIds: Set<number>;
  onExcludeSection: (sectionId: number) => void;
  onRestoreSection: (sectionId: number) => void;
  scale: number;
  selectedBlockId: number | null;
  selectedSectionId: number | null;
  onSelectBlock: (block: BlockViewModel) => void;
  onSelectSection: (sectionId: number) => void;
}) {
  return (
    <>
      {slices.map((slice) => {
        const url =
          mode === 'original'
            ? slice.originalUrl
            : slice.render.status === 'ready'
              ? slice.render.url
              : null;
        const isExcluded = excludedSectionIds.has(slice.sectionId);
        // renderedUrl===null(렌더 전)이고 제외도 아닌데 「번역 후」를 보고 있는
        // 경우 — 상위(N5View)가 이 상태면 번역 후 자체를 disabled 처리하므로
        // 실제로는 거의 도달하지 않지만, 방어적으로 안내 문구를 보여준다(빈
        // 배경으로 조용히 실패 처리하지 않는다).
        const isPending = mode === 'translated' && !isExcluded && slice.render.status === 'unresolved';
        const blocks = blocksBySection.get(slice.sectionId) ?? [];
        return (
          <div
            key={slice.sectionId}
            data-testid={`n5-slice-${mode}-${slice.sectionId}`}
            role="button"
            tabIndex={0}
            // Figma(544:3168)는 section마다 border(border-[#eaeaea])로 구획을
            // 나눈다 — 쌓인 section 사이 경계가 시각적으로 보이게 한다.
            className="relative shrink-0 cursor-pointer border border-[#eaeaea]"
            onClick={() => onSelectSection(slice.sectionId)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onSelectSection(slice.sectionId);
            }}
            style={{
              height: slice.height,
              width: slice.width,
              backgroundColor: '#e5e5e5',
              backgroundImage: url ? `url(${url})` : 'none',
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
            }}
          >
            {isPending && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#e5e5e5] text-center text-[12px] text-[#999]">
                렌더 대기 중
              </div>
            )}
            {!isExcluded &&
              blocks.map((block) => (
                <BlockOverlay
                  key={block.id}
                  block={block}
                  index={blockIndexById.get(block.id) ?? 0}
                  scale={scale}
                  isSelected={block.id === selectedBlockId}
                  onSelect={
                    selectionTool === 'section'
                      ? () => onSelectSection(block.sectionId)
                      : () => onSelectBlock(block)
                  }
                />
              ))}
            {!isExcluded && slice.sectionId === selectedSectionId && (
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
                <button
                  type="button"
                  data-testid={`n5-section-restore-${slice.sectionId}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestoreSection(slice.sectionId);
                  }}
                  className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-[#171717] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)] hover:bg-gray-50"
                >
                  되돌리기
                </button>
              </div>
            ) : (
              <div className="absolute top-2 right-2 z-10">
                <button
                  type="button"
                  data-testid={`n5-section-exclude-${slice.sectionId}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onExcludeSection(slice.sectionId);
                  }}
                  className="rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-[#171717] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)] hover:bg-white"
                >
                  제외하기
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
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
  blocks,
  viewMode,
  selectedBlockId,
  selectedSectionId,
  revealRequestSeq,
  onSelectBlock,
  onSelectSection,
}: {
  preview: PreviewViewModel;
  blocks: BlockViewModel[];
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
}) {
  const [transform, setTransform] = useState<Transform>(INITIAL_TRANSFORM);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // 하단 배치 편집 toolbar의 현재 도구 — 로컬 UI state다(새 API/선택 데이터
  // 구조를 만들지 않는다). 기본은 'text'(지금까지의 기본 클릭 동작과 동일:
  // block을 누르면 block을, 빈 section 배경을 누르면 section을 선택한다).
  // 'section'으로 바꾸면 block 위를 눌러도 block이 아니라 그 section만
  // 선택한다 — selectedBlockId/selectedSectionId 정본(N5View 소유)은 그대로
  // 재사용하고, 이 tool state는 "클릭을 어떻게 해석할지"만 바꾼다.
  const [selectionTool, setSelectionTool] = useState<'text' | 'section'>('text');

  const handleSelectTextTool = useCallback(() => {
    setSelectionTool('text');
  }, []);

  // 섹션 선택 도구로 전환하는 순간, 이미 선택된 block이 있으면 그 block의
  // section으로 다운그레이드한다("block selection은 해제하거나 section
  // selection 규칙에 맞게 처리" — onSelectSection이 이미 selectedBlockId를
  // null로 정리하는 handleSelectSection(n5-view.tsx)을 그대로 호출한다).
  const handleSelectSectionTool = useCallback(() => {
    setSelectionTool('section');
    if (selectedBlockId != null && selectedSectionId != null) {
      onSelectSection(selectedSectionId);
    }
  }, [selectedBlockId, selectedSectionId, onSelectSection]);

  // F-CFM-14 — N5에서 제외된 section의 회색 오버레이(sectionId 기준 로컬 state).
  // 서버 render.status==='excluded'(bucket/excludedStage 파생)를 초기값으로만
  // 씨드하고, 이후로는 서버와 왕복하지 않는다 — 제외하기/되돌리기 둘 다 이
  // Set을 add/delete할 뿐이다.
  const [excludedSectionIds, setExcludedSectionIds] = useState<Set<number>>(
    () => new Set(preview.sections.filter((s) => s.render.status === 'excluded').map((s) => s.id)),
  );

  const handleExcludeSection = useCallback((sectionId: number) => {
    setExcludedSectionIds((prev) => {
      if (prev.has(sectionId)) return prev;
      const next = new Set(prev);
      next.add(sectionId);
      return next;
    });
  }, []);

  const handleRestoreSection = useCallback((sectionId: number) => {
    setExcludedSectionIds((prev) => {
      if (!prev.has(sectionId)) return prev;
      const next = new Set(prev);
      next.delete(sectionId);
      return next;
    });
  }, []);

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

  // excludedSectionIds는 일부러 이 의존성 배열에 넣지 않는다 — F-CFM-14
  // 되돌리기는 오버레이 표시 여부만 바꿀 뿐, slices(위치/높이) 자체를
  // 다시 계산하면 안 된다(스택 재배치 금지).
  const slices = useMemo(
    () => buildSectionSlices(preview.sections, preview.scale),
    [preview.sections, preview.scale],
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
  const sliceOffsetYById = useMemo(() => {
    const map = new Map<number, number>();
    let cursor = 0;
    for (const slice of slices) {
      map.set(slice.sectionId, cursor);
      cursor += slice.height;
    }
    return map;
  }, [slices]);

  // canvas(원본, zoom과 무관한) 크기 — fit 계산의 기준값. 매 렌더 다시 측정하지 않는다.
  const canvasSize = useMemo<Size>(
    () => ({
      width: Math.max(preview.containerWidth, slices.reduce((max, s) => Math.max(max, s.width), 0)),
      height: slices.reduce((sum, s) => sum + s.height, 0),
    }),
    [preview.containerWidth, slices],
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
      if (hasInteractedRef.current) return;
      const canvas = canvasSizeRef.current;
      if (canvas.width <= 0) return;
      const usable = computeUsableViewportSize(el!.clientWidth, el!.clientHeight, readPadding(el!));
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
        const pointer: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
    const rect = el.getBoundingClientRect();
    const center: Point = { x: rect.width / 2, y: rect.height / 2 };
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    setTransform((prev) => {
      const result = computeZoomAroundPoint(prev.zoom, prev.pan, center, prev.zoom + direction * ZOOM_BUTTON_STEP);
      return { zoom: result.zoom, pan: clampPan(result.pan, canvasSizeRef.current, result.zoom, usable) };
    });
  }, []);

  const handleSetZoom = useCallback((nextZoom: number) => {
    const el = viewportRef.current;
    if (!el) return;
    hasInteractedRef.current = true; // 사용자가 직접 조작 — 이후 자동 중앙 정렬 중단
    const rect = el.getBoundingClientRect();
    const center: Point = { x: rect.width / 2, y: rect.height / 2 };
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
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

  const cursor = isPanning ? 'grabbing' : isSpaceHeld ? 'grab' : 'default';

  return (
    <div
      ref={viewportRef}
      data-testid="n5-viewport"
      className="relative h-full min-w-0 flex-1 touch-none overflow-hidden rounded-[6px] bg-[#f5f5f5] p-6"
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
          <div className="pointer-events-none absolute top-5 right-5 z-10 flex items-center gap-2">
            <ZoomControls
              zoom={transform.zoom}
              onZoomIn={() => handleZoomButton(1)}
              onZoomOut={() => handleZoomButton(-1)}
              onSetZoom={handleSetZoom}
            />
            <FitControls onFitWidth={handleFitWidth} onFitHeight={handleFitHeight} />
          </div>

          {/* N5 4차 정리 — 캔버스 전체를 덮던 상시 안내("번역문 미리보기가
              아직 생성되지 않았습니다")는 제거했다. render 없는 section에는
              원래도 그 section 자신의 "렌더 대기 중" 오버레이가 있는데(아래
              ImageLayer의 isPending), 일부 section만 렌더가 안 된 경우에도
              캔버스 전체가 "미리보기 자체가 없다"처럼 보이는 중복·과장된
              표현이었다 — section-local 표시 하나로 충분하다. */}

          {/* N5 3차 정렬 — 텍스트 선택/섹션 선택은 이제 실제로 클릭 가능한
              tool이다(pointer-events-none로 회피하지 않는다). fit-height로
              캔버스가 이 toolbar와 같은 화면 위치(하단 중앙)까지 꽉 찰 때
              그 지점을 클릭하면 toolbar가 우선한다 — 이는 Figma가 보여주는
              대로 toolbar가 캔버스 위에 항상 떠 있는 고정 컨트롤이라는
              점에서 의도된 동작이다(다른 캔버스형 툴의 floating toolbar와
              동일). 삭제하기만 실제 handler가 없어 disabled 상태를 유지한다
              (아래 PlacementToolbar 정의, n5-toolbar.tsx). */}
          <div
            data-testid="n5-placement-toolbar-wrap"
            className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2"
          >
            <PlacementToolbar
              activeTool={selectionTool}
              onSelectTextTool={handleSelectTextTool}
              onSelectSectionTool={handleSelectSectionTool}
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
              mode={viewMode}
              selectionTool={selectionTool}
              excludedSectionIds={excludedSectionIds}
              onExcludeSection={handleExcludeSection}
              onRestoreSection={handleRestoreSection}
              scale={preview.scale}
              selectedBlockId={selectedBlockId}
              selectedSectionId={selectedSectionId}
              onSelectBlock={onSelectBlock}
              onSelectSection={onSelectSection}
            />
          </div>
        </>
      )}
    </div>
  );
}
