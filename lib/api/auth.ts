import type { components } from './generated/openapi';

type LoginRequest = components['schemas']['LoginRequest'];
type LoginResponse = components['schemas']['LoginResponse'];

export type LoginFailureKind = 'invalid-credentials' | 'invalid-request' | 'unavailable';

export type LoginResult =
  | { ok: true; seller: LoginResponse['seller'] | null }
  | { ok: false; kind: LoginFailureKind };

/**
 * POST /auth/login (API-AUTH-01). refresh 는 서버가 HttpOnly 쿠키로 주므로 credentials: 'include' 로 보낸다.
 *
 * 응답의 accessToken 은 일부러 어디에도 보관하지 않고 호출자에게도 돌려주지 않는다. 현재 session.ts 는 개발용 자동 로그인과
 * sessionStorage 보관만 있어, 메모리 토큰·refresh·보호 라우트를 갖춘 세션 작업이 별도로 끝나야 실제 로그인이 성립한다.
 */
export async function loginWithEmail(request: LoginRequest): Promise<LoginResult> {
  let response: Response;
  try {
    response = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  if (response.status === 401) return { ok: false, kind: 'invalid-credentials' };
  if (response.status === 400) return { ok: false, kind: 'invalid-request' };
  if (!response.ok) return { ok: false, kind: 'unavailable' };
  try {
    const body = (await response.json()) as LoginResponse;
    if (!body.accessToken) return { ok: false, kind: 'unavailable' };
    return { ok: true, seller: body.seller ?? null };
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
}
