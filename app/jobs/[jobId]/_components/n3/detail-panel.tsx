'use client';

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import type { Section } from '@/lib/api/types';
import { EXCLUSION_REASON_LABELS } from '@/lib/api/labels';
import { StatusChip, VerdictCard } from './verdict-card';

// ─────────────────────────────────────────────────────────────────
// N3 — 가운데 "삭제할 섹션 상세 보기"
// 현재 activeSection(exclude bucket)의 원본 이미지 + 판정/근거 카드.
// Figma 570:5136(N3 / 원본 상세페이지 스크롤 뷰포트 + 판정 카드) 대응.
//
// 데이터 계약에 섹션별 "전체 원본 상세페이지" 이미지 필드가 없어
// (Section에는 thumbnailUrl만 존재) 같은 이미지를 크게 보여준다.
// ─────────────────────────────────────────────────────────────────

export function DetailPanel({ section }: { section: Section | null }) {
  if (!section) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-[8px] bg-white">
        <p className="text-sm text-[#999]">삭제 후보로 남은 섹션이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 items-start gap-4 overflow-hidden">
      <DraggableDetailImage section={section} />

      <div className="flex h-full w-[402px] shrink-0 flex-col gap-7 overflow-y-auto py-2 pr-1">
        {section.exclusionReason && (
          <div className="flex w-full flex-col items-start gap-3 rounded-[8px] bg-white p-5">
            <StatusChip label={EXCLUSION_REASON_LABELS[section.exclusionReason]} />
          </div>
        )}

        {section.verdicts.map((verdict) => (
          <VerdictCard key={verdict.verdictId} verdict={verdict} />
        ))}

        {!section.exclusionReason && section.verdicts.length === 0 && (
          <p className="px-1 text-sm text-[#999]">판정 정보가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

function DraggableDetailImage({ section }: { section: Section }) {
  const [imgFailed, setImgFailed] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `detail-${section.sectionId}`,
    data: { sectionId: section.sectionId, sourceBucket: section.bucket },
  });

  const aspectRatio = `${section.bbox.width} / ${section.bbox.height}`;

  return (
    <div
      ref={setNodeRef}
      data-testid={`n3-detail-image-${section.sectionId}`}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform), touchAction: 'none' }}
      className={`h-full flex-1 cursor-grab overflow-y-auto rounded-[8px] bg-white transition-opacity duration-150 active:cursor-grabbing ${
        isDragging ? 'opacity-30' : 'opacity-100'
      }`}
    >
      {!imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={section.thumbnailUrl}
          alt={`섹션 ${section.sectionOrder} 원본`}
          className="w-full object-cover"
          style={{ aspectRatio }}
          draggable={false}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          className="flex w-full flex-col items-center justify-center gap-2 bg-gray-100"
          style={{ aspectRatio }}
        >
          <div className="h-8 w-8 rounded bg-gray-200" />
          <span className="text-xs text-gray-400">이미지 없음</span>
        </div>
      )}
    </div>
  );
}
