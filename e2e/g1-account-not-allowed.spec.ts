import { type Page, type Request, expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// 허용 목록 밖 계정 — 401 UNAUTHORIZED · details.reason=account_not_allowed(BE 합의).
//   POST /auth/social  → 계정·세션 없음 · G1 유지 · 「허용되지 않은 계정입니다」(provider_auth_failed 와 구분)
//   POST /auth/refresh → 서버가 세션 폐기·쿠키 삭제 → 자동 refresh/재시도 중단 · 인증 상태 초기화 · G1 · 같은 문구 · refresh 반복 없음
// 다른 401(provider_auth_failed·refresh_invalid)은 기존 처리 그대로다. Mock 인증 시나리오(sessionStorage)로 만든다. Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'G1 인증 흐름은 Chromium 기준이다');

const SCENARIO_KEY = 'pixlate:mock-auth-scenario';
const MESSAGE = '허용되지 않은 계정입니다';

function recordAuth(page: Page) {
  const calls: { method: string; path: string }[] = [];
  page.on('request', (request: Request) => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith('/auth/') || /\.(gif|svg)$/.test(pathname)) return;
    calls.push({ method: request.method(), path: pathname });
  });
  return { calls, count: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length };
}

async function setScenario(page: Page, scenario: Record<string, unknown>) {
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [SCENARIO_KEY, JSON.stringify(scenario)] as const);
}

async function openLogin(page: Page, scenario?: Record<string, unknown>) {
  await page.goto('/login');
  await expect(page.getByTestId('g1-social')).toBeVisible();
  if (scenario) await setScenario(page, scenario);
}

async function loginWith(page: Page, provider: 'kakao' | 'google') {
  await openLogin(page);
  await page.getByTestId(`g1-social-${provider}`).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByTestId('auth-notice')).toBeAttached();
  await expect(page.getByTestId('library-add-card-link')).toBeVisible({ timeout: 15_000 });
}

test('소셜 로그인 account_not_allowed — 세션 없이 G1 으로 돌아와 「허용되지 않은 계정입니다」, 새 로그인을 시작하면 안내가 사라진다', async ({ page }) => {
  const auth = recordAuth(page);
  await openLogin(page, { complete: 'account_not_allowed' });
  await page.getByTestId('g1-social-kakao').click();
  await page.waitForURL((url) => url.pathname === '/login');
  await expect(page.getByTestId('g1-social-error')).toHaveText(MESSAGE);
  expect(auth.count('POST', '/auth/social')).toBe(1);
  expect(auth.count('GET', '/auth/me')).toBe(0);
  // 저장소에 access·seller 가 없다
  expect(await page.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage))).not.toMatch(/mock-access/);

  // 정상 계정으로 다시 로그인 — 시작 순간 안내를 지우고 M1 로 간다
  await setScenario(page, {});
  await page.getByTestId('g1-social-google').click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.goto('/login');
  await expect(page.getByTestId('g1-social-error')).toHaveCount(0);
});

test('소셜 로그인 provider_auth_failed — 기존 안내(허용되지 않은 계정 문구 아님)', async ({ page }) => {
  await openLogin(page, { complete: 'provider_auth_failed' });
  await page.getByTestId('g1-social-kakao').click();
  await expect(page.getByTestId('g1-callback-error')).toHaveAttribute('data-error', 'provider-auth-failed');
  await expect(page.getByTestId('g1-callback-error')).not.toHaveText(MESSAGE);
});

test('refresh account_not_allowed — 자동 복구 중단·인증 초기화·G1·「허용되지 않은 계정입니다」, refresh 를 반복하지 않는다', async ({ page }) => {
  const auth = recordAuth(page);
  await loginWith(page, 'kakao');
  await setScenario(page, { expireOnce: true, refresh: ['account_not_allowed'] });
  await page.getByTestId('library-add-card-link').click();
  await page.waitForURL((url) => url.pathname === '/login');
  await expect(page.getByTestId('g1-social-error')).toHaveText(MESSAGE);
  const refreshes = auth.count('POST', '/auth/refresh');
  expect(refreshes).toBe(1);
  // G1 에 머무는 동안 refresh·/auth/me 를 다시 보내지 않는다(무한 루프 없음)
  await page.waitForTimeout(3_000);
  expect(auth.count('POST', '/auth/refresh')).toBe(refreshes);
  expect(auth.count('GET', '/auth/me')).toBe(0);
  expect(new URL(page.url()).pathname).toBe('/login');
});

test('refresh_invalid — 기존대로 G1(허용되지 않은 계정 문구 없음)', async ({ page }) => {
  await loginWith(page, 'kakao');
  await setScenario(page, { expireOnce: true, refresh: ['invalid'] });
  await page.getByTestId('library-add-card-link').click();
  await page.waitForURL((url) => url.pathname === '/login');
  await expect(page.getByTestId('g1-social-error')).toHaveCount(0);
});
