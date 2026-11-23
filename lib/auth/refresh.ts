import { AUTH_REFRESH_EVENT_WAIT_MS, AUTH_REFRESH_MAX_ATTEMPTS } from './constants.ts';
import type { AuthChannel } from './cross-tab.ts';
import { classifyRefreshFailure } from './errors.ts';
import { getAuthEpoch, getAuthSnapshot, setAccessToken, confirmSeller } from './session-store.ts';
import { AuthLockTimeoutError, type AuthLock } from './tab-lock.ts';
import type { AuthApiResult, AuthSeller } from './types.ts';

/**
 * 401 뒤 인증 복구(한 탭 안 single-flight).
 *
 *   refresh(탭 잠금 안) ─ 성공 → refresh-complete 알림 → GET /auth/me(받은 access 로) → 계정 비교 → 같은 계정일 때만 access 메모리 반영
 *                       ├ refresh_rotated → 다른 탭 refresh-complete 를 최대 2초 기다린 뒤 한 번 더(사건당 refresh 최대 2회)
 *                       ├ account_not_allowed → 허용되지 않은 계정(세션 종료 · 다시 refresh 하지 않음 · G1 안내)
 *                       ├ refresh_reused·refresh_invalid → 세션 종료
 *                       ├ 503·네트워크 → 일시 오류(세션 유지, 자동 반복 없음)
 *                       └ origin_not_allowed·422 → 실패(세션 유지, 자동 재시도 없음)
 *
 * 같은 탭에서 동시에 난 401 은 진행 중인 복구 하나를 함께 기다린다 — 단, 같은 인증 세대(epoch)의 요청끼리만이다. 복구는 시작할 때의
 * expectedEpoch 에 묶이고, 계정 전환·로그아웃으로 세대가 바뀌면 그 복구는 현재 세션에 아무것도 쓰지 않고 'stale' 로 끝난다:
 *   시작 전 · 탭 잠금을 얻은 직후(POST /auth/refresh 직전) · refresh 응답 뒤 · /auth/me 응답 뒤 에 세대를 다시 확인한다.
 *   stale 이면 refresh 를 보내지 않고, 받은 access 를 저장하지 않고, refresh-complete 를 알리지 않고, /auth/me 를 부르지 않는다.
 * 결과 처리(이동·알림·캐시 정리)는 onOutcome 에서 사건당 한 번만 한다. onOutcome 직전에도 세대를 다시 보고, 그 사이 바뀌었으면 'stale' 로 넘긴다
 * (예: 결과가 나온 직후 로그아웃 — 끝난 세션에 새 계정을 다시 넣지 않는다).
 *
 * access 는 /auth/me 로 계정을 확인한 뒤에만 메모리에 넣는다. 확인 전(또는 확인 실패)에 넣으면 seller 없이 access 만 있는 상태가 생기고,
 * 그 access 로 받은 이전 계정 데이터가 cache 에 남은 채 다른 탭의 계정 변경 알림이 무시된다(seller=null 경계, lib/auth/runtime.ts).
 * 다른 계정이면 access 를 결과(account-changed)에 실어 보내 runtime 이 이전 계정 데이터를 지운 뒤에 넣는다.
 * /auth/me 로 계정을 확인하기 전에는 원 요청을 다시 보내지 않는다 — 재시도 판단은 결과를 받은 호출부(authorizedFetch)가 한다.
 */
export type RecoveryOutcome =
  | { kind: 'same-account' }
  /** 허용 목록 밖 계정(401 account_not_allowed) — 서버가 세션을 폐기했다. 다시 refresh 하지 않는다 */
  | { kind: 'account-not-allowed' }
  /** accessToken = 새 계정 access. 아직 메모리에 넣지 않았다 — 이전 계정 정리 뒤 runtime 이 넣는다 */
  | { kind: 'account-changed'; seller: AuthSeller; accessToken: string }
  | { kind: 'session-ended' }
  /** 소셜 callback 완료 여부를 모름 — 남은 refresh 쿠키가 이전 계정일 수 있어 복원하지 않는다(lib/auth/callback-state.ts) */
  | { kind: 'restore-suppressed' }
  | { kind: 'rotated-exhausted' }
  | { kind: 'unavailable' }
  | { kind: 'failed' }
  /** 복구 중 인증 세대가 바뀌었다(계정 전환·로그아웃) — 현재 세션에 아무것도 쓰지 않았다. 호출부는 응답을 버린다 */
  | { kind: 'stale' };

export interface RecoveryDeps {
  refresh: () => Promise<AuthApiResult<{ accessToken: string }>>;
  me: (accessToken: string) => Promise<AuthApiResult<AuthSeller>>;
  lock: AuthLock;
  channel: Pick<AuthChannel, 'post' | 'waitFor'>;
  /** 서버 로그아웃 미완료 기록이 있으면 refresh 로 로그인을 되살리지 않는다 */
  isLogoutPending: () => boolean;
  /** callback 결과 불확정 동안 refresh 로 세션을 되살리지 않는다 */
  isSessionRestoreSuppressed: () => boolean;
  /** 사건당 한 번 호출된다 */
  onOutcome?: (outcome: RecoveryOutcome) => void;
  /** 현재 인증 세대(기본 session-store getAuthEpoch) */
  currentEpoch?: () => number;
  eventWaitMs?: number;
  maxAttempts?: number;
}

export interface SessionRecovery {
  /** expectedEpoch = 401 을 받은 요청을 보낼 때의 세대(생략하면 지금 세대). 다른 세대의 진행 중 복구와 합치지 않는다 */
  recover(expectedEpoch?: number): Promise<RecoveryOutcome>;
}

const STALE = Symbol('stale');

export function createSessionRecovery(deps: RecoveryDeps): SessionRecovery {
  const eventWaitMs = deps.eventWaitMs ?? AUTH_REFRESH_EVENT_WAIT_MS;
  const maxAttempts = deps.maxAttempts ?? AUTH_REFRESH_MAX_ATTEMPTS;
  const currentEpoch = deps.currentEpoch ?? getAuthEpoch;
  /** 세대별 진행 중 복구 — 같은 세대의 동시 401 만 하나를 함께 기다린다 */
  const inflight = new Map<number, Promise<RecoveryOutcome>>();

  async function refreshWithinLimit(isStale: () => boolean): Promise<{ ok: true; accessToken: string } | { ok: false; outcome: RecoveryOutcome }> {
    for (let attempt = 1; ; attempt += 1) {
      let result: AuthApiResult<{ accessToken: string }> | typeof STALE;
      try {
        // 잠금을 기다리는 사이 세대가 바뀌었으면 refresh 를 보내지 않는다(새 세션의 쿠키를 회전시키지 않는다)
        result = await deps.lock<AuthApiResult<{ accessToken: string }> | typeof STALE>(() => (isStale() ? Promise.resolve(STALE) : deps.refresh()));
      } catch (error) {
        // 잠금을 10초 안에 얻지 못함 — 다른 탭이 멈춘 것일 수 있어 세션은 건드리지 않는다
        if (error instanceof AuthLockTimeoutError) return { ok: false, outcome: { kind: 'unavailable' } };
        throw error;
      }
      if (result === STALE || isStale()) return { ok: false, outcome: { kind: 'stale' } };
      if (result.ok) return { ok: true, accessToken: result.data.accessToken };

      const kind = classifyRefreshFailure(result.error);
      if (kind === 'rotated') {
        // 서버 세션은 살아 있다. 상한을 넘으면 자동 반복만 멈춘다(세션 폐기로 단정하지 않음)
        if (attempt >= maxAttempts) return { ok: false, outcome: { kind: 'rotated-exhausted' } };
        // 다른 탭의 회전이 끝나 브라우저에 새 쿠키가 저장되기를 기다린다. 알림이 없어도 한 번은 다시 시도한다
        await deps.channel.waitFor('refresh-complete', eventWaitMs);
        continue;
      }
      if (kind === 'account-not-allowed') return { ok: false, outcome: { kind: 'account-not-allowed' } };
      if (kind === 'session-ended') return { ok: false, outcome: { kind: 'session-ended' } };
      if (kind === 'unavailable') return { ok: false, outcome: { kind: 'unavailable' } };
      return { ok: false, outcome: { kind: 'failed' } };
    }
  }

  async function run(expectedEpoch: number): Promise<RecoveryOutcome> {
    const isStale = () => currentEpoch() !== expectedEpoch;
    if (isStale()) return { kind: 'stale' };
    if (deps.isLogoutPending()) return { kind: 'session-ended' };
    if (deps.isSessionRestoreSuppressed()) return { kind: 'restore-suppressed' };

    const refreshed = await refreshWithinLimit(isStale);
    if (!refreshed.ok) return refreshed.outcome;
    // refresh 도중 세대가 바뀌었으면(refreshWithinLimit 가 응답 직후 확인) 여기 오지 않는다 — 새 access 를 이 세대에만 쓴다

    // 쿠키 회전이 끝났다는 알림이다(다른 탭의 refresh_rotated 대기용). access 는 아직 메모리에 넣지 않는다
    deps.channel.post({ type: 'refresh-complete' });

    const me = await deps.me(refreshed.accessToken);
    if (isStale()) return { kind: 'stale' };
    if (!me.ok) {
      if (me.error.status === 401 || me.error.status === 404) return { kind: 'session-ended' };
      // 계정을 확인하지 못했으면 원 요청을 다시 보내지 않는다
      return me.error.status === 0 || me.error.status >= 500 ? { kind: 'unavailable' } : { kind: 'failed' };
    }

    const current = getAuthSnapshot().seller;
    if (current && current.id !== me.data.id) return { kind: 'account-changed', seller: me.data, accessToken: refreshed.accessToken };
    // current=null 은 이 세대가 아직 계정을 확인한 적 없다는 뜻이다 — access 가 없었으니 인증된 응답도, 정리할 이전 계정 데이터도 없다
    // (이전 계정 데이터는 세대를 올린 쪽이 이미 지웠다: switchAccount·clearAuth 호출부). 그래서 처음 확인한 계정을 이 세대의 계정으로 둔다
    setAccessToken(refreshed.accessToken);
    confirmSeller(me.data);
    return { kind: 'same-account' };
  }

  return {
    recover(expectedEpoch = currentEpoch()) {
      const running = inflight.get(expectedEpoch);
      if (running) return running;
      const started = run(expectedEpoch)
        .then((result) => {
          // run 이 끝난 뒤 onOutcome 전에 세대가 바뀌었을 수 있다(같은 틈의 로그아웃·계정 전환) — 그 결과를 새 세대에 적용하지 않는다
          const outcome: RecoveryOutcome = result.kind !== 'stale' && currentEpoch() !== expectedEpoch ? { kind: 'stale' } : result;
          deps.onOutcome?.(outcome);
          return outcome;
        })
        .finally(() => {
          if (inflight.get(expectedEpoch) === started) inflight.delete(expectedEpoch);
        });
      inflight.set(expectedEpoch, started);
      return started;
    },
  };
}
