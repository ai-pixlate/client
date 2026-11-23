import { type Page, type Request, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// 인증 P1 후속 F1~F3 — 실제 브라우저(Chromium) + 실제 QueryClient. Mock(MSW) dev 서버에서 돈다.
// 백엔드 인증은 Mock 이다 — 실서버 refresh 쿠키·Redis 세션을 검증하지 않는다(모듈 시험은 scripts/verify-auth-session.mjs).
//   F1 이전 인증 세대 요청의 늦은 401 → 이 탭 refresh 0회
//   F2 접근 불가 작업 /tasks 404 → 자동 재시도·polling 종료 · 일반화된 안내 · 보관함 복귀
//   F3 인증 복구 최종 실패 → React Query 가 query 를 다시 실행해 새 refresh 를 만들지 않는다
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

const SCENARIO_KEY = 'pixlate:mock-auth-scenario';

function recordRequests(page: Page) {
  const calls: { method: string; path: string }[] = [];
  page.on('request', (request: Request) => {
    const { pathname } = new URL(request.url());
    if (/\.(gif|svg|png|js|css|woff2?)$/.test(pathname)) return;
    calls.push({ method: request.method(), path: pathname });
  });
  return { calls, count: (method: string, path: string | RegExp) => calls.filter((c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path))).length };
}

async function setScenario(page: Page, scenario: Record<string, unknown>) {
  await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [SCENARIO_KEY, JSON.stringify(scenario)] as const);
}

async function loginWith(page: Page, provider: 'kakao' | 'google') {
  await page.goto('/login');
  await expect(page.getByTestId('g1-social')).toBeVisible();
  await page.getByTestId(`g1-social-${provider}`).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
}

test.describe('F1 — 이전 인증 세대 요청의 늦은 401', () => {
  test('탭 A 의 보호 요청을 붙잡은 사이 다른 탭에서 계정이 바뀌면, 그 요청의 늦은 401 은 A 에서 refresh 를 시작하지 않는다', async ({ context }) => {
    const a = await context.newPage();
    const net = recordRequests(a);
    await loginWith(a, 'kakao');

    // 다음 보호 API 요청 하나를 붙잡았다가, 나중에 401 로 돌려준다(그 사이 다른 요청은 그대로 보낸다)
    await a.evaluate(() => {
      const w = window as unknown as { __held: { url: string; release: () => void } | null };
      w.__held = null;
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const headers = new Headers(init?.headers);
        if (!w.__held && headers.get('x-pixlate-api-proxy')) {
          return new Promise<Response>((resolve) => {
            w.__held = {
              url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
              release: () =>
                resolve(
                  new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'x', retryable: false, details: null, traceId: 't' } }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                  }),
                ),
            };
          });
        }
        return original(input, init);
      };
    });
    await a.getByTestId('library-add-card-link').click(); // N1 의 보호 요청 시작 → 첫 요청이 붙잡힌다
    await expect.poll(() => a.evaluate(() => !!(window as unknown as { __held: unknown }).__held)).toBe(true);
    const refreshBefore = net.count('POST', '/auth/refresh');

    // 다른 탭이 다른 계정으로 로그인했다는 알림 → A 의 인증 세대가 바뀐다(이전 계정 화면을 버리고 M1)
    const b = await context.newPage();
    await b.goto('/login');
    await b.evaluate(() => new BroadcastChannel('pixlate-auth').postMessage({ type: 'account-changed', sellerId: 2 }));
    await a.waitForURL((url) => url.pathname === '/');

    await a.evaluate(() => (window as unknown as { __held: { release: () => void } }).__held.release());
    await a.waitForTimeout(2_000);
    expect(net.count('POST', '/auth/refresh')).toBe(refreshBefore);
    expect(net.count('GET', '/auth/me')).toBe(0);
  });
});

test.describe('F2 — 접근 불가 작업의 /tasks 404', () => {
  test('/jobs/999 → /tasks 1회만 요청하고 6초 동안 다시 묻지 않는다 · 일반화된 안내 · 보관함 복귀', async ({ page }) => {
    const net = recordRequests(page);
    await page.goto('/jobs/999');
    const notFound = page.getByTestId('job-not-found');
    await expect(notFound).toBeVisible({ timeout: 15_000 });
    await expect(notFound).toContainText('작업을 찾을 수 없거나 접근할 수 없습니다.');
    await expect(notFound).not.toContainText('다른 계정'); // 소유 여부를 추정하지 않는다

    // loading ↔ error 를 오가지 않는다 — 6초 동안 여러 번 확인
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(1_000);
      await expect(page.getByText('작업 상태를 확인하고 있습니다.')).toHaveCount(0);
      await expect(notFound).toBeVisible();
    }
    expect(net.count('GET', '/jobs/999/tasks')).toBe(1);

    await page.getByTestId('job-not-found-library').click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
  });

  test('정상 진행 polling 은 그대로 — N2·N4 진행 중 2초 polling, 정적 단계(N5) 도착 뒤에는 멈춘다', async ({ page }) => {
    const net = recordRequests(page);
    await reachN5(page);
    const tasksDuringFlow = net.count('GET', /^\/jobs\/[^/]+\/tasks$/);
    expect(tasksDuringFlow).toBeGreaterThanOrEqual(4); // N2·N4 진행 동안 여러 번
    await page.waitForTimeout(2_000); // N5 진입 직후 한 번 새로 읽는 것까지 끝나기를 기다린다
    const settled = net.count('GET', /^\/jobs\/[^/]+\/tasks$/);
    await page.waitForTimeout(5_000);
    expect(net.count('GET', /^\/jobs\/[^/]+\/tasks$/)).toBe(settled);
  });
});

/** 이후 모든 보호 API(프록시 식별 헤더) 요청에 401 TOKEN_EXPIRED 를 돌려준다 — 인증 API(/auth/*)는 그대로 Mock 으로 간다 */
async function keepProtectedApiExpired(page: Page) {
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (new Headers(init?.headers).get('x-pixlate-api-proxy')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'x', retryable: false, details: null, traceId: 't' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return original(input, init);
    };
  });
}

test.describe('F3 — 인증 복구 최종 실패는 React Query 가 다시 실행하지 않는다', () => {
  for (const [label, refresh, expectedRefresh] of [
    ['origin_not_allowed', ['origin_not_allowed'], 1],
    ['503', ['unavailable'], 1],
    ['refresh_rotated 계속(rotated-exhausted)', ['rotated', 'rotated', 'rotated'], 2],
  ] as const) {
    test(`${label} → refresh ${expectedRefresh}회에서 끝나고 5초 동안 추가 refresh 없음`, async ({ page }) => {
      const net = recordRequests(page);
      await loginWith(page, 'kakao');
      // 실서버처럼 access 가 계속 만료된 상태 — 보호 API 는 다시 보내도 401 이다(Mock expireOnce 는 한 번만 401 이라
      // query 재시도가 200 을 받아 두 번째 refresh 가 드러나지 않는다). refresh 응답만 Mock 시나리오로 정한다
      await keepProtectedApiExpired(page);
      await setScenario(page, { refresh: [...refresh] });
      await page.getByTestId('library-add-card-link').click();
      await page.waitForURL((url) => url.pathname === '/jobs/new');
      await expect.poll(() => net.count('POST', '/auth/refresh')).toBe(expectedRefresh);
      await page.waitForTimeout(5_000);
      expect(net.count('POST', '/auth/refresh')).toBe(expectedRefresh);
      expect(net.count('GET', '/auth/me')).toBe(0);
    });
  }

  test('정상 만료 → refresh 1회 · /auth/me 1회 · 원 요청 1회 재전송(쿼리 재시도 없음)', async ({ page }) => {
    const net = recordRequests(page);
    await loginWith(page, 'kakao');
    await setScenario(page, { expireOnce: true });
    await page.getByTestId('library-add-card-link').click();
    await page.waitForURL((url) => url.pathname === '/jobs/new');
    await expect.poll(() => net.count('GET', '/auth/me')).toBe(1);
    await page.waitForTimeout(3_000);
    expect(net.count('POST', '/auth/refresh')).toBe(1);
    expect(net.count('GET', '/auth/me')).toBe(1);
  });
});
