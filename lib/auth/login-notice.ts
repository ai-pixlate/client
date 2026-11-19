/**
 * G1 로그인 화면에 남길 안내(이 탭의 sessionStorage — 새로고침·이동 뒤에도 G1 에서 한 번 보인다). 토큰·계정 정보는 저장하지 않는다.
 *
 *   'account-not-allowed' — 허용 목록 밖 계정(401 UNAUTHORIZED · details.reason=account_not_allowed).
 *     POST /auth/social 은 계정·세션을 만들지 않았고, POST /auth/refresh 는 서버가 세션을 폐기했다(새 Set-Cookie 없음 —
 *     남은 같은 쿠키로 다시 refresh 하면 refresh_invalid 다).
 *
 * 새 소셜 로그인 시작이 성공하면 지운다(lib/auth/social-login.ts).
 */
import type { StorageLike } from './logout-pending.ts';

export const AUTH_LOGIN_NOTICE_KEY = 'pixlate:auth:login-notice';

export type LoginNotice = 'account-not-allowed';

let storageOverride: StorageLike | null | undefined;

/** 검증 스크립트 전용 */
export function setLoginNoticeStorageForTest(storage: StorageLike | null | undefined): void {
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

export function readLoginNotice(): LoginNotice | null {
  try {
    return storage()?.getItem(AUTH_LOGIN_NOTICE_KEY) === 'account-not-allowed' ? 'account-not-allowed' : null;
  } catch {
    return null;
  }
}

export function markLoginNotice(notice: LoginNotice): void {
  try {
    storage()?.setItem(AUTH_LOGIN_NOTICE_KEY, notice);
  } catch {
    // 저장소를 쓸 수 없으면 안내만 빠진다 — 인증 처리에는 영향이 없다
  }
}

export function clearLoginNotice(): void {
  try {
    storage()?.removeItem(AUTH_LOGIN_NOTICE_KEY);
  } catch {
    // 무시
  }
}
