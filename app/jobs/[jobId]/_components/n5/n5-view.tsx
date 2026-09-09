'use client';

import Link from 'next/link';

import { useReviewQuery } from '@/lib/queries/pixate';
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
// 아직 범위가 아닌 것: 클릭 선택 연동(block selection), 우측 block table
// 콘텐츠, virtualization, 텍스트 수정, delete interaction 완성.
// ─────────────────────────────────────────────────────────────────

export function N5View({ jobId }: { jobId: string }) {
  const { data, isLoading, isError, error } = useReviewQuery(jobId);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <span className="text-sm text-gray-400">검수 데이터를 불러오는 중...</span>
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

  const blockCount = data.sections.flatMap((s) => s.textBlocks).length;

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
          <N5Viewport sourceImages={data.sourceImages} sections={data.sections} />
          <N5Panel job={data.job} blockCount={blockCount} />
        </div>
      </div>
    </div>
  );
}
