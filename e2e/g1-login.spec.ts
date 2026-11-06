import { type Page, expect, test } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// G1 로그인 (Figma 835:6511) — UI 전용, Chromium.
// 로그인 API 가 실제 서버에 없어 화면·입력 검증·키보드·비동작 버튼과 "인증 요청 0건"만 확인한다.
// Mock 을 끈 환경의 자동 로그인 범위는 g1-login-backend-mode.spec.ts 가 맡는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'G1 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

/** public/auth 의 정적 자산을 뺀 /auth/* 요청 — 서버 인증 API 호출이다 */
function recordAuthRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/auth/') && !/\.(gif|svg)$/.test(pathname)) requests.push(`${request.method()} ${pathname}`);
  });
  return requests;
}

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
    ['g1-brand-micro', { x: 60, y: 178.81, height: 13 }],
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

/** DOM 실측 세로 여백 — 위 요소 아래 경계에서 아래 요소 위 경계까지 */
async function verticalGaps(page: Page) {
  const rect = async (id: string) => {
    const b = await box(page, id);
    return { top: b.y, bottom: b.y + b.height };
  };
  const [micro, headline, subcopy, leftLogo, logo, heading, fields, remember, button, links, social] = await Promise.all(
    ['g1-brand-micro', 'g1-brand-headline', 'g1-brand-subcopy', 'g1-brand-logo', 'g1-auth-logo', 'g1-heading', 'g1-fields', 'g1-remember', 'g1-submit', 'g1-links', 'g1-social'].map(rect),
  );
  return {
    leftTop: leftLogo.top,
    rightTop: logo.top,
    microToHeadline: headline.top - micro.bottom,
    headlineToSubcopy: subcopy.top - headline.bottom,
    logoToHeading: heading.top - logo.bottom,
    headingToFields: fields.top - heading.bottom,
    rememberToButton: button.top - remember.bottom,
    buttonToLinks: links.top - button.bottom,
    linksToSocial: social.top - links.bottom,
    socialBottom: social.bottom,
  };
}

test('1920×1080 세로 여백이 Figma 값이고 위치가 그대로다', async ({ page }) => {
  await open(page);
  const gaps = await verticalGaps(page);
  console.log(`[gap] 1920×1080 ${JSON.stringify(gaps)}`);
  expect(gaps.leftTop).toBe(120);
  expect(gaps.rightTop).toBe(120);
  expect(Math.abs(gaps.microToHeadline - 91.19)).toBeLessThanOrEqual(1);
  expect(Math.abs(gaps.headlineToSubcopy - 32.24)).toBeLessThanOrEqual(1);
  expect(gaps.logoToHeading).toBe(115);
  expect(gaps.headingToFields).toBe(60);
  expect(gaps.rememberToButton).toBe(60);
  expect(gaps.buttonToLinks).toBe(32);
  expect(gaps.linksToSocial).toBe(148);
  for (const [id, y] of [['g1-heading', 274], ['g1-fields', 398], ['g1-remember', 536], ['g1-submit', 616], ['g1-links', 693], ['g1-social', 858]] as const) {
    expect((await box(page, id)).y, id).toBe(y);
  }
});

// 1728×885·918 은 실제 노트북 Chrome 창(1728×1005, 내장 화면 1728×1117)에서 브라우저 상단 UI 높이를 뺀 값의 범위다
for (const [width, height] of [[1440, 900], [1728, 918], [1728, 885], [1512, 860]] as const) {
  test(`${width}×${height} 에서 여백이 같은 비율로 줄고 겹치지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page);
    const gaps = await verticalGaps(page);
    console.log(`[gap] ${width}×${height} ${JSON.stringify(gaps)}`);

    // 내부 여백은 하나의 배율을 공유해 Figma 비율을 유지한다
    const scale = gaps.headingToFields / 60;
    expect(scale).toBeLessThan(1);
    expect(Math.abs(gaps.logoToHeading - 115 * scale)).toBeLessThanOrEqual(1);
    expect(Math.abs(gaps.rememberToButton - 60 * scale)).toBeLessThanOrEqual(1);
    expect(Math.abs(gaps.buttonToLinks - 32 * scale)).toBeLessThanOrEqual(1);
    expect(Math.abs(gaps.microToHeadline - 91.19 * scale)).toBeLessThanOrEqual(1);
    expect(gaps.logoToHeading).toBeGreaterThanOrEqual(80);
    expect(gaps.headingToFields).toBeGreaterThanOrEqual(40);
    expect(gaps.buttonToLinks).toBeGreaterThanOrEqual(24);

    // 제목과 보조 문구 묶음은 유지하고, 양쪽 로고 높이는 같다
    expect(Math.abs(gaps.headlineToSubcopy - 32.24)).toBeLessThanOrEqual(1);
    expect(gaps.leftTop).toBe(gaps.rightTop);

    // 스크롤 없이 들어오고 소셜과 겹치지 않으며 아래 여백이 위 여백과 같다
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(gaps.linksToSocial).toBeGreaterThan(gaps.logoToHeading * 0.8);
    expect(Math.abs(height - gaps.socialBottom - gaps.rightTop)).toBeLessThanOrEqual(1);

    // 요소 크기와 글자는 줄지 않는다
    expect((await email(page).boundingBox())!.height).toBe(39);
    expect((await box(page, 'g1-submit')).height).toBe(45);
    expect((await box(page, 'g1-social-kakao')).height).toBe(45);
    expect((await box(page, 'g1-form')).width).toBe(432);
    await expect(page.getByTestId('g1-brand-headline')).toHaveCSS('font-size', '46px');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '32px');
  });
}

test('낮은 화면에서 오류 문구가 늘어나도 소셜 버튼과 겹치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 885 });
  await open(page);
  await submit(page).click();
  await expect(page.getByTestId('login-password-error')).toBeVisible();
  const gaps = await verticalGaps(page);
  expect(gaps.linksToSocial).toBeGreaterThanOrEqual(24);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(885);
});

test('입력과 버튼 폭은 모두 432px 이고 x 위치가 같다', async ({ page }) => {
  for (const [width, height, x] of [[1920, 1080, 1276], [1728, 885, null], [1512, 860, null], [1440, 900, null]] as const) {
    await page.setViewportSize({ width, height });
    await open(page);
    const controls = [email(page), password(page), submit(page), page.getByTestId('g1-social-kakao'), page.getByTestId('g1-social-google'), page.getByTestId('g1-form'), page.getByTestId('g1-social')];
    const boxes = await Promise.all(controls.map(async (c) => (await c.boundingBox())!));
    console.log(`[width] ${width}×${height} ${boxes.map((b) => b.width).join(', ')} / x ${boxes[0].x}`);
    for (const b of boxes) {
      expect(Math.abs(b.width - 432), `${width}×${height}`).toBeLessThanOrEqual(0.5);
      expect(b.x).toBe(boxes[0].x);
    }
    if (x !== null) {
      expect(boxes[0].x).toBe(x);
      expect(boxes[0].x + boxes[0].width).toBe(1708);
    }
  }
});

test('패널이 432px 보다 좁을 때만 줄어들고 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await open(page);
  const panel = await box(page, 'g1-auth-panel');
  const form = await box(page, 'g1-form');
  const social = await box(page, 'g1-social');
  expect(form.width).toBeLessThan(432);
  expect(form.width).toBe(social.width);
  expect(form.x + form.width).toBeLessThanOrEqual(panel.x + panel.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
});

const SUBCOPY_LINES = ['AI가 분석하고 번역하고 검수합니다.', '필요한 순간, 당신 옆엔 픽슬레이트'];
const CONTRAST_LINES = ['AI LOCALIZATION WORKSPACE', ...SUBCOPY_LINES, 'LOCALIZE · VERIFY · EXPORT'];
const graphemes = (page: Page) => page.getByTestId('g1-brand-subcopy').locator('[data-g1-grapheme]');

/** 지정한 원본 좌표 사각형만 주황인 프레임을 주는 ImageDecoder 대역. 실제 GIF 프레임 타이밍에 의존하지 않는다 */
async function useSyntheticGif(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __orange: { x: number; y: number; w: number; h: number } | null; ImageDecoder: unknown };
    w.__orange = null;
    w.ImageDecoder = class {
      static isTypeSupported() {
        return Promise.resolve(true);
      }
      completed = Promise.resolve();
      tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 1 } };
      async decode() {
        const canvas = new OffscreenCanvas(1120, 1080);
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#000';
        g.fillRect(0, 0, 1120, 1080);
        if (w.__orange) {
          g.fillStyle = '#FF6B3A';
          g.fillRect(w.__orange.x, w.__orange.y, w.__orange.w, w.__orange.h);
        }
        return { image: new VideoFrame(canvas, { timestamp: 0, duration: 40_000 }) };
      }
      close() {}
    };
  });
}

/** 글자 index 범위를 덮는 원본 좌표 사각형을 cover 식으로 직접 계산해 주황으로 칠한다 */
async function paintOrangeBehind(page: Page, from: number, to: number, testId = 'g1-brand-subcopy') {
  await page.evaluate(
    ([start, end, scope]) => {
      const panel = document.querySelector('[data-testid=g1-brand-layer]')!.getBoundingClientRect();
      const spans = Array.from(document.querySelectorAll(`[data-testid=${scope}] [data-g1-grapheme]`)).slice(start as number, end as number);
      const rects = spans.map((s) => s.getBoundingClientRect());
      const left = Math.min(...rects.map((r) => r.left)) - panel.left;
      const right = Math.max(...rects.map((r) => r.right)) - panel.left;
      const top = Math.min(...rects.map((r) => r.top)) - panel.top;
      const bottom = Math.max(...rects.map((r) => r.bottom)) - panel.top;
      const scale = Math.max(panel.width / 1120, panel.height / 1080);
      const cropX = (1120 - panel.width / scale) / 2;
      const cropY = (1080 - panel.height / scale) / 2;
      (window as unknown as { __orange: unknown }).__orange = { x: cropX + left / scale, y: cropY + top / scale, w: (right - left) / scale, h: (bottom - top) / scale };
    },
    [from, to, testId] as const,
  );
}

const darkIndexes = (page: Page, testId = 'g1-brand-subcopy') =>
  page.evaluate(
    (scope) => Array.from(document.querySelectorAll(`[data-testid=${scope}] [data-g1-grapheme]`)).flatMap((s, i) => (s.hasAttribute('data-on-orange') ? [i] : [])),
    testId,
  );
const allDarkCount = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-on-orange]').length);

test('GIF 위 문구 4줄은 글자 span 으로 그려지고 문장 이름을 유지하며 줄 폭이 그대로다', async ({ page }) => {
  await open(page);
  for (const line of CONTRAST_LINES) {
    const group = page.getByRole('group', { name: line });
    await expect(group).toHaveText(line);
    expect(await group.locator('[data-g1-grapheme]').count()).toBe(Array.from(line).length);
    await expect(group.locator('[data-g1-grapheme]').first()).toHaveAttribute('aria-hidden', 'true');
    // 글자를 나눠도 자간·kerning 이 유지되어 통문장과 폭이 같다. 차이는 span 별 1/64px 반올림 누적뿐이다
    const widths = await group.evaluate((p, text) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const split = range.getBoundingClientRect().width;
      const plain = document.createElement('span');
      plain.textContent = text;
      plain.style.whiteSpace = 'nowrap';
      p.append(plain);
      const whole = plain.getBoundingClientRect().width;
      plain.remove();
      return { split, whole };
    }, line);
    expect(Math.abs(widths.split - widths.whole)).toBeLessThanOrEqual(0.5);
  }
  await expect(graphemes(page).first()).toHaveCSS('color', 'rgb(153, 153, 153)');
  // 제목은 흰색 그대로이며 대상이 아니다
  await expect(page.getByTestId('g1-brand-headline').locator('[data-g1-grapheme]')).toHaveCount(0);
  // 글자를 나눠도 Figma typography 와 기본 색은 그대로다
  const micro = page.getByTestId('g1-brand-micro').locator('[data-g1-grapheme]').first();
  await expect(micro).toHaveCSS('font-size', '11px');
  await expect(micro).toHaveCSS('font-weight', '300');
  await expect(micro).toHaveCSS('letter-spacing', '0.88px');
  await expect(micro).toHaveCSS('color', 'rgb(153, 153, 153)');
  const footer = page.getByTestId('g1-brand-footer').locator('[data-g1-grapheme]').first();
  await expect(footer).toHaveCSS('font-size', '12px');
  await expect(footer).toHaveCSS('font-weight', '300');
  await expect(footer).toHaveCSS('letter-spacing', '-0.48px');
  await expect(footer).toHaveCSS('color', 'rgb(153, 153, 153)');
});

for (const [width, height] of [[1920, 1080], [1440, 900], [1728, 885]] as const) {
  test(`${width}×${height} 주황 뒤의 글자만 #171717 이 되고 지나가면 #999 로 돌아오며 위치는 그대로다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await useSyntheticGif(page);
    await open(page);
    await expect(page.getByTestId('g1-brand-layer')).toHaveAttribute('data-gif-contrast', 'running');
    await expect.poll(() => darkIndexes(page)).toEqual([]);
    const rectsBefore = await graphemes(page).evaluateAll((all) => all.map((s) => { const r = s.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));

    // "분석하" (index 4~6)
    await paintOrangeBehind(page, 4, 7);
    await expect.poll(() => darkIndexes(page)).toEqual([4, 5, 6]);
    await expect(graphemes(page).nth(5)).toHaveCSS('color', 'rgb(23, 23, 23)');
    await expect(graphemes(page).nth(3)).toHaveCSS('color', 'rgb(153, 153, 153)');
    await expect(graphemes(page).nth(7)).toHaveCSS('color', 'rgb(153, 153, 153)');
    const weight = await graphemes(page).nth(5).evaluate((s) => getComputedStyle(s).fontWeight);
    expect(weight).toBe(await graphemes(page).nth(0).evaluate((s) => getComputedStyle(s).fontWeight));
    const rectsDuring = await graphemes(page).evaluateAll((all) => all.map((s) => { const r = s.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
    expect(rectsDuring).toEqual(rectsBefore);

    // 둘째 줄로 이동하면 첫 줄은 복귀한다
    const firstLineCount = Array.from(SUBCOPY_LINES[0]).length;
    await paintOrangeBehind(page, firstLineCount, firstLineCount + 2);
    await expect.poll(() => darkIndexes(page)).toEqual([firstLineCount, firstLineCount + 1]);

    await page.evaluate(() => {
      (window as unknown as { __orange: unknown }).__orange = null;
    });
    await expect.poll(() => darkIndexes(page)).toEqual([]);
    await expect(graphemes(page).nth(5)).toHaveCSS('color', 'rgb(153, 153, 153)');
  });
}

for (const [width, height] of [[1920, 1080], [1728, 885]] as const) {
  test(`${width}×${height} 작은 문구와 하단 문구도 주황 뒤의 글자만 바뀌고 돌아온다`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await useSyntheticGif(page);
    await open(page);
    await expect(page.getByTestId('g1-brand-layer')).toHaveAttribute('data-gif-contrast', 'running');
    await expect.poll(() => allDarkCount(page)).toBe(0);
    const positions = () =>
      page.evaluate(() => Array.from(document.querySelectorAll('[data-g1-grapheme]')).map((s) => { const r = s.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].join(); }).join('|'));
    const before = await positions();

    // "LOC" (AI 다음 index 3~5)
    await paintOrangeBehind(page, 3, 6, 'g1-brand-micro');
    await expect.poll(() => darkIndexes(page, 'g1-brand-micro')).toEqual([3, 4, 5]);
    expect(await allDarkCount(page)).toBe(3);
    await expect(page.getByTestId('g1-brand-micro').locator('[data-g1-grapheme]').nth(4)).toHaveCSS('color', 'rgb(23, 23, 23)');
    await expect(page.getByTestId('g1-brand-micro').locator('[data-g1-grapheme]').nth(6)).toHaveCSS('color', 'rgb(153, 153, 153)');
    expect(await positions()).toBe(before);

    // "VE" (index 11~12). 하단 문구는 bottom 기준이므로 패널 높이에 따라 위치가 다르다
    await paintOrangeBehind(page, 11, 13, 'g1-brand-footer');
    await expect.poll(() => darkIndexes(page, 'g1-brand-footer')).toEqual([11, 12]);
    expect(await darkIndexes(page, 'g1-brand-micro')).toEqual([]);
    expect(await allDarkCount(page)).toBe(2);
    await expect(page.getByTestId('g1-brand-footer').locator('[data-g1-grapheme]').nth(12)).toHaveCSS('color', 'rgb(23, 23, 23)');
    expect(await positions()).toBe(before);

    await page.evaluate(() => {
      (window as unknown as { __orange: unknown }).__orange = null;
    });
    await expect.poll(() => allDarkCount(page)).toBe(0);
    await expect(page.getByTestId('g1-brand-footer').locator('[data-g1-grapheme]').nth(12)).toHaveCSS('color', 'rgb(153, 153, 153)');
  });
}

test('문구가 늘어도 GIF fetch 와 디코더는 하나다', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __signals: AbortSignal[]; __decoders: number; ImageDecoder: new (...args: unknown[]) => object };
    w.__signals = [];
    w.__decoders = 0;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes('pixlate_login.gif') && init?.signal) w.__signals.push(init.signal);
      return original(input, init);
    };
    const Real = w.ImageDecoder;
    w.ImageDecoder = class extends Real {
      constructor(...args: unknown[]) {
        super(...args);
        w.__decoders += 1;
      }
    };
  });
  await open(page);
  await expect(page.getByTestId('g1-brand-layer')).toHaveAttribute('data-gif-contrast', 'running');
  await page.waitForTimeout(500);
  // 개발 모드 Strict Mode 는 effect 를 두 번 실행해 첫 요청을 취소한다. 살아 있는 요청과 디코더는 하나여야 한다
  const live = await page.evaluate(() => {
    const w = window as unknown as { __signals: AbortSignal[]; __decoders: number };
    return { fetches: w.__signals.filter((signal) => !signal.aborted).length, decoders: w.__decoders };
  });
  expect(live).toEqual({ fetches: 1, decoders: 1 });
});

test('창 크기가 바뀌면 글자 위치와 crop 을 다시 계산한다', async ({ page }) => {
  await useSyntheticGif(page);
  await open(page);
  await expect(page.getByTestId('g1-brand-layer')).toHaveAttribute('data-gif-contrast', 'running');
  await page.setViewportSize({ width: 1440, height: 900 });
  await paintOrangeBehind(page, 4, 7);
  await expect.poll(() => darkIndexes(page)).toEqual([4, 5, 6]);
});

test('실제 GIF 를 canvas 로 재생하고 프레임이 첫 프레임에 멈추지 않는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page.getByTestId('g1-brand-layer')).toHaveAttribute('data-gif-contrast', 'running');
  await expect(page.getByTestId('g1-brand-gif-canvas')).toBeVisible();
  await expect(page.getByTestId('g1-brand-gif-canvas')).toHaveCSS('object-fit', 'cover');
  const fingerprint = () =>
    page.getByTestId('g1-brand-gif-canvas').evaluate((c: HTMLCanvasElement) => {
      const small = document.createElement('canvas');
      small.width = 56;
      small.height = 54;
      const g = small.getContext('2d')!;
      g.drawImage(c, 0, 0, 56, 54);
      return Array.from(g.getImageData(0, 0, 56, 54).data).reduce((h, v) => (h * 31 + v) | 0, 0);
    });
  const first = await fingerprint();
  await expect.poll(fingerprint).not.toBe(first);
  expect(errors).toEqual([]);
});

test('GIF 를 받지 못하면 문구는 #999 로 남고 오류가 나지 않는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/auth/pixlate_login.gif', (route) => route.abort());
  // MSW service worker 를 거치는 fetch 는 page.route 로 막히지 않아 fetch 자체를 실패시킨다
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => (String(input).includes('pixlate_login.gif') ? Promise.reject(new TypeError('network')) : original(input, init));
  });
  await open(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('g1-brand-gif-canvas')).toBeHidden();
  expect(await darkIndexes(page)).toEqual([]);
  await expect(graphemes(page).first()).toHaveCSS('color', 'rgb(153, 153, 153)');
  expect(errors).toEqual([]);
});

test('재생 중 디코딩이 실패하면 img 와 #999 로 돌아간다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await useSyntheticGif(page);
  await open(page);
  await expect(page.getByTestId('g1-brand-layer')).toHaveAttribute('data-gif-contrast', 'running');
  await paintOrangeBehind(page, 4, 7);
  await expect.poll(() => darkIndexes(page)).toEqual([4, 5, 6]);
  await page.evaluate(() => {
    (window as unknown as { __orange: unknown }).__orange = 'break';
    OffscreenCanvas.prototype.getContext = () => {
      throw new Error('decode failed');
    };
  });
  await expect(page.getByTestId('g1-brand-gif-canvas')).toBeHidden();
  await expect(page.getByTestId('g1-brand-gif')).toBeVisible();
  expect(await darkIndexes(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('ImageDecoder 미지원 브라우저는 img 로 재생하고 문구는 #999 다', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { ImageDecoder?: unknown }).ImageDecoder;
  });
  await open(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('g1-brand-gif')).toBeVisible();
  await expect(page.getByTestId('g1-brand-gif-canvas')).toBeHidden();
  expect(await darkIndexes(page)).toEqual([]);
});

test('모션 감소 환경은 추적을 멈추고 #999 를 유지한다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await useSyntheticGif(page);
  await open(page);
  await paintOrangeBehind(page, 4, 7);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('g1-brand-gif-canvas')).toBeHidden();
  expect(await allDarkCount(page)).toBe(0);
  await expect(page.getByTestId('g1-brand-micro').locator('[data-g1-grapheme]').first()).toHaveCSS('color', 'rgb(153, 153, 153)');
  await expect(page.getByTestId('g1-brand-footer').locator('[data-g1-grapheme]').first()).toHaveCSS('color', 'rgb(153, 153, 153)');
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

test('자동 로그인은 화면 상태만 바꾸고 어디에도 저장하지 않는다', async ({ page }) => {
  await open(page);
  const checkbox = page.getByTestId('g1-remember-checkbox');
  const frame = (await checkbox.boundingBox())!;
  expect([frame.width, frame.height]).toEqual([20, 20]);
  const visual = page.getByTestId('g1-remember').locator('[data-checkbox-visual]');
  await expect(visual).toHaveCSS('width', '18px');
  await expect(visual).toHaveCSS('border-radius', '4px');
  await expect(visual).toHaveCSS('border-color', 'rgb(234, 234, 234)');

  await page.getByText('자동 로그인', { exact: true }).click();
  await expect(checkbox).toBeChecked();
  await expect(visual).toHaveCSS('border-color', 'rgb(255, 106, 56)');
  // 마우스로 선택한 뒤 modifier 키를 눌러도 포커스 링이 켜지지 않는다(M1 공용 규칙)
  await page.keyboard.press('Shift');
  await expect(visual).toHaveCSS('outline-style', 'none');

  await email(page).fill('seller@example.com');
  await password(page).fill('secret');
  await submit(page).click();
  const saved = await page.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage), document.cookie].join('|'));
  expect(saved).not.toMatch(/seller@example\.com|secret|token|remember/i);

  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
});

test('빈 값과 잘못된 이메일에만 오류를 표시한다', async ({ page }) => {
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
});

test('유효한 제출은 이동·결과 문구·요청 없이 끝난다', async ({ page }) => {
  const auth = recordAuthRequests(page);
  await open(page);
  expect(auth).toEqual([]);
  const before = await page.getByTestId('g1-auth-panel').innerText();

  await email(page).fill('seller@example.com');
  await password(page).fill('secret');
  await submit(page).click();
  await page.waitForTimeout(300);

  expect(new URL(page.url()).pathname).toBe('/login');
  expect(await page.getByTestId('g1-auth-panel').innerText()).toBe(before);
  await expect(page.getByTestId('login-email-error')).toHaveCount(0);
  await expect(page.getByTestId('login-password-error')).toHaveCount(0);
  await expect(page.getByTestId('g1-auth-panel').locator('[role="alert"], [role="status"]')).toHaveCount(0);
  await expect(email(page)).toHaveValue('seller@example.com');
  expect(auth).toEqual([]);
});

test('Enter 는 입력창과 로그인 버튼에서 제출되어 검증을 실행한다', async ({ page }) => {
  const auth = recordAuthRequests(page);
  await open(page);
  await password(page).press('Enter');
  await expect(page.getByTestId('login-email-error')).toBeVisible();

  await email(page).fill('seller@example.com');
  await submit(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('login-password-error')).toBeVisible();
  expect(auth).toEqual([]);
});

test('소셜·비밀번호 찾기·회원가입은 눌러도 요청이나 이동이 없다', async ({ page }) => {
  const auth = recordAuthRequests(page);
  await open(page);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (!/\/_next\/|\/auth\/.*\.(svg|gif)$/.test(r.url())) requests.push(r.url());
  });
  for (const id of ['g1-social-kakao', 'g1-social-google', 'g1-find-password', 'g1-signup']) {
    const button = page.getByTestId(id);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('type', 'button');
    // aria-disabled 는 Playwright 가 비활성으로 봐서 force 로 실제 클릭을 보낸다
    await button.click({ force: true });
  }
  await page.waitForTimeout(300);
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(requests).toEqual([]);
  expect(auth).toEqual([]);
  await expect(page.getByTestId('login-email-error')).toHaveCount(0);
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
  await expect(page.locator('a')).toHaveCount(0);
});

test('Tab·Shift+Tab 이동과 Space 토글이 동작하고 포커스가 보인다', async ({ page }) => {
  await open(page);
  await email(page).focus();
  await expect(email(page)).toHaveCSS('border-color', 'rgb(255, 106, 56)');
  await email(page).press('Tab');
  await expect(password(page)).toBeFocused();
  await password(page).press('Shift+Tab');
  await expect(email(page)).toBeFocused();
  await email(page).press('Tab');
  await password(page).press('Tab');
  const checkbox = page.getByTestId('g1-remember-checkbox');
  await expect(checkbox).toBeFocused();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeFocused();
  await expect(page.getByTestId('g1-remember').locator('[data-checkbox-visual]')).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  await expect(submit(page)).toBeFocused();
  await expect(submit(page)).toHaveCSS('outline-style', 'solid');
});
