'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

import {
  useSectionsQuery,
  useSourceImagesQuery,
  useUpdateSectionBucketMutation,
  useSectionProceedMutation,
} from '@/lib/queries/pixlate';
import type { ApiSection, ApiSectionBucket, ApiSourceImage } from '@/lib/api/n3-schema';
import { N3_DRAG_ACTIVATION_DISTANCE } from '@/lib/n3/constants';
import { StepNav } from '../step-nav';
import { DetailPanel } from './detail-panel';
import { SectionCropThumbnail } from './section-crop-thumbnail';
import { EXCLUDE_THUMB_WIDTH, SectionThumbnail, ThumbnailPlaceholder } from './section-thumbnail';

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 확인 (Figma node 540:3119, 3단계 UI 재구성)
//
// 구조(Figma 실측):
// - 좌측 rail(나가기 버튼 + StepNav) — N2와 같은 패턴 재사용
// - 좌측 삭제 섹션 nav(262px, chevron + crop 썸네일 scroll)
// - 중앙 workspace 카드(rounded-20, shadow) — 원본 상세페이지 scroll
//   뷰포트(SourceImage.fileUrl 전체) + 판정 카드 컬럼
// - 우측 번역할 섹션 sidebar(전체 높이, #f5f5f5) — crop 썸네일 + CTA
//
// 이미지 계약(3단계 데이터 가정): Section 자체엔 이미지 URL이 없다.
// SourceImage.fileUrl + Section.bbox를 FE가 crop해 썸네일을 만들고,
// 중앙 뷰포트는 crop하지 않은 전체 SourceImage를 보여준다.
//
// drop 판단은 개별 썸네일이 아니라 두 영역(나가기+workspace 통합 / 우측
// sidebar) 기준(pointerWithin). 같은 bucket 안에서의 재정렬은 지원하지
// 않는다 — sectionOrder는 항상 유지.
// ─────────────────────────────────────────────────────────────────

const EXCLUDE_ZONE = 'exclude-zone';
const INCLUDE_ZONE = 'include-zone';
const INCLUDE_THUMB_WIDTH = 'clamp(160px, 10.7vw, 206px)';

interface ActiveDrag {
  sectionId: number;
  sourceBucket: ApiSectionBucket;
}

function sortByOrder(sections: ApiSection[]): ApiSection[] {
  return [...sections].sort((a, b) => (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0));
}

function findSourceImage(
  images: ApiSourceImage[] | undefined,
  sourceImageId: number | null | undefined,
): ApiSourceImage | null {
  if (sourceImageId == null) return null;
  return images?.find((img) => img.id === sourceImageId) ?? null;
}

function ExitIcon() {
  // N2(n2-analysis-view.tsx)와 동일 패턴 재사용 — Figma(849:7241) glyph는
  // 7일 만료 원격 asset이라 커밋 코드에 하드링크하지 않는다.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 12.5L10 7.5L15 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function N3View({ jobId }: { jobId: string }) {
  const sectionsQuery = useSectionsQuery(jobId);
  const sourceImagesQuery = useSourceImagesQuery(jobId);
  const mutation = useUpdateSectionBucketMutation(jobId);
  const proceedMutation = useSectionProceedMutation(jobId);

  const [activeSectionId, setActiveSectionId] = useState<number | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [overZone, setOverZone] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: N3_DRAG_ACTIVATION_DISTANCE } }),
  );

  const excludeSections = useMemo(() => sortByOrder(sectionsQuery.data?.exclude ?? []), [sectionsQuery.data]);
  const includeSections = useMemo(() => sortByOrder(sectionsQuery.data?.include ?? []), [sectionsQuery.data]);
  const allSections = useMemo(() => [...excludeSections, ...includeSections], [excludeSections, includeSections]);

  const sourceImages = sourceImagesQuery.data;

  // activeSectionId가 아직 없으면(최초 진입) 첫 삭제 후보를 렌더링 중 파생한다.
  const effectiveActiveId = activeSectionId ?? excludeSections[0]?.id ?? null;
  const activeSection = excludeSections.find((s) => s.id === effectiveActiveId) ?? null;
  const activeSourceImage = findSourceImage(sourceImages, activeSection?.sourceImageId);

  function moveSection(sectionId: number, targetBucket: ApiSectionBucket) {
    if (targetBucket === 'include') {
      // 삭제 → 번역
      if (effectiveActiveId === sectionId) {
        const next = excludeSections.find((s) => s.id !== sectionId);
        setActiveSectionId(next?.id ?? null);
      }
      mutation.mutate({ sectionId, bucket: 'include' });
    } else {
      // 번역 → 삭제: 이동한 섹션을 바로 상세 보기로 노출
      setActiveSectionId(sectionId);
      mutation.mutate({ sectionId, bucket: 'exclude' });
    }
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDrag(event.active.data.current as ActiveDrag);
  }

  function handleDragOver(event: DragOverEvent) {
    setOverZone((event.over?.id as string | undefined) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const dragged = activeDrag;
    setActiveDrag(null);
    setOverZone(null);
    if (!dragged || !event.over) return;

    const targetBucket: ApiSectionBucket = event.over.id === EXCLUDE_ZONE ? 'exclude' : 'include';
    if (targetBucket === dragged.sourceBucket) return; // 같은 영역에 drop → no-op

    moveSection(dragged.sectionId, targetBucket);
  }

  function handleDragCancel() {
    setActiveDrag(null);
    setOverZone(null);
  }

  const draggedSection = activeDrag ? allSections.find((s) => s.id === activeDrag.sectionId) : null;
  const draggedSourceImage = findSourceImage(sourceImages, draggedSection?.sourceImageId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex h-full w-full bg-white">
        {/* 좌측 rail — 나가기 버튼 + StepNav (N2와 동일 패턴 재사용) */}
        <div className="relative ml-9 h-full w-[44px] shrink-0">
          <Link
            href="/"
            aria-label="보관함으로 나가기"
            className="absolute top-10 left-1/2 z-20 flex size-10 -translate-x-1/2 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
          >
            <ExitIcon />
          </Link>
          <div className="absolute inset-0 pt-[100px] pb-6">
            <StepNav currentStep="N3" />
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 헤더 */}
          <div className="flex shrink-0 justify-center px-8 pt-[52px] pb-6">
            <div className="flex items-center gap-4">
              <h1 className="text-[20px] font-semibold tracking-[-0.02em] whitespace-nowrap text-[#171717]">
                삭제할 섹션
              </h1>
              <p className="text-[14px] tracking-[-0.01em] text-[#707070]">
                삭제할 섹션과 번역할 섹션을 확인할 수 있습니다. 드래그 앤 드롭으로 편집 가능합니다.
              </p>
            </div>
          </div>

          {/* 본문: 삭제 섹션 nav + 중앙 workspace */}
          <div className="flex min-h-0 flex-1 gap-4 px-8 pb-2">
            {sectionsQuery.isLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <span className="text-sm text-gray-400">섹션 목록을 불러오는 중...</span>
              </div>
            ) : sectionsQuery.isError ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-red-500">
                  {sectionsQuery.error instanceof Error ? sectionsQuery.error.message : '오류가 발생했습니다.'}
                </p>
              </div>
            ) : (
              <ExcludeDropZone activeDrag={activeDrag} overZone={overZone}>
                <ExcludeThumbnailNav
                  sections={excludeSections}
                  sourceImages={sourceImages}
                  activeSectionId={effectiveActiveId}
                  onSelect={setActiveSectionId}
                  activeDrag={activeDrag}
                  overZone={overZone}
                />
                <DetailPanel
                  section={activeSection}
                  sourceImage={activeSourceImage}
                  sourceImagesLoading={sourceImagesQuery.isLoading}
                  sourceImagesError={sourceImagesQuery.isError}
                />
              </ExcludeDropZone>
            )}
          </div>

          {/* 하단 안내 문구 — Figma: 우측 sidebar 바로 왼쪽 하단. 뷰포트 폭을
              하드코딩하지 않고, 이 main content column 자체가 sidebar와
              바로 맞닿아 있다는(outer flex row에 gap 없음) 구조를 이용해
              text-right + 최소 오른쪽 padding만으로 sidebar 경계에
              붙인다 — 1536/1440에서도 이 column 폭을 그대로 따라간다. */}
          <p className="shrink-0 pr-4 pl-8 pb-6 text-right text-[12px] font-light tracking-[-0.02em] text-[#999]">
            해당 섹션을 통과된 섹션으로 끌어다 놓으면 섹션이 되살아나요!
          </p>
        </div>

        <IncludeSidebar
          sections={includeSections}
          sourceImages={sourceImages}
          isLoading={sectionsQuery.isLoading}
          activeDrag={activeDrag}
          overZone={overZone}
          onAdvance={() => proceedMutation.mutate()}
          isAdvancing={proceedMutation.isPending}
        />
      </div>

      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
        {draggedSection && activeDrag ? (
          <DragPreview section={draggedSection} sourceImage={draggedSourceImage} sourceBucket={activeDrag.sourceBucket} overZone={overZone} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─────────────────────────────────────────────────────────────────
// 삭제할 섹션 영역 — 좌측 썸네일 nav + 가운데 workspace (하나의 droppable).
// Figma는 나가기+workspace 각각 독립 요소지만, drop 판단은 기존처럼 두
// 영역(exclude/include) 기준 큰 단위를 유지한다.
// ─────────────────────────────────────────────────────────────────

function ExcludeDropZone({
  children,
  activeDrag,
  overZone,
}: {
  children: React.ReactNode;
  activeDrag: ActiveDrag | null;
  overZone: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: EXCLUDE_ZONE });
  const isValidTarget = activeDrag?.sourceBucket === 'include';
  const showHighlight = isOver && isValidTarget;
  void overZone;

  return (
    <div
      ref={setNodeRef}
      data-testid="n3-exclude-zone"
      className={`flex min-h-0 flex-1 gap-4 transition-[outline-color] duration-150 ${
        showHighlight ? 'outline-2 outline-dashed outline-[#ff6a38] outline-offset-[-2px]' : 'outline-2 outline-transparent'
      }`}
    >
      {children}
    </div>
  );
}

function ExcludeThumbnailNav({
  sections,
  sourceImages,
  activeSectionId,
  onSelect,
  activeDrag,
  overZone,
}: {
  sections: ApiSection[];
  sourceImages: ApiSourceImage[] | undefined;
  activeSectionId: number | null;
  onSelect: (sectionId: number) => void;
  activeDrag: ActiveDrag | null;
  overZone: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const isValidTarget = activeDrag?.sourceBucket === 'include';
  const showPlaceholder = isValidTarget && overZone === EXCLUDE_ZONE;

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 2);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }

  useEffect(() => {
    updateScrollState();
  }, [sections.length]);

  function scrollByStep(direction: 1 | -1) {
    scrollRef.current?.scrollBy({ top: direction * 340, behavior: 'smooth' });
  }

  return (
    <div className="flex h-full w-[262px] shrink-0 flex-col items-center gap-5 overflow-hidden py-5">
      <button
        type="button"
        onClick={() => scrollByStep(-1)}
        disabled={!canScrollUp}
        aria-label="위로 스크롤"
        className="flex size-6 shrink-0 items-center justify-center text-[#171717] disabled:opacity-30"
      >
        <ChevronUpIcon />
      </button>

      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="n3-scroll-hidden flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto px-8"
      >
        {sections.map((section) => (
          <SectionThumbnail
            key={section.id}
            section={section}
            sourceImage={findSourceImage(sourceImages, section.sourceImageId)}
            variant="exclude"
            targetWidth={EXCLUDE_THUMB_WIDTH}
            isActive={section.id === activeSectionId}
            onClick={() => onSelect(section.id!)}
          />
        ))}
        {showPlaceholder && <ThumbnailPlaceholder width={EXCLUDE_THUMB_WIDTH} />}
        {sections.length === 0 && !showPlaceholder && (
          <p className="px-1 text-center text-xs text-[#999]">삭제 후보 없음</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => scrollByStep(1)}
        disabled={!canScrollDown}
        aria-label="아래로 스크롤"
        className="flex size-6 shrink-0 items-center justify-center text-[#171717] disabled:opacity-30"
      >
        <ChevronDownIcon />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 번역할 섹션 영역 — 우측 full-height sidebar (droppable)
// ─────────────────────────────────────────────────────────────────

function IncludeSidebar({
  sections,
  sourceImages,
  isLoading,
  activeDrag,
  overZone,
  onAdvance,
  isAdvancing,
}: {
  sections: ApiSection[];
  sourceImages: ApiSourceImage[] | undefined;
  isLoading: boolean;
  activeDrag: ActiveDrag | null;
  overZone: string | null;
  onAdvance: () => void;
  isAdvancing: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: INCLUDE_ZONE });
  const isValidTarget = activeDrag?.sourceBucket === 'exclude';
  const showHighlight = isOver && isValidTarget;
  const showPlaceholder = isValidTarget && overZone === INCLUDE_ZONE;

  return (
    <div
      ref={setNodeRef}
      data-testid="n3-include-zone"
      style={{ width: 'clamp(320px, 19.9vw, 383px)' }}
      className={`flex h-full shrink-0 flex-col bg-[#f5f5f5] transition-[outline-color] duration-150 ${
        showHighlight ? 'outline-2 outline-dashed outline-[#ff6a38] outline-offset-[-2px]' : 'outline-2 outline-transparent'
      }`}
    >
      <p className="shrink-0 px-6 pt-[52px] pb-8 text-center text-[18px] font-medium tracking-[-0.03em] text-[#171717]">
        번역할 섹션
      </p>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-8 overflow-y-auto px-6">
        {isLoading ? (
          <span className="text-sm text-gray-400">불러오는 중...</span>
        ) : (
          <>
            {sections.map((section) => (
              <SectionThumbnail
                key={section.id}
                section={section}
                sourceImage={findSourceImage(sourceImages, section.sourceImageId)}
                variant="include"
                targetWidth={INCLUDE_THUMB_WIDTH}
              />
            ))}
            {showPlaceholder && <ThumbnailPlaceholder width={206} />}
            {sections.length === 0 && !showPlaceholder && (
              <p className="px-1 text-center text-xs text-[#999]">
                번역할 섹션이 아직 없습니다. 왼쪽에서 섹션을 끌어다 놓아 보세요.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-3 bg-[#eee] px-6 pt-4 pb-[60px]">
        <button
          type="button"
          disabled={isAdvancing || sections.length === 0}
          onClick={onAdvance}
          className="w-full max-w-[342px] rounded-md bg-[#171717] px-8 py-3.5 text-[14px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isAdvancing ? '번역 시작 중...' : '번역 시작'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// drag preview — target 영역에 진입하면 target 썸네일 폭으로 morph
// ─────────────────────────────────────────────────────────────────

function DragPreview({
  section,
  sourceImage,
  sourceBucket,
  overZone,
}: {
  section: ApiSection;
  sourceImage: ApiSourceImage | null;
  sourceBucket: ApiSectionBucket;
  overZone: string | null;
}) {
  const targetBucket: ApiSectionBucket | null =
    overZone === EXCLUDE_ZONE ? 'exclude' : overZone === INCLUDE_ZONE ? 'include' : null;
  const isValidTarget = targetBucket !== null && targetBucket !== sourceBucket;
  const effectiveBucket = isValidTarget ? targetBucket : sourceBucket;
  const width = effectiveBucket === 'exclude' ? EXCLUDE_THUMB_WIDTH : 206;

  return (
    <div className="cursor-grabbing shadow-[2px_2px_24px_0px_rgba(0,0,0,0.18)] ring-2 ring-white transition-[width] duration-150 ease-out" style={{ width }}>
      <SectionCropThumbnail sourceImage={sourceImage} bbox={section.bbox} targetWidth={width} alt="" className="rounded-[4px]" />
    </div>
  );
}
