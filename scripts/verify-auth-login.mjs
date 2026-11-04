/**
 * G1 로그인 입력 검증과 POST /auth/login 호출 계약 순수 검증(fetch 를 대체해 실행, 브라우저 불필요).
 *
 * 실행: npm run verify:auth-login
 */

import { loginWithEmail } from '../lib/api/auth.ts';
import { validateLoginForm } from '../lib/auth/login-form.ts';

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

console.log('\n[1] 입력 검증');
const ok = { email: 'seller@example.com', password: 'x' };
check('정상 → 오류 없음', Object.keys(validateLoginForm(ok)).length === 0);
check('이메일 빈 값', validateLoginForm({ ...ok, email: '' }).email === '이메일을 입력해주세요.');
check('이메일 공백만 → 빈 값', validateLoginForm({ ...ok, email: '   ' }).email === '이메일을 입력해주세요.');
for (const email of ['seller', 'seller@', '@example.com', 'seller@example', 'sel ler@example.com', 'a@b@c.com']) {
  check(`형식 오류: ${email}`, validateLoginForm({ ...ok, email }).email === '올바른 이메일 형식으로 입력해주세요.');
}
check('앞뒤 공백은 형식 오류로 보지 않음', validateLoginForm({ ...ok, email: ' seller@example.com ' }).email === undefined);
check('비밀번호 빈 값', validateLoginForm({ ...ok, password: '' }).password === '비밀번호를 입력해주세요.');
check('비밀번호 한 글자·공백도 통과(정책 없음)', !validateLoginForm({ ...ok, password: 'a' }).password && !validateLoginForm({ ...ok, password: ' ' }).password);
const both = validateLoginForm({ email: '', password: '' });
check('두 필드 동시 오류', both.email && both.password);

console.log('\n[2] POST /auth/login 호출');
const realFetch = globalThis.fetch;
function stub(response) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return calls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const seller = { id: 1, email: 'seller@example.com' };
const calls = stub(json({ accessToken: 'secret-token', seller }));
const success = await loginWithEmail({ email: 'seller@example.com', password: 'pw' });
check('경로·메서드', calls[0].url === '/auth/login' && calls[0].init.method === 'POST');
check('credentials include', calls[0].init.credentials === 'include');
check('body 는 email·password 만', JSON.stringify(JSON.parse(calls[0].init.body)) === JSON.stringify({ email: 'seller@example.com', password: 'pw' }));
check('성공 → seller 전달', success.ok && success.seller.id === 1);
check('accessToken 을 호출자에게 넘기지 않음', !JSON.stringify(success).includes('secret-token'));

stub(json({ error: { code: 'UNAUTHORIZED', message: 'x', retryable: false, traceId: 't' } }, 401));
check('401 → invalid-credentials', (await loginWithEmail(ok)).kind === 'invalid-credentials');
stub(json({ error: { code: 'VALIDATION_ERROR', message: 'x', retryable: false, traceId: 't' } }, 400));
check('400 → invalid-request', (await loginWithEmail(ok)).kind === 'invalid-request');
stub(json({ error: { code: 'INTERNAL', message: 'x', retryable: true, traceId: 't' } }, 500));
check('500 → unavailable', (await loginWithEmail(ok)).kind === 'unavailable');
stub(new TypeError('network'));
check('네트워크 오류 → unavailable', (await loginWithEmail(ok)).kind === 'unavailable');
stub(json({ seller }));
check('200 인데 accessToken 없음 → 성공 처리하지 않음', (await loginWithEmail(ok)).ok === false);
stub(new Response('not json', { status: 200 }));
check('200 인데 JSON 아님 → 성공 처리하지 않음', (await loginWithEmail(ok)).ok === false);
globalThis.fetch = realFetch;

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
