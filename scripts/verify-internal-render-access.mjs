/**
 * 내부 렌더 경로 접근 판정(lib/internal-render/access.ts) 검증 — 순수 함수.
 * 실제 서버 응답(proxy 404·page 200)은 scripts/verify-internal-render-route.mjs 가 production 빌드로 확인한다.
 *
 * 실행: npm run verify:internal-render-access
 */

import { isInternalRenderRequestAllowed, INTERNAL_RENDER_TOKEN_HEADER, ALB_TRACE_HEADER } from '../lib/internal-render/access.ts';

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

const TOKEN = 'verify-token-0123456789';
const h = (entries) => new Headers(entries);

console.log('\n[1] 토큰 판정');
check('정상 토큰 → 허용', isInternalRenderRequestAllowed(h({ [INTERNAL_RENDER_TOKEN_HEADER]: TOKEN }), TOKEN));
check('토큰 없음 → 거부', !isInternalRenderRequestAllowed(h({}), TOKEN));
check('빈 토큰 헤더 → 거부', !isInternalRenderRequestAllowed(h({ [INTERNAL_RENDER_TOKEN_HEADER]: '' }), TOKEN));
check('틀린 토큰(같은 길이) → 거부', !isInternalRenderRequestAllowed(h({ [INTERNAL_RENDER_TOKEN_HEADER]: TOKEN.replace(/9$/, '8') }), TOKEN));
check('틀린 토큰(접두어) → 거부', !isInternalRenderRequestAllowed(h({ [INTERNAL_RENDER_TOKEN_HEADER]: TOKEN.slice(0, -1) }), TOKEN));
check('헤더 이름 대소문자 무관', isInternalRenderRequestAllowed(h({ 'X-Pixlate-Internal-Render': TOKEN }), TOKEN));

console.log('\n[2] env 없음');
check('env undefined → 거부', !isInternalRenderRequestAllowed(h({ [INTERNAL_RENDER_TOKEN_HEADER]: TOKEN }), undefined));
check('env 빈 문자열 → 거부(빈 헤더와 일치시키지 않는다)', !isInternalRenderRequestAllowed(h({ [INTERNAL_RENDER_TOKEN_HEADER]: '' }), ''));

console.log('\n[3] ALB 경유 차단');
check(
  '정상 토큰 + X-Amzn-Trace-Id → 거부',
  !isInternalRenderRequestAllowed(h({ [INTERNAL_RENDER_TOKEN_HEADER]: TOKEN, [ALB_TRACE_HEADER]: 'Root=1-abc' }), TOKEN),
);
check(
  '정상 토큰 + 빈 X-Amzn-Trace-Id → 거부(존재만으로 차단)',
  !isInternalRenderRequestAllowed(h({ [INTERNAL_RENDER_TOKEN_HEADER]: TOKEN, [ALB_TRACE_HEADER]: '' }), TOKEN),
);

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
