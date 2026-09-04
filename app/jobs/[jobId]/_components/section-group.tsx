'use client';

import type { ReviewSection } from '@/lib/api/types';
import { TextBlockEditor } from './text-block-editor';

// ─────────────────────────────────────────────────────────────────
// N5 — 섹션 그룹 (헤더 + textBlock 목록)
// n5-review-view.tsx에서 사용. perf harness(app/perf/long-page)에서도 재사용.
// ─────────────────────────────────────────────────────────────────
export function SectionGroup({
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
