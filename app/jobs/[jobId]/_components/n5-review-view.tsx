'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  useReviewQuery,
  useUpdateTranslationMutation,
  useUpdateSectionBucketMutation,
  pixateKeys,
} from '@/lib/queries/pixate';
import { ImageViewer } from './image-viewer';
import { SectionGroup } from './section-group';

// ─────────────────────────────────────────────────────────────────
// N5ReviewView — 진입점
// ImageViewer/SectionGroup/TextBlockEditor는 각각 별도 파일로 분리됨
// (perf harness인 app/perf/long-page에서도 재사용).
// ─────────────────────────────────────────────────────────────────

export function N5ReviewView({ jobId }: { jobId: string }) {
  const { data, isLoading, isError, error } = useReviewQuery(jobId);
  const queryClient = useQueryClient();
  const sectionMutation = useUpdateSectionBucketMutation(jobId);
  const translationMutation = useUpdateTranslationMutation(jobId);

  const [imageMode, setImageMode] = useState<'original' | 'translated'>('translated');
  const [pendingSectionId, setPendingSectionId] = useState<string | null>(null);
  const [pendingBlockId, setPendingBlockId] = useState<string | null>(null);

  // ── 핸들러 ──────────────────────────────────────────────────────

  const handleSectionToggle = (sectionId: string, currentBucket: 'include' | 'exclude') => {
    const newBucket = currentBucket === 'include' ? 'exclude' : 'include';
    setPendingSectionId(sectionId);
    sectionMutation.mutate(
      {
        sectionId,
        bucket: newBucket,
        // 제외 시 N5 context 전달. 복구(include) 시 stage 미전달 → excludedStage = null.
        ...(newBucket === 'exclude' ? { stage: 'N5' } : {}),
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: pixateKeys.review(jobId) });
        },
        onSettled: () => setPendingSectionId(null),
      },
    );
  };

  const handleTranslationSave = (blockId: string, draft: string) => {
    setPendingBlockId(blockId);
    translationMutation.mutate(
      { blockId, payload: { translatedText: draft } },
      { onSettled: () => setPendingBlockId(null) },
    );
  };

  const handleCandidateSelect = (blockId: string, candidateId: string) => {
    setPendingBlockId(blockId);
    translationMutation.mutate(
      { blockId, payload: { candidateId } },
      { onSettled: () => setPendingBlockId(null) },
    );
  };

  // ── 로딩 / 에러 ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-gray-400">검수 데이터를 불러오는 중...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-red-500">
          {error instanceof Error ? error.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  }

  if (!data) return null;

  // ── 레이아웃 ────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── 왼쪽: 이미지 뷰어 ─────────────────────────────────── */}
      <div className="flex w-[38%] shrink-0 flex-col border-r bg-gray-50">
        {/* 원문 / 번역문 토글 */}
        <div className="flex shrink-0 gap-1 border-b bg-white p-3">
          <button
            type="button"
            onClick={() => setImageMode('original')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
              imageMode === 'original'
                ? 'bg-gray-800 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            원문
          </button>
          <button
            type="button"
            onClick={() => setImageMode('translated')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
              imageMode === 'translated'
                ? 'bg-gray-800 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            번역문
          </button>
        </div>

        {/* 이미지 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto">
          <ImageViewer sourceImages={data.sourceImages} mode={imageMode} />
        </div>
      </div>

      {/* ── 오른쪽: 섹션 + TextBlock 편집 ─────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 상단 요약 */}
        <div className="shrink-0 border-b bg-white px-6 py-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              대상 국가:{' '}
              <span className="font-medium text-gray-800">
                {data.job.targetCountry} ({data.job.targetLanguage.toUpperCase()})
              </span>
            </p>
            <p className="text-xs text-gray-400">
              {data.sections.flatMap((s) => s.textBlocks).length}개 텍스트 블록
            </p>
          </div>
        </div>

        {/* 섹션 목록 (스크롤 영역) */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6 p-6">
            {data.sections.map((section) => (
              <SectionGroup
                key={section.sectionId}
                section={section}
                onSectionToggle={() =>
                  handleSectionToggle(section.sectionId, section.bucket)
                }
                isSectionDisabled={sectionMutation.isPending}
                isSectionMutating={
                  sectionMutation.isPending && pendingSectionId === section.sectionId
                }
                onSave={handleTranslationSave}
                onCandidateSelect={handleCandidateSelect}
                pendingBlockId={pendingBlockId}
                isTranslationPending={translationMutation.isPending}
              />
            ))}
          </div>
        </div>

        {/* 하단 액션 바 */}
        <div className="shrink-0 border-t bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">검수가 끝나면 저장하세요.</p>
            {/* N6 미구현 — 레이아웃 위치 예약 */}
            <button
              type="button"
              disabled
              title="N6 저장 화면은 아직 구현되지 않았습니다."
              className="cursor-not-allowed rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white opacity-40"
            >
              저장 및 완료 →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
