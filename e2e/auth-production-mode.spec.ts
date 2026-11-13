import { type Page, expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// production build 인증 모드 스위치(NEXT_PUBLIC_AUTH_MODE) smoke — Chromium.
// 기준: lib/auth/capability.ts. NEXT_PUBLIC_* 는 build 시점 값이므로 모드마다 따로 빌드한다.
//
// unset(기본 — dev-login):
//   서버: NEXT_PUBLIC_API_MOCKING=disabled npx next build && npx next start -p 3000
//   실행: E2E_PROD_AUTH=unset npx playwright test e2e/auth-production-mode.spec.ts --project=chromium
// session(명시적 opt-in):
//   서버: NEXT_PUBLIC_API_MOCKING=disabled NEXT_PUBLIC_AUTH_MODE=session npx next build && npx next start -p 3000
//   실행: E2E_PROD_AUTH=session npx playwright test e2e/auth-production-mode.spec.ts --project=chromium
//
// 백엔드 응답은 page.route 로 대신한다 — 실제 OAuth·서버 세션 완료를 검증하지 않는다.
// 두 모드 모두 M1 임시 로그아웃 시험 버튼(isLocalAuthTestMode, development 전용)은 보이지 않아야 한다.
// ─────────────────────────────────────────────────────────────────

const MODE = process.env.E2E_PROD_AUTH;
test.skip(({ browserName }) => browserName !== 'chromium' || (MODE !== 'unset' && MODE !== 'session'), 'E2E_PROD_AUTH 와 맞는 production 서버에서 Chromium 으로 실행한다');

/** 인증·앱 API 를 대신하는 서버. 정적 자산은 그대로 보낸다 */
async function stubBackend(page: Page) {
  const calls: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const isApi = Boolean(request.headers()['x-pixlate-api-proxy']);
    const isAuth = pathname.startsWith('/auth/') && !/\.(gif|svg)$/.test(pathname);
    if (!isApi && !isAuth) return route.continue();
    calls.push(`${request.method()} ${pathname}`);
    if (isApi) return route.fulfill({ json: [] });
    if (pathname === '/auth/login') return route.fulfill({ json: { accessToken: 'dev-token' } });
    if (pathname.endsWith('/start')) return route.fulfill({ json: { authorizeUrl: '/login/callback/kakao?code=c1&state=s1' } });
    if (pathname === '/auth/social') return route.fulfill({ json: { accessToken: 'access-1', seller: { id: 1, email: 'a@pixlate.test' } } });
    if (pathname === '/auth/me') return route.fulfill({ json: { id: 1, email: 'a@pixlate.test' } });
    if (pathname === '/auth/refresh') {
      return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'x', retryable: false, details: { reason: 'refresh_invalid' }, traceId: 't' } } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return calls;
}

const tempLogout = (page: Page) => page.getByTestId('local-auth-test-logout');

test.describe('unset — 기본 production(dev-login)', () => {
  test.skip(MODE !== 'unset', 'unset 모드 전용');

  test('카카오·Google 버튼은 비활성이고 눌러도 인증 요청이 없다', async ({ page }) => {
    const calls = await stubBackend(page);
    await page.goto('/login');
    await expect(page.getByTestId('g1-social')).toBeVisible();
    for (const provider of ['kakao', 'google'] as const) {
      await expect(page.getByTestId(`g1-social-${provider}`)).toHaveAttribute('aria-disabled', 'true');
      await page.getByTestId(`g1-social-${provider}`).click({ force: true });
    }
    await page.waitForTimeout(500);
    expect(calls.filter((c) => c.includes('/auth/'))).toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('M1 은 dev-login 으로 열리고 임시 로그아웃 버튼이 없다', async ({ page }) => {
    const calls = await stubBackend(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
    await expect.poll(() => calls.includes('POST /auth/login')).toBe(true);
    await page.waitForTimeout(300);
    await expect(tempLogout(page)).toHaveCount(0);
    await expect(page.getByTestId('account-logout')).toHaveCount(0);
  });
});

test.describe('session — NEXT_PUBLIC_AUTH_MODE=session production', () => {
  test.skip(MODE !== 'session', 'session 모드 전용');

  for (const provider of ['kakao', 'google'] as const) {
    test(`${provider} 버튼이 활성이고 누르면 POST /auth/social/${provider}/start 를 보낸다`, async ({ page }) => {
      const calls = await stubBackend(page);
      await page.goto('/login');
      const button = page.getByTestId(`g1-social-${provider}`);
      await expect(button).toBeVisible();
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
      await button.click();
      await expect.poll(() => calls.filter((c) => c === `POST /auth/social/${provider}/start`).length).toBe(1);
      expect(calls).not.toContain('POST /auth/login');
    });
  }

  test('소셜 로그인으로 M1 에 들어가도 임시 로그아웃 버튼이 없다', async ({ page }) => {
    const calls = await stubBackend(page);
    await page.goto('/login');
    await page.getByTestId('g1-social-kakao').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(tempLogout(page)).toHaveCount(0);
    expect(calls).not.toContain('POST /auth/login');
  });
});
