'use client';

import type { ApiSection } from '@/lib/api/n3-schema';
import { formatN3SectionTitle, getN3SectionCardState } from '@/lib/n3/section-card-state';
import { filterN3VisibleVerdicts } from '@/lib/n3/verdict';
import { VerdictCard } from './verdict-card';

// ─────────────────────────────────────────────────────────────────
// N3 — 선택 섹션 판정 상세 (Figma 1422:10176 가운데 칼럼).
//
// 제목(SECTION 0n) · 판정 행 목록(독립 스크롤) · 하단 bucket 버튼(카드 버튼과 같은 동작).
// 제외 사유 요약 배지는 두지 않는다 — 최신 Figma/PRD는 사유를 카드 칩과 판정 행으로만 보여 준다.
// 12월 판정(channel_policy)은 filterN3VisibleVerdicts로 거른다.
//
// 판정은 선택 섹션 1개의 상세 API(SEC-02) 결과를 쓴다 — 목록은 포함 섹션의 verdicts를
// 빈 배열로 주기 때문이다. 상세가 오기 전에는 목록의 verdicts를 먼저 보여 주고,
// 그것도 비어 있으면 "판정 없음"으로 단정하지 않고 불러오는 중으로 둔다.
// ─────────────────────────────────────────────────────────────────

export function DetailPanel({
  section,
  detail,
  isDetailLoading,
  isDetailError,
  isMutating,
  onChangeBucket,
}: {
  section: ApiSection | null;
  /** 선택 섹션의 상세 응답. 아직 없으면 undefined */
  detail: ApiSection | undefined;
  isDetailLoading: boolean;
  isDetailError: boolean;
  isMutating: boolean;
  onChangeBucket: () => void;
}) {
  if (!section) {
    return (
      <div data-testid="n3-detail-panel" className="flex h-full items-center justify-center">
        <p className="text-sm text-[#999]">섹션이 없습니다.</p>
      </div>
    );
  }

  const state = getN3SectionCardState(section);
  // 현지 AI 판정을 끝내지 못한 섹션(auto_local_failed)은 사유 배지가 아니라 배지 없는
  // 「판정 실패」 행으로 보여 준다(PRD v3.5.10).
  const isJudgeFailed = section.exclusionReason === 'auto_local_failed';
  const listVerdicts = filterN3VisibleVerdicts(section.verdicts);
  const verdicts = detail ? filterN3VisibleVerdicts(detail.verdicts) : listVerdicts;
  const isVerdictPending = !detail && listVerdicts.length === 0 && (isDetailLoading || isDetailError);

  return (
    <div data-testid="n3-detail-panel" className="flex h-full min-h-0 flex-col justify-between gap-6">
      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <p
          data-testid="n3-detail-title"
          className="shrink-0 text-[20px] font-semibold tracking-[-0.02em] text-[#171717]"
        >
          {formatN3SectionTitle(section.sectionOrder)}
        </p>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-3">
          {isJudgeFailed && (
            <div data-testid="n3-verdict-judge-failed" className="flex w-full flex-col items-start rounded-[8px] bg-white px-5 py-3">
              <p className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">판정 실패</p>
            </div>
          )}

          {verdicts.map((verdict) => (
            <VerdictCard key={verdict.id ?? `${section.id}-${verdict.verdictType}`} verdict={verdict} />
          ))}

          {isVerdictPending ? (
            <p className="px-1 text-sm text-[#999]">
              {isDetailError ? '판정 정보를 불러오지 못했습니다.' : '판정 정보를 불러오는 중...'}
            </p>
          ) : (
            !isJudgeFailed &&
            verdicts.length === 0 && (
              <p data-testid="n3-verdict-empty" className="px-1 text-sm text-[#999]">
                걸린 판정이 없어요
              </p>
            )
          )}
        </div>
      </div>

      <button
        type="button"
        data-testid="n3-detail-action"
        disabled={isMutating}
        onClick={onChangeBucket}
        className="w-full shrink-0 rounded-[6px] border border-[#eaeaea] bg-white px-8 py-3.5 text-[14px] leading-[normal] font-medium tracking-[-0.03em] text-[#171717] transition-colors hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state.actionLabel}
      </button>
    </div>
  );
}
