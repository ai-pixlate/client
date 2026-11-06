/**
 * G1 로그인 입력 검증 — 순수 계산(scripts/verify-auth-login.mjs 로 Node 에서 검증).
 * 비밀번호 정책은 서버 계약에 없어 빈 값만 막는다. 길이·조합 규칙을 만들지 않는다.
 */

export interface LoginFormErrors {
  email?: string;
  password?: string;
}

/** 형식 안내용 최소 검사. 계정 유무와 정확한 판정은 서버 응답을 따른다 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLoginForm(values: { email: string; password: string }): LoginFormErrors {
  const errors: LoginFormErrors = {};
  const email = values.email.trim();
  if (email === '') errors.email = '이메일을 입력해주세요.';
  else if (!EMAIL_PATTERN.test(email)) errors.email = '올바른 이메일 형식으로 입력해주세요.';
  if (values.password === '') errors.password = '비밀번호를 입력해주세요.';
  return errors;
}
