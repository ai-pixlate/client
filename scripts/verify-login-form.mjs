/**
 * G1 로그인 입력 검증과 개발용 자동 로그인 제외 경로 순수 함수 검증.
 *
 * 실행: npm run verify:login-form
 */

import { shouldBootstrapBackendSession } from '../lib/api/session.ts';
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
check('비밀번호 정책 없음(한 글자·공백 통과)', !validateLoginForm({ ...ok, password: 'a' }).password && !validateLoginForm({ ...ok, password: ' ' }).password);
const both = validateLoginForm({ email: '', password: '' });
check('두 필드 동시 오류', both.email && both.password);

console.log('\n[2] 개발용 자동 로그인 제외 경로');
check('/login 만 제외', shouldBootstrapBackendSession('/login') === false);
for (const path of ['/', '/brand', '/jobs/new', '/jobs/1', '/login-help']) {
  check(`${path} 는 유지`, shouldBootstrapBackendSession(path) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
