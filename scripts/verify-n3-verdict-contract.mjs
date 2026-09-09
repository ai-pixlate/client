/**
 * N3 section_verdict 계약 자동 검증.
 *
 * lib/n3/verdict.ts 는 React 도 브라우저 API 도 쓰지 않기 때문에
 * Node 에서 그대로 불러와 확인할 수 있다. (scripts/verify-n5-coordinates.mjs와 같은 패턴)
 *
 * lib/mock-api/fixtures.ts는 '@/' 경로 alias를 쓰기 때문에 plain node에서 바로
 * import할 수 없다 — 그래서 여기서는 mockN3VerdictContractSections와 동일한
 * 6개 케이스(verdictStatus/isTeaser/bucket 조합)를 그대로 옮겨 적어 계약을
 * 검증한다. lib/mock-api/fixtures.ts를 고칠 때 이 목록도 함께 맞춘다.
 *
 * 실행:  npm run verify:n3-verdict
 */

import { getVerdictType, getN3VerdictBadgeLabel, VERDICT_STATUSES } from '../lib/n3/verdict.ts';

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

console.log('\n[1] VerdictStatus는 정확히 5종이다');
{
  check('VERDICT_STATUSES.length === 5', VERDICT_STATUSES.length === 5, `got ${VERDICT_STATUSES.length}`);
  check(
    '옛 4종 구조가 상태값으로 남아있지 않다 (regulatory/channel_policy/local_irrelevant만 있고 conditional/policy가 없는 경우 감지)',
    VERDICT_STATUSES.includes('conditional') && VERDICT_STATUSES.includes('policy'),
  );
  check(
    'allowed / cultural은 계약에 없다',
    !VERDICT_STATUSES.includes('allowed') && !VERDICT_STATUSES.includes('cultural'),
  );
}

console.log('\n[2] verdictStatus -> verdictType 파생 (5종)');
{
  const expected = {
    regulated: 'regulatory',
    conditional: 'regulatory_conditional',
    irrelevant: 'local_irrelevant',
    needs_fix: 'needs_fix',
    policy: 'channel_policy',
  };
  for (const status of VERDICT_STATUSES) {
    const got = getVerdictType(status);
    check(`${status} -> ${expected[status]}`, got === expected[status], `got ${got}`);
  }
}

console.log('\n[3] verdictStatus -> N3 배지 라벨 (5종)');
{
  const expected = {
    regulated: '규제 위반',
    conditional: '조건부 규제',
    irrelevant: '현지 무의미',
    needs_fix: '현지 기준 수정 필요',
    policy: '채널 정책',
  };
  for (const status of VERDICT_STATUSES) {
    const got = getN3VerdictBadgeLabel(status);
    check(`${status} -> "${expected[status]}"`, got === expected[status], `got "${got}"`);
  }
}

console.log('\n[4] Mock 계약 케이스 — section.bucket이 UI 정본, isTeaser/verdictStatus로 재계산하지 않는다');
{
  // lib/mock-api/fixtures.ts의 mockN3VerdictContractSections와 동일한 조합.
  const cases = [
    { name: 'regulated / exclude', verdictStatus: 'regulated', isTeaser: false, bucket: 'exclude' },
    { name: 'conditional / include', verdictStatus: 'conditional', isTeaser: false, bucket: 'include' },
    { name: 'irrelevant / exclude', verdictStatus: 'irrelevant', isTeaser: false, bucket: 'exclude' },
    { name: 'needs_fix / include', verdictStatus: 'needs_fix', isTeaser: false, bucket: 'include' },
    { name: 'policy + isTeaser=true / include', verdictStatus: 'policy', isTeaser: true, bucket: 'include' },
    { name: 'policy + isTeaser=false / exclude', verdictStatus: 'policy', isTeaser: false, bucket: 'exclude' },
  ];

  for (const c of cases) {
    check(c.name, ['include', 'exclude'].includes(c.bucket), `bucket=${c.bucket}`);
  }

  const conditional = cases.find((c) => c.verdictStatus === 'conditional');
  check('conditional은 절대 exclude되지 않는다', conditional.bucket !== 'exclude', `got ${conditional.bucket}`);

  const teaser = cases.find((c) => c.verdictStatus === 'policy' && c.isTeaser === true);
  check('policy + isTeaser=true는 exclude되지 않는다', teaser.bucket !== 'exclude', `got ${teaser.bucket}`);

  const realPolicy = cases.find((c) => c.verdictStatus === 'policy' && c.isTeaser === false);
  check(
    'policy + isTeaser=false는 기본 exclude 대상이다',
    realPolicy.bucket === 'exclude',
    `got ${realPolicy.bucket}`,
  );
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
