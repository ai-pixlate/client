'use client';

import type { ApiSection } from '@/lib/api/n3-schema';
import { useEffect } from 'react';

import { formatN3SectionTitle, getN3SectionViewState } from '@/lib/n3/section-card-state';
import { filterN3VisibleVerdicts } from '@/lib/n3/verdict';
import { N3StatusChip } from './section-list-card';
import { VerdictCard } from './verdict-card';

// ─────────────────────────────────────────────────────────────────
// N3 — 선택 섹션 판정 상세 (Figma 1422:10176 가운데 칼럼).
//
// 제목(SECTION 0n) · 상태 칩 · 판정 행과 bucket 버튼의 한 흐름(함께 스크롤, 카드 버튼과 같은 동작).
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
      <div className="flex shrink-0 flex-col gap-2">
        <p data-testid="n3-detail-title" className="text-[20px] leading-[normal] font-semibold tracking-[-0.02em] text-[#171717]">
          {formatN3SectionTitle(section.sectionOrder)}
        </p>
        {/* 카드와 같은 상태값을 그대로 보인다. 판정 실패는 아래 전용 행이 같은 말을 한다 */}
        {state.chip && !state.isJudgeFailed && <N3StatusChip label={state.chip} testId="n3-detail-status" />}
      </div>

      {/* Figma 1502:20200 — 판정과 버튼이 12 간격의 한 흐름이다. 버튼은 칼럼 아래에 고정하지 않고 판정이 많으면 함께 스크롤한다 */}
      <div data-testid="n3-detail-flow" className="mt-[11px] flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-3 pr-3 pb-5">
        {state.isJudgeFailed && (
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
          state.isNoVerdict && (
            <p data-testid="n3-verdict-empty" className="px-1 text-sm text-[#999]">
              걸린 판정이 없어요
            </p>
          )
        )}

        <button
          type="button"
          data-testid="n3-detail-action"
          disabled={isMutating}
          onClick={onChangeBucket}
          // Figma 1619:10064 — 왼쪽 8, 폭 385(칼럼 405에서 오른쪽 12)
          className="ml-2 w-[calc(100%-8px)] shrink-0 rounded-[6px] border border-[#eaeaea] bg-white px-8 py-3.5 text-[14px] leading-[normal] font-medium tracking-[-0.03em] text-[#171717] transition-colors hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state.actionLabel}
        </button>
      </div>
    </div>
  );
}
