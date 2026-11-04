import { type Page, expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// G1 로그인 (Figma 835:6511) — Chromium, MSW Mock.
// 실제 백엔드 로그인을 검증하지 않는다. MSW 는 page.route 로 가로챌 수 없어 window.fetch 를 감싸 호출을 기록·제어한다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'G1 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

type AuthCall = { url: string; method: string; credentials?: string; body: string | null };

/** hold=true 면 window.__releaseLogin() 전까지 응답을 잡아 둔다 */
async function recordFetch(page: Page, options: { hold?: boolean; networkError?: boolean } = {}) {
  await page.addInitScript((opts) => {
    const w = window as unknown as { __calls: AuthCall[]; __releaseLogin: () => void };
    w.__calls = [];
    const original = window.fetch.bind(window);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    w.__releaseLogin = () => release();
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/auth\//.test(url)) {
        w.__calls.push({ url, method: init?.method ?? 'GET', credentials: init?.credentials, body: typeof init?.body === 'string' ? init.body : null });
        if (opts.hold) await gate;
        if (opts.networkError) throw new TypeError('network');
      }
      return original(input, init);
    };
  }, options);
}

const authCalls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: AuthCall[] }).__calls);

async function open(page: Page) {
  await page.goto('/login');
  await expect(page.getByTestId('g1-form')).toBeVisible();
}

const email = (page: Page) => page.getByLabel('이메일');
const password = (page: Page) => page.getByLabel('비밀번호');
const submit = (page: Page) => page.getByTestId('g1-submit');

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`${testId} 없음`);
  return b;
}

test('G1 이 렌더되고 Figma 문구가 모두 보인다', async ({ page }) => {
  await open(page);
  for (const text of [
    'AI LOCALIZATION WORKSPACE',
    '상세페이지를 번역하는 것에서,',
    '현지에 맞게 완성하는 것까지.',
    'AI가 분석하고 번역하고 검수합니다.',
    '필요한 순간, 당신 옆엔 픽슬레이트',
    'LOCALIZE · VERIFY · EXPORT',
    'WELCOME BACK',
    '다시 만나서 반가워요.',
    '자동 로그인',
    '비밀번호 찾기',
    '회원가입',
    '카카오로 시작하기',
    'Google로 계속하기',
  ]) {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(submit(page)).toHaveText('로그인');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('다시 만나서 반가워요.');
});

test('GIF 는 public 정적 자산으로 실제 로드되고 왼쪽 패널을 cover 로 채운다', async ({ page }) => {
  const gif = page.waitForResponse((r) => r.url().endsWith('/auth/pixlate_login.gif'));
  await open(page);
  const response = await gif;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/gif');
  const info = await page.getByTestId('g1-brand-gif').evaluate(async (el) => {
    const img = el as HTMLImageElement;
    await img.decode();
    const s = getComputedStyle(img);
    return { w: img.naturalWidth, h: img.naturalHeight, fit: s.objectFit, alt: img.alt, src: img.getAttribute('src') };
  });
  expect(info).toEqual({ w: 1120, h: 1080, fit: 'cover', alt: '', src: '/auth/pixlate_login.gif' });
  await expect(page.getByTestId('g1-brand-layer')).toHaveCSS('overflow', 'hidden');
  expect(await box(page, 'g1-brand-gif')).toEqual({ x: 0, y: 0, width: 1120, height: 1080 });
});

test('GIF 를 받지 못해도 화면은 유지되고 문구가 보인다', async ({ page }) => {
  await page.route('**/auth/pixlate_login.gif', (route) => route.abort());
  await open(page);
  await expect(page.getByTestId('g1-brand-headline')).toBeVisible();
  await expect(page.getByTestId('g1-brand-layer')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
});

test('1920×1080 위치가 Figma 와 일치한다', async ({ page }) => {
  await open(page);
  const expected: [string, Partial<{ x: number; y: number; width: number; height: number }>][] = [
    ['g1-brand-layer', { x: 0, y: 0, width: 1120, height: 1080 }],
    ['g1-auth-panel', { x: 1120, y: 0, width: 800, height: 1080 }],
    ['g1-brand-logo', { x: 60, y: 120, width: 128 }],
    ['g1-brand-micro', { x: 60 }],
    ['g1-brand-headline', { x: 60, y: 283 }],
    ['g1-brand-subcopy', { x: 60, y: 433, height: 38 }],
    ['g1-brand-footer', { x: 60, y: 1002 }],
    ['g1-auth-logo', { x: 1276, y: 120, width: 128, height: 39 }],
    ['g1-form', { x: 1276, y: 274, width: 432, height: 436 }],
    ['g1-remember', { x: 1276, y: 274 + 124 + 138, height: 20 }],
    ['g1-submit', { x: 1276, y: 274 + 342, width: 432, height: 45 }],
    ['g1-social', { x: 1276, y: 858, width: 432, height: 102 }],
    ['g1-social-kakao', { x: 1276, y: 858, width: 432, height: 45 }],
    ['g1-social-google', { x: 1276, y: 915, width: 432, height: 45 }],
  ];
  for (const [id, want] of expected) {
    const got = await box(page, id);
    for (const [key, value] of Object.entries(want)) {
      expect(got[key as keyof typeof got], `${id}.${key}`).toBeCloseTo(value, 1);
    }
  }
  for (const name of ['이메일', '비밀번호']) {
    const b = (await page.getByLabel(name).boundingBox())!;
    expect([b.x, b.width, b.height]).toEqual([1276, 432, 39]);
  }
  const emailBox = (await email(page).boundingBox())!;
  const passwordBox = (await password(page).boundingBox())!;
  expect(emailBox.y).toBe(274 + 124 + 18);
  expect(passwordBox.y).toBe(274 + 124 + 69 + 18);
  const links = await box(page, 'g1-links');
  expect(links.y).toBe(274 + 342 + 77);
  expect(Math.abs(links.x - (1276 + 136))).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1920);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(1080);

  await expect(email(page)).toHaveCSS('border-color', 'rgb(234, 234, 234)');
  await expect(email(page)).toHaveCSS('border-radius', '6px');
  await expect(email(page)).toHaveCSS('padding-left', '16px');
  await expect(submit(page)).toHaveCSS('background-color', 'rgb(23, 23, 23)');
  await expect(page.getByTestId('g1-social-kakao')).toHaveCSS('background-color', 'rgb(254, 229, 0)');
  await expect(page.getByTestId('g1-social-google')).toHaveCSS('border-color', 'rgb(234, 234, 234)');
  await expect(page.getByTestId('g1-brand-micro')).toHaveCSS('letter-spacing', '0.88px');
  await expect(page.getByTestId('g1-brand-headline')).toHaveCSS('font-size', '46px');
  await expect(page.getByTestId('g1-brand-headline')).toHaveCSS('font-weight', '600');
});

test('1440×900 에서 가로·세로 넘침 없이 폼과 소셜 버튼이 겹치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(900);
  const panel = await box(page, 'g1-auth-panel');
  expect(panel.x).toBeCloseTo(840, 0);
  const form = await box(page, 'g1-form');
  const social = await box(page, 'g1-social');
  expect(form.width).toBe(432);
  expect(form.x + form.width).toBeLessThanOrEqual(1440);
  expect(social.y).toBeGreaterThanOrEqual(form.y + form.height);
  expect(social.y + social.height).toBeLessThanOrEqual(900);
});

test('이메일·비밀번호는 실제 input 이며 비밀번호는 가려진다', async ({ page }) => {
  await open(page);
  await expect(email(page)).toHaveAttribute('type', 'email');
  await expect(email(page)).toHaveAttribute('placeholder', 'name@example.com');
  await expect(password(page)).toHaveAttribute('type', 'password');
  await expect(password(page)).toHaveAttribute('placeholder', '비밀번호를 입력해주세요');
  await email(page).fill('seller@example.com');
  await password(page).fill('secret');
  await expect(email(page)).toHaveValue('seller@example.com');
  await expect(password(page)).toHaveValue('secret');
  await expect(page.locator('body')).not.toContainText('secret');
});

test('자동 로그인은 화면 상태만 바꾸고 저장소·요청에 남기지 않는다', async ({ page }) => {
  await recordFetch(page);
  await open(page);
  const box20 = (await page.getByTestId('g1-remember-checkbox').boundingBox())!;
  expect([box20.width, box20.height]).toEqual([20, 20]);
  const visual = page.getByTestId('g1-remember').locator('[data-checkbox-visual]');
  await expect(visual).toHaveCSS('width', '18px');
  await expect(visual).toHaveCSS('border-radius', '4px');
  await expect(visual).toHaveCSS('border-color', 'rgb(234, 234, 234)');

  await page.getByText('자동 로그인', { exact: true }).click();
  await expect(page.getByTestId('g1-remember-checkbox')).toBeChecked();
  await expect(visual).toHaveCSS('border-color', 'rgb(255, 106, 56)');
  // 마우스로 선택한 뒤 modifier 키를 눌러도 포커스 링이 켜지지 않는다
  await page.keyboard.press('Shift');
  await expect(visual).toHaveCSS('outline-style', 'none');

  await email(page).fill('seller@example.com');
  await password(page).fill('secret');
  await submit(page).click();
  await expect(page.getByTestId('g1-form-success')).toBeVisible();
  const [call] = await authCalls(page);
  expect(JSON.parse(call.body!)).toEqual({ email: 'seller@example.com', password: 'secret' });
  const storage = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join());
  expect(storage).not.toContain('mock-access-token');
  expect(storage).not.toMatch(/remember|자동/);

  await page.getByTestId('g1-remember-checkbox').uncheck();
  await expect(page.getByTestId('g1-remember-checkbox')).not.toBeChecked();
});

test('빈 값과 잘못된 이메일을 막고 요청을 보내지 않는다', async ({ page }) => {
  await recordFetch(page);
  await open(page);
  // 오류가 없으면 helper 자리를 차지하지 않는다
  await expect(page.getByTestId('login-email-error')).toHaveCount(0);

  await submit(page).click();
  await expect(page.getByTestId('login-email-error')).toHaveText('이메일을 입력해주세요.');
  await expect(page.getByTestId('login-password-error')).toHaveText('비밀번호를 입력해주세요.');
  await expect(email(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(email(page)).toHaveCSS('border-color', 'rgb(229, 72, 77)');
  await expect(email(page)).toBeFocused();

  await email(page).fill('seller');
  await expect(page.getByTestId('login-email-error')).toHaveCount(0);
  await submit(page).click();
  await expect(page.getByTestId('login-email-error')).toHaveText('올바른 이메일 형식으로 입력해주세요.');

  await email(page).fill('seller@example.com');
  await submit(page).click();
  await expect(page.getByTestId('login-email-error')).toHaveCount(0);
  await expect(password(page)).toBeFocused();
  expect(await authCalls(page)).toEqual([]);
});

test('Enter 로 제출되고 응답 전에는 loading 상태이며 중복 제출되지 않는다', async ({ page }) => {
  await recordFetch(page, { hold: true });
  await open(page);
  await email(page).fill('seller@example.com');
  await password(page).fill('secret');
  const before = await box(page, 'g1-submit');
  await password(page).press('Enter');

  await expect(page.getByTestId('g1-submit-loader')).toBeVisible();
  await expect(submit(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('g1-form')).toHaveAttribute('aria-busy', 'true');
  expect(await box(page, 'g1-submit')).toEqual(before);

  await password(page).press('Enter');
  // aria-disabled 는 Playwright 가 비활성으로 봐서 force 로 실제 클릭을 보낸다
  await submit(page).click({ force: true });
  const calls = await authCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('POST');
  expect(calls[0].credentials).toBe('include');
  expect(new URL(calls[0].url, page.url()).pathname).toBe('/auth/login');

  await page.evaluate(() => (window as unknown as { __releaseLogin: () => void }).__releaseLogin());
  await expect(page.getByTestId('g1-form-success')).toBeVisible();
  await expect(page.getByTestId('g1-submit-loader')).toHaveCount(0);
});

test('Mock 성공은 토큰을 저장하지 않고 임의 화면으로 이동하지 않는다', async ({ page }) => {
  await open(page);
  const dbNames = () => page.evaluate(async () => ((await indexedDB.databases?.()) ?? []).map((d) => d.name));
  const dbsBefore = await dbNames();
  await email(page).fill(' seller@example.com ');
  await password(page).fill('secret');
  await submit(page).click();
  await expect(page.getByTestId('g1-form-success')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/login');
  const stored = await page.evaluate(() => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }));
  expect(`${stored.local}${stored.session}`).not.toContain('mock-access-token');
  expect(stored.session).not.toContain('pixlate.accessToken');
  expect(await dbNames()).toEqual(dbsBefore);
});

test('401 은 자격 증명 오류를 보여주고 입력값을 유지하며 다시 시도할 수 있다', async ({ page }) => {
  await open(page);
  await email(page).fill('seller@example.com');
  await password(page).fill('wrong-password');
  await submit(page).click();
  await expect(page.getByTestId('g1-form-error')).toHaveText('이메일 또는 비밀번호가 올바르지 않아요.');
  await expect(page.getByTestId('g1-form-success')).toHaveCount(0);
  await expect(email(page)).toHaveValue('seller@example.com');
  await expect(password(page)).toHaveValue('wrong-password');
  await expect(submit(page)).not.toHaveAttribute('aria-disabled', 'true');

  await password(page).fill('secret');
  await expect(page.getByTestId('g1-form-error')).toHaveCount(0);
  await submit(page).click();
  await expect(page.getByTestId('g1-form-success')).toBeVisible();
});

test('네트워크 실패를 성공처럼 보이지 않는다', async ({ page }) => {
  await recordFetch(page, { networkError: true });
  await open(page);
  await email(page).fill('seller@example.com');
  await password(page).fill('secret');
  await submit(page).click();
  await expect(page.getByTestId('g1-form-error')).toHaveText('지금은 로그인할 수 없어요. 잠시 후 다시 시도해주세요.');
});

test('소셜·비밀번호 찾기·회원가입은 눌러도 요청이나 이동이 없다', async ({ page }) => {
  await recordFetch(page);
  await open(page);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (!/\/_next\/|\/auth\/.*\.(svg|gif)$/.test(r.url())) requests.push(r.url());
  });
  for (const id of ['g1-social-kakao', 'g1-social-google', 'g1-find-password', 'g1-signup']) {
    const button = page.getByTestId(id);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('type', 'button');
    await button.click({ force: true });
  }
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(await authCalls(page)).toEqual([]);
  expect(requests).toEqual([]);
  await expect(page.getByTestId('g1-form-success')).toHaveCount(0);
  await expect(page.getByTestId('login-email-error')).toHaveCount(0);
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
});

test('키보드 포커스가 보이고 입력창 포커스는 Figma Focus 색을 쓴다', async ({ page }) => {
  await open(page);
  await email(page).focus();
  await expect(email(page)).toHaveCSS('border-color', 'rgb(255, 106, 56)');
  await email(page).press('Tab');
  await expect(password(page)).toBeFocused();
  await password(page).press('Tab');
  await expect(page.getByTestId('g1-remember-checkbox')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('g1-remember-checkbox')).toBeChecked();
  await expect(page.getByTestId('g1-remember-checkbox')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(submit(page)).toBeFocused();
  await expect(submit(page)).toHaveCSS('outline-style', 'solid');
});
