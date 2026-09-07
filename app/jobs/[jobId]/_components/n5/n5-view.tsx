'use client';

import Link from 'next/link';

import { useReviewQuery } from '@/lib/queries/pixate';
import { StepNav } from '../step-nav';
import { N5Viewer } from './n5-viewer';
import { N5Panel } from './n5-panel';

// ─────────────────────────────────────────────────────────────────
// N5 — 검수 shell (Figma node 544:3168 기준, 7일차 마지막 작업)
//
// 오늘은 좌/우 workspace 골격만 만든다 — 중앙 viewer와 우측 panel의
// 레이아웃 경계, 6단계 진행 nav, scroll 구조까지가 범위다.
// 전/후 slider, block bbox overlay, 클릭 선택 연동, 실제 zoom, 우측
// 카드 콘텐츠(직접 수정하기/번역근거), 기존 "다른 번역 보기" 후보 UI는
// 오늘 범위가 아니다 — 새 API/DTO/필드 없이 기존 ReviewResponse 계약만 쓴다.
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
          <N5Viewer sourceImages={data.sourceImages} />
          <N5Panel job={data.job} blockCount={blockCount} />
        </div>
      </div>
    </div>
  );
}
