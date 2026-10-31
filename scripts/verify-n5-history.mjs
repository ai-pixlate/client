/**
 * N5 실행 취소 이력 엔진(lib/n5/history.ts) 자동 검증.
 *
 * 실행:  npm run verify:n5-history
 */

import {
  EMPTY_N5_HISTORY,
  N5_HISTORY_LIMIT,
  INITIAL_N5_EDIT_SESSION,
  canRedo,
  canStartSave,
  canUndo,
  clearHistory,
  commitRedo,
  commitUndo,
  committedValue,
  displayedValue,
  n5EditFailurePolicy,
  peekRedo,
  peekUndo,
  pushCommitted,
  reduceN5EditSession,
  resolveSaveFailed,
  resolveSaveSucceeded,
  setLocalValue,
} from '../lib/n5/history.ts';
import { N5_SAVE_NOTICE_MESSAGES } from '../lib/n5/messages.ts';

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

const cmd = (kind, id, before, after, type = 'block') => ({ kind, target: { type, id }, before, after });
const A = cmd('translation', 1, 'a', 'b');
const B = cmd('box-move', 2, { x: 0, y: 0 }, { x: 10, y: 5 });
const C = cmd('section-exclude', 7, 'include', 'exclude', 'section');

console.log('\n[1] 이력 기본');
{
  check('빈 이력은 실행 취소 불가', !canUndo(EMPTY_N5_HISTORY) && peekUndo(EMPTY_N5_HISTORY) === null);
  check('빈 이력은 다시 실행 불가', !canRedo(EMPTY_N5_HISTORY) && peekRedo(EMPTY_N5_HISTORY) === null);
  const h1 = pushCommitted(EMPTY_N5_HISTORY, A);
  check('push 후 실행 취소 가능, 대상은 방금 명령', canUndo(h1) && peekUndo(h1) === A);
  check('push 는 원본을 바꾸지 않는다', EMPTY_N5_HISTORY.entries.length === 0);
  const h2 = commitUndo(h1, A);
  check('실행 취소 성공 → pointer 0, 다시 실행 가능', h2.pointer === 0 && canRedo(h2) && peekRedo(h2) === A);
  const h3 = commitRedo(h2, A);
  check('다시 실행 성공 → pointer 1', h3.pointer === 1 && peekUndo(h3) === A);
  check('조회(peek)만으로 pointer 가 움직이지 않는다', (peekUndo(h1), h1.pointer === 1));
  check('조회한 명령이 아니면 commitUndo 는 변화 없음', commitUndo(pushCommitted(h1, B), A).pointer === 2);
}

console.log('\n[2] 실행 취소 뒤 새 조작 → 다시 실행 영역 제거');
{
  let h = pushCommitted(pushCommitted(EMPTY_N5_HISTORY, A), B);
  h = commitUndo(h, B);
  check('B 실행 취소 뒤 B 다시 실행 가능', peekRedo(h) === B);
  h = pushCommitted(h, C);
  check('새 조작 C push → B 제거', h.entries.length === 2 && h.entries[0] === A && h.entries[1] === C && !canRedo(h));
}

console.log('\n[3] 같은 대상 연속 조작 · 다른 대상 순서');
{
  const m1 = cmd('box-move', 2, { x: 0, y: 0 }, { x: 10, y: 0 });
  const m2 = cmd('box-move', 2, { x: 10, y: 0 }, { x: 20, y: 0 });
  let h = pushCommitted(pushCommitted(EMPTY_N5_HISTORY, m1), m2);
  check('같은 대상 연속 조작은 각각 1단계', h.entries.length === 2);
  check('실행 취소는 마지막 것부터', peekUndo(h) === m2 && peekUndo(commitUndo(h, m2)) === m1);
  h = pushCommitted(pushCommitted(pushCommitted(EMPTY_N5_HISTORY, A), B), C);
  const order = [];
  while (canUndo(h)) {
    const c = peekUndo(h);
    order.push(c.target.id);
    h = commitUndo(h, c);
  }
  check('다른 대상은 넣은 역순으로 실행 취소', order.join(',') === '7,2,1', order.join(','));
}

console.log('\n[4] clear · 세션 초기화');
{
  const h = pushCommitted(pushCommitted(EMPTY_N5_HISTORY, A), B);
  const cleared = clearHistory(h);
  check('clear 후 비움', cleared.entries.length === 0 && cleared.pointer === 0);
  const s = reduceN5EditSession({ history: h, inFlight: 'edit', notice: 'edit-failed' }, { type: 'reset' });
  check('reset 이벤트 → 초기 세션(N5 재진입·새로고침)', s === INITIAL_N5_EDIT_SESSION);
}

console.log('\n[5] 저장 결과 상태 전이');
{
  // 일반 저장 성공: 끌기 시작 → 여러 move(화면 값만) → 놓기 → 저장 성공 → 1단계
  let s = INITIAL_N5_EDIT_SESSION;
  s = reduceN5EditSession(s, { type: 'save-started', operation: 'edit' });
  check('저장 중에는 다른 저장을 시작하지 않는다', !canStartSave(s) && reduceN5EditSession(s, { type: 'save-started', operation: 'undo' }) === s);
  const drag = cmd('box-move', 3, { x: 0, y: 0 }, { x: 42.5, y: 7.25 });
  s = reduceN5EditSession(s, { type: 'edit-succeeded', command: drag });
  check('끌기 결과는 1건만 push', s.history.entries.length === 1 && s.history.entries[0] === drag && s.inFlight === null);

  // 일반 저장 실패(박스·섹션): 이력 변화 없음 + 되돌림 안내
  const before = s.history;
  s = reduceN5EditSession(reduceN5EditSession(s, { type: 'save-started', operation: 'edit' }), { type: 'edit-failed', kind: 'box-move' });
  check('저장 실패한 조작은 이력에 없다', s.history === before && s.notice === 'edit-failed' && s.inFlight === null);

  // 번역문 저장 실패: 이력 변화 없음 + 되돌림 안내를 내지 않는다(초안 유지)
  const t = reduceN5EditSession(reduceN5EditSession(s, { type: 'save-started', operation: 'edit' }), { type: 'edit-failed', kind: 'translation' });
  check('번역문 저장 실패도 이력 불변', t.history === before && t.inFlight === null);
  check('번역문 저장 실패에는 "마지막 저장 상태로" 안내를 내지 않는다', t.notice === null);

  // 실행 취소 실패: pointer·이력 그대로
  s = reduceN5EditSession(reduceN5EditSession(s, { type: 'save-started', operation: 'undo' }), { type: 'undo-failed' });
  check('실행 취소 실패 → pointer 불변', s.history === before && s.history.pointer === 1 && s.notice === 'undo-failed');

  // 실행 취소 성공
  s = reduceN5EditSession(reduceN5EditSession(s, { type: 'save-started', operation: 'undo' }), { type: 'undo-succeeded', command: drag });
  check('실행 취소 성공 → pointer 0, 안내 지움', s.history.pointer === 0 && s.notice === null);

  // 다시 실행 실패: pointer 불변
  const afterUndo = s.history;
  s = reduceN5EditSession(reduceN5EditSession(s, { type: 'save-started', operation: 'redo' }), { type: 'redo-failed' });
  check('다시 실행 실패 → pointer 불변', s.history === afterUndo && s.notice === 'redo-failed');

  s = reduceN5EditSession(reduceN5EditSession(s, { type: 'save-started', operation: 'redo' }), { type: 'redo-succeeded', command: drag });
  check('다시 실행 성공 → pointer 1', s.history.pointer === 1);
  check('안내 닫기', reduceN5EditSession({ ...s, notice: 'redo-failed' }, { type: 'notice-dismissed' }).notice === null);
}

console.log('\n[6] 대상별 화면 값 — 저장 실패 시 마지막 저장 값으로');
{
  let v = committedValue({ x: 0, y: 0 });
  v = setLocalValue(v, { x: 30, y: 10 });
  check('조작 중에는 화면 값 표시', displayedValue(v).x === 30);
  const failed = resolveSaveFailed(v);
  check('저장 실패 → 마지막 저장 값으로 되돌림', displayedValue(failed).x === 0 && failed.local === null);
  const ok = resolveSaveSucceeded(v, { x: 30, y: 10 });
  check('저장 성공 → 저장 값이 새 기준', ok.committed.x === 30 && ok.local === null);
}

console.log('\n[6-1] 실패 정책 — 번역문만 초안 유지');
{
  check('번역문 → preserve-draft', n5EditFailurePolicy('translation') === 'preserve-draft');
  for (const kind of ['box-move', 'box-resize', 'font-scale', 'section-exclude', 'section-restore']) {
    check(`${kind} → rollback-to-committed`, n5EditFailurePolicy(kind) === 'rollback-to-committed');
  }
}

console.log('\n[7] 명령에 revision 을 담지 않는다 · 안내 문구');
{
  const keys = Object.keys(pushCommitted(EMPTY_N5_HISTORY, A).entries[0]).sort().join(',');
  check('명령 필드는 kind·target·before·after 뿐', keys === 'after,before,kind,target', keys);
  check('실행 취소 실패 문구', N5_SAVE_NOTICE_MESSAGES['undo-failed'] === '실행 취소를 하지 못했습니다. 현재 상태를 유지합니다.');
  check('다시 실행 실패 문구', N5_SAVE_NOTICE_MESSAGES['redo-failed'] === '재실행하지 못했습니다. 현재 상태를 유지합니다.');
  check('일반 저장 실패 문구', N5_SAVE_NOTICE_MESSAGES['edit-failed'] === '변경 사항을 저장하지 못했습니다. 마지막으로 저장된 상태로 돌아갑니다.');
}

console.log('\n[8] 최대 단계(N5_HISTORY_LIMIT) — 최근 50단계만 유지');
{
  const n = (i) => cmd('box-move', i, { x: i - 1, y: 0 }, { x: i, y: 0 });
  const pushN = (h, from, to) => {
    for (let i = from; i <= to; i += 1) h = pushCommitted(h, n(i));
    return h;
  };
  const ids = (h) => h.entries.map((c) => c.target.id);
  const undoAll = (h) => {
    let count = 0;
    while (canUndo(h)) {
      h = commitUndo(h, peekUndo(h));
      count += 1;
    }
    return { h, count };
  };

  check('제한은 50', N5_HISTORY_LIMIT === 50);

  const h50 = pushN(EMPTY_N5_HISTORY, 1, 50);
  check('정확히 50개 → 50개 보관', h50.entries.length === 50 && h50.pointer === 50);
  check('50번까지 실행 취소 가능', undoAll(h50).count === 50);

  const h51 = pushCommitted(h50, n(51));
  check('51번째 → 50개, 최초(1) 제거', h51.entries.length === 50 && ids(h51)[0] === 2 && ids(h51)[49] === 51 && h51.pointer === 50);

  const h100 = pushN(EMPTY_N5_HISTORY, 1, 120);
  check('120개 넣어도 50개, 최근 71~120', h100.entries.length === 50 && ids(h100)[0] === 71 && ids(h100)[49] === 120);

  // 잘린 뒤 실행 취소·다시 실행
  let t = commitUndo(h51, peekUndo(h51));
  check('잘린 뒤 실행 취소 → 대상은 최신(51), pointer 49', t.pointer === 49 && peekRedo(t).target.id === 51);
  t = commitRedo(t, peekRedo(t));
  check('잘린 뒤 다시 실행 → pointer 50', t.pointer === 50 && peekUndo(t).target.id === 51);
  const all = undoAll(h51);
  check('잘린 뒤 끝까지 실행 취소하면 50번, 마지막 대상은 2', all.count === 50 && peekRedo(all.h).target.id === 2);

  // 실행 취소 뒤 새 조작: A B C D → Undo Undo → E → A B E
  let b = pushN(EMPTY_N5_HISTORY, 1, 4);
  b = commitUndo(b, peekUndo(b));
  b = commitUndo(b, peekUndo(b));
  b = pushCommitted(b, n(5));
  check('A B C D → 2번 실행 취소 → E → A B E, 다시 실행 없음', ids(b).join(',') === '1,2,5' && !canRedo(b));

  // 제한 상태에서 실행 취소 뒤 새 조작 + 잘림
  let c = pushN(EMPTY_N5_HISTORY, 1, 50);
  for (let i = 0; i < 3; i += 1) c = commitUndo(c, peekUndo(c));
  c = pushCommitted(c, n(99));
  check('50개 중 3번 실행 취소 → 새 조작: 48개(47+1), 다시 실행 영역 제거', c.entries.length === 48 && ids(c)[47] === 99 && !canRedo(c));
  c = pushN(c, 100, 102);
  check('이어서 3개 더 → 50개 상한에서 최초(1) 제거', c.entries.length === 50 && ids(c)[0] === 2 && ids(c)[49] === 102);

  // 제한 상태에서 실행 취소·다시 실행 실패 → pointer 불변
  let s = { history: h51, inFlight: null, notice: null };
  s = reduceN5EditSession(reduceN5EditSession(s, { type: 'save-started', operation: 'undo' }), { type: 'undo-failed' });
  check('50개 상태 실행 취소 실패 → 이력·pointer 불변', s.history === h51 && s.history.pointer === 50);
  const afterUndo = commitUndo(h51, peekUndo(h51));
  s = { history: afterUndo, inFlight: null, notice: null };
  s = reduceN5EditSession(reduceN5EditSession(s, { type: 'save-started', operation: 'redo' }), { type: 'redo-failed' });
  check('50개 상태 다시 실행 실패 → 이력·pointer 불변', s.history === afterUndo && s.history.pointer === 49);

  // 저장 실패한 조작은 제한과 관계없이 추가되지 않는다
  s = { history: h51, inFlight: null, notice: null };
  s = reduceN5EditSession(reduceN5EditSession(s, { type: 'save-started', operation: 'edit' }), { type: 'edit-failed', kind: 'box-move' });
  check('50개 상태 저장 실패 → 이력 불변(최초도 밀려나지 않음)', s.history === h51 && ids(s.history)[0] === 2);

  check('clear → 비움', clearHistory(h100).entries.length === 0 && clearHistory(h100).pointer === 0);
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
