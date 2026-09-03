'use client';

import { useState } from 'react';

import type { TextBlock } from '@/lib/api/types';

// ─────────────────────────────────────────────────────────────────
// N5 — TextBlock 편집기
// n5-review-view.tsx에서 사용. perf harness(app/perf/long-page)에서도 재사용.
// ─────────────────────────────────────────────────────────────────
export function TextBlockEditor({
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
