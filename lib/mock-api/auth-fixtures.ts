import type { AuthSeller } from '../auth/types.ts';

/**
 * Mock 인증 서버 상태(MSW 전용). 실제 서버의 Redis 세션 대신, 같은 브라우저의 모든 탭이 공유하도록 localStorage 에 둔다
 * — 브라우저 refresh 쿠키가 탭 사이에서 공유되는 것을 흉내 낸다. 저장하는 값은 Mock 계정 id·세대·로그인 시도 state 뿐이며
 * access token 은 저장하지 않는다(앱 코드는 이 키를 읽지 않는다).
 *
 * 기본값은 Mock 계정 1 로 로그인된 브라우저다 — 기존 N1~N6 Mock 흐름이 로그인 없이 그대로 동작한다.
 */
export const MOCK_AUTH_SERVER_KEY = 'pixlate:mock-auth-server';
/**
 * 시험용 시나리오(sessionStorage, 탭별). 값은 JSON:
 * { start?: 'not_found' | 'unavailable' | 'origin_not_allowed',
 *   complete?: 'state_invalid' | 'provider_auth_failed' | 'provider_unavailable' | 'login_in_progress',
 *   refresh?: Array<'ok' | 'rotated' | 'reused' | 'invalid' | 'unavailable' | 'origin_not_allowed' | `switch:${number}`>,
 *   logout?: Array<'ok' | 'invalid_token' | 'refresh_invalid' | 'origin_not_allowed' | 'validation' | 'unavailable'>,
 *   expireOnce?: boolean, startDelayMs?: number, completeDelayMs?: number }
 * refresh·logout 배열은 요청마다 앞에서 하나씩 쓴다. 비면 기본 동작이다.
 */
export const MOCK_AUTH_SCENARIO_KEY = 'pixlate:mock-auth-scenario';

export interface MockAuthServerState {
  sellerId: number | null;
  generation: number;
  pendingState: string | null;
}

export const MOCK_AUTH_SELLERS: Record<number, AuthSeller> = {
  1: { id: 1, email: 'kakao-seller@pixlate.mock', accountType: 'individual', createdAt: '2026-11-01T00:00:00Z' },
  2: { id: 2, email: 'google-seller@pixlate.mock', accountType: 'individual', createdAt: '2026-11-02T00:00:00Z' },
};

/** Mock 제공자별 계정 — 카카오 = 1, Google = 2 */
export const MOCK_PROVIDER_SELLER: Record<string, number> = { kakao: 1, google: 2 };

const DEFAULT_STATE: MockAuthServerState = { sellerId: 1, generation: 1, pendingState: null };

export function readMockAuthServer(): MockAuthServerState {
  try {
    const raw = window.localStorage.getItem(MOCK_AUTH_SERVER_KEY);
    return raw ? { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<MockAuthServerState>) } : { ...DEFAULT_STATE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeMockAuthServer(state: MockAuthServerState): void {
  try {
    window.localStorage.setItem(MOCK_AUTH_SERVER_KEY, JSON.stringify(state));
  } catch {
    // 무시
  }
}

export interface MockAuthScenario {
  start?: 'not_found' | 'unavailable' | 'origin_not_allowed';
  complete?: 'state_invalid' | 'provider_auth_failed' | 'provider_unavailable' | 'login_in_progress';
  refresh?: string[];
  logout?: string[];
  expireOnce?: boolean;
  startDelayMs?: number;
  completeDelayMs?: number;
}

export function readMockAuthScenario(): MockAuthScenario {
  try {
    const raw = window.sessionStorage.getItem(MOCK_AUTH_SCENARIO_KEY);
    return raw ? (JSON.parse(raw) as MockAuthScenario) : {};
  } catch {
    return {};
  }
}

export function writeMockAuthScenario(scenario: MockAuthScenario): void {
  try {
    window.sessionStorage.setItem(MOCK_AUTH_SCENARIO_KEY, JSON.stringify(scenario));
  } catch {
    // 무시
  }
}

/** 시나리오 배열에서 다음 값을 꺼낸다 */
export function takeMockAuthStep(field: 'refresh' | 'logout'): string | null {
  const scenario = readMockAuthScenario();
  const queue = scenario[field];
  if (!queue || queue.length === 0) return null;
  const [next, ...rest] = queue;
  writeMockAuthScenario({ ...scenario, [field]: rest });
  return next;
}

/** Mock access 형식: mock-access.<sellerId>.<세대> — 서버 서명 대신 계정만 알아보게 한다 */
export function mockAccessToken(sellerId: number, generation: number): string {
  return `mock-access.${sellerId}.${generation}`;
}

export function sellerIdFromMockAccess(authorization: string | null): number | null {
  const match = /^Bearer mock-access\.(\d+)\.\d+$/.exec(authorization ?? '');
  return match ? Number(match[1]) : null;
}
