/**
 * DTO 코드값 → 화면 표시 문구 매핑.
 *
 * API는 코드값을 내려주고, 사용자에게 보일 문구는 프론트에서 이 매핑을 거칩니다.
 * 코드값을 화면에 그대로 노출하지 않기 위한 최소한의 공통 위치입니다.
 */

import type { ExclusionReasonCode } from './types';

export const EXCLUSION_REASON_LABELS: Record<ExclusionReasonCode, string> = {
  auto_regulatory: '규제 위반',
  auto_channel: '채널 정책',
  auto_local_irrelevant: '현지 무의미',
  user_manual: '사용자 직접 제외',
  restored_by_user: '사용자 되살림',
};

// N3 section_verdict 배지 라벨은 lib/n3/verdict.ts(getN3VerdictBadgeLabel)에서
// verdictStatus로부터 파생한다. 이 파일에서 별도로 관리하지 않는다.
