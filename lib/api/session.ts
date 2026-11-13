import { getAccessToken, setAccessToken } from '../auth/session-store.ts';

/**
 * 로컬 실백엔드 연동용 개발용 간이 세션(인증 모드 'dev-login' — lib/auth/capability.ts).
 *
 * 실서버에는 아직 소셜 로그인과 세션 refresh 회전(server#124)이 배포되지 않았다. mock 이 꺼진 동안만 개발용 이메일로
 * /auth/login 한 뒤 accessToken 을 메모리(lib/auth/session-store.ts)에 둔다 — 브라우저 저장소에는 쓰지 않으므로
 * 새로고침하면 다시 간이 로그인한다. MSW 모드에서는 호출하지 않는다.
 *
 * TODO(AUTH-CONTRACT): 실서버가 'session' 모드로 바뀌면 이 간이 로그인은 제거한다.
 */
let inflight: Promise<void> | null = null;

export function isApiMockingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_API_MOCKING === 'enabled';
}

/**
 * 앱 시작 때 개발용 자동 로그인을 실행할 화면인지 판단한다. G1 과 소셜 콜백(/login/callback/*)은 서버 인증 요청을 따로 다루므로 제외한다.
 * 다른 화면의 동작은 그대로이고, 로그인 화면에서 넘어가도 첫 API 호출 때 authorizedFetch 가 세션을 만든다.
 */
export function shouldBootstrapBackendSession(pathname: string): boolean {
  return pathname !== '/login' && !pathname.startsWith('/login/');
}

export function ensureBackendSession(): Promise<void> {
  if (isApiMockingEnabled()) return Promise.resolve();
  if (typeof window === 'undefined') return Promise.resolve();
  if (getAccessToken()) return Promise.resolve();
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const email = process.env.NEXT_PUBLIC_DEV_SELLER_EMAIL ?? 'local-dev@pixlate.local';
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'local' }),
      });
      if (!res.ok) {
        throw new Error(`login failed: ${res.status}`);
      }
      const data = (await res.json()) as { accessToken?: string };
      if (!data.accessToken) {
        throw new Error('login failed: accessToken missing');
      }
      setAccessToken(data.accessToken);
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
