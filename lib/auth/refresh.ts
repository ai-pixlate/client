import { AUTH_REFRESH_EVENT_WAIT_MS, AUTH_REFRESH_MAX_ATTEMPTS } from './constants.ts';
import type { AuthChannel } from './cross-tab.ts';
import { classifyRefreshFailure } from './errors.ts';
import { getAuthSnapshot, setAccessToken, confirmSeller } from './session-store.ts';
import { AuthLockTimeoutError, type AuthLock } from './tab-lock.ts';
import type { AuthApiResult, AuthSeller } from './types.ts';

/**
 * 401 뒤 인증 복구(한 탭 안 single-flight).
 *
 *   refresh(탭 잠금 안) ─ 성공 → access 메모리 반영 → refresh-complete 알림 → GET /auth/me → 계정 비교
 *                       ├ refresh_rotated → 다른 탭 refresh-complete 를 최대 2초 기다린 뒤 한 번 더(사건당 refresh 최대 2회)
 *                       ├ refresh_reused·refresh_invalid → 세션 종료
 *                       ├ 503·네트워크 → 일시 오류(세션 유지, 자동 반복 없음)
 *                       └ origin_not_allowed·422 → 실패(세션 유지, 자동 재시도 없음)
 *
 * 같은 탭에서 동시에 난 401 은 진행 중인 복구 하나를 함께 기다린다. 결과 처리(이동·알림·캐시 정리)는 onOutcome 에서 사건당 한 번만 한다.
 * /auth/me 로 계정을 확인하기 전에는 원 요청을 다시 보내지 않는다 — 재시도 판단은 결과를 받은 호출부(authorizedFetch)가 한다.
 */
export type RecoveryOutcome =
  | { kind: 'same-account' }
  | { kind: 'account-changed'; seller: AuthSeller }
  | { kind: 'session-ended' }
  | { kind: 'rotated-exhausted' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

export interface RecoveryDeps {
  refresh: () => Promise<AuthApiResult<{ accessToken: string }>>;
  me: (accessToken: string) => Promise<AuthApiResult<AuthSeller>>;
  lock: AuthLock;
  channel: Pick<AuthChannel, 'post' | 'waitFor'>;
  /** 서버 로그아웃 미완료 기록이 있으면 refresh 로 로그인을 되살리지 않는다 */
  isLogoutPending: () => boolean;
  /** 사건당 한 번 호출된다 */
  onOutcome?: (outcome: RecoveryOutcome) => void;
  eventWaitMs?: number;
  maxAttempts?: number;
}

export interface SessionRecovery {
  recover(): Promise<RecoveryOutcome>;
}

export function createSessionRecovery(deps: RecoveryDeps): SessionRecovery {
  const eventWaitMs = deps.eventWaitMs ?? AUTH_REFRESH_EVENT_WAIT_MS;
  const maxAttempts = deps.maxAttempts ?? AUTH_REFRESH_MAX_ATTEMPTS;
  let inflight: Promise<RecoveryOutcome> | null = null;

  async function refreshWithinLimit(): Promise<{ ok: true; accessToken: string } | { ok: false; outcome: RecoveryOutcome }> {
    for (let attempt = 1; ; attempt += 1) {
      let result: AuthApiResult<{ accessToken: string }>;
      try {
        result = await deps.lock(() => deps.refresh());
      } catch (error) {
        // 잠금을 10초 안에 얻지 못함 — 다른 탭이 멈춘 것일 수 있어 세션은 건드리지 않는다
        if (error instanceof AuthLockTimeoutError) return { ok: false, outcome: { kind: 'unavailable' } };
        throw error;
      }
      if (result.ok) return { ok: true, accessToken: result.data.accessToken };

      const kind = classifyRefreshFailure(result.error);
      if (kind === 'rotated') {
        // 서버 세션은 살아 있다. 상한을 넘으면 자동 반복만 멈춘다(세션 폐기로 단정하지 않음)
        if (attempt >= maxAttempts) return { ok: false, outcome: { kind: 'rotated-exhausted' } };
        // 다른 탭의 회전이 끝나 브라우저에 새 쿠키가 저장되기를 기다린다. 알림이 없어도 한 번은 다시 시도한다
        await deps.channel.waitFor('refresh-complete', eventWaitMs);
        continue;
      }
      if (kind === 'session-ended') return { ok: false, outcome: { kind: 'session-ended' } };
      if (kind === 'unavailable') return { ok: false, outcome: { kind: 'unavailable' } };
      return { ok: false, outcome: { kind: 'failed' } };
    }
  }

  async function run(): Promise<RecoveryOutcome> {
    if (deps.isLogoutPending()) return { kind: 'session-ended' };

    const refreshed = await refreshWithinLimit();
    if (!refreshed.ok) return refreshed.outcome;

    setAccessToken(refreshed.accessToken);
    deps.channel.post({ type: 'refresh-complete' });

    const me = await deps.me(refreshed.accessToken);
    if (!me.ok) {
      if (me.error.status === 401 || me.error.status === 404) return { kind: 'session-ended' };
      // 계정을 확인하지 못했으면 원 요청을 다시 보내지 않는다
      return me.error.status === 0 || me.error.status >= 500 ? { kind: 'unavailable' } : { kind: 'failed' };
    }

    const current = getAuthSnapshot().seller;
    if (current && current.id !== me.data.id) return { kind: 'account-changed', seller: me.data };
    confirmSeller(me.data);
    return { kind: 'same-account' };
  }

  return {
    recover() {
      if (inflight) return inflight;
      inflight = run()
        .then((outcome) => {
          deps.onOutcome?.(outcome);
          return outcome;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
