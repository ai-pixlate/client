import { postAuthLogout } from '../api/auth.ts';
import { AUTH_LOGOUT_INVALID_TOKEN_MAX_RETRIES } from './constants.ts';
import { clearLogoutPending, isLogoutPending, markLogoutPending } from './logout-pending.ts';
import { endSessionLocally, getAuthChannel } from './runtime.ts';
import { getAccessToken, setAuthNotice } from './session-store.ts';
import type { AuthApiResult, AuthErrorInfo } from './types.ts';

/**
 * 로그아웃 전용 처리. 일반 API 의 401 → refresh → 재시도 경로를 쓰지 않는다(logout 401 → refresh → logout … 재귀 방지).
 * 로그아웃 전에 refresh 하지 않고, 메모리에 있는 access 를 만료 여부와 상관없이 그대로 Bearer 로 보낸다.
 * 서버 결과와 상관없이 화면은 로그아웃하고 모든 탭을 G1 로 보낸다(FE 로그아웃 ≠ 서버 세션 폐기 확인).
 *
 *   204                                        → 완료(서버 로그아웃 확인). 정상 종료·이미 끝난 세션·쿠키만으로 종료 모두 204
 *   401 invalid_token(Bearer 를 보냈을 때)     → Authorization 없이 쿠키만으로 정확히 1회 다시 보냄
 *   401 UNAUTHORIZED + refresh_invalid         → 쿠키 자체를 검증할 수 없음(서버가 쿠키 삭제). 대기 해제·추가 요청 없음.
 *                                                서버 세션 폐기는 확인되지 않음(serverConfirmed=false)
 *   401 origin_not_allowed · 422 · 503 · 그 밖 → 서버 로그아웃 미완료 → logout pending 유지. 자동 반복 없음
 *
 * 횟수·시간으로 대기를 끝내지 않는다 — 끝내는 근거는 204 와 refresh_invalid 계약뿐이다.
 * refresh_invalid 계약은 FE↔BE 최신 합의다(server#124 명세에는 아직 「미결」로 남아 있다 — 반영 대기).
 */
export type LogoutResult =
  | { kind: 'done'; serverConfirmed: true }
  /** refresh 쿠키를 쓸 수 없게 됐지만 서버 세션 폐기는 확인하지 못함 */
  | { kind: 'done'; serverConfirmed: false; reason: 'refresh_invalid' }
  | { kind: 'pending'; error: AuthErrorInfo };

export interface LogoutDeps {
  logout: (options: { accessToken?: string | null }) => Promise<AuthApiResult<true>>;
}

const defaultDeps: LogoutDeps = { logout: postAuthLogout };

function isInvalidToken(error: AuthErrorInfo): boolean {
  return error.status === 401 && error.reason === 'invalid_token';
}

/** 계약: error.code === 'UNAUTHORIZED' && error.details.reason === 'refresh_invalid' */
function isRefreshInvalid(error: AuthErrorInfo): boolean {
  return error.status === 401 && error.code === 'UNAUTHORIZED' && error.reason === 'refresh_invalid';
}

/** 서버에 로그아웃을 보낸다(화면 상태는 바꾸지 않는다) */
export async function requestServerLogout(accessToken: string | null, deps: LogoutDeps = defaultDeps): Promise<LogoutResult> {
  let sentBearer = Boolean(accessToken);
  let result = await deps.logout({ accessToken });
  for (let retry = 0; !result.ok && sentBearer && isInvalidToken(result.error) && retry < AUTH_LOGOUT_INVALID_TOKEN_MAX_RETRIES; retry += 1) {
    sentBearer = false;
    result = await deps.logout({});
  }
  if (result.ok) return { kind: 'done', serverConfirmed: true };
  if (isRefreshInvalid(result.error)) return { kind: 'done', serverConfirmed: false, reason: 'refresh_invalid' };
  return { kind: 'pending', error: result.error };
}

function recordResult(result: LogoutResult): void {
  if (result.kind === 'done') clearLogoutPending();
  else markLogoutPending();
}

let inflight: Promise<LogoutResult> | null = null;

/** 사용자가 로그아웃을 눌렀을 때. 두 번 눌러도 요청은 하나다 */
export function logout(deps: LogoutDeps = defaultDeps): Promise<LogoutResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    const result = await requestServerLogout(getAccessToken(), deps);
    recordResult(result);
    endSessionLocally();
    getAuthChannel().post({ type: 'logout' });
    if (result.kind === 'pending') setAuthNotice('logout-pending');
    return result;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * 「서버 로그아웃 미완료」를 다시 보낸다([다시 시도] 또는 앱 진입). 화면은 이미 로그아웃 상태라 access 없이 쿠키만으로 보낸다.
 * 성공(204)·refresh_invalid 면 대기를 끝내고, 그 밖이면 대기를 유지한다(자동 반복 없음).
 */
export async function retryPendingLogout(deps: LogoutDeps = defaultDeps): Promise<LogoutResult> {
  const result = await requestServerLogout(null, deps);
  recordResult(result);
  return result;
}

let resumeInflight: Promise<LogoutResult> | null = null;

/**
 * 앱 진입 때 — 대기 기록이 있으면 세션 복원보다 로그아웃 재시도를 먼저 한다. 결과와 상관없이 이 탭은 로그아웃 상태로 G1 에 둔다.
 * 대기 기록이 없으면 null(정상 세션 복원 진행).
 */
export function resumePendingLogout(deps: LogoutDeps = defaultDeps): Promise<LogoutResult | null> {
  if (!isLogoutPending()) return Promise.resolve(null);
  // 앱 진입 effect 가 두 번 실행돼도(React Strict Mode) 요청은 하나다
  resumeInflight ??= (async () => {
    const result = await retryPendingLogout(deps);
    endSessionLocally();
    if (result.kind === 'done') getAuthChannel().post({ type: 'logout' });
    else setAuthNotice('logout-pending');
    return result;
  })().finally(() => {
    resumeInflight = null;
  });
  return resumeInflight;
}
