'use client';

import type { ApiSection } from '@/lib/api/n3-schema';
import { useEffect } from 'react';

import { formatN3SectionTitle, getN3SectionViewState } from '@/lib/n3/section-card-state';
import { filterN3VisibleVerdicts } from '@/lib/n3/verdict';
import { VerdictCard } from './verdict-card';

// ─────────────────────────────────────────────────────────────────
// N3 — 선택 섹션 판정 상세 (Figma 1759:11529 왼쪽 묶음의 오른쪽 칸, Frame 948).
//
// 제목(SECTION 0n, 20 SemiBold h24) · 12 아래 판정 본문(pl8 · pr12 · py12).
// 판정 목록만 스크롤하고 bucket 버튼은 본문 아래에 늘 보이게 둔다(카드 버튼과 같은 동작).
// 상태 칩은 목록 카드가 보여 준다 — 최신 Figma 상세에는 제목 아래 칩이 없다.
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
  const listVerdicts = filterN3VisibleVerdicts(section?.verdicts);
  const verdicts = detail ? filterN3VisibleVerdicts(detail.verdicts) : listVerdicts;
  const state = section ? getN3SectionViewState(section, true, detail ? verdicts.length : undefined) : null;
  const inconsistentId = state?.isContractInconsistent ? section?.id : undefined;

  // 서버 값이 서로 맞지 않으면 FE가 고치지 않고 개발 중에 알아볼 수 있게만 한다
  useEffect(() => {
    if (inconsistentId != null && process.env.NODE_ENV !== 'production') {
      console.warn(`[N3] section ${inconsistentId}: bucket·exclusionReason·verdicts가 서로 맞지 않습니다.`);
    }
  }, [inconsistentId]);

  if (!section || !state) {
    return (
      <div data-testid="n3-detail-panel" className="flex h-full items-center justify-center">
        <p className="text-sm text-[#999]">섹션이 없습니다.</p>
      </div>
    );
  }

  const isVerdictPending = !detail && listVerdicts.length === 0 && (isDetailLoading || isDetailError);

  return (
    <div
      data-testid="n3-detail-panel"
      data-contract-inconsistent={state.isContractInconsistent || undefined}
      className="flex h-full min-h-0 flex-col"
    >
      <p
        data-testid="n3-detail-title"
        className="h-6 shrink-0 text-[20px] leading-[24px] font-semibold tracking-[-0.02em] text-[#171717]"
      >
        {formatN3SectionTitle(section.sectionOrder)}
      </p>

      {/* Figma 1759:11545 — 제목 아래 12, 판정 목록(gap 12)은 내부 스크롤, [그래도 번역하기]는 아래에 고정 */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col py-3 pr-3 pl-2">
        <div data-testid="n3-detail-flow" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {state.isJudgeFailed && (
            <div data-testid="n3-verdict-judge-failed" className="flex w-full shrink-0 flex-col items-start rounded-[8px] bg-white px-2 py-3">
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
            state.isNoVerdict && (
              <p data-testid="n3-verdict-empty" className="px-1 text-sm text-[#999]">
                걸린 판정이 없어요
              </p>
            )
          )}
        </div>

        <button
          type="button"
          data-testid="n3-detail-action"
          disabled={isMutating}
          onClick={onChangeBucket}
          // Figma 1759:11591 — 본문 폭(404 − 8 − 12 = 384) 그대로, h45
          className="h-[45px] w-full shrink-0 rounded-[6px] border border-[#eaeaea] bg-white px-8 text-[14px] leading-[normal] font-medium tracking-[-0.03em] text-[#171717] transition-colors hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state.actionLabel}
        </button>
      </div>
    </div>
  );
}
