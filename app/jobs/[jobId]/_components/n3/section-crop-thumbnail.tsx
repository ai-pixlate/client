'use client';

import { useState } from 'react';

import { computeCrop } from '@/lib/n3/crop';
import type { ApiBbox, ApiSourceImage } from '@/lib/api/n3-schema';

// ─────────────────────────────────────────────────────────────────
// N3 — SourceImage + bbox crop 공용 썸네일 (Figma 540:3119 기준).
// exclude nav·include sidebar·drag preview가 모두 이 컴포넌트를 쓴다.
//
// sourceImage를 못 찾았거나 bbox가 없으면(둘 다 있을 수 있는 정상 상태 —
// 렌더 전/조회 실패 등) 임의 비율을 지어내지 않고 정사각형 중립
// placeholder를 보여준다. 이미지 로드 자체가 실패하면(sourceImage.fileUrl은
// 있지만 404 등) bbox로 이미 알고 있는 비율은 유지한 채 같은 placeholder를
// 보여준다 — "비율을 모른다"와 "내용을 못 불러왔다"를 구분한다.
//
// targetWidth는 px 숫자 또는 CSS width 문자열(예: `clamp(160px, 10vw, 206px)`)
// 둘 다 받는다 — crop 계산 자체가 퍼센트 기반이라 반응형 폭에도 그대로
// 맞춰진다(JS가 실제 렌더 폭을 다시 잴 필요가 없다).
// ─────────────────────────────────────────────────────────────────

export function SectionCropThumbnail({
  sourceImage,
  bbox,
  targetWidth,
  alt,
  className = 'rounded-[4px]',
}: {
  sourceImage: ApiSourceImage | null | undefined;
  bbox: ApiBbox | null | undefined;
  targetWidth: number | string;
  alt: string;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  const crop = computeCrop({ bbox, sourceWidth: sourceImage?.width, sourceHeight: sourceImage?.height });
  const width = typeof targetWidth === 'number' ? `${targetWidth}px` : targetWidth;

  if (!crop || !sourceImage?.fileUrl || imgFailed) {
    return (
      <div
        style={{ width, aspectRatio: crop?.aspectRatio ?? '1 / 1' }}
        className={`flex shrink-0 flex-col items-center justify-center gap-1 bg-gray-100 ${className}`}
      >
        <div className="h-6 w-6 rounded bg-gray-200" />
        <span className="text-[10px] text-gray-400">이미지 없음</span>
      </div>
    );
  }

  return (
    <div style={{ width, aspectRatio: crop.aspectRatio }} className={`relative shrink-0 overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sourceImage.fileUrl}
        alt={alt}
        draggable={false}
        onError={() => setImgFailed(true)}
        style={{
          position: 'absolute',
          width: `${crop.imgWidthPercent}%`,
          height: `${crop.imgHeightPercent}%`,
          left: `${crop.imgLeftPercent}%`,
          top: `${crop.imgTopPercent}%`,
          maxWidth: 'none',
        }}
      />
    </div>
  );
}
