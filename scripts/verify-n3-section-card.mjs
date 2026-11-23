/**
 * N3 섹션 카드 상태(lib/n3/section-card-state.ts) 검증.
 *
 * mock의 PATCH는 exclusionReason을 비우므로 직접 제외·직접 되살림은 E2E로 만들 수 없다 —
 * 계약 enum 값으로 상태 규칙만 여기서 본다.
 *
 * 실행:  node --experimental-strip-types scripts/verify-n3-section-card.mjs
 */

import { formatN3SectionTitle, getN3SectionCardState } from '../lib/n3/section-card-state.ts';

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

const cases = [
  ['포함', { bucket: 'include', exclusionReason: null }, 'include', '번역 예정', '제외하기', 'exclude'],
  ['직접 되살림', { bucket: 'include', exclusionReason: 'restored_by_user' }, 'restored', '직접 되살림', '제외하기', 'exclude'],
  ['자동 제외(규제)', { bucket: 'exclude', exclusionReason: 'auto_regulatory' }, 'autoExcluded', null, '그래도 번역하기', 'include'],
  ['자동 제외(채널)', { bucket: 'exclude', exclusionReason: 'auto_channel' }, 'autoExcluded', null, '그래도 번역하기', 'include'],
  ['자동 제외(현지)', { bucket: 'exclude', exclusionReason: 'auto_local' }, 'autoExcluded', null, '그래도 번역하기', 'include'],
  ['판정 실패 제외', { bucket: 'exclude', exclusionReason: 'auto_local_failed' }, 'autoExcluded', null, '그래도 번역하기', 'include'],
  ['직접 제외', { bucket: 'exclude', exclusionReason: 'user_manual' }, 'manualExcluded', '직접 제외', '번역하기', 'include'],
  ['제외 + 사유 없음(단정하지 않음)', { bucket: 'exclude', exclusionReason: null }, 'excluded', null, '번역하기', 'include'],
];

console.log('\n[1] bucket + exclusionReason → 카드 상태');
for (const [label, section, kind, chip, actionLabel, targetBucket] of cases) {
  const s = getN3SectionCardState(section);
  check(
    label,
    s.kind === kind && s.chip === chip && s.actionLabel === actionLabel && s.targetBucket === targetBucket,
    JSON.stringify(s),
  );
}

console.log('\n[2] 제목 형식');
check('1 → SECTION 01', formatN3SectionTitle(1) === 'SECTION 01');
check('12 → SECTION 12', formatN3SectionTitle(12) === 'SECTION 12');

console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
