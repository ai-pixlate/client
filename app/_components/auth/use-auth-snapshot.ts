'use client';

import { useSyncExternalStore } from 'react';

import { getAuthSnapshot, subscribeAuth, type AuthSnapshot } from '@/lib/auth/session-store';

const SERVER_SNAPSHOT: AuthSnapshot = { status: 'unknown', seller: null, epoch: 0, notice: null };

/** 인증 메모리 상태 구독. access token 은 snapshot 에 없다 */
export function useAuthSnapshot(): AuthSnapshot {
  return useSyncExternalStore(subscribeAuth, getAuthSnapshot, () => SERVER_SNAPSHOT);
}
