import { getAuthMe, postAuthRefresh, postSocialComplete, postSocialStart } from '../api/auth.ts';
import { AUTH_REFRESH_EVENT_WAIT_MS, type SocialProvider } from './constants.ts';
import { classifySocialCompleteFailure, classifySocialStartFailure, type SocialLoginErrorKind } from './errors.ts';
import { clearLogoutPending } from './logout-pending.ts';
import { getAuthChannel, getAuthLock } from './runtime.ts';
import { setAuthenticated } from './session-store.ts';
import type { AuthApiResult, AuthSeller } from './types.ts';

/**
 * 소셜 로그인 시작·완료.
 *
 *   G1 버튼 → (중복 클릭 잠금) → POST /auth/social/{provider}/start → authorizeUrl 로 이동
 *   제공자 → /login/callback/{provider}?code&state → POST /auth/social(같은 provider+code+state 는 1회) → access 메모리·seller 반영
 *          → 다른 탭 login-complete 알림 → M1 (신규·기존 가입 구분 없음)
 */

// ── 시작 ──────────────────────────────────────

export type SocialStartResult = { kind: 'redirecting' } | { kind: 'busy' } | { kind: 'error'; error: SocialLoginErrorKind };

export interface SocialStartDeps {
  start: (provider: SocialProvider) => Promise<AuthApiResult<{ authorizeUrl: string }>>;
  redirect: (url: string) => void;
}

const defaultStartDeps: SocialStartDeps = {
  start: postSocialStart,
  redirect: (url) => window.location.assign(url),
};

let startLocked = false;

/** 두 버튼을 함께 잠근다 — 진행 중에는 어떤 제공자로도 다시 시작하지 않는다. 이동에 성공하면 페이지를 떠나므로 잠금을 풀지 않는다 */
export async function startSocialLogin(provider: SocialProvider, deps: SocialStartDeps = defaultStartDeps): Promise<SocialStartResult> {
  if (startLocked) return { kind: 'busy' };
  startLocked = true;
  const result = await deps.start(provider);
  if (!result.ok) {
    startLocked = false;
    return { kind: 'error', error: classifySocialStartFailure(result.error) };
  }
  deps.redirect(result.data.authorizeUrl);
  return { kind: 'redirecting' };
}

export function isSocialLoginStarting(): boolean {
  return startLocked;
}

/** 제공자 화면에서 뒤로 가기로 G1 이 bfcache 에서 복원되면 잠금이 남아 있다 — 그때 푼다 */
export function releaseSocialLoginStart(): void {
  startLocked = false;
}

/** 검증 스크립트 전용 */
export function resetSocialLoginForTest(): void {
  startLocked = false;
  completions.clear();
}

// ── 완료(콜백) ─────────────────────────────────

export type SocialCompleteResult = { kind: 'success'; seller: AuthSeller } | { kind: 'error'; error: SocialLoginErrorKind };

export interface SocialCompleteDeps {
  complete: typeof postSocialComplete;
  refresh: typeof postAuthRefresh;
  me: typeof getAuthMe;
  /** 같은 탭에서 이미 보낸 콜백 표시(새로고침 대비). 값은 provider:state 뿐 — code·토큰은 저장하지 않는다 */
  attemptStore: { read(): string | null; write(value: string): void; clear(): void } | null;
  waitMs?: number;
}

const ATTEMPT_KEY = 'pixlate:auth:callback-attempt';

const sessionAttemptStore: SocialCompleteDeps['attemptStore'] = {
  read() {
    try {
      return window.sessionStorage.getItem(ATTEMPT_KEY);
    } catch {
      return null;
    }
  },
  write(value) {
    try {
      window.sessionStorage.setItem(ATTEMPT_KEY, value);
    } catch {
      // 무시 — 같은 페이지 안 중복 방어(아래 completions)는 그대로 동작한다
    }
  },
  clear() {
    try {
      window.sessionStorage.removeItem(ATTEMPT_KEY);
    } catch {
      // 무시
    }
  },
};

function defaultCompleteDeps(): SocialCompleteDeps {
  return {
    complete: postSocialComplete,
    refresh: postAuthRefresh,
    me: getAuthMe,
    attemptStore: typeof window === 'undefined' ? null : sessionAttemptStore,
  };
}

/** 같은 provider+code+state 완료 요청은 페이지 안에서 한 번만 보낸다. 다시 불러도(Strict Mode effect 재실행 등) 같은 결과를 기다린다 */
const completions = new Map<string, Promise<SocialCompleteResult>>();

export function completeSocialLogin(
  params: { provider: SocialProvider; code: string; state: string },
  deps: SocialCompleteDeps = defaultCompleteDeps(),
): Promise<SocialCompleteResult> {
  const key = `${params.provider}\u0000${params.code}\u0000${params.state}`;
  const existing = completions.get(key);
  if (existing) return existing;
  const promise = runCompletion(params, deps);
  completions.set(key, promise);
  return promise;
}

function finishLogin(accessToken: string, seller: AuthSeller): SocialCompleteResult {
  setAuthenticated(accessToken, seller);
  clearLogoutPending();
  getAuthChannel().post({ type: 'login-complete', sellerId: seller.id });
  return { kind: 'success', seller };
}

async function runCompletion(params: { provider: SocialProvider; code: string; state: string }, deps: SocialCompleteDeps): Promise<SocialCompleteResult> {
  const marker = `${params.provider}:${params.state}`;
  // 같은 탭이 이 콜백을 이미 보냈다(완료 요청 중 새로고침). code 는 한 번만 쓸 수 있어 다시 보내지 않고, 먼저 보낸 요청이 남긴 세션으로 이어 간다
  if (deps.attemptStore?.read() === marker) return resumeEarlierLogin(deps);
  deps.attemptStore?.write(marker);

  const result = await deps.complete(params);
  if (result.ok) {
    deps.attemptStore?.clear();
    return finishLogin(result.data.accessToken, result.data.seller);
  }
  const kind = classifySocialCompleteFailure(result.error);
  // 먼저 시작된 같은 로그인이 진행 중 — 오류로 바꾸지 않고 그 결과를 기다린다(409 login_in_progress 는 BE 후보 계약)
  if (kind === 'in-progress') return resumeEarlierLogin(deps);
  // 네트워크 실패(새로고침으로 끊긴 요청 포함)는 서버가 요청을 받았는지 알 수 없다 — 기록을 남겨 같은 code 를 다시 보내지 않게 한다
  if (result.error.status !== 0) deps.attemptStore?.clear();
  return { kind: 'error', error: kind };
}

/**
 * 먼저 보낸 완료 요청의 결과를 이어받는다. 그 요청이 성공했다면 브라우저에 refresh 쿠키가 있으므로 refresh → /auth/me 로 로그인을 마친다.
 * 다른 탭의 login-complete 를 잠깐 기다린 뒤 한 번만 시도하고, 실패하면 처음부터 다시 로그인하도록 안내한다(자동 반복 없음).
 */
async function resumeEarlierLogin(deps: SocialCompleteDeps): Promise<SocialCompleteResult> {
  await getAuthChannel().waitFor('login-complete', deps.waitMs ?? AUTH_REFRESH_EVENT_WAIT_MS);
  const refreshed = await getAuthLock()(() => deps.refresh());
  deps.attemptStore?.clear();
  if (!refreshed.ok) return { kind: 'error', error: refreshed.error.status === 503 || refreshed.error.status === 0 ? 'unavailable' : 'state-invalid' };
  const me = await deps.me(refreshed.data.accessToken);
  if (!me.ok) return { kind: 'error', error: me.error.status === 503 || me.error.status === 0 ? 'unavailable' : 'state-invalid' };
  getAuthChannel().post({ type: 'refresh-complete' });
  return finishLogin(refreshed.data.accessToken, me.data);
}
