'use client';

import { useState } from 'react';

import type { Section } from '@/lib/api/types';

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 카드
// app/jobs/[jobId]/page.tsx의 N3View에서 사용.
// perf harness(app/perf/long-page)에서도 동일 컴포넌트를 재사용한다.
// ─────────────────────────────────────────────────────────────────
export function SectionCard({
  section,
  onToggle,
  isDisabled,
  isMutating,
}: {
  section: Section;
  onToggle: () => void;
  isDisabled: boolean;
  isMutating: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const isExcluded = section.bucket === 'exclude';

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm transition-opacity duration-200 ${
        isExcluded ? 'opacity-50' : 'opacity-100'
      }`}
    >
      <div className="flex gap-4">
        {/* 썸네일 */}
        <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-gray-100">
          {!imgFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={section.thumbnailUrl}
              alt={`섹션 ${section.sectionOrder} 미리보기`}
              className="h-full w-full object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1">
              <div className="h-6 w-6 rounded bg-gray-200" />
              <span className="text-[10px] text-gray-400">이미지 없음</span>
            </div>
          )}
        </div>

        {/* 본문 */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* 헤더: 섹션 번호 + 상태 뱃지 + 버튼 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">
                섹션 {section.sectionOrder}
              </span>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  isExcluded
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {isExcluded ? '제외됨' : '포함'}
              </span>
            </div>

            <button
              type="button"
              onClick={onToggle}
              disabled={isDisabled}
              className={`shrink-0 rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                isExcluded
                  ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 active:bg-gray-100'
              }`}
            >
              {isMutating ? '처리 중…' : isExcluded ? '되살리기' : '제외'}
            </button>
          </div>

          {/* 자동 제외 이유 */}
          {section.exclusionReason && (
            <p className="text-xs text-gray-500">{section.exclusionReason}</p>
          )}

          {/* 판정 결과 (규제/로컬라이제이션 경고) */}
          {section.verdicts.length > 0 && (
            <ul className="space-y-1.5">
              {section.verdicts.map((v) => (
                <li
                  key={v.verdictId}
                  className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2"
                >
                  <p className="text-xs font-medium text-yellow-800">⚠ {v.problemText}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-yellow-700">{v.basis}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
