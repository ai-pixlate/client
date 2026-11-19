import type { AuthErrorInfo } from './types.ts';

/**
 * 인증 API 오류 해석. 공통 Error `{ error: { code, message, retryable, details?, traceId } }` 에서 code 와 details.reason 만 꺼낸다.
 * reason 이름은 server release/1.1.0 OpenAPI(v3.5.10)의 authRefresh·authLogout·authSocialStart·authSocial 정의를 따른다.
 */
export function readAuthError(status: number, body: unknown): AuthErrorInfo {
  const error = body && typeof body === 'object' ? (body as { error?: { code?: unknown; details?: { reason?: unknown } | null } }).error : undefined;
  return {
    status,
    code: typeof error?.code === 'string' ? error.code : null,
    reason: typeof error?.details?.reason === 'string' ? error.details.reason : null,
  };
}

export const NETWORK_ERROR: AuthErrorInfo = { status: 0, code: null, reason: null };

/**
 * refresh 실패 분류.
 * - account-not-allowed: 401 + account_not_allowed — 허용 목록 밖 계정. 서버는 그 세션을 폐기하고 새 Set-Cookie 를 보내지 않는다
 *   (거절 응답이라 쿠키를 지우지도 않는다 — 브라우저에 남은 같은 쿠키로 다시 refresh 하면 refresh_invalid). →
 *   다시 refresh 하지 않고 인증 상태를 지운 뒤 G1 에서 「허용되지 않은 계정입니다」(일반 토큰 오류가 아니다)
 * - rotated: 직전 refresh 가 30초 안에 다시 옴. 서버 세션은 살아 있다 → 다른 탭 완료를 기다려 다시 시도
 * - session-ended: refresh_reused·refresh_invalid, 판매자 없음(404). 세션이 끝났다 → G1
 * - unavailable: 503·네트워크·5xx. 세션 만료가 아니다 → 상태를 지우지 않고 자동 반복만 멈춘다
 * - failed: origin_not_allowed·422 등 설정·요청 오류. 자동 재시도하지 않고 세션도 지우지 않는다
 * reason 없는 401 은 쿠키가 없거나 이전 서버(무상태 refresh)의 거절이라 세션 종료로 본다.
 */
export type RefreshFailureKind = 'account-not-allowed' | 'rotated' | 'session-ended' | 'unavailable' | 'failed';

export function classifyRefreshFailure(error: AuthErrorInfo): RefreshFailureKind {
  if (error.status === 0 || error.status >= 500) return 'unavailable';
  if (error.status === 401) {
    if (error.reason === 'account_not_allowed') return 'account-not-allowed';
    if (error.reason === 'refresh_rotated') return 'rotated';
    if (error.reason === 'origin_not_allowed') return 'failed';
    return 'session-ended';
  }
  if (error.status === 404) return 'session-ended';
  return 'failed';
}

/** 소셜 로그인 시작(POST /auth/social/{provider}/start) 실패 분류 */
export type SocialStartFailureKind = 'not-available' | 'unavailable' | 'failed';

export function classifySocialStartFailure(error: AuthErrorInfo): SocialStartFailureKind {
  // 404 = 지원하지 않는 제공자 또는 OAuth 미설정·배포 전
  if (error.status === 404) return 'not-available';
  if (error.status === 0 || error.status >= 500) return 'unavailable';
  // 401 origin_not_allowed 를 포함한 나머지는 일반 오류. 자동 재시도하지 않는다
  return 'failed';
}

/**
 * 소셜 로그인 완료(POST /auth/social) 실패 분류. HTTP 상태는 아직 확정 전이라 reason 으로 먼저 나눈다.
 * in-progress(409 DUPLICATE + login_in_progress)는 BE 후보 계약이다. 같은 document 안의 중복은 요청 전에 막으므로(social-login.ts)
 * 이 응답은 새로고침 등 다른 document 가 같은 시도를 다시 보냈을 때만 온다 — 먼저 시작된 요청의 결과를 받을 계약이 없어 다시 로그인하도록 안내한다.
 */
export type SocialCompleteFailureKind =
  | 'account-not-allowed'
  | 'state-invalid'
  | 'provider-auth-failed'
  | 'provider-unavailable'
  | 'in-progress'
  | 'unavailable'
  | 'failed';

export function classifySocialCompleteFailure(error: AuthErrorInfo): SocialCompleteFailureKind {
  // 401 + account_not_allowed — 허용 목록 밖 계정. 서버는 계정·세션을 만들지 않았다(provider_auth_failed 와 구분)
  if (error.status === 401 && error.reason === 'account_not_allowed') return 'account-not-allowed';
  if (error.reason === 'state_invalid') return 'state-invalid';
  if (error.reason === 'provider_auth_failed') return 'provider-auth-failed';
  if (error.reason === 'provider_unavailable') return 'provider-unavailable';
  // TODO(AUTH-CONTRACT): 409 DUPLICATE login_in_progress 는 BE 후보 계약 — 최종 명세 반영 후 확인
  if (error.status === 409 && error.code === 'DUPLICATE' && error.reason === 'login_in_progress') return 'in-progress';
  if (error.status === 0 || error.status >= 500) return 'unavailable';
  return 'failed';
}

/** 소셜 로그인 오류 문구. 제공자·state 문제는 같은 시도로 되살릴 수 없어 처음부터 다시 로그인하도록 안내한다 */
export type SocialLoginErrorKind = SocialStartFailureKind | SocialCompleteFailureKind | 'cancelled' | 'callback-unconfirmed';

export function socialLoginErrorMessage(kind: SocialLoginErrorKind): string {
  switch (kind) {
    case 'account-not-allowed':
      return '허용되지 않은 계정입니다';
    case 'callback-unconfirmed':
      return '로그인 완료 여부를 확인할 수 없습니다. 다시 로그인해 주세요.';
    case 'not-available':
      return '지금은 이 방법으로 로그인할 수 없습니다.';
    case 'unavailable':
    case 'provider-unavailable':
      return '일시적으로 로그인할 수 없습니다. 처음부터 다시 로그인해 주세요.';
    case 'state-invalid':
    case 'provider-auth-failed':
    case 'in-progress':
    case 'cancelled':
      return '로그인을 완료하지 못했습니다. 처음부터 다시 로그인해 주세요.';
    case 'failed':
    default:
      return '로그인 중 문제가 생겼습니다. 다시 시도해 주세요.';
  }
}
