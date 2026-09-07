'use client';

import { useState } from 'react';
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
  useUpdateSectionBucketMutation,
  useAdvanceJobStepMutation,
} from '@/lib/queries/pixate';
import type { Section, SectionBucket } from '@/lib/api/types';
import { DetailPanel } from './detail-panel';
import { N3StepNav } from './step-nav';
import { SectionThumbnail, ThumbnailPlaceholder, thumbWidthFor } from './section-thumbnail';

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 확인 (Figma node 540:3119 기준)
//
// 핵심 구조: 2버킷 drag & drop
// - 삭제할 섹션 영역(exclude-zone): 좌측 썸네일 nav + 가운데 상세 보기
// - 번역할 섹션 영역(include-zone): 우측 패널
//
// drop 판단은 개별 썸네일이 아니라 두 영역의 BG 경계선 기준(pointerWithin).
// 같은 bucket 안에서의 재정렬은 지원하지 않는다 — sectionOrder는 항상 유지.
// ─────────────────────────────────────────────────────────────────

const EXCLUDE_ZONE = 'exclude-zone';
const INCLUDE_ZONE = 'include-zone';

interface ActiveDrag {
  sectionId: string;
  sourceBucket: SectionBucket;
}

export function N3View({ jobId }: { jobId: string }) {
  const { data, isLoading, isError, error } = useSectionsQuery(jobId);
  const mutation = useUpdateSectionBucketMutation(jobId);
  const advanceMutation = useAdvanceJobStepMutation(jobId);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [overZone, setOverZone] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const sections = data?.sections ?? [];
  const excludeSections = sections.filter((s) => s.bucket === 'exclude');
  const includeSections = sections.filter((s) => s.bucket === 'include');
  // activeSectionId가 아직 없으면(최초 진입) 첫 삭제 후보를 렌더링 중 파생한다 —
  // 별도 effect 없이 상태를 파생시켜 불필요한 리렌더를 피한다.
  const effectiveActiveId = activeSectionId ?? excludeSections[0]?.sectionId ?? null;
  const activeSection = excludeSections.find((s) => s.sectionId === effectiveActiveId) ?? null;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <span className="text-sm text-gray-400">섹션 목록을 불러오는 중...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-red-500">
          {error instanceof Error ? error.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  }

  if (!data) return null;

  function moveSection(sectionId: string, targetBucket: SectionBucket) {
    if (targetBucket === 'include') {
      // 삭제 → 번역
      if (effectiveActiveId === sectionId) {
        const next = excludeSections.find((s) => s.sectionId !== sectionId);
        setActiveSectionId(next?.sectionId ?? null);
      }
      mutation.mutate({ sectionId, bucket: 'include' });
    } else {
      // 번역 → 삭제: 이동한 섹션을 바로 상세 보기로 노출
      setActiveSectionId(sectionId);
      mutation.mutate({ sectionId, bucket: 'exclude', stage: 'N3' });
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

    const targetBucket: SectionBucket = event.over.id === EXCLUDE_ZONE ? 'exclude' : 'include';
    if (targetBucket === dragged.sourceBucket) return; // 같은 영역에 drop → no-op

    moveSection(dragged.sectionId, targetBucket);
  }

  function handleDragCancel() {
    setActiveDrag(null);
    setOverZone(null);
  }

  const draggedSection = activeDrag
    ? sections.find((s) => s.sectionId === activeDrag.sectionId)
    : null;

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
        <N3StepNav />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 헤더 */}
          <div className="flex shrink-0 items-center gap-4 px-8 pt-8 pb-4">
            <Link
              href="/"
              className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
              aria-label="뒤로"
            >
              ←
            </Link>
            <div className="mx-auto flex items-center gap-4 text-center">
              <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[#171717]">
                삭제할 섹션
              </h1>
              <p className="text-[14px] tracking-[-0.01em] text-[#707070]">
                드래그 앤 드롭으로 삭제할 섹션과 번역할 섹션을 확인해 보세요
              </p>
            </div>
            <div className="size-10 shrink-0" />
          </div>

          {/* 본문: 삭제 영역 + 번역 영역 */}
          <div className="flex min-h-0 flex-1 gap-4 px-8 pb-8">
            <ExcludeZone
              sections={excludeSections}
              activeSection={activeSection}
              activeSectionId={effectiveActiveId}
              onSelect={setActiveSectionId}
              activeDrag={activeDrag}
              overZone={overZone}
            />

            <IncludeZone
              sections={includeSections}
              activeDrag={activeDrag}
              overZone={overZone}
              onAdvance={() => advanceMutation.mutate()}
              isAdvancing={advanceMutation.isPending}
            />
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
        {draggedSection && activeDrag ? (
          <DragPreview
            section={draggedSection}
            sourceBucket={activeDrag.sourceBucket}
            overZone={overZone}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ─────────────────────────────────────────────────────────────────
// 삭제할 섹션 영역 — 좌측 썸네일 nav + 가운데 상세 보기 (하나의 droppable)
// ─────────────────────────────────────────────────────────────────

function ExcludeZone({
  sections,
  activeSection,
  activeSectionId,
  onSelect,
  activeDrag,
  overZone,
}: {
  sections: Section[];
  activeSection: Section | null;
  activeSectionId: string | null;
  onSelect: (sectionId: string) => void;
  activeDrag: ActiveDrag | null;
  overZone: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: EXCLUDE_ZONE });
  const isValidTarget = activeDrag?.sourceBucket === 'include';
  const showHighlight = isOver && isValidTarget;
  const showPlaceholder = isValidTarget && overZone === EXCLUDE_ZONE;

  return (
    <div
      ref={setNodeRef}
      data-testid="n3-exclude-zone"
      className={`flex min-h-0 flex-1 gap-4 rounded-[20px] border p-4 shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)] transition-colors duration-150 ${
        showHighlight ? 'border-[#ff6a38] bg-[#fff6f3]' : 'border-transparent bg-white'
      }`}
    >
      <div className="flex h-full w-[152px] shrink-0 flex-col items-center gap-5 overflow-y-auto px-4 py-3">
        {sections.map((section) => (
          <SectionThumbnail
            key={section.sectionId}
            section={section}
            variant="exclude"
            isActive={section.sectionId === activeSectionId}
            onClick={() => onSelect(section.sectionId)}
          />
        ))}
        {showPlaceholder && <ThumbnailPlaceholder variant="exclude" />}
        {sections.length === 0 && !showPlaceholder && (
          <p className="px-1 text-center text-xs text-[#999]">삭제 후보 없음</p>
        )}
      </div>

      <DetailPanel section={activeSection} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 번역할 섹션 영역 — 우측 패널 (droppable)
// ─────────────────────────────────────────────────────────────────

function IncludeZone({
  sections,
  activeDrag,
  overZone,
  onAdvance,
  isAdvancing,
}: {
  sections: Section[];
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
      className={`flex h-full w-[320px] shrink-0 flex-col rounded-[8px] border transition-colors duration-150 ${
        showHighlight ? 'border-[#ff6a38] bg-[#ffece3]' : 'border-transparent bg-[#f5f5f5]'
      }`}
    >
      <p className="shrink-0 px-6 pt-8 pb-4 text-center text-[18px] font-medium tracking-[-0.03em] text-[#171717]">
        번역할 섹션
      </p>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-y-auto px-6 pb-6">
        {sections.map((section) => (
          <SectionThumbnail key={section.sectionId} section={section} variant="include" />
        ))}
        {showPlaceholder && <ThumbnailPlaceholder variant="include" />}
        {sections.length === 0 && !showPlaceholder && (
          <p className="px-1 text-center text-xs text-[#999]">
            번역할 섹션이 아직 없습니다. 왼쪽에서 섹션을 끌어다 놓아 보세요.
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-3 bg-[#eee] px-6 pt-4 pb-8">
        <button
          type="button"
          disabled={isAdvancing || sections.length === 0}
          onClick={onAdvance}
          className="w-full rounded-md bg-[#171717] px-8 py-3.5 text-[14px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
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
  sourceBucket,
  overZone,
}: {
  section: Section;
  sourceBucket: SectionBucket;
  overZone: string | null;
}) {
  const targetBucket: SectionBucket | null =
    overZone === EXCLUDE_ZONE ? 'exclude' : overZone === INCLUDE_ZONE ? 'include' : null;
  const isValidTarget = targetBucket !== null && targetBucket !== sourceBucket;
  const width = isValidTarget ? thumbWidthFor(targetBucket) : thumbWidthFor(sourceBucket);

  return (
    <div
      style={{ width, aspectRatio: `${section.bbox.width} / ${section.bbox.height}` }}
      className="cursor-grabbing overflow-hidden rounded-[4px] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.18)] ring-2 ring-white transition-[width] duration-150 ease-out"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={section.thumbnailUrl}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
    </div>
  );
}
