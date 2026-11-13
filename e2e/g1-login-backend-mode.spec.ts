import { expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// Mock 을 끈 환경의 개발용 자동 로그인 범위 검증 — Chromium.
// 서버 실행: NEXT_PUBLIC_API_MOCKING=disabled npm run dev
// 테스트 실행: E2E_REAL_BACKEND_MODE=1 npx playwright test e2e/g1-login-backend-mode.spec.ts --project=chromium
// 백엔드 응답은 route 로 대신한다. 실제 서버 인증을 검증하지 않는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium' || !process.env.E2E_REAL_BACKEND_MODE, 'Mock 을 끈 dev 서버에서 Chromium 으로 실행한다');

async function recordAuth(page: import('@playwright/test').Page) {
  const logins: { method: string; body: string | null }[] = [];
  await page.route('**/auth/login', async (route) => {
    logins.push({ method: route.request().method(), body: route.request().postData() });
    await route.fulfill({ json: { accessToken: 'dev-token' } });
  });
  return logins;
}

test('/login 은 Mock 이 꺼져 있어도 자동 로그인·소셜 로그인 요청을 보내지 않는다', async ({ page }) => {
  const logins = await recordAuth(page);
  const authRequests: string[] = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith('/auth/') && !/\.(gif|svg)$/.test(pathname)) authRequests.push(`${r.method()} ${pathname}`);
  });
  await page.goto('/login');
  await expect(page.getByTestId('g1-social')).toBeVisible();
  // 실서버에는 소셜 OAuth 가 아직 없어 버튼은 비활성 의미(aria-disabled)이고 눌러도 요청이 없다(lib/auth/capability.ts)
  await expect(page.getByTestId('g1-social-kakao')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('g1-social-kakao').click({ force: true });
  await page.getByTestId('g1-social-google').click({ force: true });
  await page.waitForTimeout(500);
  expect(logins).toEqual([]);
  expect(authRequests).toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/login');
});

for (const path of ['/', '/jobs/new']) {
  test(`${path} 의 개발용 자동 로그인은 그대로 동작하고 access 는 메모리에만 둔다`, async ({ page }) => {
    const logins = await recordAuth(page);
    const bearer: string[] = [];
    page.on('request', (r) => {
      const headers = r.headers();
      if (headers['x-pixlate-api-proxy'] && headers['authorization']) bearer.push(headers['authorization']);
    });
    await page.goto(path);
    await expect.poll(() => logins.length).toBeGreaterThanOrEqual(1);
    expect(logins[0].method).toBe('POST');
    expect(JSON.parse(logins[0].body!)).toMatchObject({ password: 'local' });
    // 이후 API 요청은 메모리의 access 로 Bearer 를 싣는다
    await expect.poll(() => bearer[0] ?? null).toBe('Bearer dev-token');
    // 브라우저 저장소에는 access 가 없다
    const stored = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join('|'));
    expect(stored).not.toContain('dev-token');
  });
}
