/**
 * 인증 세션 공통 상수. FE↔BE 인증 합의(server#124 「로그인 세션」)의 FE 쪽 수치를 한곳에 둔다.
 * server#124 는 대기 2초·refresh 최대 2회·원 요청 1회를 「FE 제안 수치」로 적어 두었다 — 바뀌면 여기만 고친다.
 */

/** refresh_rotated 를 받은 뒤 다른 탭의 refresh-complete 알림을 기다리는 최대 시간 */
export const AUTH_REFRESH_EVENT_WAIT_MS = 2000;
/** 탭 사이 refresh 잠금을 기다리는 최대 시간. 넘으면 자동 복구를 멈추고 일시 오류로 돌려준다 */
export const AUTH_REFRESH_LOCK_WAIT_MS = 10000;
/** 한 번의 인증 복구(사건)에서 보내는 refresh 요청 상한 */
export const AUTH_REFRESH_MAX_ATTEMPTS = 2;
/** 401 로 중단된 원 요청을 다시 보내는 상한 */
export const AUTH_ORIGINAL_REQUEST_MAX_RETRIES = 1;
/** 로그아웃 401 invalid_token 뒤 Authorization 없이 다시 보내는 상한 */
export const AUTH_LOGOUT_INVALID_TOKEN_MAX_RETRIES = 1;

/** /auth/refresh·/auth/logout·소셜 인증 요청의 CSRF 헤더 */
export const AUTH_CSRF_HEADER = 'X-Requested-With';
export const AUTH_CSRF_VALUE = 'XMLHttpRequest';

/** 탭 사이 인증 알림 채널. 토큰은 절대 싣지 않는다(lib/auth/cross-tab.ts) */
export const AUTH_CHANNEL_NAME = 'pixlate-auth';
/** 탭 사이 refresh 잠금 이름(Web Locks) */
export const AUTH_REFRESH_LOCK_NAME = 'pixlate-auth-refresh';

/** 서버 로그아웃이 끝나지 않았다는 표시. 값은 '1' 하나뿐이고 토큰·계정 정보는 저장하지 않는다 */
export const AUTH_LOGOUT_PENDING_KEY = 'pixlate:auth:logout-pending';

/** 합의된 소셜 제공자. 임의로 늘리지 않는다 */
export const SOCIAL_PROVIDERS = ['kakao', 'google'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProvider(value: unknown): value is SocialProvider {
  return typeof value === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/** G1 로그인 화면 */
export const AUTH_LOGIN_PATH = '/login';
/** 2차 로그인 후 이동 — 신규·기존 계정 모두 M1 보관함 */
export const AUTH_HOME_PATH = '/';
/** 소셜 제공자가 돌려보내는 경로 /login/callback/{provider} */
export const AUTH_CALLBACK_PATH_PREFIX = '/login/callback/';
