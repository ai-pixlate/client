import { type Page, type Route, expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// 세션 사용자용 정식 로그아웃 버튼(M1 우측 상단, Figma 확정 전 임시 위치) — production build, Chromium.
// 노출 기준: lib/auth/capability.ts isAccountLogoutEnabled(). 동작은 lib/auth/logout.ts logout() 그대로다.
//
// session(정식 버튼 보임·로그아웃 계약):
//   서버: NEXT_PUBLIC_API_MOCKING=disabled NEXT_PUBLIC_AUTH_MODE=session npx next build && npx next start -p 3000
//   실행: E2E_PROD_AUTH=session npx playwright test e2e/auth-production-logout.spec.ts --project=chromium
// unset(기본 dev-login — 정식·임시 버튼 모두 숨김):
//   서버: NEXT_PUBLIC_API_MOCKING=disabled npx next build && npx next start -p 3000
//   실행: E2E_PROD_AUTH=unset npx playwright test e2e/auth-production-logout.spec.ts --project=chromium
//
// 백엔드 응답은 page.route 로 대신한다 — 실제 OAuth·서버 세션 폐기를 검증하지 않는다.
// ─────────────────────────────────────────────────────────────────

const MODE = process.env.E2E_PROD_AUTH;
test.skip(({ browserName }) => browserName !== 'chromium' || (MODE !== 'unset' && MODE !== 'session'), 'E2E_PROD_AUTH 와 맞는 production 서버에서 Chromium 으로 실행한다');

const PENDING_KEY = 'pixlate:auth:logout-pending';

type LogoutStep = 'ok' | 'invalid_token' | 'refresh_invalid' | 'unavailable' | 'slow-ok';

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
      if (step === 'slow-ok') await new Promise((resolve) => setTimeout(resolve, 1500));
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
const entry = (page: Page) => page.getByTestId('account-logout');
const tempEntry = (page: Page) => page.getByTestId('local-auth-test-logout');

test.describe('unset — 기본 production(dev-login)', () => {
  test.skip(MODE !== 'unset', 'unset 모드 전용');

  test('dev-login 으로 M1 이 열리고 정식·임시 로그아웃 버튼이 모두 없다', async ({ page }) => {
    const server = await stubBackend(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
    await expect.poll(() => server.count('POST', '/auth/login')).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await expect(entry(page)).toHaveCount(0);
    await expect(tempEntry(page)).toHaveCount(0);
  });
});

test.describe('session — 정식 로그아웃 버튼', () => {
  test.skip(MODE !== 'session', 'session 모드 전용');

  test('M1 우측 상단에 「로그아웃」이 보이고 임시 시험 버튼은 없다·키보드 접근 가능', async ({ page }) => {
    await stubBackend(page);
    await loginToM1(page);
    await expect(entry(page)).toBeVisible();
    await expect(entry(page)).toHaveText('로그아웃');
    await expect(tempEntry(page)).toHaveCount(0);
    const box = (await entry(page).boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y).toBeLessThan(80);
    expect(viewport.width - (box.x + box.width)).toBeLessThan(60);
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

  test('Bearer invalid_token → 쿠키만으로 정확히 1회 다시 → 204, G1', async ({ page }) => {
    const server = await stubBackend(page, ['invalid_token']);
    await loginToM1(page);
    await entry(page).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(500);
    expect(server.logouts().map((c) => c.auth)).toEqual(['Bearer access-1', null]);
    expect(server.count('POST', '/auth/refresh')).toBe(0);
    expect(await pending(page)).toBeNull();
  });

  test('쿠키만 재요청도 invalid_token → 더 보내지 않음(총 2회), 대기 유지', async ({ page }) => {
    const server = await stubBackend(page, ['invalid_token', 'invalid_token']);
    await loginToM1(page);
    await entry(page).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(800);
    expect(server.logouts().map((c) => c.auth)).toEqual(['Bearer access-1', null]);
    expect(server.count('POST', '/auth/refresh')).toBe(0);
    expect(await pending(page)).toBe('1');
  });

  test('refresh_invalid → 추가 logout·refresh 없음, G1, 대기 해제', async ({ page }) => {
    const server = await stubBackend(page, ['refresh_invalid']);
    await loginToM1(page);
    const before = server.calls.length;
    await entry(page).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(800);
    expect(server.calls.slice(before).map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/logout']);
    expect(await pending(page)).toBeNull();
    await expect(page.getByTestId('g1-logout-pending')).toHaveCount(0);
  });

  test('503 → G1, 대기 유지, 미완료 안내, 자동 재시도 없음 → [다시 시도] 204 로 해제', async ({ page }) => {
    const server = await stubBackend(page, ['unavailable']);
    await loginToM1(page);
    const before = server.calls.length;
    await entry(page).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(1500);
    expect(server.calls.slice(before).map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/logout']);
    expect(await pending(page)).toBe('1');
    await expect(page.getByTestId('g1-logout-pending')).toContainText('로그아웃했지만 서버 로그아웃을 확인하지 못했습니다.');
    await expect(page.getByTestId('auth-notice')).toHaveAttribute('data-notice', 'logout-pending');

    await page.getByTestId('g1-logout-pending-retry').click();
    await expect(page.getByTestId('g1-logout-pending')).toHaveCount(0);
    expect(server.logouts()).toHaveLength(2);
    expect(server.logouts().at(-1)!.auth).toBeNull();
    expect(server.count('POST', '/auth/refresh')).toBe(0);
    expect(await pending(page)).toBeNull();
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('진행 중에는 「로그아웃 중...」·비활성, 중복 클릭해도 요청 1회', async ({ page }) => {
    const server = await stubBackend(page, ['slow-ok']);
    await loginToM1(page);
    await entry(page).click();
    await expect(entry(page)).toHaveText('로그아웃 중...');
    await expect(entry(page)).toHaveAttribute('aria-disabled', 'true');
    await entry(page).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(500);
    expect(server.logouts()).toHaveLength(1);
  });

  test('multi-tab — 탭 B 에서 로그아웃 → 기존 logout 알림으로 탭 A 도 G1, 두 탭 모두 정식 버튼 없음', async ({ context }) => {
    const a = await context.newPage();
    const serverA = await stubBackend(a);
    await loginToM1(a);
    const b = await context.newPage();
    const serverB = await stubBackend(b);
    await loginToM1(b);
    await entry(b).click();
    await b.waitForURL((url) => url.pathname === '/login');
    await a.waitForURL((url) => url.pathname === '/login');
    await a.waitForTimeout(500);
    expect(serverB.logouts()).toHaveLength(1);
    expect(serverA.logouts()).toHaveLength(0);
    await expect(entry(a)).toHaveCount(0);
    await expect(entry(b)).toHaveCount(0);
  });
});
