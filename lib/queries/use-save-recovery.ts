'use client';

import { useCallback, useRef, useState } from 'react';

import { runSaveWithRecovery, type IdempotentPatchRequest, type SaveRunResult } from '@/lib/api/idempotent-patch';
import { getAuthEpoch } from '@/lib/auth/session-store';
import { nextUncertainSaveStatus, type UncertainRefetchResult } from '@/lib/n5/uncertain-save';

export type { SaveRunResult } from '@/lib/api/idempotent-patch';

/**
 * 블록 · 섹션 PATCH 의 응답 유실 복구(N3 · N5 공용). 판정 · 재전송 루프는 lib/api/idempotent-patch.ts runSaveWithRecovery 이고,
 * 여기서는 화면 상태(확인 중 · 확인하지 못함)와 [서버 상태 다시 확인] 대기만 붙인다.
 * run 이 끝날 때까지 호출부가 잡은 저장 잠금은 그대로다 — 결과를 확인하기 전에 추가 저장 · 확정을 시작하지 않는다.
 */

export type SaveRecoveryState = { status: 'checking' | 'unconfirmed' } | null;

export interface SaveRecoveryApi {
  state: SaveRecoveryState;
  /** [서버 상태 다시 확인] — 확인하지 못한 요청을 같은 기록으로 다시 확인한다 */
  retry: () => void;
  run: <T extends { replayed: boolean }>(request: IdempotentPatchRequest<unknown>, send: () => Promise<T>) => Promise<SaveRunResult<T>>;
}

export function useSaveRecovery(refetchServerState: () => Promise<UncertainRefetchResult>): SaveRecoveryApi {
  // 저장은 섹션 · 블록마다 동시에 진행될 수 있다 — 복구도 건별로 상태를 두고, 화면에는 하나라도 「확인하지 못함」이면 그것을 보인다
  const [state, setState] = useState<SaveRecoveryState>(null);
  const activeRef = useRef(new Map<symbol, 'checking' | 'unconfirmed'>());
  const waitersRef = useRef(new Set<() => void>());

  const mark = useCallback((id: symbol, status: 'checking' | 'unconfirmed' | null) => {
    if (status) activeRef.current.set(id, status);
    else activeRef.current.delete(id);
    const statuses = [...activeRef.current.values()];
    setState(statuses.length === 0 ? null : { status: statuses.includes('unconfirmed') ? 'unconfirmed' : 'checking' });
  }, []);

  const run = useCallback(
    async <T extends { replayed: boolean }>(request: IdempotentPatchRequest<unknown>, send: () => Promise<T>): Promise<SaveRunResult<T>> => {
      const id = Symbol(request.key);
      try {
        return await runSaveWithRecovery(request, send, {
          refetchServerState: async () => nextUncertainSaveStatus(await refetchServerState()) === 'confirmed',
          waitForRetry: () => {
            mark(id, 'unconfirmed');
            return new Promise<void>((resolve) => {
              waitersRef.current.add(resolve);
            });
          },
          onChecking: () => mark(id, 'checking'),
          getAuthEpoch,
          now: Date.now,
        });
      } finally {
        mark(id, null);
      }
    },
    [mark, refetchServerState],
  );

  const retry = useCallback(() => {
    const waiters = [...waitersRef.current];
    waitersRef.current.clear();
    for (const resume of waiters) resume();
  }, []);

  return { state, retry, run };
}
