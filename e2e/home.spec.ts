import { test, expect, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// H 홈 (/home) — 한 컴포넌트의 사용자 상태별 뷰. MSW mock 기준.
//   landing   Home / landing page 1492:10051 — 이 탭이 로그아웃 상태를 알 때(헤더 [로그아웃] 뒤 앱 안 이동)
//   returning Home / scroll       1776:4171  — 브랜드 1개(101)
//   new       Home / for new      1779:4227  — m2-no-brand
// 최근 작업은 GET /library(저장 완료) 카드다 — 상태는 모두 「완료」.
// 랜딩 배경은 public/home/hero/hero-video.mp4(1920×1080 · H.264) — 실패·자동 재생 거부·모션 줄이기에서는 hero-poster.webp 로 바꾼다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

/** 새로고침 없는 앱 안 이동 — 메모리에만 있는 인증 상태(로그아웃)를 유지한 채 /home 으로 간다 */
async function pushRoute(page: Page, href: string) {
  await page.evaluate((to) => (window as unknown as { next: { router: { push(h: string): void } } }).next.router.push(to), href);
}

/** GET /library 응답만 바꾼다(MSW 는 page.route 로 가로챌 수 없어 window.fetch 를 감싼다 — e2e/m1-library.spec.ts 와 같은 방식) */
async function overrideLibrary(page: Page, cards: unknown[]) {
  await page.addInitScript((list) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (new URL(url, window.location.href).pathname === '/library') {
        return Promise.resolve(new Response(JSON.stringify(list), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return originalFetch(input, init);
    };
  }, cards);
}

test('로그인 후 · 브랜드 있음(Home / scroll 1776:4171) — 1920 기준 좌표', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1612 });
  await page.goto('/home');
  await expect(page.getByTestId('home-workspace')).toHaveAttribute('data-home-view', 'returning');
  await expect(page.getByTestId('home-recent-table')).toBeVisible();

  const header = await box(page, 'app-header');
  expect([header.x, header.y, header.width, header.height]).toEqual([0, 0, 1920, 131]);
  await expect(page.getByTestId('app-header')).toHaveAttribute('data-variant', 'home');
  await expect(page.getByTestId('app-header').getByText('AI LOCALIZATION WORKSPACE')).toBeVisible();

  const banner = await box(page, 'home-banner');
  expect([banner.x, banner.y, banner.width, banner.height]).toEqual([60, 131, 1800, 488]);
  const heading = (await page.locator('#home-banner-title').boundingBox())!;
  expect([heading.x, heading.y, heading.height]).toEqual([114, 396, 120]);
  await expect(page.locator('#home-banner-title')).toHaveCSS('font-size', '48px');

  const brands = await box(page, 'home-brands');
  expect([brands.y, brands.height]).toEqual([679, 313]);
  const recent = await box(page, 'home-recent');
  expect([recent.y, recent.height]).toEqual([1052, 403]);
  const footer = await box(page, 'home-footer');
  expect([footer.y, footer.height]).toEqual([1555, 57]);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(1612);
});

test('배너는 Figma 에서 Export 한 정지 이미지를 cover 로 쓰고, 이미지가 깨져도 제목은 남는다', async ({ page }) => {
  await page.goto('/home');
  const image = page.getByTestId('home-hero-image');
  await expect(image).toHaveAttribute('src', '/home/hero/hero-poster.webp');
  await expect(image).toHaveCSS('object-fit', 'cover');
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId('home-banner').locator('video')).toHaveCount(0);

  await image.evaluate((el: HTMLImageElement) => {
    el.src = '/home/hero/__missing__.webp';
  });
  await expect(page.getByTestId('home-hero-media')).toHaveAttribute('data-media', 'fallback');
  await expect(page.getByTestId('home-hero-image')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /상세페이지를/ })).toBeVisible();
  await expect(page.getByTestId('home-banner')).toBeVisible();
});

test('브랜드 영역 — API 브랜드만, [정보 수정]·선택 없음·카드 이동 없음, [모든 브랜드 보기] → M0, [새 브랜드 등록] → M2 등록(1:N)', async ({ page }) => {
  await page.goto('/home');
  const brands = page.getByTestId('home-brands');
  await expect(brands.getByRole('heading', { name: '브랜드를 선택하세요.' })).toBeVisible();
  await expect(page.getByTestId('brand-card-101')).toBeVisible();
  await expect(page.getByTestId('brand-card-name-101')).toHaveText('픽슬레이트');
  await expect(page.getByTestId('brand-card-edit-101')).toHaveCount(0);
  await expect(page.getByTestId('brand-card-select-101')).toHaveCount(0);
  await expect(page.getByText(/아누아|셀리맥스|구달/)).toHaveCount(0);

  // 카드 264 가 높이 242 목록 안에 가운데 놓여 위아래가 잘린다(Figma 1778:4205)
  const list = (await page.getByTestId('home-brand-scroller').boundingBox())!;
  const card = await box(page, 'brand-card-101');
  expect([card.width, card.height, list.height]).toEqual([400, 264, 242]);
  expect(card.y).toBe(list.y - 11);

  const add = page.getByTestId('home-new-brand');
  await expect(add).toHaveAttribute('href', '/brand?mode=create&from=home');
  // 브랜드 카드 본문은 그 브랜드의 M1 이 계약 대기라 링크가 아니다(N1 로도 보내지 않는다)
  await expect(page.getByTestId('brand-card-101').locator('a')).toHaveCount(0);
  await page.getByTestId('brand-card-slot-101').click();
  await expect(page).toHaveURL(/\/home$/);
  // 브랜드 1개라 넘치지 않아 [다음] 버튼이 없다
  await expect(page.getByTestId('home-brand-next')).toHaveCount(0);

  await page.getByTestId('home-all-brands').click();
  await expect(page).toHaveURL(/\/brand\/select$/);
  await expect(page.getByTestId('app-header-title')).toHaveText('브랜드 선택');
});

test('최근 작업 — GET /library 저장 카드를 최신 변경순 4건까지, 상태 「완료」 · 표시 전용', async ({ page }) => {
  await page.goto('/home');
  const table = page.getByTestId('home-recent-table');
  await expect(table.getByRole('columnheader')).toHaveText(['상품명', '브랜드명', '국가', '언어', '상태', '최근 변경']);
  const rows = page.locator('[data-testid^="home-recent-row-"]');
  await expect(rows).toHaveCount(4);
  // savedAt 내림차순(9003 → 9002 → 9001 → 9004)
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))).toEqual([
    'home-recent-row-9003',
    'home-recent-row-9002',
    'home-recent-row-9001',
    'home-recent-row-9004',
  ]);
  const row = page.getByTestId('home-recent-row-9002');
  await expect(row.getByRole('cell')).toHaveText(['비타민C 세럼', '', '일본', '일본어', '완료', /^2026\.10\.07  \d{2}:\d{2}$/]);
  await expect(row).toHaveCSS('height', '70px');
  await expect(table.locator('a, button')).toHaveCount(0);
  // Figma 예시 진행 상태를 만들지 않는다
  await expect(table.getByText(/검수|번역중|저장 대기/)).toHaveCount(0);
});

test('로그인 후 · 브랜드 없음(Home / for new 1779:4227) — 첫 브랜드 등록 · 최근 작업 Empty State', async ({ page }) => {
  await overrideLibrary(page, []);
  await page.setViewportSize({ width: 1920, height: 1612 });
  await page.goto('/home?mockScenario=m2-no-brand');
  await expect(page.getByTestId('home-workspace')).toHaveAttribute('data-home-view', 'new');
  const first = page.getByTestId('home-first-brand');
  await expect(first.getByRole('heading', { name: '첫 브랜드를 등록해 주세요.' })).toBeVisible();
  await expect(first.getByText('브랜드를 등록하면 첫 상세페이지 번역을 시작할 수 있습니다.')).toBeVisible();

  const add = await box(page, 'home-new-brand');
  expect([add.x, add.y, add.width, add.height]).toEqual([60, 750, 404, 242]);
  const empty = page.getByTestId('home-recent-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('최근 작업이 없습니다.');
  await expect(empty).toContainText('첫 작업을 시작해 보세요.');
  const e = await box(page, 'home-recent-empty');
  expect([e.x, e.y, e.width, e.height]).toEqual([60, 1127, 1800, 328]);
  await expect(page.getByTestId('home-brands')).toHaveCount(0);

  await page.getByTestId('home-new-brand').click();
  await expect(page).toHaveURL(/\/brand\?mode=create&from=home$/);
  await expect(page.getByTestId('m2-brand')).toHaveAttribute('data-m2-status', 'create');
});

test('브랜드 목록 조회 실패는 신규 사용자 화면이 아니라 오류로 보인다', async ({ page }) => {
  await page.goto('/home?mockScenario=m2-list-fail');
  await expect(page.getByTestId('home-error')).toHaveText('브랜드 정보를 불러오지 못했습니다.', { timeout: 15_000 });
  await expect(page.getByTestId('home-first-brand')).toHaveCount(0);
  await expect(page.getByTestId('home-banner')).toBeVisible();
});

test('공통 헤더 — 로고는 홈, [브랜드 관리]는 M0, [로그아웃]은 G1 → 로그아웃 상태의 홈은 랜딩(로그인 전)', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByTestId('app-header-home')).toHaveAttribute('href', '/home');
  await expect(page.getByTestId('app-header-brand')).toHaveAttribute('href', '/brand/select');

  await page.getByTestId('account-logout').click();
  await page.waitForURL('**/login');
  await pushRoute(page, '/home');
  await expect(page.getByTestId('home-landing')).toBeVisible();
  // 로그인 전에는 계정 데이터를 부르지 않는다
  await expect(page.getByTestId('app-header')).toHaveCount(0);
  await expect(page.getByTestId('home-workspace')).toHaveCount(0);
});

test('랜딩(Home / landing page 1492:10051) — 1920 좌표 · 포스터 대체 · 로그인/회원가입 → G1', async ({ page }) => {
  await page.goto('/home');
  await page.getByTestId('account-logout').click();
  await page.waitForURL('**/login');
  await pushRoute(page, '/home');
  await expect(page.getByTestId('home-landing')).toBeVisible();

  const header = await box(page, 'home-landing-header');
  expect([header.x, header.y, header.width, header.height]).toEqual([60, 60, 1800, 39]);
  const copy = await box(page, 'home-landing-copy');
  expect([copy.x, copy.y, copy.width, copy.height]).toEqual([92, 762, 540, 207]);
  await expect(page.getByRole('heading', { name: /상세페이지를/ })).toHaveCSS('font-size', '72px');

  // 배경 영상 — 화면 전체(0,0 1920×1080)를 cover 로 채우고, 자동·반복·음소거·인라인 재생한다
  await expect(page.getByTestId('home-hero-media')).toHaveAttribute('data-media', 'video');
  const video = page.locator('video');
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute('src', '/home/hero/hero-video.mp4');
  await expect(video).toHaveAttribute('poster', '/home/hero/hero-poster.webp');
  await expect(video).toHaveCSS('object-fit', 'cover');
  const vb = (await video.boundingBox())!;
  expect([vb.x, vb.y, vb.width, vb.height]).toEqual([0, 0, 1920, 1080]);
  const props = await video.evaluate((el: HTMLVideoElement) => ({ muted: el.muted, loop: el.loop, autoplay: el.autoplay, inline: el.playsInline }));
  expect(props).toEqual({ muted: true, loop: true, autoplay: true, inline: true });
  // 실제로 재생된다 — 원본 1920×1080(Figma 프레임과 같은 비율이라 1920×1080 에서는 크롭이 없다)
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => !el.paused && el.currentTime > 0.2), { timeout: 10_000 }).toBe(true);
  expect(await video.evaluate((el: HTMLVideoElement) => [el.videoWidth, el.videoHeight])).toEqual([1920, 1080]);
  // 반복 재생 — 끝 근처로 옮기면 처음으로 돌아가 계속 재생된다
  await video.evaluate((el: HTMLVideoElement) => {
    el.currentTime = Math.max(0, el.duration - 0.2);
  });
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => !el.paused && !el.ended && el.currentTime < el.duration - 0.3), { timeout: 10_000 }).toBe(true);

  await expect(page.getByTestId('home-landing-login')).toHaveAttribute('href', '/login');
  await expect(page.getByTestId('home-landing-signup')).toHaveAttribute('href', '/login');
  await page.getByTestId('home-landing-login').click();
  await expect(page).toHaveURL(/\/login$/);
});

test('랜딩 — prefers-reduced-motion 에서도 정지 이미지이고, 이미지가 깨지면 중립 배경 위에 제목·이동 버튼이 남는다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/home');
  await page.getByTestId('account-logout').click();
  await page.waitForURL('**/login');
  await pushRoute(page, '/home');
  await expect(page.getByTestId('home-hero-media')).toHaveAttribute('data-media', 'image');
  // 모션 줄이기에서는 영상 요소를 만들지 않는다
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByTestId('home-hero-image').evaluate((el: HTMLImageElement) => {
    el.src = '/home/hero/__missing__.webp';
  });
  await expect(page.getByTestId('home-hero-media')).toHaveAttribute('data-media', 'fallback');
  await expect(page.getByTestId('home-hero-media')).toHaveCSS('background-color', 'rgb(10, 10, 10)');
  await expect(page.getByRole('heading', { name: /상세페이지를/ })).toBeInViewport();
  await expect(page.getByTestId('home-landing-login')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  await context.close();
});

async function openLanding(page: Page) {
  await page.goto('/home');
  await page.getByTestId('account-logout').click();
  await page.waitForURL('**/login');
  await pushRoute(page, '/home');
  await expect(page.getByTestId('home-landing')).toBeVisible();
}

test('랜딩 영상 로딩 실패 → 포스터 이미지로 바뀌고 제목·로그인은 그대로', async ({ page }) => {
  await openLanding(page);
  await page.locator('video').evaluate((el: HTMLVideoElement) => {
    el.src = '/home/hero/__missing__.mp4';
  });
  await expect(page.getByTestId('home-hero-media')).toHaveAttribute('data-media', 'image');
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-image')).toHaveAttribute('src', '/home/hero/hero-poster.webp');
  await expect.poll(() => page.getByTestId('home-hero-image').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: /상세페이지를/ })).toBeVisible();
  await expect(page.getByTestId('home-landing-login')).toBeVisible();
});

test('랜딩 자동 재생이 막히면(play() 거부) 멈춘 첫 프레임 대신 포스터 이미지를 보인다', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function play() {
      return Promise.reject(new DOMException('autoplay blocked', 'NotAllowedError'));
    };
  });
  await openLanding(page);
  await expect(page.getByTestId('home-hero-media')).toHaveAttribute('data-media', 'image');
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.getByTestId('home-hero-image')).toBeVisible();
  await expect(page.getByRole('heading', { name: /상세페이지를/ })).toBeVisible();
});

for (const [width, height] of [[1728, 885], [1440, 900], [1280, 720]] as const) {
  test(`${width}×${height} — 랜딩 영상은 화면 전체를 가운데 기준 cover 로 채우고 가로로 넘치지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openLanding(page);
    const video = page.locator('video');
    await expect(video).toHaveCSS('object-fit', 'cover');
    await expect(video).toHaveCSS('object-position', '50% 50%');
    const vb = (await video.boundingBox())!;
    expect([vb.x, vb.y, vb.width, vb.height]).toEqual([0, 0, width, height]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    // 메인 문구는 영상 위에서 화면 안에 남는다(아래 111 · 왼쪽 92)
    const copy = (await page.getByTestId('home-landing-copy').boundingBox())!;
    expect([copy.x, copy.y + copy.height]).toEqual([92, height - 111]);
  });
}

for (const [width, height] of [[1728, 885], [1512, 860], [1440, 900], [1280, 720]] as const) {
  test(`${width}×${height} — 로그인 후 홈은 가로로 넘치지 않고 세로로 스크롤한다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/home');
    await expect(page.getByTestId('home-recent-table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    const banner = await box(page, 'home-banner');
    expect([banner.x, banner.width, banner.height]).toEqual([60, width - 120, 488]);
    const table = await box(page, 'home-recent-table');
    expect(table.x + table.width).toBeLessThanOrEqual(width - 60);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(height);
  });
}

// ─────────────────────────────────────────────────────────────────
// 인증 진입 — /home 은 세션 확인 뒤 공개 랜딩(미인증) 또는 H0(인증)를 보인다. Mock 인증 서버 상태는 localStorage(같은 브라우저의 쿠키 흉내)다.
// ─────────────────────────────────────────────────────────────────

const MOCK_AUTH_SERVER_KEY = 'pixlate:mock-auth-server';
const MOCK_AUTH_SCENARIO_KEY = 'pixlate:mock-auth-scenario';
const PROTECTED = /^\/(brands|library|jobs|master)(\/|$)/;

/** 세션(refresh 쿠키)이 없는 브라우저 — 처음 오는 방문자 */
async function signedOutBrowser(page: Page) {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('__seeded')) {
      localStorage.setItem(key, JSON.stringify({ sellerId: null, generation: 1, pendingState: null }));
      sessionStorage.setItem('__seeded', '1');
    }
  }, MOCK_AUTH_SERVER_KEY);
}

function recordProtected(page: Page) {
  const list: string[] = [];
  page.on('request', (r) => {
    const { pathname } = new URL(r.url());
    if (PROTECTED.test(pathname) && !/\.(png|svg|webp|mp4|jpg)$/.test(pathname)) list.push(`${r.method()} ${pathname}`);
  });
  return list;
}

test('처음 오는 비로그인 방문자 — /home 은 공개 랜딩이고 보호 API(브랜드·보관함)를 부르지 않으며 G1 으로 보내지 않는다', async ({ page }) => {
  await signedOutBrowser(page);
  const protectedCalls = recordProtected(page);
  await page.goto('/home');
  await expect(page.getByTestId('home-landing')).toBeVisible();
  await expect(page.getByTestId('home-hero-media')).toHaveAttribute('data-media', 'video');
  await page.waitForTimeout(800);
  expect(page.url()).toMatch(/\/home$/);
  expect(protectedCalls).toEqual([]);
  await expect(page.getByTestId('home-workspace')).toHaveCount(0);
});

test('랜딩 [로그인] → G1 → 로그인 성공 → H0', async ({ page }) => {
  await signedOutBrowser(page);
  await page.goto('/home');
  await page.getByTestId('home-landing-login').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByTestId('g1-social-kakao').click();
  await page.waitForURL((url) => url.pathname === '/home');
  await expect(page.getByTestId('home-workspace')).toBeVisible();
  await expect(page.getByTestId('brand-card-101')).toBeVisible();
});

test('로그인 유지 중 서비스 재접속(새로고침) — 확인 중에는 랜딩·H0 를 그리지 않고, 세션 확인 뒤 H0', async ({ page }) => {
  const seen: string[] = [];
  await page.exposeFunction('__recordView', (v: string) => seen.push(v));
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const el = document.querySelector('[data-home-view]');
      if (el) (window as unknown as { __recordView(v: string): void }).__recordView(el.getAttribute('data-home-view')!);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-home-view'] });
  });
  await page.goto('/home');
  await expect(page.getByTestId('home-workspace')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('home-workspace')).toBeVisible();
  // 랜딩이 한 번도 깜빡이지 않는다
  expect(seen).not.toContain('landing');
  expect(seen).toContain('checking');
});

test('세션 확인이 네트워크·서버 오류면 로그아웃으로 보지 않는다 — 랜딩·G1 이 아니라 확인 실패 안내, [다시 시도]로 H0', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem(key, JSON.stringify({ refresh: ['unavailable'] }));
      sessionStorage.setItem('__seeded', '1');
    }
  }, MOCK_AUTH_SCENARIO_KEY);
  const protectedCalls = recordProtected(page);
  await page.goto('/home');
  await expect(page.getByTestId('home-check-failed')).toBeVisible();
  await expect(page.getByTestId('home-landing')).toHaveCount(0);
  expect(page.url()).toMatch(/\/home$/);
  expect(protectedCalls).toEqual([]);
  await page.getByTestId('home-check-retry').click();
  await expect(page.getByTestId('home-workspace')).toBeVisible();
});

test('보호 화면(H0)에서 세션이 끝나면 G1 — 확인이 끝난 뒤의 세션 종료는 랜딩이 아니다', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByTestId('home-workspace')).toBeVisible();
  // 다음 보호 요청이 401 이고 refresh 도 실패(세션 만료)
  await page.evaluate((key) => sessionStorage.setItem(key, JSON.stringify({ expireOnce: true, refresh: ['invalid'] })), MOCK_AUTH_SCENARIO_KEY);
  // H0 에서 캐시되지 않은 보호 요청(GET /brands/101)이 반드시 나가는 이동 — 캐시된 목록만 보는 이동은 요청이 없을 수 있다
  await pushRoute(page, '/brand?brandId=101');
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 15_000 });
});

test('로그아웃하면 다른 탭도 G1 — 공개 랜딩에 있던 탭은 다른 탭의 새 로그인을 따라 새 계정 H0', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto('/home');
  await expect(a.getByTestId('home-workspace')).toBeVisible();
  await b.goto('/brand/select');
  await expect(b.getByTestId('brand-card-101')).toBeVisible();
  await a.getByTestId('account-logout').click();
  await a.waitForURL((url) => url.pathname === '/login');
  await b.waitForURL((url) => url.pathname === '/login');

  // b 는 공개 랜딩, a 에서 다른 계정(Google = 2)으로 로그인 → b 도 새 계정 H0
  await b.goto('/home');
  await expect(b.getByTestId('home-landing')).toBeVisible();
  await a.getByTestId('g1-social-google').click();
  await a.waitForURL((url) => url.pathname === '/home');
  await expect(b.getByTestId('home-workspace')).toBeVisible({ timeout: 10_000 });
  await b.getByTestId('job-header-account').click();
  await expect(b.getByTestId('job-header-account-email')).toHaveText('google-seller@pixlate.mock');
});

test('다른 탭 계정 변경 — 이전 계정 화면(M2 편집 중)을 버리고 새 계정 H0, 이전 입력은 남지 않는다', async ({ context }) => {
  const a = await context.newPage();
  await a.goto('/brand');
  await expect(a.getByTestId('m2-name-ko')).toHaveValue('픽슬레이트');
  await a.getByTestId('m2-name-ko').fill('저장하지 않은 이름');
  const b = await context.newPage();
  await b.goto('/login');
  await b.getByTestId('g1-social-google').click();
  await b.waitForURL((url) => url.pathname === '/home');
  await a.waitForURL((url) => url.pathname === '/home');
  await expect(a.getByTestId('auth-notice')).toHaveAttribute('data-notice', 'account-changed');
  await expect(a.getByTestId('home-workspace')).toBeVisible();
  await expect(a.getByText('저장하지 않은 이름')).toHaveCount(0);
  await expect(a.getByTestId('m2-unsaved-dialog')).toHaveCount(0);
});

test('[전체 보관함 보기](임시) → 전체 보관함 · 특정 브랜드 보관함처럼 보이지 않는다', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByTestId('home-all-library')).toHaveText('전체 보관함 보기');
  await page.getByTestId('home-all-library').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('app-header-title')).toHaveText('보관함');
  await expect(page.getByTestId('app-header-title')).not.toHaveText(/픽슬레이트/);
});
