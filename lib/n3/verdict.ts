/**
 * N3 section_verdict 계약 — VerdictStatus / VerdictType / 배지 라벨을
 * 관리하는 단일 지점. (v3.4.1 기준)
 *
 * - verdict_status 어휘 전체는 7종이지만(VerdictStatus), 실제로 section_verdict
 *   판정 행을 생성하는 값은 그중 5종(SectionVerdictStatus)뿐이다. allowed /
 *   cultural은 판정 행을 만들지 않는 상태값이라 SectionVerdict.verdictStatus에는
 *   나타나지 않는다 — "verdict_status = 5종"으로 뭉뚱그리지 않는다.
 * - verdictType은 더 이상 verdictStatus로부터 파생하지 않는다. v3.4.1부터
 *   verdictStatus='regulated' 하나가 대체 표현 유무에 따라 verdictType이
 *   'regulatory'(대체 표현 없음) 또는 'regulatory_replaceable'(대체 표현 있음)로
 *   갈리기 때문에, status만 보고 type을 계산할 수 없다. verdictType은
 *   서버/generated column의 정본이며, FE는 API가 내려준 값을 그대로 사용하고
 *   재계산하지 않는다. verdict_status(7종)와 verdict_type(6종)은 서로 다른 축이다.
 * - section.bucket(포함/제외)은 여기서 계산하지 않는다. bucket의 정본은
 *   항상 section.bucket 자신이며, verdictStatus나 verdictType으로부터 UI가
 *   다시 계산하지 않는다. verdictType별 "기본" bucket 기대값은
 *   scripts/verify-n3-verdict-contract.mjs에서 fixture 계약으로만 검증한다.
 */

/** verdict_status 전체 어휘 (7종). 판정 행을 만들지 않는 allowed/cultural 포함 */
export type VerdictStatus =
  | 'regulated'
  | 'conditional'
  | 'allowed'
  | 'irrelevant'
  | 'needs_fix'
  | 'cultural'
  | 'policy';

export const VERDICT_STATUSES = [
  'regulated',
  'conditional',
  'allowed',
  'irrelevant',
  'needs_fix',
  'cultural',
  'policy',
] as const satisfies readonly VerdictStatus[];

/**
 * 실제로 section_verdict 판정 행을 생성하는 verdict_status (5종).
 * SectionVerdict.verdictStatus는 이 부분집합만 받는다 — allowed/cultural은
 * 판정 행을 만들지 않으므로 여기 포함되지 않는다.
 */
export type SectionVerdictStatus = Exclude<VerdictStatus, 'allowed' | 'cultural'>;

export const SECTION_VERDICT_STATUSES = [
  'regulated',
  'conditional',
  'irrelevant',
  'needs_fix',
  'policy',
] as const satisfies readonly SectionVerdictStatus[];

export type VerdictType =
  | 'regulatory'
  | 'regulatory_replaceable'
  | 'regulatory_conditional'
  | 'local_irrelevant'
  | 'needs_fix'
  | 'channel_policy';

/**
 * VerdictType 런타임 목록.
 * channel_policy는 12월 전용 값으로 타입에는 존재하지만, 9월 판정 행
 * fixture에는 만들지 않는다 (lib/mock-api/fixtures.ts 참고).
 */
export const VERDICT_TYPES = [
  'regulatory',
  'regulatory_replaceable',
  'regulatory_conditional',
  'local_irrelevant',
  'needs_fix',
  'channel_policy',
] as const satisfies readonly VerdictType[];

/**
 * verdictType -> 배지 기본 문구. N3 배지뿐 아니라 exclusion reason 라벨
 * (lib/api/labels.ts의 EXCLUSION_REASON_LABELS) 등 같은 의미를 화면에 다시
 * 쓰는 곳에서도 이 map을 재사용한다 — 같은 문구를 여러 파일에 따로
 * 하드코딩하지 않기 위함이다.
 *
 * TODO(v3.4.2): regulatory / regulatory_replaceable의 최종 사용자 노출
 * 문구는 화면문구 ② 확정 전이다. 코드값과 동작은 확정됐으므로 바꾸지
 * 않되, 화면문구 ② 확정 후 이 두 값만 교체한다.
 */
export const VERDICT_BADGE_LABELS: Record<VerdictType, string> = {
  regulatory: '규제 위반',
  regulatory_replaceable: '규제 표현',
  regulatory_conditional: '조건부 규제',
  // 표시 문구만 PRD v3.5 이름(must_fix「현지 수정 필수」· needs_check「현지 확인 필요」)을 따른다.
  // 코드값(local_irrelevant · needs_fix)은 DB·계약 이름 그대로 둔다(값 이관은 서버 스키마 배치 몫).
  local_irrelevant: '현지 수정 필수',
  needs_fix: '현지 확인 필요',
  channel_policy: '채널 정책',
};

/**
 * N3 현재(9월) 화면에 보이는 판정 5종. channel_policy(채널 정책)는 12월 기능이라 뺀다.
 * VerdictType·라벨 map에서는 지우지 않는다 — N3 화면 표시에서만 거른다(N5·12월 화면 영향 없음).
 */
export const N3_VISIBLE_VERDICT_TYPES = [
  'regulatory',
  'regulatory_replaceable',
  'regulatory_conditional',
  'local_irrelevant',
  'needs_fix',
] as const satisfies readonly VerdictType[];

const N3_VISIBLE_VERDICT_TYPE_SET: ReadonlySet<string> = new Set(N3_VISIBLE_VERDICT_TYPES);

/** 서버 verdicts 중 N3 현재 화면에 그릴 것만 고른다(순서 유지). verdictType 없는 행도 뺀다. */
export function filterN3VisibleVerdicts<T extends { verdictType?: VerdictType | null }>(
  verdicts: readonly T[] | null | undefined,
): T[] {
  return (verdicts ?? []).filter((v) => v.verdictType != null && N3_VISIBLE_VERDICT_TYPE_SET.has(v.verdictType));
}

/** verdictType -> N3 배지 문구 */
export function getN3VerdictBadgeLabel(type: VerdictType): string {
  return VERDICT_BADGE_LABELS[type];
}
