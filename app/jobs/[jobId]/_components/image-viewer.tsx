'use client';

import { useState } from 'react';

import type { ReviewSourceImage } from '@/lib/api/types';

// ─────────────────────────────────────────────────────────────────
// N5 — 왼쪽 이미지 뷰어
// n5-review-view.tsx에서 사용. perf harness(app/perf/long-page)에서도 재사용.
// ─────────────────────────────────────────────────────────────────
export function ImageViewer({
  sourceImages,
  mode,
}: {
  sourceImages: ReviewSourceImage[];
  mode: 'original' | 'translated';
}) {
  const [failed, setFailed] = useState<Set<string>>(new Set());

  return (
    <div className="space-y-3 p-4">
      {sourceImages.map((img) => {
        const url = mode === 'original' ? img.originalPreviewUrl : img.translatedPreviewUrl;
        const hasFailed = failed.has(img.sourceImageId);

        return (
          <div key={img.sourceImageId} className="overflow-hidden rounded-xl border bg-white shadow-sm">
            {!hasFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={mode === 'original' ? '원문 이미지' : '번역문 이미지'}
                className="w-full"
                onError={() =>
                  setFailed((prev) => new Set([...prev, img.sourceImageId]))
                }
              />
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-2 bg-gray-50">
                <div className="h-12 w-12 rounded-lg bg-gray-200" />
                <p className="text-xs text-gray-400">이미지를 불러올 수 없습니다</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
