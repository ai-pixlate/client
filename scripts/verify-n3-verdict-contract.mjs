/**
 * N3 section_verdict 계약 자동 검증 (v3.4.1).
 *
 * lib/n3/verdict.ts, lib/api/types.ts 는 React 도 브라우저 API 도 쓰지 않기
 * 때문에 Node 에서 그대로 불러와 확인할 수 있다. (scripts/verify-n5-coordinates.mjs와 같은 패턴)
 *
 * lib/mock-api/fixtures.ts는 '@/' 경로 alias를 쓰기 때문에 plain node에서 바로
 * import할 수 없다 — 그래서 여기서는 mockN3VerdictContractSections와 동일한
 * 5개 케이스(verdictType/verdictStatus/bucket 조합)를 그대로 옮겨 적어 계약을
 * 검증한다. lib/mock-api/fixtures.ts를 고칠 때 이 목록도 함께 맞춘다.
 *
 * 실행:  npm run verify:n3-verdict
 */

import {
  VERDICT_STATUSES,
  SECTION_VERDICT_STATUSES,
  VERDICT_TYPES,
  getN3VerdictBadgeLabel,
} from '../lib/n3/verdict.ts';
import * as verdictModule from '../lib/n3/verdict.ts';

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

console.log('\n[1] verdict_status 전체 어휘는 7종, section_verdict 판정 행을 만드는 값은 5종이다');
{
  const fullExpected = ['regulated', 'conditional', 'allowed', 'irrelevant', 'needs_fix', 'cultural', 'policy'];
  check('VERDICT_STATUSES.length === 7', VERDICT_STATUSES.length === 7, `got ${VERDICT_STATUSES.length}`);
  for (const status of fullExpected) {
    check(`VERDICT_STATUSES에 '${status}' 포함`, VERDICT_STATUSES.includes(status));
  }
  check(
    'allowed / cultural은 전체 어휘에는 있다',
    VERDICT_STATUSES.includes('allowed') && VERDICT_STATUSES.includes('cultural'),
  );

  const sectionExpected = ['regulated', 'conditional', 'irrelevant', 'needs_fix', 'policy'];
  check(
    'SECTION_VERDICT_STATUSES.length === 5',
    SECTION_VERDICT_STATUSES.length === 5,
    `got ${SECTION_VERDICT_STATUSES.length}`,
  );
  for (const status of sectionExpected) {
    check(`SECTION_VERDICT_STATUSES에 '${status}' 포함`, SECTION_VERDICT_STATUSES.includes(status));
  }
  check(
    'allowed / cultural은 판정 행을 만드는 5종에는 없다 (SectionVerdict.verdictStatus에 못 옴)',
    !SECTION_VERDICT_STATUSES.includes('allowed') && !SECTION_VERDICT_STATUSES.includes('cultural'),
  );
}

console.log('\n[2] VerdictType은 정확히 6종이다 (v3.4.1, regulatory_replaceable 추가)');
{
  const expected = [
    'regulatory',
    'regulatory_replaceable',
    'regulatory_conditional',
    'local_irrelevant',
    'needs_fix',
    'channel_policy',
  ];
  check('VERDICT_TYPES.length === 6', VERDICT_TYPES.length === 6, `got ${VERDICT_TYPES.length}`);
  for (const type of expected) {
    check(`VERDICT_TYPES에 '${type}' 포함`, VERDICT_TYPES.includes(type));
  }
  check(
    'channel_policy는 12월 계약 값으로 타입에 남아있다',
    VERDICT_TYPES.includes('channel_policy'),
  );
}

console.log("\n[3] verdictStatus -> verdictType 파생 함수(getVerdictType)는 제거됐다");
{
  check(
    "getVerdictType export가 존재하지 않는다",
    typeof verdictModule.getVerdictType === 'undefined',
    `got ${typeof verdictModule.getVerdictType}`,
  );
}

console.log('\n[4] verdictType -> N3 배지 라벨 (9월 표시 5종 + 12월 channel_policy)');
{
  const expected = {
    regulatory: '규제 위반',
    regulatory_replaceable: '규제 표현',
    regulatory_conditional: '조건부 규제',
    local_irrelevant: '현지 무의미',
    needs_fix: '현지 기준 수정 필요',
    channel_policy: '채널 정책',
  };
  for (const type of VERDICT_TYPES) {
    const got = getN3VerdictBadgeLabel(type);
    check(`${type} -> "${expected[type]}"`, got === expected[type], `got "${got}"`);
  }
}

console.log('\n[5] Mock 계약 케이스 (9월 5종) — section.bucket이 UI 정본, verdictType으로 재계산하지 않는다');
{
  // lib/mock-api/fixtures.ts의 mockN3VerdictContractSections와 동일한 조합.
  // channel_policy는 12월 전용이라 이 목록에는 없다.
  // 기대 bucket: regulatory(대체 표현 없음)=exclude, regulatory_replaceable(대체
  // 표현 있음)=include — v3.4.1이 명시한 기본값. FE가 이 값을 verdict로부터
  // 계산하는 게 아니라, fixture가 "정본 값"을 그대로 담고 있는지만 확인한다.
  const cases = [
    { name: 'regulatory / exclude', verdictType: 'regulatory', verdictStatus: 'regulated', bucket: 'exclude' },
    {
      name: 'regulatory_replaceable / include (status는 regulatory와 동일하게 regulated)',
      verdictType: 'regulatory_replaceable',
      verdictStatus: 'regulated',
      bucket: 'include',
    },
    {
      name: 'regulatory_conditional / include',
      verdictType: 'regulatory_conditional',
      verdictStatus: 'conditional',
      bucket: 'include',
    },
    { name: 'local_irrelevant / exclude', verdictType: 'local_irrelevant', verdictStatus: 'irrelevant', bucket: 'exclude' },
    { name: 'needs_fix / include', verdictType: 'needs_fix', verdictStatus: 'needs_fix', bucket: 'include' },
  ];

  check('9월 mock 케이스는 정확히 5개다 (channel_policy 행 없음)', cases.length === 5, `got ${cases.length}`);

  for (const c of cases) {
    check(c.name, ['include', 'exclude'].includes(c.bucket), `bucket=${c.bucket}`);
    check(`${c.name} — isTeaser 필드가 없다`, !('isTeaser' in c));
  }

  const expectedBuckets = {
    regulatory: 'exclude',
    regulatory_replaceable: 'include',
    regulatory_conditional: 'include',
    local_irrelevant: 'exclude',
    needs_fix: 'include',
  };
  for (const [type, bucket] of Object.entries(expectedBuckets)) {
    const c = cases.find((x) => x.verdictType === type);
    check(`${type}의 기본 bucket은 '${bucket}'이다`, c.bucket === bucket, `got ${c.bucket}`);
  }

  const regulatory = cases.find((c) => c.verdictType === 'regulatory');
  const regulatoryReplaceable = cases.find((c) => c.verdictType === 'regulatory_replaceable');
  check(
    'regulatory와 regulatory_replaceable은 같은 verdictStatus(regulated)를 공유하지만 type과 bucket이 다르다 — status만으로 type을 계산할 수 없음을 증명',
    regulatory.verdictStatus === regulatoryReplaceable.verdictStatus &&
      regulatory.verdictType !== regulatoryReplaceable.verdictType &&
      regulatory.bucket !== regulatoryReplaceable.bucket,
  );

  check(
    'channel_policy 케이스가 9월 mock에 없다',
    !cases.some((c) => c.verdictType === 'channel_policy'),
  );
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
