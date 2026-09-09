'use client';

import { useMemo, useState } from 'react';

import { ImageViewer } from '@/app/jobs/[jobId]/_components/image-viewer';
import { SectionGroup } from '@/app/jobs/[jobId]/_components/section-group';
import { buildN5Fixtures } from '@/lib/perf/harness-fixtures';
import type { PerfManifestProduct } from '@/lib/perf/manifest-types';
import type { ReviewSection } from '@/lib/api/types';

/**
 * N5 baseline harness — 프로덕션 ImageViewer/SectionGroup(TextBlockEditor 포함)을
 * 그대로 재사용해 제품 실제 이미지 + synthetic textBlock 부하로 DOM을 구성한다.
 *
 * 최적화(virtualization/lazy loading/memo 등)를 일부러 적용하지 않는다.
 * 이미지 원본은 perf-assets/long-pages를 dev 전용 API route로 그대로 서빙한다.
 */
export function N5HarnessView({
  products,
  textBlockCount,
}: {
  products: PerfManifestProduct[];
  textBlockCount: number;
}) {
  const fixtures = useMemo(
    () => buildN5Fixtures(products, textBlockCount),
    [products, textBlockCount],
  );

  const [sections, setSections] = useState<ReviewSection[]>(fixtures.sections);
  const [imageMode, setImageMode] = useState<'original' | 'translated'>('translated');

  const handleSectionToggle = (sectionId: string) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.sectionId !== sectionId) return s;
        const isExcluded = s.bucket === 'exclude' && s.excludedStage === 'N5';
        return isExcluded
          ? { ...s, bucket: 'include', excludedStage: null }
          : { ...s, bucket: 'exclude', excludedStage: 'N5' };
      }),
    );
  };

  const handleSave = (blockId: string, draft: string) => {
    setSections((prev) =>
      prev.map((s) => ({
        ...s,
        textBlocks: s.textBlocks.map((b) =>
          b.blockId === blockId ? { ...b, translatedText: draft, translationStatus: 'userEdited' } : b,
        ),
      })),
    );
  };

  const handleCandidateSelect = (blockId: string, candidateId: string) => {
    setSections((prev) =>
      prev.map((s) => ({
        ...s,
        textBlocks: s.textBlocks.map((b) => {
          if (b.blockId !== blockId) return b;
          const candidate = b.candidates.find((c) => c.candidateId === candidateId);
          if (!candidate) return b;
          return {
            ...b,
            translatedText: candidate.translatedText,
            candidates: b.candidates.map((c) => ({ ...c, isSelected: c.candidateId === candidateId })),
          };
        }),
      })),
    );
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 왼쪽: 이미지 뷰어 */}
      <div className="flex w-[38%] shrink-0 flex-col border-r bg-gray-50">
        <div className="flex shrink-0 gap-1 border-b bg-white p-3">
          <button
            type="button"
            onClick={() => setImageMode('original')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
              imageMode === 'original' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            원문
          </button>
          <button
            type="button"
            onClick={() => setImageMode('translated')}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
              imageMode === 'translated' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            번역문
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ImageViewer sourceImages={fixtures.sourceImages} mode={imageMode} />
        </div>
      </div>

      {/* 오른쪽: 섹션 + textBlock */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b bg-white px-6 py-3">
          <p className="text-xs text-gray-400">
            {sections.flatMap((s) => s.textBlocks).length}개 텍스트 블록
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6 p-6">
            {sections.map((section) => (
              <SectionGroup
                key={section.sectionId}
                section={section}
                onSectionToggle={() => handleSectionToggle(section.sectionId)}
                isSectionDisabled={false}
                isSectionMutating={false}
                onSave={handleSave}
                onCandidateSelect={handleCandidateSelect}
                pendingBlockId={null}
                isTranslationPending={false}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
