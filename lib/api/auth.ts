import { AUTH_CSRF_HEADER, AUTH_CSRF_VALUE, type SocialProvider } from '../auth/constants.ts';
import { NETWORK_ERROR, readAuthError } from '../auth/errors.ts';
import type { AuthApiResult, AuthSeller } from '../auth/types.ts';

/**
 * 인증 API adapter. 일반 API 의 authorizedFetch(401 → refresh → 재시도)를 거치지 않는다 —
 * refresh·logout 이 다시 refresh 를 부르는 재귀를 막기 위해서다. 실패는 throw 하지 않고 AuthApiResult 로 돌려준다.
 *
 * 계약 출처: /auth/refresh·/auth/logout·/auth/me = server#124(공개 OpenAPI v3.5.10 위에 세션 규칙 추가, 배포 대기).
 * /auth/social/{provider}/start·POST /auth/social = FE↔BE 인증 합의. 공개 OpenAPI 의 /auth/social 은 아직 이전 stub 이다.
 */

function csrfHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set(AUTH_CSRF_HEADER, AUTH_CSRF_VALUE);
  return headers;
}

async function request<T>(url: string, init: RequestInit, parse: (body: unknown) => T | null): Promise<AuthApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: readAuthError(res.status, body) };
  const data = parse(body);
  // 성공 응답인데 필요한 값이 없으면 계약 위반 — 실패로 다룬다(세션 상태는 바꾸지 않는다)
  if (data === null) return { ok: false, error: { status: res.status, code: null, reason: 'malformed_response' } };
  return { ok: true, data };
}

function parseAccessToken(body: unknown): { accessToken: string } | null {
  const token = (body as { accessToken?: unknown } | null)?.accessToken;
  return typeof token === 'string' && token ? { accessToken: token } : null;
}

export function parseSeller(body: unknown): AuthSeller | null {
  if (!body || typeof body !== 'object') return null;
  const rec = body as Record<string, unknown>;
  if (typeof rec.id !== 'number') return null;
  return {
    id: rec.id,
    email: typeof rec.email === 'string' ? rec.email : null,
    ...(rec.accountType === 'individual' || rec.accountType === 'business' ? { accountType: rec.accountType } : {}),
    ...(typeof rec.createdAt === 'string' ? { createdAt: rec.createdAt } : {}),
  };
}

/** POST /auth/refresh — 쿠키로 새 access 를 받는다. 응답에 계정 정보가 없다(server#124) */
export function postAuthRefresh(): Promise<AuthApiResult<{ accessToken: string }>> {
  return request('/auth/refresh', { method: 'POST', credentials: 'include', headers: csrfHeaders() }, parseAccessToken);
}

/** GET /auth/me — refresh 뒤 계정이 바뀌었는지 확인한다 */
export function getAuthMe(accessToken: string): Promise<AuthApiResult<AuthSeller>> {
  return request('/auth/me', { method: 'GET', credentials: 'include', headers: new Headers({ Authorization: `Bearer ${accessToken}` }) }, parseSeller);
}

/**
 * POST /auth/logout. accessToken 이 있으면 Bearer 로 함께 보낸다(만료됐어도 사전 refresh 없이 그대로).
 * TODO(AUTH-CONTRACT): confirm cookie-only logout contract with BE — accessToken 없이 쿠키만으로 로그아웃되는지는 BE 최종 답변 대기
 */
export function postAuthLogout(options: { accessToken?: string | null } = {}): Promise<AuthApiResult<true>> {
  const headers = csrfHeaders();
  if (options.accessToken) headers.set('Authorization', `Bearer ${options.accessToken}`);
  // 204 본문 없음 — 성공 여부만 본다
  return request('/auth/logout', { method: 'POST', credentials: 'include', headers }, () => true as const);
}

/** POST /auth/social/{provider}/start — 본문 없음. 서버가 로그인 시도용 HttpOnly 쿠키를 설정하고 authorizeUrl 을 준다 */
export function postSocialStart(provider: SocialProvider): Promise<AuthApiResult<{ authorizeUrl: string }>> {
  return request(`/auth/social/${provider}/start`, { method: 'POST', credentials: 'include', headers: csrfHeaders() }, (body) => {
    const url = (body as { authorizeUrl?: unknown } | null)?.authorizeUrl;
    return typeof url === 'string' && url ? { authorizeUrl: url } : null;
  });
}

/** POST /auth/social — 제공자 콜백의 code·state 로 로그인을 끝낸다. 신규·기존 가입 구분 필드는 없다 */
export function postSocialComplete(payload: { provider: SocialProvider; code: string; state: string }): Promise<AuthApiResult<{ accessToken: string; seller: AuthSeller }>> {
  return request(
    '/auth/social',
    { method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) },
    (body) => {
      const token = parseAccessToken(body);
      const seller = parseSeller((body as { seller?: unknown } | null)?.seller);
      return token && seller ? { accessToken: token.accessToken, seller } : null;
    },
  );
}
