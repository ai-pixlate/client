/**
 * 로컬 실백엔드 연동용 간이 세션.
 *
 * 백엔드는 Bearer JWT가 필요하고(GET /master/* 제외), FE에는 아직 로그인
 * 화면이 없다. mock이 꺼진 동안만 개발용 이메일로 /auth/login 한 뒤
 * accessToken을 sessionStorage에 둔다. MSW 모드에서는 호출하지 않는다.
 */
const TOKEN_KEY = 'pixlate.accessToken';

let inflight: Promise<void> | null = null;

export function isApiMockingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_API_MOCKING === 'enabled';
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * 앱 시작 때 개발용 자동 로그인을 실행할 화면인지 판단한다. 로그인 화면은 서버 인증 요청을 보내지 않아야 하므로 제외한다.
 * 다른 화면의 동작은 그대로이고, 로그인 화면에서 넘어가도 첫 API 호출 때 authorizedFetch 가 세션을 만든다.
 */
export function shouldBootstrapBackendSession(pathname: string): boolean {
  return pathname !== '/login';
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
