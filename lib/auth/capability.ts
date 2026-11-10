import { isApiMockingEnabled } from '../api/session.ts';

/**
 * 인증 기능 gate. lib/n5/layout-adjust-capability.ts 와 같은 방식으로 Mock(MSW)에서만 새 흐름을 켜고,
 * 실서버(API 모드)에서는 아직 구현·배포되지 않은 endpoint 를 부르지 않는다. 판단은 이 파일 한 곳이다.
 * 기능 여부를 알아내려고 endpoint 를 시험 호출하지 않는다.
 */

/**
 * 'session'   = 메모리 access + 401 → refresh(single-flight·탭 잠금) → /auth/me → 원 요청 1회 재시도
 * 'dev-login' = 기존 개발용 이메일 간이 로그인(/auth/login)으로 받고, 401 이면 다시 간이 로그인. access 는 메모리에만 둔다
 *
 * TODO(AUTH-CONTRACT): server#124(세션·refresh 회전) 배포와 소셜 로그인 서버 구현이 끝나면 실서버도 'session' 으로 바꾸고
 * 개발용 간이 로그인(lib/api/session.ts ensureBackendSession)을 제거한다.
 */
export type AuthMode = 'session' | 'dev-login';

export function getAuthMode(): AuthMode {
  return isApiMockingEnabled() ? 'session' : 'dev-login';
}

/**
 * G1 소셜 로그인 버튼·콜백 완료 요청 허용 여부.
 * TODO(AUTH-CONTRACT): 실제 카카오·Google OAuth 서버(POST /auth/social/{provider}/start, POST /auth/social)가 배포되면 실서버도 연다.
 */
export function isSocialLoginEnabled(): boolean {
  return isApiMockingEnabled();
}

/**
 * 앱 진입 때 「서버 로그아웃 미완료」 기록이 있으면 로그아웃을 다시 보내는 동작.
 * TODO(AUTH-CONTRACT): confirm cookie-only logout contract with BE — access 없이 쿠키만으로 로그아웃되는지 확정 전에는 켜지 않는다.
 * TODO(AUTH-CONTRACT): BE to decide no-session logout = 204 vs 401
 */
export function isLogoutPendingRetryEnabled(): boolean {
  return false;
}
