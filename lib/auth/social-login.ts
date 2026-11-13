import { postSocialComplete, postSocialStart } from '../api/auth.ts';
import { clearCallbackState, markCallbackInFlight, markCallbackUnconfirmed, readCallbackState } from './callback-state.ts';
import type { SocialProvider } from './constants.ts';
import { classifySocialCompleteFailure, classifySocialStartFailure, type SocialLoginErrorKind } from './errors.ts';
import { clearLogoutPending } from './logout-pending.ts';
import { getAuthChannel } from './runtime.ts';
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
  // 새 로그인 흐름이 시작됐다 — 이전 callback 의 「완료 여부 모름」 차단을 푼다
  clearCallbackState();
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
}

const defaultCompleteDeps: SocialCompleteDeps = { complete: postSocialComplete };

/**
 * 같은 provider+code+state 완료 요청은 같은 document 안에서 한 번만 보낸다. 다시 불러도(Strict Mode effect 재실행·재마운트) 같은 Promise 를 기다린다.
 *
 * 새로고침(새 document)은 다르게 다룬다 — 확정 계약(2차): 응답 전 새로고침된 callback 은 같은 /auth/social 을 다시 보내지 않고,
 * refresh 로 성공을 추측하지도 않는다. 이 document 에 Promise 가 없는데 callback 상태 기록이 있으면 이전 document 가 이미 보낸 것으로 보고
 * 「완료 여부를 확인할 수 없음」으로 끝낸다(세션 자동 복원 차단 → G1 → 새 start). 서버 쪽 결과 재전달은 계약에 없다.
 */
const completions = new Map<string, Promise<SocialCompleteResult>>();

const UNCONFIRMED: SocialCompleteResult = { kind: 'error', error: 'callback-unconfirmed' };

export function completeSocialLogin(
  params: { provider: SocialProvider; code: string; state: string },
  deps: SocialCompleteDeps = defaultCompleteDeps,
): Promise<SocialCompleteResult> {
  const key = `${params.provider}\u0000${params.code}\u0000${params.state}`;
  const existing = completions.get(key);
  if (existing) return existing;
  let promise: Promise<SocialCompleteResult>;
  if (readCallbackState() !== null) {
    markCallbackUnconfirmed();
    promise = Promise.resolve(UNCONFIRMED);
  } else {
    // 첫 await 전에 동기로 기록한다 — 응답 전에 새로고침되면 새 document 가 이 기록을 본다
    markCallbackInFlight();
    promise = runCompletion(params, deps);
  }
  completions.set(key, promise);
  return promise;
}

async function runCompletion(params: { provider: SocialProvider; code: string; state: string }, deps: SocialCompleteDeps): Promise<SocialCompleteResult> {
  const result = await deps.complete(params);
  if (result.ok) {
    clearCallbackState();
    setAuthenticated(result.data.accessToken, result.data.seller);
    clearLogoutPending();
    getAuthChannel().post({ type: 'login-complete', sellerId: result.data.seller.id });
    return { kind: 'success', seller: result.data.seller };
  }
  const kind = classifySocialCompleteFailure(result.error);
  // 결과를 알 수 없는 경우 — 네트워크 끊김(새로고침으로 끊긴 요청 포함), login_in_progress(다른 document 의 같은 시도).
  // 자동 반복·refresh 추측 없이 불확정으로 끝내고 세션 자동 복원을 막는다
  if (result.error.status === 0 || kind === 'in-progress') {
    markCallbackUnconfirmed();
    return UNCONFIRMED;
  }
  // 서버가 이번 시도를 거절했다(로그인되지 않음이 확정) — 차단할 이유가 없다
  clearCallbackState();
  return { kind: 'error', error: kind };
}
