/**
 * N5 저장하지 못한 번역문 집계(lib/n5/failed-drafts.ts) 자동 검증.
 *
 * 실행:  npm run verify:n5-failed-drafts
 */

import {
  FAILED_DRAFT_CONFIRM_DESCRIPTION,
  failedDraftConfirmTitle,
  isFailedDraft,
  updateFailedDraftIds,
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

console.log('\n[1] 판정 — 저장 실패 AND 초안 ≠ 서버값');
{
  check('저장 실패 + 초안 다름 → 실패 칸', isFailedDraft({ lastSaveFailed: true, isDirty: true }));
  check('저장 시도 전 편집 중 초안은 세지 않는다', !isFailedDraft({ lastSaveFailed: false, isDirty: true }));
  check('실패했어도 초안이 서버값과 같으면 세지 않는다', !isFailedDraft({ lastSaveFailed: true, isDirty: false }));
}

console.log('\n[2] 집계');
{
  const empty = new Set();
  let ids = updateFailedDraftIds(empty, 9101, true);
  check('실패 칸 1개 → 1', ids.size === 1 && empty.size === 0);
  ids = updateFailedDraftIds(ids, 9102, true);
  check('다른 칸 실패 → 2', ids.size === 2);
  const same = updateFailedDraftIds(ids, 9101, true);
  check('같은 칸 다시 실패 → 그대로 2(같은 Set)', same === ids && same.size === 2);
  ids = updateFailedDraftIds(ids, 9101, false);
  check('저장 성공 → 제거', ids.size === 1 && !ids.has(9101));
  ids = updateFailedDraftIds(ids, 9102, isFailedDraft({ lastSaveFailed: true, isDirty: false }));
  check('초안이 서버값과 같아짐 → 제거', ids.size === 0);
  const unchanged = updateFailedDraftIds(ids, 9103, false);
  check('집계에 없는 칸 해제 → 같은 Set', unchanged === ids);
}

console.log('\n[3] 확인창 문구(PM 승인)');
{
  check('제목 N=1', failedDraftConfirmTitle(1) === '저장하지 못한 번역문이 1칸 있습니다.');
  check('제목 N=2', failedDraftConfirmTitle(2) === '저장하지 못한 번역문이 2칸 있습니다.');
  check('설명', FAILED_DRAFT_CONFIRM_DESCRIPTION === '계속하면 이 칸들은 마지막으로 저장된 문장으로 확정됩니다.');
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
