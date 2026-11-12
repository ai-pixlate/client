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

/** 앱 API(프록시 식별 헤더가 붙은 보호 API) 요청을 기록한다 */
function recordProtectedApi(page: Page) {
  const calls: string[] = [];
  page.on('request', (request: Request) => {
    if (request.headers()['x-pixlate-api-proxy']) calls.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return calls;
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

  test('이전 Kakao 세션이 있는 브라우저에서 Google 완료 요청 중 새로고침 → 재전송·추측·자동 복원 없이 G1 에서 다시 로그인', async ({ page }) => {
    const auth = recordAuth(page);
    // Mock 기본 상태 = 계정 1(Kakao) 세션이 남아 있는 브라우저
    await openLogin(page, { completeDelayMs: 1500 });
    await page.getByTestId('g1-social-google').click();
    await page.waitForURL((url) => url.pathname.startsWith('/login/callback/google'));
    await expect.poll(() => auth.count('POST', '/auth/social')).toBe(1);
    await page.reload();

    // 새 document: 같은 /auth/social 재전송 없이 G1 로, 다시 로그인 안내
    await page.waitForURL((url) => url.pathname === '/login');
    await expect(page.getByTestId('g1-social-error')).toHaveText('로그인 완료 여부를 확인할 수 없습니다. 다시 로그인해 주세요.');
    await page.waitForTimeout(500);
    expect(auth.count('POST', '/auth/social')).toBe(1);
    expect(auth.count('POST', '/auth/refresh')).toBe(0);
    expect(auth.count('GET', '/auth/me')).toBe(0);

    // G1 에서 M1 을 직접 열어 401 이 나도 이전 Kakao 세션으로 복원하지 않고 G1 에 남는다
    await setScenario(page, { expireOnce: true });
    await page.goto('/jobs/new');
    await page.waitForURL((url) => url.pathname === '/login');
    expect(auth.count('POST', '/auth/refresh')).toBe(0);
    expect(auth.count('GET', '/auth/me')).toBe(0);

    // 새 start 부터 다시 → 선택한 Google 계정으로 M1
    await setScenario(page, {});
    await page.getByTestId('g1-social-google').click();
    await page.waitForURL((url) => url.pathname === '/');
    expect(auth.count('POST', '/auth/social/google/start')).toBe(2);
    expect(auth.count('POST', '/auth/social')).toBe(2);
    expect(await page.evaluate(() => sessionStorage.getItem('pixlate:auth:callback-state'))).toBeNull();
  });

  test('새로고침한 콜백이 이미 쓰인 state 면 재시도 가능한 오류로 끝난다', async ({ page }) => {
    const auth = recordAuth(page);
    await openLogin(page);
    await page.getByTestId('g1-social-kakao').click();
    await page.waitForURL((url) => url.pathname === '/');
    // 같은 콜백 주소를 다시 열면(이미 처리된 state) 서버가 state_invalid 를 준다
    const completeBody = JSON.parse(auth.calls.find((c) => c.path === '/auth/social')!.body!);
    await page.goto(`/login/callback/kakao?code=${completeBody.code}&state=${completeBody.state}`);
    await expect(page.getByTestId('g1-callback-error')).toHaveAttribute('data-error', 'state-invalid');
    await page.getByTestId('g1-callback-retry').click();
    await page.waitForURL((url) => url.pathname === '/login');
    expect(auth.count('POST', '/auth/refresh')).toBe(0);
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

  test('409 login_in_progress → polling·refresh·재POST 없이 G1 에서 다시 로그인', async ({ page }) => {
    const auth = recordAuth(page);
    await openLogin(page, { complete: 'login_in_progress' });
    await page.getByTestId('g1-social-kakao').click();
    await page.waitForURL((url) => url.pathname === '/login');
    await expect(page.getByTestId('g1-social-error')).toHaveText('로그인 완료 여부를 확인할 수 없습니다. 다시 로그인해 주세요.');
    await page.waitForTimeout(500);
    expect(auth.count('POST', '/auth/social')).toBe(1);
    expect(auth.count('POST', '/auth/refresh')).toBe(0);
    expect(auth.count('GET', '/auth/me')).toBe(0);
    await setScenario(page, {});
    await page.getByTestId('g1-social-kakao').click();
    await page.waitForURL((url) => url.pathname === '/');
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

test.describe('logoutPending — 앱 진입', () => {
  const PENDING_KEY = 'pixlate:auth:logout-pending';

  /**
   * expireOnce: 보호 API 첫 요청을 401 로 막는다 — 실서버에서 access 없이 이전 화면(M1)의 query 가 나가면 401 이 나는 상황.
   * 이전 화면이 잠깐이라도 마운트되면 그 401 이 refresh 를 시작하는지 드러난다(BE 실측: logout 204 → refresh 401)
   */
  async function reopenWithPending(page: Page, logoutSteps: string[], { expireOnce = false } = {}) {
    await page.goto('/login');
    await page.evaluate(
      ([key, scenarioKey, scenario]) => {
        localStorage.setItem(key, '1');
        sessionStorage.setItem(scenarioKey, scenario);
      },
      [PENDING_KEY, SCENARIO_KEY, JSON.stringify({ logout: logoutSteps, expireOnce })] as const,
    );
    const auth = recordAuth(page);
    await page.goto('/');
    return auth;
  }

  const pending = (page: Page) => page.evaluate((key) => localStorage.getItem(key), PENDING_KEY);

  test('대기 + 쿠키만 204 → 세션 복원보다 로그아웃 먼저, 대기 해제, G1', async ({ page }) => {
    const auth = await reopenWithPending(page, []);
    await page.waitForURL((url) => url.pathname === '/login');
    await expect.poll(() => pending(page)).toBeNull();
    expect(auth.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/logout']);
    expect(auth.calls[0].auth).toBeNull();
  });

  test('대기 + refresh_invalid → 대기 해제·G1, 추가 요청 없음', async ({ page }) => {
    const auth = await reopenWithPending(page, ['refresh_invalid']);
    await page.waitForURL((url) => url.pathname === '/login');
    await expect.poll(() => pending(page)).toBeNull();
    await page.waitForTimeout(500);
    expect(auth.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/logout']);
  });

  test('대기 + 503 → 대기 유지·G1·자동 반복 없음', async ({ page }) => {
    const auth = await reopenWithPending(page, ['unavailable']);
    await page.waitForURL((url) => url.pathname === '/login');
    await page.waitForTimeout(500);
    expect(await pending(page)).toBe('1');
    expect(auth.count('POST', '/auth/logout')).toBe(1);
    expect(auth.count('POST', '/auth/refresh')).toBe(0);
    await expect(page.getByTestId('auth-notice')).toHaveAttribute('data-notice', 'logout-pending');
  });

  // ── 앱 진입에서 로그아웃 재시도를 실행하면 결과와 상관없이 이번 진입은 G1 으로 끝난다 — refresh·이전 화면 API 없음 ──
  for (const [label, steps, keepsPending] of [
    ['204', [], false],
    ['refresh_invalid', ['refresh_invalid'], false],
    ['503', ['unavailable'], true],
  ] as const) {
    test(`대기 + ${label} → 이전 화면을 마운트하지 않아 refresh·보호 API 0회`, async ({ page }) => {
      const api = recordProtectedApi(page);
      const auth = await reopenWithPending(page, [...steps], { expireOnce: true });
      await page.waitForURL((url) => url.pathname === '/login');
      await expect(page.getByTestId('g1-social')).toBeVisible();
      await page.waitForTimeout(800);
      expect(auth.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /auth/logout']);
      expect(auth.count('POST', '/auth/refresh')).toBe(0);
      expect(api).toEqual([]);
      expect(await pending(page)).toBe(keepsPending ? '1' : null);
      if (keepsPending) {
        // 안내가 이전 화면의 401 처리(clearAuth)로 지워지지 않고 화면에 보인다
        await expect(page.getByTestId('auth-notice')).toHaveAttribute('data-notice', 'logout-pending');
        await expect(page.getByTestId('g1-logout-pending')).toContainText('로그아웃했지만 서버 로그아웃을 확인하지 못했습니다.');
        await expect(page.getByTestId('g1-social-error')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('g1-logout-pending')).toHaveCount(0);
      }
    });
  }

  test('G1 에 도착한 뒤에는 새 로그인부터 정상 흐름(M1 데이터 요청)이 다시 동작한다', async ({ page }) => {
    const api = recordProtectedApi(page);
    await reopenWithPending(page, []);
    await page.waitForURL((url) => url.pathname === '/login');
    await setScenario(page, {});
    await page.getByTestId('g1-social-kakao').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect.poll(() => api.includes('GET /library')).toBe(true);
  });
});

test.describe('G1 서버 로그아웃 미완료 — [다시 시도]', () => {
  const PENDING_KEY = 'pixlate:auth:logout-pending';
  const pending = (page: Page) => page.evaluate((key) => localStorage.getItem(key), PENDING_KEY);

  /** 앱 진입 503 으로 안내가 보이는 G1 을 만든 뒤, 다음 재시도 응답을 정한다 */
  async function pendingOnLogin(page: Page, retrySteps: string[]) {
    await page.goto('/login');
    await page.evaluate(
      ([key, scenarioKey, scenario]) => {
        localStorage.setItem(key, '1');
        sessionStorage.setItem(scenarioKey, scenario);
      },
      [PENDING_KEY, SCENARIO_KEY, JSON.stringify({ logout: ['unavailable', ...retrySteps] })] as const,
    );
    const auth = recordAuth(page);
    await page.reload();
    await expect(page.getByTestId('g1-logout-pending')).toBeVisible();
    expect(auth.count('POST', '/auth/logout')).toBe(1);
    return auth;
  }

  for (const [label, step] of [
    ['204', null],
    ['refresh_invalid', 'refresh_invalid'],
  ] as const) {
    test(`재시도 ${label} → 대기·안내 해제, G1 유지, refresh 없음`, async ({ page }) => {
      const auth = await pendingOnLogin(page, step ? [step] : []);
      await page.getByTestId('g1-logout-pending-retry').click();
      await expect(page.getByTestId('g1-logout-pending')).toHaveCount(0);
      await expect(page.getByTestId('auth-notice')).toHaveAttribute('data-notice', '');
      await page.waitForTimeout(500);
      expect(await pending(page)).toBeNull();
      expect(auth.count('POST', '/auth/logout')).toBe(2);
      expect(auth.calls.at(-1)!.auth).toBeNull();
      expect(auth.count('POST', '/auth/refresh')).toBe(0);
      expect(new URL(page.url()).pathname).toBe('/login');
    });
  }

  for (const [label, step] of [
    ['503', 'unavailable'],
    ['origin_not_allowed', 'origin_not_allowed'],
    ['422', 'validation'],
  ] as const) {
    test(`재시도 ${label} → 대기·안내 유지, 자동 반복 없음, 다시 누를 때만 재시도`, async ({ page }) => {
      const auth = await pendingOnLogin(page, [step]);
      await page.getByTestId('g1-logout-pending-retry').click();
      await expect.poll(() => auth.count('POST', '/auth/logout')).toBe(2);
      await page.waitForTimeout(800);
      expect(auth.count('POST', '/auth/logout')).toBe(2);
      expect(auth.count('POST', '/auth/refresh')).toBe(0);
      expect(await pending(page)).toBe('1');
      await expect(page.getByTestId('g1-logout-pending')).toBeVisible();
      await expect(page.getByTestId('auth-notice')).toHaveAttribute('data-notice', 'logout-pending');
      // 다시 누르면(이번엔 204) 그때만 한 번 더 보낸다
      await page.getByTestId('g1-logout-pending-retry').click();
      await expect(page.getByTestId('g1-logout-pending')).toHaveCount(0);
      expect(auth.count('POST', '/auth/logout')).toBe(3);
    });
  }
});

test.describe('로컬 실서버 인증 시험용 임시 로그아웃 진입점', () => {
  test('일반 Mock 개발 환경에서는 M1 에 보이지 않는다', async ({ page }) => {
    await loginWith(page, 'kakao');
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
    await expect(page.getByTestId('local-auth-test-logout')).toHaveCount(0);
  });
});
