/**
 * 결과를 알 수 없는 저장 뒤 서버 상태 다시 받기 한 번의 결과 판정 — 순수 함수(scripts/verify-n5-history.mjs 에서 검증).
 *
 * 다시 받은 /blocks · /preview · /sections 는 「지금 서버 상태」 확인용이다. 그 값으로 과거 요청이 반영됐는지 추정하지 않는다 —
 * 반영 여부는 같은 Idempotency-Key · 같은 본문 재전송의 응답으로만 정한다(lib/api/idempotent-patch.ts · lib/queries/use-save-recovery.ts).
 *
 * - confirmed: 다시 받았다
 * - unconfirmed: 실패했거나 상한(시간)을 넘었다 → 잠금을 그대로 두고 사용자가 [서버 상태 다시 확인]을 누를 때까지 기다린다
 *   (시간이 지났다는 이유로 잠금을 풀지 않는다)
 */
export type UncertainRefetchResult = 'ok' | 'failed' | 'timeout';

export function nextUncertainSaveStatus(result: UncertainRefetchResult): 'confirmed' | 'unconfirmed' {
  return result === 'ok' ? 'confirmed' : 'unconfirmed';
}
