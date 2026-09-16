/**
 * DTO 코드값 → 화면 표시 문구 매핑.
 *
 * API는 코드값을 내려주고, 사용자에게 보일 문구는 프론트에서 이 매핑을 거칩니다.
 * 코드값을 화면에 그대로 노출하지 않기 위한 최소한의 공통 위치입니다.
 */

import type { BlockRole, ExclusionReasonCode } from './types';
import type { ApiSignalCode } from './n5-schema';
// 값 import는 상대경로를 쓴다 — '@/' alias는 tsconfig paths 전용이라 이 파일을
// plain Node(scripts/verify-*.mjs, --experimental-strip-types)로 직접/간접 실행할 때
// 풀리지 않는다. (lib/n5/coordinates.ts 상단 주석의 type-only vs 값 import 구분과 동일)
import { VERDICT_BADGE_LABELS } from '../n3/verdict.ts';

export const BLOCK_ROLE_LABELS: Record<BlockRole, string> = {
  title: '제목',
  body: '본문',
  caption: '캡션',
  price: '가격',
  caution: '주의문구',
  product_label: '제품 라벨',
};

/**
 * 자동 제외 사유 3종은 N3 배지 기본 문구(VERDICT_BADGE_LABELS)에 "(자동)"만
 * 붙여 재사용한다 — 같은 의미의 문구가 이 파일과 lib/n3/verdict.ts 양쪽에서
 * 따로 바뀌는 것을 막기 위함이다. 사용자 직접 조작 2종은 배지 개념이 아니라
 * 이 파일에서 직접 관리한다.
 */
export const EXCLUSION_REASON_LABELS: Record<ExclusionReasonCode, string> = {
  auto_regulatory: `${VERDICT_BADGE_LABELS.regulatory}(자동)`,
  auto_channel: `${VERDICT_BADGE_LABELS.channel_policy}(자동)`,
  auto_local_irrelevant: `${VERDICT_BADGE_LABELS.local_irrelevant}(자동)`,
  user_manual: '직접 제외',
  restored_by_user: '직접 되살림',
};

// N3 section_verdict 배지 라벨은 lib/n3/verdict.ts(getN3VerdictBadgeLabel)에서
// verdictType(서버 정본, v3.4.1)으로부터 매핑한다. 이 파일에서 별도로 관리하지 않는다.

/**
 * 셀러 화면에 노출되는 signal 6종 (v3.4.2 openapi.yaml SignalCode 8종 중
 * admin 전용 2종은 서버가 이미 응답 signals[]에서 제외한다 — FE는 그 6종만
 * 받는다고 가정하되, 혹시 모를 값에도 raw code를 노출하지 않도록
 * getSignalLabel에서 폴백을 둔다).
 */
export const SELLER_SIGNAL_CODES = [
  'prohibited_expression',
  'mandatory_term_unapplied',
  'translation_failed',
  'empty_block',
  'logo_match_failed',
  'width_overflow',
] as const;

type SellerSignalCode = (typeof SELLER_SIGNAL_CODES)[number];

export const SIGNAL_LABELS: Record<SellerSignalCode, string> = {
  prohibited_expression: '금지 표현',
  mandatory_term_unapplied: '필수 문구 누락',
  translation_failed: '번역 실패',
  empty_block: '원문 없음',
  logo_match_failed: '로고 인식 실패',
  width_overflow: '영역 초과',
};

/**
 * signal code → 한글 라벨. 매핑에 없는 코드(예: admin 전용 코드가 실수로 섞여
 * 들어온 경우)는 raw code를 그대로 보여주지 않고 일반 안내 문구로 대체한다.
 */
export function getSignalLabel(code: ApiSignalCode): string {
  return (SIGNAL_LABELS as Record<string, string>)[code] ?? '확인 필요';
}
