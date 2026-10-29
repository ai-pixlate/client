/**
 * N5 저장하지 못한 번역문 집계 — 순수 함수(scripts/verify-n5-failed-drafts.mjs 로 Node 에서 검증).
 *
 * PM 확정(10/29): 번역문 저장이 실패하면 초안을 그대로 두고, 그런 칸이 남아 있어도 [저장하러 가기]를
 * 막지 않는다. 대신 확인창으로 "N칸이 마지막으로 저장된 문장으로 확정된다"고 알린다.
 *
 * 실행 취소 이력(lib/n5/history.ts)과는 다른 것이다 — 이력은 저장에 성공한 과거 조작, 이 집계는
 * 지금 저장되지 못한 번역문이다. 저장 실패한 번역문은 이력에 들어가지 않는다.
 */

/** 확인창 문구 — PM 승인(10/29). N 은 집계된 칸 수(단수 문구를 따로 두지 않는다) */
export function failedDraftConfirmTitle(count: number): string {
  return `저장하지 못한 번역문이 ${count}칸 있습니다.`;
}
export const FAILED_DRAFT_CONFIRM_DESCRIPTION = '계속하면 이 칸들은 마지막으로 저장된 문장으로 확정됩니다.';

/**
 * 저장하지 못한 번역문인지 — 마지막 저장 시도가 실패했고(409 충돌 포함), 초안이 마지막 서버 저장값과
 * 다를 때만. 저장을 시도하지 않은 편집 중 초안은 세지 않고, 초안을 서버값과 같게 되돌리면 빠진다.
 */
export function isFailedDraft({ lastSaveFailed, isDirty }: { lastSaveFailed: boolean; isDirty: boolean }): boolean {
  return lastSaveFailed && isDirty;
}

/** 한 칸의 상태를 집계에 반영한다. 바뀐 것이 없으면 같은 Set 을 그대로 돌려준다(불필요한 re-render 방지) */
export function updateFailedDraftIds(
  ids: ReadonlySet<number>,
  blockId: number,
  hasFailedDraft: boolean,
): ReadonlySet<number> {
  if (ids.has(blockId) === hasFailedDraft) return ids;
  const next = new Set(ids);
  if (hasFailedDraft) next.add(blockId);
  else next.delete(blockId);
  return next;
}
