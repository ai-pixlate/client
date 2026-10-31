/**
 * N5 번역문 미저장 초안(lib/n5/failed-drafts.ts) 자동 검증.
 *
 * 실행:  npm run verify:n5-failed-drafts
 */

import {
  FAILED_DRAFT_CONFIRM_DESCRIPTION,
  countFailedDrafts,
  editTranslationDraft,
  failedDraftConfirmTitle,
  isFailedDraft,
  resolveTranslationSaveFailed,
  resolveTranslationSaveSucceeded,
  updateTranslationDrafts,
} from '../lib/n5/failed-drafts.ts';

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

const SERVER = 'Server text';

console.log('\n[1] 한 칸 생명주기');
{
  let e = editTranslationDraft(undefined, 'Edited', SERVER);
  check('최초 편집 → 초안 생김, 실패 아님', e?.draft === 'Edited' && !isFailedDraft(e));
  e = resolveTranslationSaveFailed(e);
  check('저장 실패 → 초안 그대로 + 실패', e?.draft === 'Edited' && isFailedDraft(e));
  e = editTranslationDraft(e, 'Edited more', SERVER);
  check('실패 뒤 더 고쳐도 실패 칸', e?.draft === 'Edited more' && isFailedDraft(e));
  check('서버값으로 되돌리면 항목 없음', editTranslationDraft(e, SERVER, SERVER) === undefined);
  check('저장 성공(보낸 문장 그대로) → 항목 없음', resolveTranslationSaveSucceeded(e, 'Edited more') === undefined);
  const typedWhileSaving = resolveTranslationSaveSucceeded({ draft: 'Typed later', lastSaveFailed: true }, 'Sent');
  check('저장 중에 더 고친 초안은 남고 실패는 끝', typedWhileSaving?.draft === 'Typed later' && !isFailedDraft(typedWhileSaving));
  check('항목 없을 때 저장 실패 → 그대로 없음', resolveTranslationSaveFailed(undefined) === undefined);
  check('저장 시도 전 편집 중 초안은 실패가 아니다', !isFailedDraft({ draft: 'x', lastSaveFailed: false }));
}

console.log('\n[2] 여러 칸 집계 — 초안 Map 하나에서 센다');
{
  const empty = new Map();
  const failOf = (text) => () => ({ draft: text, lastSaveFailed: true });
  let m = updateTranslationDrafts(empty, 9101, failOf('A'));
  check('실패 칸 1개 → 1', countFailedDrafts(m) === 1 && empty.size === 0);
  m = updateTranslationDrafts(m, 9102, failOf('B'));
  check('다른 칸 실패 → 2', countFailedDrafts(m) === 2);
  const same = updateTranslationDrafts(m, 9101, resolveTranslationSaveFailed);
  check('같은 칸 다시 실패 → 그대로 2(같은 Map)', same === m && countFailedDrafts(same) === 2);
  m = updateTranslationDrafts(m, 9103, (p) => editTranslationDraft(p, 'C', SERVER));
  check('저장 시도 전 편집 칸은 세지 않는다', m.size === 3 && countFailedDrafts(m) === 2);
  m = updateTranslationDrafts(m, 9101, (p) => resolveTranslationSaveSucceeded(p, 'A'));
  check('저장 성공 → 제거', countFailedDrafts(m) === 1 && !m.has(9101));
  m = updateTranslationDrafts(m, 9102, (p) => editTranslationDraft(p, SERVER, SERVER));
  check('초안이 서버값과 같아짐 → 제거', countFailedDrafts(m) === 0 && !m.has(9102));
  check('없는 칸 제거 → 같은 Map', updateTranslationDrafts(m, 9999, () => undefined) === m);
}

console.log('\n[3] 확인창 문구(PM 승인)');
{
  check('제목 N=1', failedDraftConfirmTitle(1) === '저장하지 못한 번역문이 1칸 있습니다.');
  check('제목 N=2', failedDraftConfirmTitle(2) === '저장하지 못한 번역문이 2칸 있습니다.');
  check('설명', FAILED_DRAFT_CONFIRM_DESCRIPTION === '계속하면 이 칸들은 마지막으로 저장된 문장으로 확정됩니다.');
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
