'use client';

import type { ApiSection, ApiSourceImage } from '@/lib/api/n3-schema';
import { formatN3SectionTitle, getN3SectionViewState } from '@/lib/n3/section-card-state';
import { filterN3VisibleVerdicts } from '@/lib/n3/verdict';
import { SectionCropThumbnail } from './section-crop-thumbnail';
import { VerdictBadge } from './verdict-card';

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 목록 카드 (Figma component set 1416:12943, variant 7종 — getN3CardVisual).
//
// - compact(600×160): 번역 예정 · 번역 선택 · 제외된 · 판정실패. 버튼은 테두리 없음
// - verdict(602×161·193 — 배지 줄 수만큼): 제외 판정 · 되살린 · 제외 선택. 버튼에 테두리
// - 배경: 흰색(번역 예정 · 번역 선택 · 되살린) / #f5f5f5(나머지). 판정실패는 카드·이미지 불투명도 50%
// - 선택: 1px orange 테두리
//
// 문구와 내용은 서버 데이터가 정본이다(sectionOrder · bucket · exclusionReason · verdicts).
// Figma의 판정실패 버튼 샘플 「판정실패」는 쓰지 않고 PRD 버튼([그래도 번역하기])을 유지한다.
//
// 카드 클릭은 선택만, 버튼은 bucket 변경만 한다(버튼 click은 카드로 올리지 않는다).
// 배지는 목록 응답의 verdicts만 그린다. 12월 판정(channel_policy)은 filterN3VisibleVerdicts로 거른다.
// 카드마다 상세 API를 부르지 않는다.
// ─────────────────────────────────────────────────────────────────

/** Figma 썸네일 폭 96 — 긴 섹션은 위쪽만 보이게 자른다 */
const THUMB_WIDTH = 96;

/** 상태 칩(Figma Work Status). 카드와 상세가 같이 쓴다 */
export function N3StatusChip({ label, testId, onGray = false }: { label: string; testId?: string; onGray?: boolean }) {
  return (
    <span
      data-testid={testId}
      className={`flex h-7 w-fit items-center rounded-[6px] px-2.5 text-[12px] font-light tracking-[-0.04em] text-[#171717] ${onGray ? 'bg-white' : 'bg-[#f5f5f5]'}`}
    >
      {label}
    </span>
  );
}

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
  const state = getN3SectionViewState(section, isSelected);
  const { variant, layout } = state;
  const isCompact = layout === 'compact';
  const isWhite = variant === 'translation-pending' || variant === 'translation-selected' || variant === 'restored';
  const isJudgementFailed = state.isJudgeFailed;
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
      data-variant={variant}
      data-contract-inconsistent={state.isContractInconsistent || undefined}
      data-selected={isSelected}
      onClick={onSelect}
      onKeyDown={(e) => {
        // 안쪽 버튼에서 올라온 키 입력은 선택으로 바꾸지 않는다
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`flex shrink-0 cursor-pointer gap-5 rounded-[8px] border text-left transition-colors ${
        isCompact ? 'h-40 w-full py-[13px] pr-4 pl-[15px]' : 'min-h-[161px] w-[calc(100%+2px)] -mx-px p-5'
      } ${isWhite ? 'bg-white' : 'bg-[#f5f5f5]'} ${isSelected ? 'border-[#ff6a38]' : 'border-[#eaeaea]'} ${
        isJudgementFailed ? 'opacity-50' : ''
      }`}
    >
      {/* verdict 카드 높이는 배지 줄 수로 정해진다(161·193) — 이미지는 그 높이를 채울 뿐 카드를 늘리지 않는다 */}
      <div
        data-testid={`n3-section-thumb-${section.id}`}
        className={`relative shrink-0 self-stretch overflow-hidden rounded-[4px] ${isJudgementFailed ? 'opacity-50' : ''}`}
        style={{ width: THUMB_WIDTH }}
      >
        <div className="absolute inset-0">
          <SectionCropThumbnail
            sourceImage={sourceImage}
            bbox={section.bbox}
            targetWidth={THUMB_WIDTH}
            alt={`섹션 ${section.sectionOrder ?? ''} 미리보기`}
          />
        </div>
      </div>

      <div className={`relative flex min-w-0 flex-1 flex-col ${isCompact ? 'pt-[14px]' : 'justify-between gap-7'}`}>
        <div className={`flex flex-col ${isCompact ? 'gap-2' : 'gap-4'}`}>
          <p className="text-[18px] leading-[normal] font-medium tracking-[-0.03em] text-[#171717]">{title}</p>
          {(state.chip || badges.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {/* 회색 카드 위에서는 칩이 사라지지 않게 흰 바탕으로 둔다(Figma 제외된 variant에는 칩 표본이 없다) */}
              {state.chip && <N3StatusChip label={state.chip} onGray={!isWhite} />}
              {badges.map((verdict, i) => (
                <VerdictBadge key={verdict.id ?? `${verdict.verdictType}-${i}`} type={verdict.verdictType!} />
              ))}
            </div>
          )}
        </div>

        <div className={`flex justify-end ${isCompact ? 'absolute right-[7px] bottom-[10px]' : ''}`}>
          <button
            type="button"
            data-testid={`n3-section-action-${section.id}`}
            disabled={isMutating}
            onClick={(e) => {
              e.stopPropagation();
              onChangeBucket();
            }}
            className={`flex h-[30px] items-center rounded-[4px] bg-white px-3 text-[12px] tracking-[-0.02em] text-[#171717] transition-colors hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40 ${
              isCompact ? '' : 'border border-[#eaeaea]'
            }`}
          >
            <span className="px-2">{state.actionLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
