import { type Page, type Request, expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// G1 소셜 로그인·세션 FE 선행 구현 — Mock(MSW) 흐름, Chromium.
// 실제 카카오·Google OAuth 와 서버 세션을 검증하지 않는다. Mock 은 FE↔BE 인증 합의·server#124 응답 형태를 흉내 낸다.
// refresh 경합·로그아웃 응답 분기의 세부 규칙은 Node 검증(npm run verify:auth-session)이 맡는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'G1 인증 흐름은 Chromium 기준이다');

const SCENARIO_KEY = 'pixlate:mock-auth-scenario';
const ACCESS_PATTERN = /mock-access/;

type Scenario = Record<string, unknown>;

/** 서버 인증 API 요청(정적 자산 제외)을 순서대로 기록한다 */
function recordAuth(page: Page) {
  const calls: { method: string; path: string; body: string | null; auth: string | null }[] = [];
  page.on('request', (request: Request) => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith('/auth/') || /\.(gif|svg)$/.test(pathname)) return;
    calls.push({ method: request.method(), path: pathname, body: request.postData(), auth: request.headers()['authorization'] ?? null });
  });
  return {
    calls,
    count: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length,
  };
}

async function setScenario(page: Page, scenario: Scenario) {
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [SCENARIO_KEY, JSON.stringify(scenario)] as const);
}

async function openLogin(page: Page, scenario?: Scenario) {
  await page.goto('/login');
  await expect(page.getByTestId('g1-social')).toBeVisible();
  if (scenario) await setScenario(page, scenario);
}

/** G1 → 제공자 → 콜백 → M1 까지 실제 화면 흐름으로 로그인한다 */
async function loginWith(page: Page, provider: 'kakao' | 'google') {
  await openLogin(page);
  await page.getByTestId(`g1-social-${provider}`).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByTestId('auth-notice')).toBeAttached();
}

async function storedText(page: Page) {
  return page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage), document.cookie].join('|'));
}

test.describe('소셜 로그인 시작·완료', () => {
  for (const provider of ['kakao', 'google'] as const) {
    test(`${provider}: start → authorizeUrl → 콜백 → M1, 각 요청 1회`, async ({ page }) => {
      const auth = recordAuth(page);
      await loginWith(page, provider);
      expect(auth.count('POST', `/auth/social/${provider}/start`)).toBe(1);
      expect(auth.count('POST', '/auth/social')).toBe(1);
      const complete = auth.calls.find((c) => c.path === '/auth/social')!;
      const body = JSON.parse(complete.body!);
      expect(Object.keys(body).sort()).toEqual(['code', 'provider', 'state']);
      expect(body.provider).toBe(provider);
      // 신규·기존 구분 없이 M1 — 콜백 주소는 기록에 남기지 않는다(replace)
      expect(new URL(page.url()).pathname).toBe('/');
      // access token 은 브라우저 저장소에 없다
      expect(await storedText(page)).not.toMatch(ACCESS_PATTERN);
    });
  }

  test('React Strict Mode 이중 effect 에도 콜백 완료 POST 는 1회', async ({ page }) => {
    const auth = recordAuth(page);
    await openLogin(page, { completeDelayMs: 400 });
    await page.getByTestId('g1-social-kakao').click();
    await expect(page.getByTestId('g1-callback-working')).toBeVisible();
    await page.waitForURL((url) => url.pathname === '/');
    await page.waitForTimeout(300);
    expect(auth.count('POST', '/auth/social')).toBe(1);
  });

  test('완료 요청 중 새로고침해도 완료 POST 를 다시 보내지 않고 이어서 M1 로 간다', async ({ page }) => {
    const auth = recordAuth(page);
    await openLogin(page, { completeDelayMs: 3000 });
    await page.getByTestId('g1-social-kakao').click();
    await page.waitForURL((url) => url.pathname.startsWith('/login/callback/kakao'));
    await expect.poll(() => auth.count('POST', '/auth/social')).toBe(1);
    await page.reload();
    await page.waitForURL((url) => url.pathname === '/');
    expect(auth.count('POST', '/auth/social')).toBe(1);
    expect(auth.count('POST', '/auth/refresh')).toBe(1);
  });

  test('버튼을 빠르게 여러 번 눌러도 시작 요청은 1회', async ({ page }) => {
    const auth = recordAuth(page);
    await openLogin(page, { startDelayMs: 600 });
    const kakao = page.getByTestId('g1-social-kakao');
    await kakao.click();
    await expect(kakao).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('g1-social-google')).toHaveAttribute('aria-disabled', 'true');
    await kakao.click({ force: true });
    await page.getByTestId('g1-social-google').click({ force: true });
    await page.waitForURL((url) => url.pathname === '/');
    expect(auth.calls.filter((c) => c.path.endsWith('/start'))).toHaveLength(1);
  });

  for (const [start, message] of [
    ['not_found', '지금은 이 방법으로 로그인할 수 없습니다.'],
    ['unavailable', '일시적으로 로그인할 수 없습니다. 처음부터 다시 로그인해 주세요.'],
    ['origin_not_allowed', '로그인 중 문제가 생겼습니다. 다시 시도해 주세요.'],
  ] as const) {
    test(`start ${start} → G1 에 오류, 이동·자동 재시도 없음`, async ({ page }) => {
      const auth = recordAuth(page);
      await openLogin(page, { start });
      await page.getByTestId('g1-social-kakao').click();
      await expect(page.getByTestId('g1-social-error')).toHaveText(message);
      await page.waitForTimeout(300);
      expect(new URL(page.url()).pathname).toBe('/login');
      expect(auth.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/social/kakao/start']);
      // 다시 누를 수 있다
      await expect(page.getByTestId('g1-social-kakao')).toHaveAttribute('aria-disabled', 'false');
    });
  }

  for (const [complete, error, message] of [
    ['provider_auth_failed', 'provider-auth-failed', '로그인을 완료하지 못했습니다. 처음부터 다시 로그인해 주세요.'],
    ['provider_unavailable', 'provider-unavailable', '일시적으로 로그인할 수 없습니다. 처음부터 다시 로그인해 주세요.'],
    ['state_invalid', 'state-invalid', '로그인을 완료하지 못했습니다. 처음부터 다시 로그인해 주세요.'],
  ] as const) {
    test(`complete ${complete} → 콜백 오류 화면, 완료 요청 자동 반복 없음`, async ({ page }) => {
      const auth = recordAuth(page);
      await openLogin(page, { complete });
      await page.getByTestId('g1-social-kakao').click();
      const alert = page.getByTestId('g1-callback-error');
      await expect(alert).toHaveText(message);
      await expect(alert).toHaveAttribute('data-error', error);
      await page.waitForTimeout(500);
      expect(auth.count('POST', '/auth/social')).toBe(1);
      expect(new URL(page.url()).pathname).toBe('/login/callback/kakao');
      await page.getByTestId('g1-callback-retry').click();
      await page.waitForURL((url) => url.pathname === '/login');
    });
  }

  test('콜백 state 가 시작 때와 다르면 state_invalid 로 처리한다', async ({ page }) => {
    const auth = recordAuth(page);
    await page.goto('/login/callback/kakao?code=mock-code-kakao&state=forged');
    await expect(page.getByTestId('g1-callback-error')).toHaveAttribute('data-error', 'state-invalid');
    expect(auth.count('POST', '/auth/social')).toBe(1);
  });

  test('409 login_in_progress(후보) → 오류로 바꾸지 않고 먼저 시작된 로그인을 이어받아 M1', async ({ page }) => {
    const auth = recordAuth(page);
    await openLogin(page, { complete: 'login_in_progress' });
    await page.getByTestId('g1-social-kakao').click();
    await page.waitForURL((url) => url.pathname === '/');
    expect(auth.count('POST', '/auth/social')).toBe(1);
    expect(auth.count('POST', '/auth/refresh')).toBe(1);
    expect(auth.count('GET', '/auth/me')).toBe(1);
  });

  test('제공자 화면에서 취소하면 완료 요청 없이 안내한다', async ({ page }) => {
    const auth = recordAuth(page);
    await page.goto('/login/callback/kakao?error=access_denied');
    await expect(page.getByTestId('g1-callback-error')).toHaveAttribute('data-error', 'cancelled');
    expect(auth.calls).toEqual([]);
  });

  test('지원하지 않는 제공자 콜백은 요청 없이 안내한다', async ({ page }) => {
    const auth = recordAuth(page);
    await page.goto('/login/callback/naver?code=x&state=y');
    await expect(page.getByTestId('g1-callback-error')).toHaveAttribute('data-error', 'not-available');
    expect(auth.calls).toEqual([]);
  });
});

test.describe('401 → refresh → /auth/me', () => {
  test('같은 계정이면 원 요청을 1회 다시 보내고 화면이 그대로 동작한다', async ({ page }) => {
    const auth = recordAuth(page);
    await loginWith(page, 'kakao');
    await setScenario(page, { expireOnce: true });
    await page.getByTestId('library-add-card-link').click();
    await page.waitForURL((url) => url.pathname === '/jobs/new');
    await expect.poll(() => auth.count('GET', '/auth/me')).toBe(1);
    expect(auth.count('POST', '/auth/refresh')).toBe(1);
    // refresh 뒤 요청은 새 access 로 나간다
    const me = auth.calls.find((c) => c.path === '/auth/me')!;
    expect(me.auth).toMatch(/^Bearer mock-access\.1\./);
    await expect(page.getByTestId('auth-notice')).toHaveAttribute('data-notice', '');
    expect(new URL(page.url()).pathname).toBe('/jobs/new');
  });

  test('refresh 뒤 다른 계정이면 원 요청을 다시 보내지 않고 M1 으로 가서 계정 전환을 알린다', async ({ page }) => {
    await loginWith(page, 'kakao');
    await setScenario(page, { expireOnce: true, refresh: ['switch:2'] });
    await page.getByTestId('library-add-card-link').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByTestId('auth-notice')).toHaveAttribute('data-notice', 'account-changed');
  });

  test('refresh_invalid → G1', async ({ page }) => {
    await loginWith(page, 'kakao');
    await setScenario(page, { expireOnce: true, refresh: ['invalid'] });
    await page.getByTestId('library-add-card-link').click();
    await page.waitForURL((url) => url.pathname === '/login');
  });

  test('refresh 503 → 세션을 지우지 않고 G1 로 보내지 않으며 일시 오류를 알린다', async ({ page }) => {
    const auth = recordAuth(page);
    await loginWith(page, 'kakao');
    await setScenario(page, { expireOnce: true, refresh: ['unavailable'] });
    await page.getByTestId('library-add-card-link').click();
    await expect(page.getByTestId('auth-notice')).toHaveAttribute('data-notice', 'auth-unavailable');
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe('/jobs/new');
    expect(auth.count('POST', '/auth/refresh')).toBe(1);
  });
});

test.describe('여러 탭', () => {
  test('다른 탭의 logout 알림 → 이 탭도 G1', async ({ context }) => {
    const a = await context.newPage();
    await loginWith(a, 'kakao');
    const b = await context.newPage();
    await b.goto('/login');
    await b.evaluate(() => new BroadcastChannel('pixlate-auth').postMessage({ type: 'logout' }));
    await a.waitForURL((url) => url.pathname === '/login');
  });

  test('다른 탭에서 다른 계정으로 로그인 → 이 탭은 이전 계정 화면을 버리고 M1 + 계정 전환 안내', async ({ context }) => {
    const a = await context.newPage();
    await loginWith(a, 'kakao');
    await a.getByTestId('library-add-card-link').click();
    await a.waitForURL((url) => url.pathname === '/jobs/new');

    // 다른 탭이 받은 알림을 기록해 토큰이 실리지 않는지 본다
    await a.evaluate(() => {
      const w = window as unknown as { __authWire: string[] };
      w.__authWire = [];
      new BroadcastChannel('pixlate-auth').addEventListener('message', (e) => w.__authWire.push(JSON.stringify(e.data)));
    });
    const b = await context.newPage();
    await loginWith(b, 'google');

    await a.waitForURL((url) => url.pathname === '/');
    await expect(a.getByTestId('auth-notice')).toHaveAttribute('data-notice', 'account-changed');
    const wire = await a.evaluate(() => (window as unknown as { __authWire: string[] }).__authWire);
    expect(wire).toContain(JSON.stringify({ type: 'login-complete', sellerId: 2 }));
    expect(wire.join()).not.toMatch(/access|token|email/i);
  });

  test('다른 탭의 같은 계정 로그인은 이 탭을 움직이지 않는다', async ({ context }) => {
    const a = await context.newPage();
    await loginWith(a, 'kakao');
    await a.getByTestId('library-add-card-link').click();
    await a.waitForURL((url) => url.pathname === '/jobs/new');
    const b = await context.newPage();
    await loginWith(b, 'kakao');
    await a.waitForTimeout(500);
    expect(new URL(a.url()).pathname).toBe('/jobs/new');
  });
});
