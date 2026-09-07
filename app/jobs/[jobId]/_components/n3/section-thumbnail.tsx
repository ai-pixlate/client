'use client';

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import type { Section } from '@/lib/api/types';

// ─────────────────────────────────────────────────────────────────
// N3 — 썸네일 (drag source)
// exclude/include 두 리스트에서 공용으로 사용. variant로 폭만 다름.
// Figma 540:3119 기준: 삭제 썸네일 120px, 번역 썸네일 206px(사이드바 폭 기준).
// ─────────────────────────────────────────────────────────────────

export const EXCLUDE_THUMB_WIDTH = 120;
export const INCLUDE_THUMB_WIDTH = 206;

export function thumbWidthFor(bucket: 'include' | 'exclude') {
  return bucket === 'exclude' ? EXCLUDE_THUMB_WIDTH : INCLUDE_THUMB_WIDTH;
}

export function SectionThumbnail({
  section,
  variant,
  isActive = false,
  onClick,
}: {
  section: Section;
  variant: 'exclude' | 'include';
  isActive?: boolean;
  onClick?: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `thumb-${section.sectionId}`,
    data: { sectionId: section.sectionId, sourceBucket: section.bucket },
  });

  const width = thumbWidthFor(variant);
  const aspectRatio = `${section.bbox.width} / ${section.bbox.height}`;

  return (
    <button
      type="button"
      ref={setNodeRef}
      data-testid={`n3-thumb-${variant}-${section.sectionId}`}
      onClick={onClick}
      {...listeners}
      {...attributes}
      style={{
        width,
        transform: CSS.Translate.toString(transform),
        touchAction: 'none',
      }}
      className={`n3-thumb-settle group relative block shrink-0 overflow-hidden rounded-[4px] text-left shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)] transition-opacity duration-150 ${
        isDragging ? 'opacity-30' : 'opacity-100'
      } ${isActive ? 'ring-4 ring-[#ff6a38]' : ''}`}
    >
      {!imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={section.thumbnailUrl}
          alt={`섹션 ${section.sectionOrder} 미리보기`}
          className="block w-full cursor-grab object-cover active:cursor-grabbing"
          style={{ aspectRatio }}
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className="flex w-full flex-col items-center justify-center gap-1 bg-gray-100"
          style={{ aspectRatio }}
        >
          <div className="h-6 w-6 rounded bg-gray-200" />
          <span className="text-[10px] text-gray-400">이미지 없음</span>
        </div>
      )}
    </button>
  );
}

/** drag 중 target 리스트에 표시되는 placeholder — 실제 drop 위치를 미리 보여준다 */
export function ThumbnailPlaceholder({ variant }: { variant: 'exclude' | 'include' }) {
  const width = thumbWidthFor(variant);
  return (
    <div
      style={{ width, height: width * 1.1 }}
      className="shrink-0 rounded-[4px] border-2 border-dashed border-[#ff6a38]/40 bg-[#ff6a38]/5"
    />
  );
}
