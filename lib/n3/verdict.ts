/**
 * N3 section_verdict 계약 — VerdictStatus / VerdictType / 배지 라벨을
 * 관리하는 단일 지점.
 *
 * - verdictType은 verdictStatus에서만 파생된다. 다른 파일에서 별도로
 *   switch/if-else로 파생시키지 않고 이 모듈의 함수만 사용한다.
 * - allowed / cultural은 이 계약에 없다 — 9월 N3 판정 행을 만들지 않고
 *   배지도 렌더하지 않는다.
 * - section.bucket(포함/제외)은 여기서 계산하지 않는다. bucket의 정본은
 *   항상 section.bucket 자신이며, verdictStatus나 isTeaser로부터 UI가
 *   다시 계산하지 않는다.
 */

export type VerdictStatus = 'regulated' | 'conditional' | 'irrelevant' | 'needs_fix' | 'policy';

export const VERDICT_STATUSES = [
  'regulated',
  'conditional',
  'irrelevant',
  'needs_fix',
  'policy',
] as const satisfies readonly VerdictStatus[];

export type VerdictType =
  | 'regulatory'
  | 'regulatory_conditional'
  | 'local_irrelevant'
  | 'needs_fix'
  | 'channel_policy';

const VERDICT_STATUS_TO_TYPE: Record<VerdictStatus, VerdictType> = {
  regulated: 'regulatory',
  conditional: 'regulatory_conditional',
  irrelevant: 'local_irrelevant',
  needs_fix: 'needs_fix',
  policy: 'channel_policy',
};

/** verdictStatus -> verdictType. verdictType을 독립적으로 파생시키지 않는다 */
export function getVerdictType(status: VerdictStatus): VerdictType {
  return VERDICT_STATUS_TO_TYPE[status];
}

const N3_VERDICT_BADGE_LABELS: Record<VerdictStatus, string> = {
  regulated: '규제 위반',
  conditional: '조건부 규제',
  irrelevant: '현지 무의미',
  needs_fix: '현지 기준 수정 필요',
  policy: '채널 정책',
};

/** verdictStatus -> N3 배지 문구 */
export function getN3VerdictBadgeLabel(status: VerdictStatus): string {
  return N3_VERDICT_BADGE_LABELS[status];
}
