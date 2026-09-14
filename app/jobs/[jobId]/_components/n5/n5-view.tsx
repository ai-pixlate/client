'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

import type { ReviewResponse, ReviewSection, PreviewSourceImage } from '@/lib/api/types';
import { useReviewQuery, usePreviewQuery } from '@/lib/queries/pixate';
import { hasMissingRenderedPreview, type N5ViewMode } from '@/lib/n5/viewport';
import { StepNav } from '../step-nav';
import { N5Viewport } from './n5-viewport';
import { N5Panel } from './n5-panel';

// ─────────────────────────────────────────────────────────────────
// N5 — 검수 shell (Figma node 544:3168 기준, 7일차 골격 → 9일차 캔버스형 viewport)
//
// 7일차: 좌/우 workspace 골격 (레이아웃 경계, 6단계 진행 nav, scroll 구조).
// 8일차: 좌측 viewer에 원본/번역 Before/After 비교 슬라이더를 추가했었다
// (N5Viewer → N5CompareStack, BeforeAfterSlider) — 9일차 방향 전환으로 폐기.
// 9일차: 슬라이더 대신 하나의 캔버스형 viewport(N5Viewport)로 교체했다.
// 원문/번역문은 같은 viewport에서 image source만 바뀌고, 그 위에
// zoom(Ctrl/Cmd+Wheel, +/-)·pan(Space+drag)·Fit Width/Height 조작 기반을
// 얹는다 (좌표 정확성은 npm run verify:n5-coords, viewport 계산은
// npm run verify:n5-viewport로 계속 검증한다).
//
// 10일차: 좌측 뷰어의 이미지 데이터는 /review가 아니라 별도 계약인
// /preview(API-CFM-03, v3.4.1)에서 온다 — usePreviewQuery. section의
// bucket/height/topOffset/textBlocks(우측 패널용)는 여전히 /review가
// 정본이라 useReviewQuery를 그대로 함께 쓴다.
//
// 11일차: 번역 전/번역 후 토글(viewMode)이 좌측 뷰어 툴바에서 N5Panel(우측
// 패널) 상단으로 이동했다 — N5Viewport와 N5Panel이 형제 컴포넌트라 state를
// 공통 조상인 이 컴포넌트로 끌어올려야 둘 다 같은 값을 쓸 수 있다. viewMode
// state는 N5View가 아니라 그 아래 N5Loaded가 갖는다 — N5View는 로딩/에러
// 처리 뒤 데이터가 준비된 시점에야 N5Loaded를 마운트하므로, viewMode의
// lazy initializer(hasMissingRenderedPreview)가 항상 "최종 sourceImages"를
// 보고 계산된다(로딩 중 초깃값을 잘못 잡았다가 나중에 바로잡는 effect가
// 필요 없다).
//
// 아직 범위가 아닌 것: 클릭 선택 연동(block selection), 우측 block table
// 콘텐츠, virtualization, 텍스트 수정, delete interaction 완성.
// ─────────────────────────────────────────────────────────────────

function N5Loaded({
  job,
  sections,
  sourceImages,
  blockCount,
}: {
  job: ReviewResponse['job'];
  sections: ReviewSection[];
  sourceImages: PreviewSourceImage[];
  blockCount: number;
}) {
  // renderedUrl(render_image_key)이 없는 sourceImage가 하나라도 있으면 렌더가
  // 아직 없다는 뜻이다 — 이때는 기본 진입도 'translated'가 아니라 'original'로
  // 시작한다(보여줄 이미지가 없으므로). 이 컴포넌트는 N5View가 로딩 완료 후에만
  // 마운트하므로 lazy initializer로 한 번만 계산해도 안전하다.
  const [viewMode, setViewMode] = useState<N5ViewMode>(() =>
    hasMissingRenderedPreview(sourceImages) ? 'original' : 'translated',
  );
  const translatedDisabled = useMemo(() => hasMissingRenderedPreview(sourceImages), [sourceImages]);

  return (
    <div className="flex h-full w-full bg-white">
      <StepNav currentStep="N5" />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 헤더 — Figma 기준 뒤로가기만 존재, 별도 타이틀 없음 */}
        <div className="shrink-0 px-8 pt-8 pb-4">
          <Link
            href="/"
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
            aria-label="뒤로"
          >
            ←
          </Link>
        </div>

        {/* 본문: 중앙 viewer + 우측 panel */}
        <div className="flex min-h-0 flex-1 gap-6 px-8 pb-8">
          <N5Viewport sourceImages={sourceImages} sections={sections} viewMode={viewMode} />
          <N5Panel
            job={job}
            blockCount={blockCount}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            translatedDisabled={translatedDisabled}
          />
        </div>
      </div>
    </div>
  );
}

export function N5View({ jobId }: { jobId: string }) {
  const { data, isLoading, isError, error } = useReviewQuery(jobId);
  const {
    data: previewData,
    isLoading: isPreviewLoading,
    isError: isPreviewError,
    error: previewError,
  } = usePreviewQuery(jobId);

  if (isLoading || isPreviewLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <span className="text-sm text-gray-400">검수 데이터를 불러오는 중...</span>
      </div>
    );
  }

  if (isError || isPreviewError) {
    const err = error ?? previewError;
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-red-500">
          {err instanceof Error ? err.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  }

  if (!data || !previewData) return null;

  const blockCount = data.sections.flatMap((s) => s.textBlocks).length;

  return (
    <N5Loaded
      job={data.job}
      sections={data.sections}
      sourceImages={previewData.sourceImages}
      blockCount={blockCount}
    />
  );
}
