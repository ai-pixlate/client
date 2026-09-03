'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  useReviewQuery,
  useUpdateTranslationMutation,
  useUpdateSectionBucketMutation,
  pixateKeys,
} from '@/lib/queries/pixate';
import type { TextBlock, ReviewSection, ReviewSourceImage } from '@/lib/api/types';

// ─────────────────────────────────────────────────────────────────
// 왼쪽 이미지 뷰어
// ─────────────────────────────────────────────────────────────────

function ImageViewer({
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

// ─────────────────────────────────────────────────────────────────
// TextBlock 편집기
// ─────────────────────────────────────────────────────────────────

function TextBlockEditor({
  block,
  onSave,
  onCandidateSelect,
  isSaving,
  disabled,
}: {
  block: TextBlock;
  onSave: (blockId: string, draft: string) => void;
  onCandidateSelect: (blockId: string, candidateId: string) => void;
  isSaving: boolean;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(block.translatedText);
  const [showBasis, setShowBasis] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);

  const isDirty = draft !== block.translatedText;
  const isFailed = block.blockStatus === 'failed';
  const isDisabled = disabled || isSaving;

  const handleCandidateClick = (candidateId: string) => {
    const candidate = block.candidates.find((c) => c.candidateId === candidateId);
    if (!candidate) return;
    setDraft(candidate.translatedText);
    setShowCandidates(false);
    onCandidateSelect(block.blockId, candidateId);
  };

  return (
    <div
      className={`rounded-lg border p-4 ${
        disabled
          ? 'border-gray-100 bg-gray-50 opacity-60'
          : isFailed
          ? 'border-red-200 bg-red-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      {/* 상태 뱃지 영역 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {isFailed && (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
            번역 실패
          </span>
        )}
        {block.needsReview && !isFailed && (
          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-700">
            확인 필요
          </span>
        )}
        {block.translationStatus === 'userEdited' && (
          <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700">
            사용자 수정
          </span>
        )}
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
          {block.role}
        </span>
      </div>

      {/* 규제 경고 */}
      {block.complianceFlags.length > 0 && !disabled && (
        <div className="mb-3 flex items-start gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
          <span className="shrink-0">⚠</span>
          <span>규제 또는 표현 확인이 필요합니다.</span>
        </div>
      )}

      {/* 원문 */}
      <div className="mb-3">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">원문</p>
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {block.sourceText || <span className="text-gray-300 italic">원문 없음</span>}
        </p>
      </div>

      {/* 번역문 */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">번역문</p>
          {isDirty && !isSaving && !disabled && (
            <span className="text-[11px] text-amber-600">● 미저장</span>
          )}
          {isSaving && (
            <span className="text-[11px] text-blue-500">저장 중...</span>
          )}
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isDisabled || isFailed}
          rows={3}
          placeholder={isFailed ? '번역에 실패했습니다. 직접 입력해 주세요.' : ''}
          className={`w-full resize-none rounded-md border px-3 py-2 text-sm leading-relaxed outline-none transition-colors ${
            isFailed
              ? 'border-red-200 bg-red-50 text-red-700 placeholder:text-red-300'
              : 'border-gray-200 bg-white text-gray-800 focus:border-blue-400 focus:ring-1 focus:ring-blue-100 disabled:bg-gray-50 disabled:opacity-60'
          }`}
        />

        {/* 저장 버튼 */}
        {isDirty && !isSaving && !disabled && (
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => onSave(block.blockId, draft)}
              className="rounded-lg bg-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-600 active:bg-blue-700"
            >
              저장
            </button>
          </div>
        )}
      </div>

      {/* 하단 액션: 근거 보기 + 다른 번역 보기 */}
      {!disabled && (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
          {block.basis && (
            <button
              type="button"
              onClick={() => setShowBasis((v) => !v)}
              className="text-[11px] text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline"
            >
              {showBasis ? '근거 닫기' : '근거 보기'}
            </button>
          )}
          {block.candidates.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCandidates((v) => !v)}
              className="text-[11px] text-blue-500 underline-offset-2 hover:text-blue-700 hover:underline"
            >
              {showCandidates ? '후보 닫기' : `다른 번역 보기 (${block.candidates.length})`}
            </button>
          )}
        </div>
      )}

      {/* 근거 */}
      {showBasis && block.basis && !disabled && (
        <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-600">
          {block.basis}
        </p>
      )}

      {/* 번역 후보 목록 */}
      {showCandidates && block.candidates.length > 0 && !disabled && (
        <ul className="mt-2 space-y-1.5 rounded-md border border-blue-100 bg-blue-50 p-2">
          {block.candidates.map((candidate) => (
            <li key={candidate.candidateId}>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleCandidateClick(candidate.candidateId)}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors disabled:opacity-40 ${
                  candidate.isSelected
                    ? 'border-blue-400 bg-blue-100 font-medium text-blue-800'
                    : 'border-blue-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                {candidate.translatedText}
                {candidate.isSelected && (
                  <span className="ml-2 text-[10px] text-blue-600">선택됨</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 섹션 그룹 (헤더 + textBlock 목록)
// ─────────────────────────────────────────────────────────────────

function SectionGroup({
  section,
  onSectionToggle,
  isSectionDisabled,
  isSectionMutating,
  onSave,
  onCandidateSelect,
  pendingBlockId,
  isTranslationPending,
}: {
  section: ReviewSection;
  onSectionToggle: () => void;
  isSectionDisabled: boolean;
  isSectionMutating: boolean;
  onSave: (blockId: string, draft: string) => void;
  onCandidateSelect: (blockId: string, candidateId: string) => void;
  pendingBlockId: string | null;
  isTranslationPending: boolean;
}) {
  // N5에서 제외된 섹션: textBlock 편집 불가, 되돌리기 가능
  const isExcludedInN5 = section.bucket === 'exclude' && section.excludedStage === 'N5';

  return (
    <div className={`transition-opacity duration-200 ${isExcludedInN5 ? 'opacity-60' : ''}`}>
      {/* 섹션 헤더 */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">섹션 {section.sectionOrder}</h3>
          {isExcludedInN5 ? (
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
              저장 시 제외됨
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              포함
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onSectionToggle}
          disabled={isSectionDisabled}
          className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            isExcludedInN5
              ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {isSectionMutating ? '처리 중…' : isExcludedInN5 ? '되돌리기' : '제외'}
        </button>
      </div>

      {/* TextBlock 목록 */}
      {section.textBlocks.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400">
          이 섹션에는 번역할 텍스트가 없습니다.
        </p>
      ) : (
        <div className="space-y-3">
          {section.textBlocks.map((block) => (
            <TextBlockEditor
              key={block.blockId}
              block={block}
              onSave={onSave}
              onCandidateSelect={onCandidateSelect}
              isSaving={isTranslationPending && pendingBlockId === block.blockId}
              disabled={isExcludedInN5}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// N5ReviewView — 진입점
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
