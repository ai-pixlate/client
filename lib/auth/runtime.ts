import { getAuthMe, postAuthRefresh } from '../api/auth.ts';
import { clearCallbackState, isSessionRestoreSuppressed, readCallbackState } from './callback-state.ts';
import { AUTH_CALLBACK_PATH_PREFIX, AUTH_HOME_PATH, AUTH_LOGIN_PATH } from './constants.ts';
import { createAuthChannel, type AuthChannel, type AuthTabEvent } from './cross-tab.ts';
import { isLogoutPending } from './logout-pending.ts';
import { createSessionRecovery, type RecoveryDeps, type RecoveryOutcome, type SessionRecovery } from './refresh.ts';
import type { AuthSeller } from './types.ts';
import { clearAuth, confirmSeller, getAuthEpoch, getAuthSnapshot, setAccessToken, setAuthNotice, stopRecovery, switchAccount } from './session-store.ts';
import { createAuthLock, type AuthLock } from './tab-lock.ts';
import { markLoginNotice } from './login-notice.ts';

/**
 * 인증 실행부 — 복구 결과와 다른 탭 알림을 화면 동작(이동·캐시 정리·탭 알림)으로 바꾼다.
 * 화면 쪽 동작은 app/providers.tsx 가 configureAuthRuntime 으로 넣는다(Next router·QueryClient). 이 파일은 React 를 모른다.
 */
export interface AuthRuntimeHooks {
  /** 앱 안 이동(router.replace) */
  navigate(path: string): void;
  /** 현재 경로 */
  currentPath(): string;
  /**
   * 이전 계정의 서버 데이터 캐시를 버린다 — 진행 중 query 취소 + query·mutation cache 제거(app/providers.tsx).
   * 네트워크 요청 자체는 세대 AbortSignal 이 끊는다(session-store). polling 과 화면 local 편집 상태는 이어지는 navigate 의 unmount 로 끝난다.
   */
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
/**
 * 다른 탭 알림으로 세운 마지막 계정 경계 — 어느 세대에서 어느 계정(sellerId)을 기다리는지. 그 세대가 그대로인 동안 같은 계정 알림이 다시 오면
 * 경계를 또 세우지 않는다: 경계 뒤 시작한 복구는 이미 그 계정 쿠키로 refresh 하므로, 다시 세대를 올리면 새 계정 복구만 stale 로 끊긴다.
 * 세대가 바뀌면(복구 확정·로그아웃 등) 저절로 무효다.
 */
let tabEventBoundary: { epoch: number; sellerId: number } | null = null;

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
  tabEventBoundary = null;
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
      crossAccountBoundary({ seller: outcome.seller, accessToken: outcome.accessToken });
      getAuthChannel().post({ type: 'account-changed', sellerId: outcome.seller.id });
      hooks.navigate(AUTH_HOME_PATH);
      return;
    case 'session-ended':
      endSessionLocally();
      getAuthChannel().post({ type: 'logout' });
      return;
    case 'account-not-allowed':
      // 서버가 세션을 폐기하고 refresh 쿠키를 지웠다 — 자동 복구를 더 하지 않고 G1 에서 이유를 보인다(다른 탭도 같은 쿠키라 로그아웃)
      markLoginNotice('account-not-allowed');
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

/**
 * 계정 경계(PRD F-ACC-01) — 이 탭이 들고 있던 이전 계정 세션을 버린다. 순서가 중요하다:
 *   1. switchAccount: 세대를 올린다. 이전 세대로 보낸 요청은 abort, 늦은 응답은 AuthSessionChangedError, 진행 중 복구는 stale.
 *      access·seller 를 비운다
 *   2. clearClientData: 진행 중 query 취소, query·mutation cache 제거
 *   3. next 가 있으면(복구가 /auth/me 로 확인한 새 계정) 그때 새 access·seller 를 넣는다 — 이전 cache 가 남은 동안 새 access 가 있는 순간을 만들지 않는다
 *   4. 새 계정 요청은 그 뒤 새 세대로 나간다
 * next 가 없으면(다른 탭 알림) 새 access 는 다음 요청의 401 → refresh → /auth/me 가 정한다.
 * 화면 local 편집 상태(N5 초안·이력·배치 편집 등)는 모두 라우트 컴포넌트 state 라 호출부의 navigate(M1) unmount 로 사라진다.
 */
function crossAccountBoundary(next: { seller: AuthSeller; accessToken: string } | null, awaitedSellerId: number | null = null): void {
  switchAccount();
  // clearClientData 안에서 같은 알림이 다시 처리돼도(동기 재진입) 경계를 겹쳐 세우지 않도록 먼저 기록한다
  tabEventBoundary = awaitedSellerId == null ? null : { epoch: getAuthEpoch(), sellerId: awaitedSellerId };
  hooks.clearClientData();
  if (next) {
    setAccessToken(next.accessToken);
    confirmSeller(next.seller);
  }
}

function isLoginPath(path: string): boolean {
  return path === AUTH_LOGIN_PATH || path.startsWith(AUTH_CALLBACK_PATH_PREFIX);
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
      const path = hooks.currentPath();
      // seller 가 없어도 이 탭의 세션이 끝난 게 아니면(unknown — 새로고침 직후·이전 전환 직후, 복구가 진행 중일 수 있음) 계정 경계를 세운다.
      // 그대로 두면 진행 중인 복구가 refresh 시점 쿠키의 이전 계정을 이 세대의 계정으로 확정할 수 있다. 세대를 올려 그 복구를 stale 로 끝낸다.
      // 로그인 화면·콜백은 제외한다 — 보호 API 를 부르지 않고, 콜백은 이 탭 자신의 로그인 완료를 처리 중이다
      if (seller || (status !== 'signed-out' && !isLoginPath(path))) {
        // 이미 이 세대에서 같은 계정을 기다리는 경계를 세웠다 — 그 뒤의 복구는 그 계정 쿠키를 쓰고 있어 다시 끊지 않는다
        if (!seller && tabEventBoundary?.epoch === getAuthEpoch() && tabEventBoundary.sellerId === event.sellerId) return;
        // 한 브라우저 한 계정 — 기존 요청·미저장 편집·이전 계정 데이터를 버리고 새 계정으로 M1 에서 시작한다.
        // 새 계정 access 는 알림으로 받지 않는다. 다음 요청의 401 → refresh → /auth/me 가 새 계정으로 맞춘다
        crossAccountBoundary(null, event.sellerId);
        hooks.navigate(AUTH_HOME_PATH);
        return;
      }
      // 로그아웃 뒤 G1 에 있던 탭은 새 로그인을 따라 M1 로 간다
      if (status === 'signed-out' && path === AUTH_LOGIN_PATH) hooks.navigate(AUTH_HOME_PATH);
      return;
    }
  }
}

/** 앱 시작 때 한 번 — 다른 탭 알림 구독 */
export function startAuthTabSync(): () => void {
  return getAuthChannel().subscribe(handleAuthTabEvent);
}
