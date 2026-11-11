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

/**
 * 로컬 개발 전용 실서버 인증 스위치. `next dev`(NODE_ENV=development)에서 NEXT_PUBLIC_AUTH_MODE=session 일 때만 켜져
 * 실서버(API 모드)에서도 Mock 과 같은 'session'·소셜 로그인·logoutPending 재시도 흐름을 쓴다. BE 와 실제 브라우저 소셜 로그인
 * 연동 시험용이다. production build 에서는 값이 있어도 무시한다. process.env 는 빌드 때 인라인되도록 직접 참조한다.
 */
export function isLocalSessionAuthEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_AUTH_MODE === 'session';
}

export function getAuthMode(): AuthMode {
  return isApiMockingEnabled() || isLocalSessionAuthEnabled() ? 'session' : 'dev-login';
}

/**
 * G1 소셜 로그인 버튼·콜백 완료 요청 허용 여부.
 * TODO(AUTH-CONTRACT): 실제 카카오·Google OAuth 서버(POST /auth/social/{provider}/start, POST /auth/social)가 배포되면 실서버도 연다.
 */
export function isSocialLoginEnabled(): boolean {
  return isApiMockingEnabled() || isLocalSessionAuthEnabled();
}

/**
 * 앱 진입 때 「서버 로그아웃 미완료」 기록이 있으면 로그인 복원보다 로그아웃(쿠키만)을 먼저 다시 보내는 동작.
 * 계약(쿠키만으로 로그아웃 204·끝낼 세션 없음 204·검증 불가 쿠키 refresh_invalid)은 확정됐다. 서버 세션 방식('session')에서만 켠다.
 * TODO(AUTH-CONTRACT): server#124 최신 로그아웃 계약 배포 뒤 실서버가 'session' 모드로 바뀌면 함께 켜진다.
 */
export function isLogoutPendingRetryEnabled(): boolean {
  return getAuthMode() === 'session';
}

/**
 * 로컬 실서버 인증 연동 시험 모드 — `next dev` + NEXT_PUBLIC_AUTH_MODE=session + Mock(MSW) 꺼짐.
 * BE 와 실제 브라우저로 인증 계약을 시험할 때만 쓰는 임시 진입점(M1 임시 로그아웃 버튼)의 노출 기준이다.
 * 일반 Mock 개발 환경·production build 에서는 false. 정식 로그아웃 UX 위치는 별도 디자인 확정 대상이다.
 */
export function isLocalAuthTestMode(): boolean {
  return isLocalSessionAuthEnabled() && !isApiMockingEnabled();
}
