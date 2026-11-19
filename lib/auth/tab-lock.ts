import { AUTH_REFRESH_LOCK_NAME, AUTH_REFRESH_LOCK_WAIT_MS } from './constants.ts';

/**
 * 탭 사이 refresh 잠금. 같은 브라우저의 여러 탭이 같은 refresh 쿠키로 동시에 회전하지 않게 한 번에 한 탭만 refresh 한다.
 * Web Locks(navigator.locks)가 있으면 쓰고, 없으면 잠금 없이 실행한다 — 그때 생기는 경합은 refresh_rotated 복구가 받는다.
 * Web Locks 사용 여부는 FE↔BE 합의 대기 항목이라 이 파일 하나로 격리했다.
 */
export class AuthLockTimeoutError extends Error {
  constructor() {
    super('auth refresh lock timeout');
    this.name = 'AuthLockTimeoutError';
  }
}

export interface LockManagerLike {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>;
}

export type AuthLock = <T>(task: () => Promise<T>) => Promise<T>;

export function createAuthLock(locks: LockManagerLike | null = defaultLocks(), waitMs = AUTH_REFRESH_LOCK_WAIT_MS): AuthLock {
  return async <T,>(task: () => Promise<T>) => {
    if (!locks) return task();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    let acquired = false;
    try {
      return await locks.request(AUTH_REFRESH_LOCK_NAME, { signal: controller.signal }, () => {
        acquired = true;
        clearTimeout(timer);
        return task();
      });
    } catch (error) {
      if (!acquired && controller.signal.aborted) throw new AuthLockTimeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

function defaultLocks(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  return locks ?? null;
}
