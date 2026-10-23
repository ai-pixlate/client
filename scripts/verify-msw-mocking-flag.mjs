/**
 * MSW on/off 기준 = NEXT_PUBLIC_API_MOCKING 하나(fix/msw-mocking-flag).
 *
 * lib/api/session.ts의 isApiMockingEnabled()는 React/브라우저 API를 쓰지
 * 않는 순수 함수라(scripts/verify-n3-verdict-contract.mjs와 같은 패턴) Node에서
 * 실제 함수를 그대로 import해 값 조합별 실제 반환값을 확인한다 — 이 함수가
 * app/providers.tsx(enableMocking)·lib/api/pixlate.ts(인증 처리) 양쪽의
 * SSOT이므로, 이 함수 하나의 동작만 보장하면 두 호출부도 함께 보장된다.
 *
 * app/providers.tsx의 enableMocking() 자체(JSX를 포함해 이 러너로 직접 import할
 * 수 없다)를 소스 텍스트 grep으로 검사하는 방식은 일부러 넣지 않았다 —
 * 함수를 리네임/화살표 함수로 바꾸는 무해한 리팩터에도 깨지고, 반대로
 * NODE_ENV를 다른 변수를 경유해 다시 들여와도 못 잡아내는 brittle한 검사라
 * "실제로 보장하지 못하는 걸 보장하는 것처럼" 보이는 게 더 위험하다고
 * 판단했다. enableMocking()이 실제로 이 함수를 쓰는지는 코드 리뷰 + 기존
 * e2e(basic-flow.spec.ts 등, NEXT_PUBLIC_API_MOCKING=enabled로 MSW가 실제로
 * 뜨는지)로 확인한다.
 *
 * 실행: npm run verify:msw-flag
 */

import { isApiMockingEnabled } from '../lib/api/session.ts';

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

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

console.log('\n[A] NEXT_PUBLIC_API_MOCKING=enabled → true (NODE_ENV와 무관)');
{
  check(
    "enabled + NODE_ENV=production → true",
    withEnv({ NEXT_PUBLIC_API_MOCKING: 'enabled', NODE_ENV: 'production' }, isApiMockingEnabled) === true,
  );
  check(
    "enabled + NODE_ENV=development → true",
    withEnv({ NEXT_PUBLIC_API_MOCKING: 'enabled', NODE_ENV: 'development' }, isApiMockingEnabled) === true,
  );
}

console.log('\n[B] 미설정/그 외 값 → false (NODE_ENV와 무관)');
{
  check(
    "미설정 + NODE_ENV=development → false",
    withEnv({ NEXT_PUBLIC_API_MOCKING: undefined, NODE_ENV: 'development' }, isApiMockingEnabled) === false,
  );
  check(
    "미설정 + NODE_ENV=production → false",
    withEnv({ NEXT_PUBLIC_API_MOCKING: undefined, NODE_ENV: 'production' }, isApiMockingEnabled) === false,
  );
  check(
    "'disabled' + NODE_ENV=production → false",
    withEnv({ NEXT_PUBLIC_API_MOCKING: 'disabled', NODE_ENV: 'production' }, isApiMockingEnabled) === false,
  );
}

console.log(`\n총 ${pass + fail}건 중 ${pass}건 통과, ${fail}건 실패`);
if (fail > 0) process.exit(1);
