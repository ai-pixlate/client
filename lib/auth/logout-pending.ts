import { AUTH_LOGOUT_PENDING_KEY } from './constants.ts';

/**
 * 「서버 로그아웃 미완료」 기록. 화면은 이미 로그아웃했지만 서버 세션 폐기를 확인하지 못했을 때만 남긴다.
 * 저장 값은 '1' 하나다 — access·refresh token, 계정 식별자, 개인정보는 저장하지 않는다.
 * 기록이 있는 동안에는 refresh 로 자동 로그인 복원을 하지 않는다(lib/auth/refresh.ts).
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

let storageOverride: StorageLike | null | undefined;

/** 검증 스크립트 전용 */
export function setLogoutPendingStorageForTest(storage: StorageLike | null | undefined): void {
  storageOverride = storage;
}

function storage(): StorageLike | null {
  return storageOverride !== undefined ? storageOverride : defaultStorage();
}

export function isLogoutPending(): boolean {
  try {
    return storage()?.getItem(AUTH_LOGOUT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

export function markLogoutPending(): void {
  try {
    storage()?.setItem(AUTH_LOGOUT_PENDING_KEY, '1');
  } catch {
    // 저장소를 쓸 수 없어도 화면 로그아웃은 그대로 진행한다
  }
}

export function clearLogoutPending(): void {
  try {
    storage()?.removeItem(AUTH_LOGOUT_PENDING_KEY);
  } catch {
    // 무시
  }
}
