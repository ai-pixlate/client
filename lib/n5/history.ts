/**
 * N5 실행 취소·다시 실행(F-CFM-03) — API 와 독립된 순수 이력 엔진.
 *
 * React 도 브라우저 API 도 쓰지 않는다(scripts/verify-n5-history.mjs 로 Node 에서 검증).
 *
 * PM 확정(10/29):
 * - 이력은 화면 세션 안에서만 쓴다. N5 를 나갔다 오거나 새로고침하면 비운다 — 서버·localStorage·
 *   sessionStorage 에 저장하지 않는다(이 모듈은 in-memory 값만 다룬다).
 * - 서버 저장에 성공한 사용자 조작만 이력에 넣는다. 끌기·크기 조절은 손을 놓은 뒤 저장 성공 1회가
 *   1단계(snap 포함), [+][-] 는 한 번 누르고 저장 성공 1회가 1단계다.
 * - 일반 저장 실패: 이력 변화 없음. 화면 처리는 조작 종류마다 다르다(n5EditFailurePolicy) —
 *   박스 조정·섹션 제외·되돌리기는 마지막 저장 성공 값으로 되돌리고 안내, 번역문은 입력한 초안을
 *   그대로 둔다(편집 중 상태 유지). 실제로 화면 값을 되돌리거나 초안을 지키는 것은 이 모듈 밖
 *   (UI·저장 orchestration)의 일이다 — 이 엔진은 "실패 = 이력 불변"만 보장한다.
 * - 실행 취소·다시 실행 저장 실패: 이력·pointer·화면 모두 그대로, 안내만.
 *
 * 실행 취소·다시 실행은 "저장 성공 뒤에 pointer 를 옮긴다". 버튼을 누를 때 pointer 를 먼저 옮기지 않으므로
 * 실패해도 되돌릴 것이 없다.
 *
 * revision: 명령에 revision 을 담지 않는다. 실제 저장에 쓸 revision 은 실행 시점의 최신 서버 값이며,
 * 그 값을 고르는 것과 409 처리는 이 모듈 밖(저장 orchestration)의 책임이다.
 */

import type { N5SaveNotice } from './messages';

/** FE 내부 조작 종류 — API 계약과 무관하다 */
export type N5EditKind =
  | 'translation'
  | 'section-exclude'
  | 'section-restore'
  | 'box-move'
  | 'box-resize'
  | 'font-scale';

export interface N5EditTarget {
  type: 'block' | 'section';
  id: number;
}

/** 사용자의 의미 있는 변경 하나. before/after 는 조작 종류마다 다른 화면 값(API 요청 본문이 아니다) */
export interface N5EditCommand<TValue = unknown> {
  kind: N5EditKind;
  target: N5EditTarget;
  before: TValue;
  after: TValue;
}

export interface N5History {
  readonly entries: readonly N5EditCommand[];
  /** 적용된 명령 수. entries[pointer - 1] 이 다음 실행 취소 대상, entries[pointer] 가 다음 다시 실행 대상 */
  readonly pointer: number;
}

export const EMPTY_N5_HISTORY: N5History = { entries: [], pointer: 0 };

/** 보관할 최대 단계 수 — PM 확정(10/29). FE 제품 상수(서버 계약 아님). 넘치면 가장 오래된 것부터 버린다 */
export const N5_HISTORY_LIMIT = 50;

/**
 * 일반 저장 실패 때 화면을 어떻게 둘지 — FE 내부 개념(PM 확정 10/29).
 * - 'rollback-to-committed': 마지막 저장 성공 값으로 되돌린다(resolveSaveFailed) + 'edit-failed' 안내.
 * - 'preserve-draft': 사용자가 입력한 초안·편집 중 상태를 그대로 둔다. 번역문 수정만 해당한다.
 */
export type N5EditFailurePolicy = 'rollback-to-committed' | 'preserve-draft';

export function n5EditFailurePolicy(kind: N5EditKind): N5EditFailurePolicy {
  return kind === 'translation' ? 'preserve-draft' : 'rollback-to-committed';
}

export function canUndo(history: N5History): boolean {
  return history.pointer > 0;
}

export function canRedo(history: N5History): boolean {
  return history.pointer < history.entries.length;
}

/** 실행 취소할 명령(없으면 null). 조회만 하고 pointer 는 옮기지 않는다 */
export function peekUndo(history: N5History): N5EditCommand | null {
  return canUndo(history) ? history.entries[history.pointer - 1] : null;
}

/** 다시 실행할 명령(없으면 null). 조회만 하고 pointer 는 옮기지 않는다 */
export function peekRedo(history: N5History): N5EditCommand | null {
  return canRedo(history) ? history.entries[history.pointer] : null;
}

/**
 * 새 조작의 저장 성공 — 다시 실행 영역(pointer 뒤)을 버리고 끝에 넣은 뒤, N5_HISTORY_LIMIT 를 넘으면
 * 가장 오래된 것부터 버려 최근 단계만 남긴다. pointer 는 항상 남은 목록의 끝(가장 최근 명령 다음)이다.
 */
export function pushCommitted(history: N5History, command: N5EditCommand): N5History {
  const entries = [...history.entries.slice(0, history.pointer), command].slice(-N5_HISTORY_LIMIT);
  return { entries, pointer: entries.length };
}

/** 실행 취소 저장 성공 — 조회했던 그 명령일 때만 pointer 를 한 칸 뒤로(다른 명령이면 그대로) */
export function commitUndo(history: N5History, command: N5EditCommand): N5History {
  return peekUndo(history) === command ? { ...history, pointer: history.pointer - 1 } : history;
}

/** 다시 실행 저장 성공 — 조회했던 그 명령일 때만 pointer 를 한 칸 앞으로 */
export function commitRedo(history: N5History, command: N5EditCommand): N5History {
  return peekRedo(history) === command ? { ...history, pointer: history.pointer + 1 } : history;
}

export function clearHistory(): N5History {
  return EMPTY_N5_HISTORY;
}

// ─────────────────────────────────────────────────────────────────
// 저장 결과 상태 전이 — 이력·진행 중 작업·안내를 함께 다룬다(실제 mutation 과는 아직 연결하지 않는다)
// ─────────────────────────────────────────────────────────────────

export type N5SaveOperation = 'edit' | 'undo' | 'redo';

/** 안내 종류. 문구는 lib/n5/messages.ts 의 N5_SAVE_NOTICE_MESSAGES 에서 고른다 */
export type { N5SaveNotice };

export interface N5EditSession {
  history: N5History;
  /** 저장 중인 작업. 저장은 한 번에 하나 — 진행 중이면 새 조작·실행 취소·다시 실행을 시작하지 않는다 */
  inFlight: N5SaveOperation | null;
  notice: N5SaveNotice | null;
}

export const INITIAL_N5_EDIT_SESSION: N5EditSession = { history: EMPTY_N5_HISTORY, inFlight: null, notice: null };

export type N5EditEvent =
  | { type: 'save-started'; operation: N5SaveOperation }
  | { type: 'edit-succeeded'; command: N5EditCommand }
  | { type: 'edit-failed'; kind: N5EditKind }
  | { type: 'undo-succeeded'; command: N5EditCommand }
  | { type: 'undo-failed' }
  | { type: 'redo-succeeded'; command: N5EditCommand }
  | { type: 'redo-failed' }
  | { type: 'notice-dismissed' }
  | { type: 'reset' };

export function canStartSave(session: N5EditSession): boolean {
  return session.inFlight === null;
}

export function reduceN5EditSession(session: N5EditSession, event: N5EditEvent): N5EditSession {
  switch (event.type) {
    case 'save-started':
      return canStartSave(session) ? { ...session, inFlight: event.operation, notice: null } : session;
    case 'edit-succeeded':
      return { history: pushCommitted(session.history, event.command), inFlight: null, notice: null };
    case 'edit-failed':
      // 이력은 그대로. 'edit-failed' 안내는 "마지막 저장 상태로 돌아갑니다" 문구라 되돌리는 조작에만 낸다 —
      // 번역문은 초안을 유지하므로 이 안내를 내지 않는다(번역문 실패 문구는 PM 승인 전, 화면이 따로 표시).
      return {
        ...session,
        inFlight: null,
        notice: n5EditFailurePolicy(event.kind) === 'rollback-to-committed' ? 'edit-failed' : null,
      };
    case 'undo-succeeded':
      return { history: commitUndo(session.history, event.command), inFlight: null, notice: null };
    case 'undo-failed':
      return { ...session, inFlight: null, notice: 'undo-failed' };
    case 'redo-succeeded':
      return { history: commitRedo(session.history, event.command), inFlight: null, notice: null };
    case 'redo-failed':
      return { ...session, inFlight: null, notice: 'redo-failed' };
    case 'notice-dismissed':
      return { ...session, notice: null };
    case 'reset':
      return INITIAL_N5_EDIT_SESSION;
  }
}

// ─────────────────────────────────────────────────────────────────
// 대상별 화면 값 — 마지막 저장 성공 값(committed)과 저장 전 화면 값(local)을 나눠 둔다
// ─────────────────────────────────────────────────────────────────

export interface N5CommittedValue<TValue> {
  committed: TValue;
  local: TValue | null;
}

export function committedValue<TValue>(value: TValue): N5CommittedValue<TValue> {
  return { committed: value, local: null };
}

/** 화면에 보일 값 — 저장 전 화면 값이 있으면 그것, 없으면 마지막 저장 성공 값 */
export function displayedValue<TValue>(state: N5CommittedValue<TValue>): TValue {
  return state.local ?? state.committed;
}

/** 조작 중(끌기·입력 등) 화면 값만 바꾼다 */
export function setLocalValue<TValue>(state: N5CommittedValue<TValue>, local: TValue): N5CommittedValue<TValue> {
  return { ...state, local };
}

/** 저장 성공 — 서버가 확정한 값을 새 기준으로 */
export function resolveSaveSucceeded<TValue>(_state: N5CommittedValue<TValue>, saved: TValue): N5CommittedValue<TValue> {
  return { committed: saved, local: null };
}

/** 저장 실패 — 화면 값을 버리고 마지막 저장 성공 값으로 되돌린다. 'rollback-to-committed' 조작에만 쓴다(번역문 초안에는 쓰지 않는다) */
export function resolveSaveFailed<TValue>(state: N5CommittedValue<TValue>): N5CommittedValue<TValue> {
  return { committed: state.committed, local: null };
}
