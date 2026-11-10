import { delay, http, HttpResponse } from 'msw';

import { AUTH_CSRF_HEADER, isSocialProvider } from '@/lib/auth/constants';
import {
  MOCK_AUTH_SELLERS,
  MOCK_PROVIDER_SELLER,
  mockAccessToken,
  readMockAuthScenario,
  readMockAuthServer,
  sellerIdFromMockAccess,
  takeMockAuthStep,
  writeMockAuthScenario,
  writeMockAuthServer,
} from '@/lib/mock-api/auth-fixtures';

/**
 * Mock 인증 API. FE↔BE 인증 합의와 server#124 의 응답 형태를 따른다 — 실제 서버 검증이 아니다.
 * 소셜 제공자 화면은 흉내 내지 않고, start 의 authorizeUrl 이 바로 /login/callback/{provider}?code&state 로 돌아오게 한다.
 */

function authError(status: number, code: string, reason: string | null, message = '인증 오류') {
  return HttpResponse.json(
    { error: { code, message, retryable: status === 503, details: reason ? { reason } : null, traceId: 'mock-auth' } },
    { status },
  );
}

const unavailable = () => authError(503, 'SERVICE_UNAVAILABLE', null, '일시적으로 처리할 수 없습니다');

function requireCsrf(request: Request) {
  return request.headers.get(AUTH_CSRF_HEADER) ? null : authError(422, 'VALIDATION_ERROR', null, 'X-Requested-With 헤더가 필요합니다');
}

export const authHandlers = [
  // 일반 API 의 access 만료 시나리오 — 앱 API 요청(프록시 식별 헤더)을 한 번만 401 TOKEN_EXPIRED 로 막는다
  http.all('*', ({ request }) => {
    if (!request.headers.get('x-pixlate-api-proxy')) return undefined;
    const scenario = readMockAuthScenario();
    if (!scenario.expireOnce) return undefined;
    writeMockAuthScenario({ ...scenario, expireOnce: false });
    return authError(401, 'TOKEN_EXPIRED', null, 'access 가 만료되었습니다');
  }),

  http.post('/auth/social/:provider/start', async ({ params, request }) => {
    const csrf = requireCsrf(request);
    if (csrf) return csrf;
    if (!isSocialProvider(params.provider)) return authError(404, 'NOT_FOUND', null, '지원하지 않는 제공자');
    const { start: forced, startDelayMs } = readMockAuthScenario();
    if (startDelayMs) await delay(startDelayMs);
    if (forced === 'not_found') return authError(404, 'NOT_FOUND', null, 'OAuth 미설정');
    if (forced === 'unavailable') return unavailable();
    if (forced === 'origin_not_allowed') return authError(401, 'UNAUTHORIZED', 'origin_not_allowed');
    const state = `mock-state-${params.provider}-${Date.now().toString(36)}`;
    writeMockAuthServer({ ...readMockAuthServer(), pendingState: state });
    return HttpResponse.json({ authorizeUrl: `/login/callback/${params.provider}?code=mock-code-${params.provider}&state=${state}` });
  }),

  http.post('/auth/social', async ({ request }) => {
    const csrf = requireCsrf(request);
    if (csrf) return csrf;
    const body = (await request.json().catch(() => null)) as { provider?: unknown; code?: unknown; state?: unknown } | null;
    const scenario = readMockAuthScenario();
    if (scenario.completeDelayMs) await delay(scenario.completeDelayMs);
    if (scenario.complete === 'login_in_progress') return authError(409, 'DUPLICATE', 'login_in_progress', '같은 로그인이 진행 중입니다');
    if (scenario.complete === 'provider_unavailable') return authError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable');
    if (scenario.complete === 'provider_auth_failed') return authError(401, 'UNAUTHORIZED', 'provider_auth_failed');
    if (!body || !isSocialProvider(body.provider) || typeof body.code !== 'string' || typeof body.state !== 'string') {
      return authError(422, 'VALIDATION_ERROR', null, 'provider·code·state 가 필요합니다');
    }
    const server = readMockAuthServer();
    if (scenario.complete === 'state_invalid' || server.pendingState !== body.state) return authError(401, 'UNAUTHORIZED', 'state_invalid');

    const sellerId = MOCK_PROVIDER_SELLER[body.provider];
    // 로그인마다 새 세션 — 같은 브라우저의 이전 세션은 끝난다(한 브라우저 한 계정)
    const generation = server.generation + 1;
    writeMockAuthServer({ sellerId, generation, pendingState: null });
    return HttpResponse.json({ accessToken: mockAccessToken(sellerId, generation), seller: MOCK_AUTH_SELLERS[sellerId] });
  }),

  http.post('/auth/refresh', ({ request }) => {
    const csrf = requireCsrf(request);
    if (csrf) return csrf;
    const step = takeMockAuthStep('refresh');
    if (step === 'rotated') return authError(401, 'UNAUTHORIZED', 'refresh_rotated');
    if (step === 'reused') {
      writeMockAuthServer({ ...readMockAuthServer(), sellerId: null });
      return authError(401, 'UNAUTHORIZED', 'refresh_reused');
    }
    if (step === 'invalid') return authError(401, 'UNAUTHORIZED', 'refresh_invalid');
    if (step === 'unavailable') return unavailable();
    if (step === 'origin_not_allowed') return authError(401, 'UNAUTHORIZED', 'origin_not_allowed');
    const server = readMockAuthServer();
    // switch:N — 다른 탭에서 계정 N 으로 로그인해 브라우저 쿠키가 바뀐 상황
    const switched = step?.startsWith('switch:') ? Number(step.slice('switch:'.length)) : null;
    const sellerId = switched ?? server.sellerId;
    if (sellerId == null) return authError(401, 'UNAUTHORIZED', 'refresh_invalid');
    const generation = server.generation + 1;
    writeMockAuthServer({ ...server, sellerId, generation });
    return HttpResponse.json({ accessToken: mockAccessToken(sellerId, generation) });
  }),

  http.get('/auth/me', ({ request }) => {
    const sellerId = sellerIdFromMockAccess(request.headers.get('Authorization'));
    const seller = sellerId == null ? undefined : MOCK_AUTH_SELLERS[sellerId];
    if (!seller) return authError(401, 'UNAUTHORIZED', 'invalid_token');
    return HttpResponse.json(seller);
  }),

  http.post('/auth/logout', ({ request }) => {
    const csrf = requireCsrf(request);
    if (csrf) return csrf;
    const step = takeMockAuthStep('logout');
    if (step === 'invalid_token') return authError(401, 'UNAUTHORIZED', 'invalid_token');
    if (step === 'origin_not_allowed') return authError(401, 'UNAUTHORIZED', 'origin_not_allowed');
    if (step === 'validation') return authError(422, 'VALIDATION_ERROR', null);
    if (step === 'unavailable') return unavailable();
    const server = readMockAuthServer();
    // 끝낼 세션 없음: 현행 후보는 401(사유 없음) — 204 로 바뀔 수 있다(BE 결정 대기)
    if (step === 'no_session' || server.sellerId == null) return authError(401, 'UNAUTHORIZED', null);
    writeMockAuthServer({ ...server, sellerId: null });
    return new HttpResponse(null, { status: 204 });
  }),
];
