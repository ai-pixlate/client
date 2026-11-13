import { getAuthMe, postAuthRefresh } from '../api/auth.ts';
import { clearCallbackState, isSessionRestoreSuppressed, readCallbackState } from './callback-state.ts';
import { AUTH_HOME_PATH, AUTH_LOGIN_PATH } from './constants.ts';
import { createAuthChannel, type AuthChannel, type AuthTabEvent } from './cross-tab.ts';
import { isLogoutPending } from './logout-pending.ts';
import { createSessionRecovery, type RecoveryDeps, type RecoveryOutcome, type SessionRecovery } from './refresh.ts';
import { clearAuth, getAccessToken, getAuthSnapshot, setAuthNotice, stopRecovery, switchAccount } from './session-store.ts';
import { createAuthLock, type AuthLock } from './tab-lock.ts';

/**
 * 인증 실행부 — 복구 결과와 다른 탭 알림을 화면 동작(이동·캐시 정리·탭 알림)으로 바꾼다.
 * 화면 쪽 동작은 app/providers.tsx 가 configureAuthRuntime 으로 넣는다(Next router·QueryClient). 이 파일은 React 를 모른다.
 */
export interface AuthRuntimeHooks {
  /** 앱 안 이동(router.replace) */
  navigate(path: string): void;
  /** 현재 경로 */
  currentPath(): string;
  /** 이전 계정의 서버 데이터 캐시를 버린다(진행 중 query 취소·polling 중단 포함) */
  clearClientData(): void;
}

const fallbackHooks: AuthRuntimeHooks = {
  navigate(path) {
    if (typeof window !== 'undefined') window.location.assign(path);
  },
  currentPath() {
    return typeof window === 'undefined' ? '' : window.location.pathname;
  },
  clearClientData() {},
};

let hooks: AuthRuntimeHooks = fallbackHooks;
let channel: AuthChannel | null = null;
let lock: AuthLock | null = null;
let recovery: SessionRecovery | null = null;

export function configureAuthRuntime(next: AuthRuntimeHooks): void {
  hooks = next;
}

export function getAuthChannel(): AuthChannel {
  channel ??= createAuthChannel();
  return channel;
}

export function getAuthLock(): AuthLock {
  lock ??= createAuthLock();
  return lock;
}

/** 검증 스크립트 전용 — 대역 채널·잠금·API 로 바꾼다 */
export function configureAuthRuntimeForTest(options: {
  hooks?: AuthRuntimeHooks;
  channel?: AuthChannel;
  lock?: AuthLock;
  recoveryDeps?: Partial<RecoveryDeps>;
}): void {
  hooks = options.hooks ?? fallbackHooks;
  channel = options.channel ?? null;
  lock = options.lock ?? null;
  recovery = createSessionRecovery({ ...defaultRecoveryDeps(), ...options.recoveryDeps });
}

function defaultRecoveryDeps(): RecoveryDeps {
  return {
    refresh: postAuthRefresh,
    me: getAuthMe,
    lock: getAuthLock(),
    channel: getAuthChannel(),
    isLogoutPending,
    isSessionRestoreSuppressed,
    onOutcome: applyRecoveryOutcome,
  };
}

/**
 * 401 을 받은 요청이 부른다. expectedEpoch = 그 요청을 보낼 때의 인증 세대. 같은 탭·같은 세대의 동시 호출은 결과 하나를 공유하고,
 * 세대가 바뀐 뒤의 호출은 이전 세대의 진행 중 복구에 합류하지 않는다(lib/auth/refresh.ts).
 */
export function recoverSession(expectedEpoch?: number): Promise<RecoveryOutcome> {
  recovery ??= createSessionRecovery(defaultRecoveryDeps());
  return recovery.recover(expectedEpoch);
}

/** 사건당 한 번 실행된다(refresh.ts onOutcome) */
export function applyRecoveryOutcome(outcome: RecoveryOutcome): void {
  switch (outcome.kind) {
    case 'same-account':
      return;
    case 'account-changed':
      // 원 요청은 다시 보내지 않는다. 이전 계정 상태를 버리고 새 계정으로 M1 에서 다시 시작한다
      switchAccount(outcome.seller, getAccessToken());
      hooks.clearClientData();
      getAuthChannel().post({ type: 'account-changed', sellerId: outcome.seller.id });
      hooks.navigate(AUTH_HOME_PATH);
      return;
    case 'session-ended':
      endSessionLocally();
      getAuthChannel().post({ type: 'logout' });
      return;
    case 'restore-suppressed':
      // 이 탭만 G1 로 — 다른 탭의 세션은 건드리지 않는다(logout 알림 없음). 새 start 로 다시 로그인한다
      endSessionLocally();
      return;
    case 'rotated-exhausted':
      // 서버 세션이 폐기됐다고 단정하지 않는다 — 다른 탭에 로그아웃을 알리지 않고, 이 탭의 자동 복구만 멈춘다
      stopRecovery();
      return;
    case 'unavailable':
      // 서버·세션 저장소 일시 장애. 세션을 지우지 않는다
      setAuthNotice('auth-unavailable');
      return;
    case 'failed':
      setAuthNotice('auth-failed');
      return;
    case 'stale':
      // 이전 세대의 복구 — 현재 세션(새 계정·로그아웃 상태)에 아무것도 하지 않는다
      return;
  }
}

/** 이 탭의 인증 상태를 지우고 G1 로 간다(다른 탭 알림은 호출부가 정한다) */
export function endSessionLocally(): void {
  clearAuth();
  hooks.clearClientData();
  if (hooks.currentPath() !== AUTH_LOGIN_PATH) hooks.navigate(AUTH_LOGIN_PATH);
}

/** 다른 탭 알림 처리 */
export function handleAuthTabEvent(event: AuthTabEvent): void {
  switch (event.type) {
    case 'refresh-complete':
      // refresh 를 기다리는 쪽(refresh.ts waitFor)만 쓴다
      return;
    case 'logout':
      endSessionLocally();
      return;
    case 'login-complete':
    case 'account-changed': {
      // 다른 탭의 새 로그인이 끝났다 — 브라우저 쿠키는 그 새 세션이므로 이 탭의 「완료 여부 모름」 차단을 푼다
      if (event.type === 'login-complete' && readCallbackState() === 'unconfirmed') clearCallbackState();
      const { seller, status } = getAuthSnapshot();
      if (seller?.id === event.sellerId) return;
      if (seller) {
        // 한 브라우저 한 계정 — 기존 요청·미저장 편집·이전 계정 데이터를 버리고 새 계정으로 M1 에서 시작한다.
        // 새 계정 access 는 알림으로 받지 않는다. 다음 요청의 401 → refresh → /auth/me 가 새 계정으로 맞춘다
        switchAccount(null, null);
        hooks.clearClientData();
        hooks.navigate(AUTH_HOME_PATH);
        return;
      }
      // 로그아웃 뒤 G1 에 있던 탭은 새 로그인을 따라 M1 로 간다. 아직 계정을 확인하지 않은 탭은 보여 준 계정 데이터가 없어 그대로 둔다
      if (status === 'signed-out' && hooks.currentPath() === AUTH_LOGIN_PATH) hooks.navigate(AUTH_HOME_PATH);
      return;
    }
  }
}

/** 앱 시작 때 한 번 — 다른 탭 알림 구독 */
export function startAuthTabSync(): () => void {
  return getAuthChannel().subscribe(handleAuthTabEvent);
}
