/**
 * N3 섹션 카드 상태 — bucket과 exclusionReason(서버 정본)만으로 정한다.
 *
 * PRD v3.5.10(F-SEC-03): 자동 제외 [그래도 번역하기] · 직접 제외 [번역하기] ·
 * 포함 [제외하기], 칩 「번역 예정」 · 「직접 되살림」 · 「직접 제외」.
 * 「그래도 번역하기」·「번역하기」는 둘 다 되살리기(action=restore)이고 문구만 다르다.
 *
 * 판정 내용(verdicts)으로 상태를 다시 계산하지 않는다 — bucket이 포함/제외의 정본이다.
 * 제외인데 exclusionReason이 없거나 계약에 없는 값이면 자동 판정이라고 단정하지 않고
 * 칩 없이 [번역하기]로 둔다.
 *
 * 런타임 import가 없는 순수 함수라 scripts/verify-n3-section-card.mjs가 Node에서 바로 검증한다.
 */

import type { ApiExclusionReason, ApiSectionBucket } from '@/lib/api/n3-schema';

export type N3SectionCardKind = 'include' | 'restored' | 'autoExcluded' | 'manualExcluded' | 'excluded';

export interface N3SectionCardState {
  kind: N3SectionCardKind;
  /** 카드 칩 문구. 없으면 null */
  chip: string | null;
  actionLabel: string;
  /** 버튼을 누르면 옮겨 갈 bucket */
  targetBucket: ApiSectionBucket;
}

const AUTO_EXCLUSION_REASONS = new Set<ApiExclusionReason>([
  'auto_regulatory',
  'auto_channel',
  'auto_local',
  'auto_local_failed',
]);

export function getN3SectionCardState(section: {
  bucket?: ApiSectionBucket;
  exclusionReason?: ApiExclusionReason | null;
}): N3SectionCardState {
  if (section.bucket === 'include') {
    return section.exclusionReason === 'restored_by_user'
      ? { kind: 'restored', chip: '직접 되살림', actionLabel: '제외하기', targetBucket: 'exclude' }
      : { kind: 'include', chip: '번역 예정', actionLabel: '제외하기', targetBucket: 'exclude' };
  }
  const reason = section.exclusionReason ?? null;
  if (reason && AUTO_EXCLUSION_REASONS.has(reason)) {
    return { kind: 'autoExcluded', chip: null, actionLabel: '그래도 번역하기', targetBucket: 'include' };
  }
  if (reason === 'user_manual') {
    return { kind: 'manualExcluded', chip: '직접 제외', actionLabel: '번역하기', targetBucket: 'include' };
  }
  return { kind: 'excluded', chip: null, actionLabel: '번역하기', targetBucket: 'include' };
}

/**
 * Figma N3 카드 variant 7종(component set 1416:12943). 서버 상태(kind·exclusionReason)와 선택 여부로만 정한다.
 * variant는 모양이고 문구(칩·버튼)는 N3SectionCardState가 맡는다 — Figma 샘플 문구를 쓰지 않는다.
 */
export type N3CardVariant =
  | 'translation-pending' // 번역 예정
  | 'translation-selected' // 번역 선택
  | 'excluded' // 제외된
  | 'judgement-failed' // 판정실패
  | 'exclusion-verdict' // 제외 판정
  | 'restored' // 되살린
  | 'exclusion-selected'; // 제외 선택

/** compact 600×160 · verdict 602×161~193(판정 배지 줄 수만큼). 선택해도 바꾸지 않아 목록이 밀리지 않는다 */
export type N3CardLayout = 'compact' | 'verdict';

export function getN3CardVisual(
  section: { bucket?: ApiSectionBucket; exclusionReason?: ApiExclusionReason | null },
  isSelected: boolean,
): { variant: N3CardVariant; layout: N3CardLayout } {
  const { kind } = getN3SectionCardState(section);
  if (kind === 'include') return { variant: isSelected ? 'translation-selected' : 'translation-pending', layout: 'compact' };
  if (kind === 'restored') return { variant: 'restored', layout: 'verdict' };
  // 현지 판정을 끝내지 못한 섹션은 자동 제외와 다른 카드다. Figma에 선택 variant가 없어 테두리만 카드가 따로 표시한다
  if (section.exclusionReason === 'auto_local_failed') return { variant: 'judgement-failed', layout: 'compact' };
  if (kind === 'autoExcluded') return { variant: isSelected ? 'exclusion-selected' : 'exclusion-verdict', layout: 'verdict' };
  return { variant: isSelected ? 'exclusion-selected' : 'excluded', layout: 'compact' };
}

/** 카드·상세 제목. Figma 1422:10176 「SECTION 01」 형식 */
export function formatN3SectionTitle(sectionOrder: number | undefined): string {
  return `SECTION ${String(sectionOrder ?? 0).padStart(2, '0')}`;
}
