'use client';

import { useMemo, useState } from 'react';

import type { Section } from '@/lib/api/types';
import { SectionCard } from '@/app/jobs/[jobId]/_components/section-card';
import { buildN3Sections } from '@/lib/perf/harness-fixtures';

/**
 * N3 baseline harness — 프로덕션 SectionCard를 그대로 재사용해
 * section count별 DOM 밀도를 측정한다.
 *
 * 최적화(virtualization/lazy loading/memo 등)를 일부러 적용하지 않는다.
 * 실제 long-page 이미지는 사용하지 않고 최소 placeholder만 사용한다.
 */
export function N3HarnessView({ sectionCount }: { sectionCount: number }) {
  const [sections, setSections] = useState<Section[]>(() => buildN3Sections(sectionCount));

  // sectionCount가 바뀌면(=key로 컴포넌트가 재생성되므로 실제로는 초기 마운트에서만 실행됨)
  const includedCount = useMemo(
    () => sections.filter((s) => s.bucket === 'include').length,
    [sections],
  );

  const handleToggle = (sectionId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.sectionId === sectionId
          ? { ...s, bucket: s.bucket === 'include' ? 'exclude' : 'include' }
          : s,
      ),
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-6">
      <p className="text-sm text-gray-500">
        전체 {sections.length}개 섹션 중{' '}
        <span className="font-semibold text-gray-800">{includedCount}개</span> 포함
      </p>

      {sections.map((section) => (
        <SectionCard
          key={section.sectionId}
          section={section}
          isDisabled={false}
          isMutating={false}
          onToggle={() => handleToggle(section.sectionId)}
        />
      ))}
    </div>
  );
}
