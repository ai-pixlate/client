import { postSocialComplete, postSocialStart } from '../api/auth.ts';
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
 * 새로고침은 다르게 다룬다 — 새 document 에는 먼저 보낸 요청의 Promise 가 없고, 그 결과를 다시 받을 방법(계약)도 없다.
 * 그래서 새 document 는 같은 콜백을 한 번 다시 보내고, 서버 응답만으로 성공·실패를 정한다(성공 → 로그인, 실패 → 처음부터 다시).
 * refresh 로 결과를 추측하지 않는다: 먼저 보낸 요청이 끝나지 않았는데 브라우저에 이전 세션 쿠키가 있으면 다른 계정으로 로그인될 수 있다.
 */
const completions = new Map<string, Promise<SocialCompleteResult>>();

export function completeSocialLogin(
  params: { provider: SocialProvider; code: string; state: string },
  deps: SocialCompleteDeps = defaultCompleteDeps,
): Promise<SocialCompleteResult> {
  const key = `${params.provider}\u0000${params.code}\u0000${params.state}`;
  const existing = completions.get(key);
  if (existing) return existing;
  const promise = runCompletion(params, deps);
  completions.set(key, promise);
  return promise;
}

async function runCompletion(params: { provider: SocialProvider; code: string; state: string }, deps: SocialCompleteDeps): Promise<SocialCompleteResult> {
  const result = await deps.complete(params);
  if (result.ok) {
    setAuthenticated(result.data.accessToken, result.data.seller);
    clearLogoutPending();
    getAuthChannel().post({ type: 'login-complete', sellerId: result.data.seller.id });
    return { kind: 'success', seller: result.data.seller };
  }
  // in-progress(409 login_in_progress, BE 후보)는 다른 document 가 먼저 보낸 같은 시도다 — 그 결과를 받을 계약이 없어
  // 기다리지 않고 「처음부터 다시」로 끝낸다. TODO(AUTH-CONTRACT): callback 요청 진행 중 document reload 시 완료 결과 복구 방식 필요
  return { kind: 'error', error: classifySocialCompleteFailure(result.error) };
}
