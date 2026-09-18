'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { useJobQuery, useN5BlocksQuery, useN5PreviewQuery } from '@/lib/queries/pixlate';
import { toBlockViewModel, toPreviewViewModel } from '@/lib/n5/adapter';
import type { BlockViewModel, PreviewViewModel } from '@/lib/n5/adapter';
import type { N5ViewMode } from '@/lib/n5/viewport';
import { StepNav } from '../step-nav';
import { N5Viewport } from './n5-viewport';
import { N5Panel } from './n5-panel';

// ─────────────────────────────────────────────────────────────────
// N5 — 검수 shell (Figma node 544:3168, "N5 검수" 기준)
//
// 3단계(v3.4.2 실제 계약 연결): GET /jobs/{jobId} + GET /jobs/{jobId}/blocks +
// GET /jobs/{jobId}/preview 세 조회를 병렬로 받아 각각 Adapter(lib/n5/adapter.ts)를
// 거쳐 ViewModel로만 하위 컴포넌트에 전달한다. N5Viewport/N5Panel은 generated
// DTO(Api*)를 직접 import하지 않는다.
//
// 구 /review, /preview(API-CFM-03 v3.4.1) 계약 기반 코드(useReviewQuery,
// usePreviewQuery, ReviewSection/PreviewSourceImage)는 5단계에서 호출부가
// 전혀 없음을 확인하고 완전히 제거했다. ReviewSection/ReviewSourceImage
// "타입"만 app/perf/long-page(별도 성능 검증 spike 화면)가 여전히 써서
// lib/api/types.ts에는 남아 있다 — 이 화면(N5)에서는 더 이상 참조하지 않는다.
//
// F-CFM-13(이번 반영): selectedBlockId/selectedSectionId는 이 컴포넌트(N5Loaded)
// 하나가 정본으로 소유하고, N5Viewport(좌)와 N5Panel(우) 둘 다 이 값을 prop으로만
// 받는다 — 각자 별도 selection state를 두지 않는다. 좌→우 방향(선택 시 우측
// 자동 스크롤)은 N5Panel 내부에서 ref+scrollIntoView로 처리하고, 우→좌 방향은
// "표시만" 한다(자동 pan/scroll 없음) — 그래서 zoom/pan은 selection 변경으로
// 전혀 건드리지 않는다.
// ─────────────────────────────────────────────────────────────────

function N5Loaded({
  jobId,
  targetCountry,
  targetLanguage,
  preview,
  blocks,
}: {
  jobId: string;
  targetCountry: string | null;
  targetLanguage: string | null;
  preview: PreviewViewModel;
  blocks: BlockViewModel[];
}) {
  // 번역 후(renderedUrl) 이미지가 하나라도 없는(제외 섹션 제외) include section이
  // 있으면 「번역문」 토글을 기본으로 켜지 않는다 — 보여줄 이미지가 없기 때문이다.
  // resolveSectionRenderState(Adapter)가 이미 렌더 전/제외/실패를 구분해 둔 값을
  // 그대로 쓴다 — renderedUrl===null을 이 컴포넌트가 다시 실패로 단정하지 않는다.
  const translatedDisabled = useMemo(
    () =>
      preview.sections.some(
        (section) => section.bucket === 'include' && section.render.status !== 'ready',
      ),
    [preview.sections],
  );

  const [viewMode, setViewMode] = useState<N5ViewMode>(() => (translatedDisabled ? 'original' : 'translated'));
  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);

  function handleSelectBlock(block: BlockViewModel) {
    setSelectedBlockId(block.id);
    setSelectedSectionId(block.sectionId);
  }

  function handleSelectSection(sectionId: number) {
    setSelectedSectionId(sectionId);
    setSelectedBlockId(null);
  }

  return (
    <div className="flex h-full w-full bg-white">
      <StepNav currentStep="N5" />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 헤더 — Figma(544:3168 재확인, node 849:7253 "보관함으로 나가기")는
            뒤로가기 화살표가 아니라 닫기(X) 아이콘이다. 별도 타이틀은 없다. */}
        <div className="shrink-0 px-8 pt-8 pb-4">
          <Link
            href="/"
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
            aria-label="보관함으로 나가기"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2 2L14 14M14 2L2 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Link>
        </div>

        {/* 본문: 중앙 viewer + 우측 panel */}
        <div className="flex min-h-0 flex-1 gap-6 px-8 pb-8">
          <N5Viewport
            preview={preview}
            blocks={blocks}
            viewMode={viewMode}
            selectedBlockId={selectedBlockId}
            selectedSectionId={selectedSectionId}
            onSelectBlock={handleSelectBlock}
            onSelectSection={handleSelectSection}
          />
          <N5Panel
            jobId={jobId}
            targetCountry={targetCountry}
            targetLanguage={targetLanguage}
            sections={preview.sections}
            blocks={blocks}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            translatedDisabled={translatedDisabled}
            selectedBlockId={selectedBlockId}
            selectedSectionId={selectedSectionId}
            onSelectBlock={handleSelectBlock}
            onSelectSection={handleSelectSection}
          />
        </div>
      </div>
    </div>
  );
}

export function N5View({ jobId }: { jobId: string }) {
  const jobQuery = useJobQuery(jobId);
  const blocksQuery = useN5BlocksQuery(jobId);
  const previewQuery = useN5PreviewQuery(jobId);

  const isLoading = jobQuery.isLoading || blocksQuery.isLoading || previewQuery.isLoading;
  const isError = jobQuery.isError || blocksQuery.isError || previewQuery.isError;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <span className="text-sm text-gray-400">검수 데이터를 불러오는 중...</span>
      </div>
    );
  }

  if (isError) {
    const err = jobQuery.error ?? blocksQuery.error ?? previewQuery.error;
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-red-500">
          {err instanceof Error ? err.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  }

  if (!jobQuery.data || !blocksQuery.data || !previewQuery.data) return null;

  const blocks = blocksQuery.data.map(toBlockViewModel);
  const preview = toPreviewViewModel(previewQuery.data);

  return (
    <N5Loaded
      jobId={jobId}
      targetCountry={jobQuery.data.targetCountry ?? null}
      targetLanguage={jobQuery.data.targetLanguage ?? null}
      preview={preview}
      blocks={blocks}
    />
  );
}
