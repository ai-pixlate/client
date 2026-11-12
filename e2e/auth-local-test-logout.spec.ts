import { type Page, type Route, expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// 로컬 실서버 인증 연동 시험용 임시 로그아웃 진입점 — Chromium.
// 정식 로그아웃 UX 가 아니다(위치는 별도 디자인 확정 대상). 노출 기준은 lib/auth/capability.ts isLocalAuthTestMode().
//
// visible(로컬 실서버 시험 모드):
//   서버: NEXT_PUBLIC_API_MOCKING=disabled NEXT_PUBLIC_AUTH_MODE=session npx next dev -p 3000
//   실행: E2E_LOCAL_AUTH_LOGOUT=visible npx playwright test e2e/auth-local-test-logout.spec.ts --project=chromium
// hidden(production build — 같은 스위치 값이어도 숨김):
//   서버: NEXT_PUBLIC_API_MOCKING=disabled NEXT_PUBLIC_AUTH_MODE=session npx next build && npx next start -p 3000
//   실행: E2E_LOCAL_AUTH_LOGOUT=hidden npx playwright test e2e/auth-local-test-logout.spec.ts --project=chromium
// 일반 Mock 환경의 숨김은 e2e/g1-social-auth.spec.ts 가 확인한다.
//
// 백엔드 응답은 page.route 로 대신한다 — 실제 BE 인증을 검증하지 않는다. BE 실브라우저 재시험은 별도로 한다.
// ─────────────────────────────────────────────────────────────────

const MODE = process.env.E2E_LOCAL_AUTH_LOGOUT;
test.skip(({ browserName }) => browserName !== 'chromium' || (MODE !== 'visible' && MODE !== 'hidden'), 'E2E_LOCAL_AUTH_LOGOUT 와 맞는 서버에서 Chromium 으로 실행한다');

const PENDING_KEY = 'pixlate:auth:logout-pending';

type LogoutStep = 'ok' | 'invalid_token' | 'refresh_invalid' | 'unavailable';

function authError(route: Route, status: number, code: string, reason: string | null) {
  return route.fulfill({ status, json: { error: { code, message: 'x', retryable: status === 503, details: reason ? { reason } : null, traceId: 't' } } });
}

/** 인증·앱 API 를 대신하는 서버. logout 응답은 steps 를 앞에서 하나씩 쓰고, 비면 204 */
async function stubBackend(page: Page, logoutSteps: LogoutStep[] = []) {
  const calls: { method: string; path: string; auth: string | null }[] = [];
  const steps = [...logoutSteps];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const isApi = Boolean(request.headers()['x-pixlate-api-proxy']);
    const isAuth = pathname.startsWith('/auth/') && !/\.(gif|svg)$/.test(pathname);
    if (!isApi && !isAuth) return route.continue();
    calls.push({ method: request.method(), path: pathname, auth: request.headers()['authorization'] ?? null });
    if (isApi) return route.fulfill({ json: [] });
    if (pathname === '/auth/login') return route.fulfill({ json: { accessToken: 'dev-token' } });
    if (pathname.endsWith('/start')) return route.fulfill({ json: { authorizeUrl: '/login/callback/kakao?code=c1&state=s1' } });
    if (pathname === '/auth/social') return route.fulfill({ json: { accessToken: 'access-1', seller: { id: 1, email: 'a@pixlate.test' } } });
    if (pathname === '/auth/me') return route.fulfill({ json: { id: 1, email: 'a@pixlate.test' } });
    if (pathname === '/auth/refresh') return authError(route, 401, 'UNAUTHORIZED', 'refresh_invalid');
    if (pathname === '/auth/logout') {
      const step = steps.shift() ?? 'ok';
      if (step === 'invalid_token') return authError(route, 401, 'UNAUTHORIZED', 'invalid_token');
      if (step === 'refresh_invalid') return authError(route, 401, 'UNAUTHORIZED', 'refresh_invalid');
      if (step === 'unavailable') return authError(route, 503, 'SERVICE_UNAVAILABLE', null);
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return {
    calls,
    logouts: () => calls.filter((c) => c.path === '/auth/logout'),
    count: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length,
  };
}

/** G1 → 카카오 → 콜백 → M1 */
async function loginToM1(page: Page) {
  await page.goto('/login');
  await page.getByTestId('g1-social-kakao').click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
}

const pending = (page: Page) => page.evaluate((key) => localStorage.getItem(key), PENDING_KEY);
const entry = (page: Page) => page.getByTestId('local-auth-test-logout');

test.describe('hidden — production build', () => {
  test.skip(MODE !== 'hidden', 'hidden 모드 전용');

  test('같은 스위치 값이어도 production 에서는 M1 에 임시 로그아웃 진입점이 없다', async ({ page }) => {
    await stubBackend(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(entry(page)).toHaveCount(0);
  });
});

test.describe('visible — 로컬 실서버 인증 시험 모드', () => {
  test.skip(MODE !== 'visible', 'visible 모드 전용');

  test('M1 에 임시 진입점이 보이고 키보드로 접근할 수 있다', async ({ page }) => {
    await stubBackend(page);
    await loginToM1(page);
    await expect(entry(page)).toBeVisible();
    await entry(page).focus();
    await expect(entry(page)).toBeFocused();
  });

  test('204 → Bearer 로 1회, G1, 대기 없음, refresh 없음', async ({ page }) => {
    const server = await stubBackend(page);
    await loginToM1(page);
    await entry(page).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(500);
    expect(server.logouts().map((c) => c.auth)).toEqual(['Bearer access-1']);
    expect(server.count('POST', '/auth/refresh')).toBe(0);
    expect(await pending(page)).toBeNull();
    await expect(page.getByTestId('g1-logout-pending')).toHaveCount(0);
  });

  test('Bearer invalid_token → 쿠키만으로 1회 다시 → 204', async ({ page }) => {
    const server = await stubBackend(page, ['invalid_token']);
    await loginToM1(page);
    await entry(page).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(500);
    expect(server.logouts().map((c) => c.auth)).toEqual(['Bearer access-1', null]);
    expect(server.count('POST', '/auth/refresh')).toBe(0);
    expect(await pending(page)).toBeNull();
  });

  test('refresh_invalid → 추가 요청 없음, G1, 대기 해제', async ({ page }) => {
    const server = await stubBackend(page, ['refresh_invalid']);
    await loginToM1(page);
    await entry(page).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(500);
    expect(server.logouts()).toHaveLength(1);
    expect(server.count('POST', '/auth/refresh')).toBe(0);
    expect(await pending(page)).toBeNull();
    await expect(page.getByTestId('g1-logout-pending')).toHaveCount(0);
  });

  test('503 → G1, 대기 유지, 안내 표시, refresh·보호 API 없음 → [다시 시도] 204 로 해제', async ({ page }) => {
    const server = await stubBackend(page, ['unavailable']);
    await loginToM1(page);
    const before = server.calls.length;
    await entry(page).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(800);
    expect(server.calls.slice(before).map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/logout']);
    expect(await pending(page)).toBe('1');
    await expect(page.getByTestId('g1-logout-pending')).toContainText('로그아웃했지만 서버 로그아웃을 확인하지 못했습니다.');
    await expect(page.getByTestId('auth-notice')).toHaveAttribute('data-notice', 'logout-pending');

    await page.getByTestId('g1-logout-pending-retry').click();
    await expect(page.getByTestId('g1-logout-pending')).toHaveCount(0);
    expect(server.logouts().at(-1)!.auth).toBeNull();
    expect(server.count('POST', '/auth/refresh')).toBe(0);
    expect(await pending(page)).toBeNull();
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('같은 탭 중복 클릭 → 로그아웃 요청 1회', async ({ page }) => {
    const server = await stubBackend(page);
    await loginToM1(page);
    await entry(page).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
      button.click();
    });
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(500);
    expect(server.logouts()).toHaveLength(1);
  });

  test('다른 탭 → logout 알림을 받아 G1', async ({ context }) => {
    const a = await context.newPage();
    await stubBackend(a);
    await loginToM1(a);
    const b = await context.newPage();
    const serverB = await stubBackend(b);
    await loginToM1(b);
    await entry(b).click();
    await b.waitForURL((url) => url.pathname === '/login');
    await a.waitForURL((url) => url.pathname === '/login');
    expect(serverB.logouts()).toHaveLength(1);
  });

  test('logoutPending + 앱 진입 204 → refresh·보호 API 0회, G1', async ({ page }) => {
    // 첫 문서의 bootstrap 보다 먼저 기록을 심는다 — G1 을 먼저 열고 심으면 G1 의 늦은 bootstrap 이 그 기록을 먼저 처리한다
    await page.addInitScript((key) => {
      if (sessionStorage.getItem('e2e:pending-seeded')) return;
      sessionStorage.setItem('e2e:pending-seeded', '1');
      localStorage.setItem(key, '1');
    }, PENDING_KEY);
    const server = await stubBackend(page);
    await page.goto('/');
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(800);
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/logout']);
    expect(await pending(page)).toBeNull();
  });
});
