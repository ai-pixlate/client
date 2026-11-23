import { AuthRecoveryError, AuthSessionChangedError } from './authorized-request.ts';

/** 일반 query 오류의 자동 재시도 횟수(기존 QueryClient retry: 1) */
export const QUERY_RETRY_COUNT = 1;

/** 인증 계층이 이미 최종 판단한 오류 — 자동 재시도하면 새 refresh·이전 세대 요청만 만든다 */
export function isAuthTerminalError(error: unknown): boolean {
  return error instanceof AuthRecoveryError || error instanceof AuthSessionChangedError;
}

/**
 * React Query 전역 retry. 인증 복구 실패·세대 변경은 0회, 그 밖의 일반 오류는 기존 정책대로 최대 1회.
 * 인증 계층 안의 복구(401 → refresh → /auth/me → 원 요청 1회)는 query 재시도와 별개라 여기서 세지 않는다.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isAuthTerminalError(error)) return false;
  return failureCount < QUERY_RETRY_COUNT;
}
