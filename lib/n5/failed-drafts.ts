/**
 * N5 번역문 미저장 초안 — 순수 함수(scripts/verify-n5-failed-drafts.mjs 로 Node 에서 검증).
 *
 * PM 확정(10/29): 번역문 저장이 실패하면 초안을 그대로 두고, 그런 칸이 남아 있어도 [저장하러 가기]를
 * 막지 않는다. 대신 확인창으로 "N칸이 마지막으로 저장된 문장으로 확정된다"고 알린다.
 *
 * 초안은 N5Panel 이 blockId → TranslationDraft 로 들고 있다(N5 화면 안의 메모리 상태 — 서버·
 * localStorage·sessionStorage 에 저장하지 않는다). 편집기(TranslationEditor)가 원문 보기 전환 등으로
 * 사라졌다 다시 생겨도 초안이 남는다. 항목은 "서버값과 다른 초안이 있을 때만" 존재하고, 저장 실패 칸
 * 집계도 이 항목에서 바로 센다(따로 세는 상태를 두지 않는다).
 *
 * 실행 취소 이력(lib/n5/history.ts)과는 다른 것이다 — 이력은 저장에 성공한 과거 조작, 이 상태는
 * 지금 저장되지 못한 번역문이다. 저장 실패한 번역문은 이력에 들어가지 않는다.
 */

/** 확인창 문구 — PM 승인(10/29). N 은 집계된 칸 수(단수 문구를 따로 두지 않는다) */
export function failedDraftConfirmTitle(count: number): string {
  return `저장하지 못한 번역문이 ${count}칸 있습니다.`;
}
export const FAILED_DRAFT_CONFIRM_DESCRIPTION = '계속하면 이 칸들은 마지막으로 저장된 문장으로 확정됩니다.';

/** 서버값과 다른 번역문 초안 한 칸. lastSaveFailed — 마지막 저장 시도가 실패했다(409 포함) */
export interface TranslationDraft {
  draft: string;
  lastSaveFailed: boolean;
}

/** 입력 — 서버값과 같아지면 항목을 없앤다(실패 상태도 끝, 다음 편집은 저장 시도 전 일반 편집) */
export function editTranslationDraft(
  prev: TranslationDraft | undefined,
  text: string,
  serverText: string,
): TranslationDraft | undefined {
  if (text === serverText) return undefined;
  return { draft: text, lastSaveFailed: prev?.lastSaveFailed ?? false };
}

/** 저장 성공 — 보낸 문장 그대로면 항목을 없앤다. 저장 중에 더 고쳤으면 그 초안은 남기되 실패 상태는 끝낸다 */
export function resolveTranslationSaveSucceeded(
  prev: TranslationDraft | undefined,
  sentText: string,
): TranslationDraft | undefined {
  if (!prev || prev.draft === sentText) return undefined;
  return { draft: prev.draft, lastSaveFailed: false };
}

/** 저장 실패 — 초안은 그대로, 실패 표시만 켠다(저장 중에 서버값으로 되돌려 항목이 없으면 그대로 없음) */
export function resolveTranslationSaveFailed(prev: TranslationDraft | undefined): TranslationDraft | undefined {
  return prev ? { draft: prev.draft, lastSaveFailed: true } : undefined;
}

/** 저장하지 못한 번역문인지 — 마지막 저장 시도가 실패했고 서버값과 다른 초안이 있다(항목 존재 = 다름) */
export function isFailedDraft(entry: TranslationDraft | undefined): boolean {
  return entry?.lastSaveFailed === true;
}

export function countFailedDrafts(drafts: ReadonlyMap<number, TranslationDraft>): number {
  let count = 0;
  for (const entry of drafts.values()) if (isFailedDraft(entry)) count += 1;
  return count;
}

/** 한 칸의 초안을 갱신한다(undefined = 제거). 바뀐 것이 없으면 같은 Map 을 돌려준다(불필요한 re-render 방지) */
export function updateTranslationDrafts(
  drafts: ReadonlyMap<number, TranslationDraft>,
  blockId: number,
  update: (prev: TranslationDraft | undefined) => TranslationDraft | undefined,
): ReadonlyMap<number, TranslationDraft> {
  const prev = drafts.get(blockId);
  const next = update(prev);
  if (next === prev || (next && prev && next.draft === prev.draft && next.lastSaveFailed === prev.lastSaveFailed)) {
    return drafts;
  }
  const map = new Map(drafts);
  if (next) map.set(blockId, next);
  else map.delete(blockId);
  return map;
}
