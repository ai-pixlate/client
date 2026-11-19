/**
 * 소셜 로그인 callback 실행 상태(이 탭의 sessionStorage — 새로고침해도 남고 다른 탭과 공유하지 않는다).
 * 값은 아래 두 상태뿐이며 토큰·seller·code·state 는 저장하지 않는다.
 *
 *   'in-flight'   — 이 탭이 POST /auth/social 을 보냈고 아직 서버 응답을 받지 못함
 *   'unconfirmed' — 이번 로그인 완료 여부를 알 수 없음(응답 전 새로고침·네트워크 끊김·login_in_progress)
 *
 * 둘 중 하나가 있는 동안에는 refresh 로 세션을 되살리지 않는다(lib/auth/refresh.ts) — 브라우저에 남은 refresh 쿠키가
 * 이번 소셜 로그인이 아니라 이전 계정 세션일 수 있기 때문이다. 새 start 성공·새 로그인 완료 때 지운다.
 */
import type { StorageLike } from './logout-pending.ts';

export const AUTH_CALLBACK_STATE_KEY = 'pixlate:auth:callback-state';

export type CallbackState = 'in-flight' | 'unconfirmed';

let storageOverride: StorageLike | null | undefined;

/** 검증 스크립트 전용 */
export function setCallbackStateStorageForTest(storage: StorageLike | null | undefined): void {
  storageOverride = storage;
}

function storage(): StorageLike | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readCallbackState(): CallbackState | null {
  try {
    const value = storage()?.getItem(AUTH_CALLBACK_STATE_KEY);
    return value === 'in-flight' || value === 'unconfirmed' ? value : null;
  } catch {
    return null;
  }
}

function write(value: CallbackState | null): void {
  try {
    if (value) storage()?.setItem(AUTH_CALLBACK_STATE_KEY, value);
    else storage()?.removeItem(AUTH_CALLBACK_STATE_KEY);
  } catch {
    // 저장소를 쓸 수 없으면 같은 document 안 중복 방어만 동작한다
  }
}

export const markCallbackInFlight = () => write('in-flight');
export const markCallbackUnconfirmed = () => write('unconfirmed');
export const clearCallbackState = () => write(null);

/** callback 결과를 모르는 동안 세션 자동 복원을 막는다 */
export function isSessionRestoreSuppressed(): boolean {
  return readCallbackState() !== null;
}
