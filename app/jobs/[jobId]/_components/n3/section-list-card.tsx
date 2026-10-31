'use client';

import type { ApiSection, ApiSourceImage } from '@/lib/api/n3-schema';
import { formatN3SectionTitle, getN3SectionCardState } from '@/lib/n3/section-card-state';
import { filterN3VisibleVerdicts } from '@/lib/n3/verdict';
import { SectionCropThumbnail } from './section-crop-thumbnail';
import { VerdictBadge } from './verdict-card';

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 목록 카드 (Figma 1422:10176 「N3」 카드 variant).
//
// - 포함: 흰 배경 + 칩(번역 예정 · 직접 되살림) + Tertiary [제외하기]
// - 제외: #f5f5f5 배경 + 판정 배지 + 칩(직접 제외) + Secondary [그래도 번역하기 · 번역하기]
// - 선택: 1px orange 테두리
//
// 카드 클릭은 선택만, 버튼은 bucket 변경만 한다(버튼 click은 카드로 올리지 않는다).
// 배지는 목록 응답의 verdicts만 그린다 — 계약상 포함 섹션은 빈 배열이라 배지가 없다.
// 12월 판정(channel_policy)은 filterN3VisibleVerdicts로 거른다.
// 카드마다 상세 API를 부르지 않는다.
// ─────────────────────────────────────────────────────────────────

/** Figma 썸네일 96×132 — 긴 섹션은 위쪽만 보이게 자른다 */
const THUMB_WIDTH = 96;

export function SectionListCard({
  section,
  sourceImage,
  isSelected,
  isMutating,
  onSelect,
  onChangeBucket,
}: {
  section: ApiSection;
  sourceImage: ApiSourceImage | null;
  isSelected: boolean;
  isMutating: boolean;
  onSelect: () => void;
  onChangeBucket: () => void;
}) {
  const state = getN3SectionCardState(section);
  const isInclude = section.bucket === 'include';
  const title = formatN3SectionTitle(section.sectionOrder);
  const badges = filterN3VisibleVerdicts(section.verdicts);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      data-testid={`n3-section-card-${section.id}`}
      data-bucket={section.bucket}
      data-kind={state.kind}
      onClick={onSelect}
      onKeyDown={(e) => {
        // 안쪽 버튼에서 올라온 키 입력은 선택으로 바꾸지 않는다
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`flex w-full shrink-0 cursor-pointer gap-5 rounded-[8px] border p-4 text-left transition-colors ${
        isInclude ? 'bg-white' : 'bg-[#f5f5f5]'
      } ${isSelected ? 'border-[#ff6a38]' : 'border-[#eaeaea]'}`}
    >
      <div className="h-[132px] shrink-0 overflow-hidden rounded-[4px]" style={{ width: THUMB_WIDTH }}>
        <SectionCropThumbnail
          sourceImage={sourceImage}
          bbox={section.bbox}
          targetWidth={THUMB_WIDTH}
          alt={`섹션 ${section.sectionOrder ?? ''} 미리보기`}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 py-1">
        <div className="flex flex-col gap-3">
          <p className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">{title}</p>
          {(state.chip || badges.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {state.chip && (
                <span className="flex h-7 items-center rounded-[6px] bg-[#f5f5f5] px-2.5 text-[12px] font-light tracking-[-0.04em] text-[#171717]">
                  {state.chip}
                </span>
              )}
              {badges.map((verdict, i) => (
                <VerdictBadge key={verdict.id ?? `${verdict.verdictType}-${i}`} type={verdict.verdictType!} />
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            data-testid={`n3-section-action-${section.id}`}
            disabled={isMutating}
            onClick={(e) => {
              e.stopPropagation();
              onChangeBucket();
            }}
            className={`rounded-[4px] bg-white px-3 py-2 text-[12px] tracking-[-0.02em] text-[#171717] transition-colors hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40 ${
              isInclude ? '' : 'border border-[#eaeaea]'
            }`}
          >
            {state.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
