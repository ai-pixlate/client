'use client';

import Link from 'next/link';

import { useReviewQuery } from '@/lib/queries/pixate';
import { StepNav } from '../step-nav';
import { N5Viewer } from './n5-viewer';
import { N5Panel } from './n5-panel';

// ─────────────────────────────────────────────────────────────────
// N5 — 검수 shell (Figma node 544:3168 기준, 7일차 골격 → 8일차 좌측 viewer)
//
// 7일차: 좌/우 workspace 골격 (레이아웃 경계, 6단계 진행 nav, scroll 구조).
// 8일차: 좌측 viewer에 원본/번역 Before/After 비교 슬라이더를 추가했다
// (N5Viewer → N5CompareStack). 좌표 검증용 bbox debug overlay는 구현
// 중 잠깐 썼다가, Day10 selection overlay와 중복될 dead code라 제거했다
// (좌표 정확성은 npm run verify:n5-coords로 계속 검증한다).
//
// 아직 범위가 아닌 것: 클릭 선택 연동(block selection), 실제 zoom, 우측
// 카드 콘텐츠(직접 수정하기/번역근거), 기존 "다른 번역 보기" 후보 UI.
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
          <N5Viewer sourceImages={data.sourceImages} sections={data.sections} />
          <N5Panel job={data.job} blockCount={blockCount} />
        </div>
      </div>
    </div>
  );
}
