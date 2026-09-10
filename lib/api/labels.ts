/**
 * DTO 코드값 → 화면 표시 문구 매핑.
 *
 * API는 코드값을 내려주고, 사용자에게 보일 문구는 프론트에서 이 매핑을 거칩니다.
 * 코드값을 화면에 그대로 노출하지 않기 위한 최소한의 공통 위치입니다.
 */

import type { ExclusionReasonCode } from './types';
import { VERDICT_BADGE_LABELS } from '@/lib/n3/verdict';

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
