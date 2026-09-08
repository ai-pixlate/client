'use client';

import { useMemo, useRef, useState } from 'react';

import { getPreviewScale } from '@/lib/n5/coordinates';
import type { ReviewSection, ReviewSourceImage } from '@/lib/api/types';
import { BeforeAfterSlider } from './before-after-slider';

// ─────────────────────────────────────────────────────────────────
// N5 — 원본/번역 Before/After 비교 스택 (Figma 544:3168 기준, 8일차)
//
// 여러 sourceImage를 "하나의" 초장축 스크롤 스택으로 이어 붙인다. 원본/번역
// preview는 완전히 같은 위치에 겹쳐 그리고(같은 좌표계·같은 scroll), 그 위에
// 세로 divider를 얹어 좌우 drag로 노출 비율을 바꾼다.
//
// exclude section은 이 스택에서 공간을 아예 차지하지 않는다 — include
// section만으로 DOM을 쌓으므로, section.displayTop(누적 스킵) 값과 실제
// 렌더 top이 정확히 일치한다 (기존 ImageViewer의 space-y-* 같은 CSS gap을
// 여기서는 전혀 쓰지 않는다 — gap 하나라도 있으면 displayTop과 어긋난다).
//
// 한 sourceImage 안에서 여러 section을 이어 보여줄 때, "이 section이 원본
// 이미지의 어디를 보여줘야 하는가"는 section.topOffset(DB section.top_offset
// 그대로)을 그대로 쓴다 — section.height를 누적해서 역산하지 않는다. section이
// sourceImage를 빈틈없이 나눈다는 보장이 계약에 없기 때문이다. topOffset은
// 절대 displayTop과 섞어 쓰지 않는다 — 표시 스택 위치(N5 표시 Y)는 언제나
// section.displayTop만 쓴다.
// ─────────────────────────────────────────────────────────────────

interface CompareSlice {
  sectionId: string;
  /** 스택 안에서 이 section이 차지하는 높이 (scaleY 적용됨) */
  height: number;
  /** 이 section이 속한 sourceImage의 표시 폭 (scaleX 적용됨) */
  width: number;
  backgroundSize: string;
  backgroundPositionY: number;
  originalUrl: string;
  translatedUrl: string;
}

function buildIncludeSlices(
  sections: ReviewSection[],
  sourceImages: ReviewSourceImage[],
): CompareSlice[] {
  const previewById = new Map(sourceImages.map((image) => [image.sourceImageId, image]));

  // job 전체 표시 순서 = sectionOrder 오름차순 (fixtures/handler가 이 순서로
  // displayTop을 계산했으므로, 렌더 순서도 반드시 같은 순서를 따라야 한다).
  const ordered = [...sections].sort((a, b) => a.sectionOrder - b.sectionOrder);

  return ordered
    .filter((section) => section.bucket === 'include')
    .flatMap((section): CompareSlice[] => {
      const image = previewById.get(section.sourceImageId);
      if (!image) return [];

      const scale = getPreviewScale(image.preview);

      return [
        {
          sectionId: section.sectionId,
          height: section.height * scale.scaleY,
          width: image.preview.previewWidth,
          backgroundSize: `${image.preview.previewWidth}px ${image.preview.previewHeight}px`,
          // section.topOffset(원본 이미지 내부 절대 위치)을 그대로 쓴다 —
          // section.height 누적으로 만든 값이 아니다.
          backgroundPositionY: -(section.topOffset * scale.scaleY),
          originalUrl: image.originalPreviewUrl,
          translatedUrl: image.translatedPreviewUrl,
        },
      ];
    });
}

function ImageLayer({
  slices,
  layer,
}: {
  slices: CompareSlice[];
  layer: 'original' | 'translated';
}) {
  return (
    <>
      {slices.map((slice) => (
        <div
          key={slice.sectionId}
          data-testid={`n5-slice-${layer}-${slice.sectionId}`}
          style={{
            height: slice.height,
            width: slice.width,
            backgroundColor: '#e5e5e5',
            backgroundImage: `url(${layer === 'original' ? slice.originalUrl : slice.translatedUrl})`,
            backgroundSize: slice.backgroundSize,
            backgroundPosition: `0px ${slice.backgroundPositionY}px`,
            backgroundRepeat: 'no-repeat',
          }}
        />
      ))}
    </>
  );
}

export function N5CompareStack({
  sourceImages,
  sections,
}: {
  sourceImages: ReviewSourceImage[];
  sections: ReviewSection[];
}) {
  const [value, setValue] = useState(50);
  const stackRef = useRef<HTMLDivElement>(null);

  const slices = useMemo(
    () => buildIncludeSlices(sections, sourceImages),
    [sections, sourceImages],
  );

  const stackWidth = slices.reduce((max, s) => Math.max(max, s.width), 0);
  const stackHeight = slices.reduce((sum, s) => sum + s.height, 0);

  if (slices.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-400">
        표시할 include section이 없습니다.
      </div>
    );
  }

  return (
    <div className="p-4">
      <div
        ref={stackRef}
        data-testid="n5-compare-stack"
        className="relative"
        style={{ width: stackWidth, height: stackHeight }}
      >
        {/* translated layer — 항상 전체 노출되는 기준 레이어 */}
        <div className="absolute inset-0">
          <ImageLayer slices={slices} layer="translated" />
        </div>

        {/* original layer — slider 위치까지만 clip해서 겹쳐 보여준다.
            value%까지(왼쪽부터) 원본을 노출하고, 나머지는 오른쪽을 잘라 숨긴다. */}
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}
        >
          <ImageLayer slices={slices} layer="original" />
        </div>

        {/* slider — 이미지 두 레이어보다 위. divider는 clip과 무관하게
            항상 value% 위치에 그린다. */}
        <BeforeAfterSlider value={value} onChange={setValue} containerRef={stackRef} />
      </div>
    </div>
  );
}
