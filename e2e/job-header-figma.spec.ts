import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N1~N6 작업용 공통 헤더 — Figma header component set 1809:42006 「속성 1=작업용」(N1 525:3023 instance 1792:21551).
// 1920×1080: header 0/0/1920/72 · home 124/12/102/48 · 화면명 x238 y27.5 h17 · 우측 1539/24/257/24(오른쪽 끝 1796).
// [내 계정] 드롭다운 — 1876:40072 작업용_오픈 · 1890:58502: 버튼 1623/24/80/24 · 메뉴 1613/56/102 × 38(실제 값이 있는 이메일 한 행).
// 헤더는 화면 위에 겹쳐 놓아 본문 geometry 를 바꾸지 않는다 — S0 ✕·진행단계와 화면별 본문 위치가 그대로인지 함께 본다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '화면 수치 검증은 Chromium 기준이다');

const STEPS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'] as const;
type Step = (typeof STEPS)[number];

/** N4 Figma(1821:48003)의 「이미지 분석」은 복사 잔여로 보고 서비스 단계명 「번역 중」을 쓴다 */
const TITLES: Record<Step, string> = {
  N1: '정보 입력',
  N2: '이미지 분석',
  N3: '섹션 확인',
  N4: '번역 중',
  N5: '번역 중',
  N6: '저장 및 내보내기',
};

/** 헤더 추가 전(dd1707f) 실측 본문 위치 — 이번 변경으로 움직이면 안 된다 */
const BODY: Partial<Record<Step, { testId: string; box: [number, number, number, number] }[]>> = {
  N1: [
    { testId: 'n1-image-dropzone', box: [140, 147, 1184, 873] },
    { testId: 'n1-input-panel', box: [1344, 96, 516, 795] },
  ],
  N3: [
    { testId: 'n3-work-area', box: [200, 112, 1600, 920] },
    { testId: 'n3-section-list', box: [1112, 112, 688, 863] },
  ],
  N5: [
    { testId: 'n5-viewport', box: [120, 0, 1255, 1080] },
    { testId: 'n5-panel', box: [1427, 0, 433, 1080] },
  ],
  N6: [
    { testId: 'n6-final-preview', box: [140, 86, 1195, 962] },
    { testId: 'n6-export-panel', box: [1404, 86, 456, 962] },
  ],
};

/** 예전 화면별 제목 옆 설명 문구 — 최신 Figma 에서 빠졌다 */
const REMOVED_DESCRIPTIONS = [
  '번역할 원본 이미지를 등록하고 작업 조건을 설정합니다.',
  '등록한 이미지의 텍스트와 구조를 분석하고 있습니다.',
  '전체 섹션에서 제외 판정을 확인하고, 필요한 경우 번역에 포함하세요.',
  '확정한 섹션을 번역하고 이미지에 적용하고 있습니다.',
  '최종 결과물을 확인하고 내려받거나 보관함에 저장합니다.',
];

async function openStep(page: Page, step: Step) {
  if (step === 'N1') {
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  } else {
    await page.addInitScript(
      ({ forced, jobId }) => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await original(input, init);
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (new URL(url, location.href).pathname !== `/jobs/${jobId}/tasks` || !response.ok) return response;
          const body = await response.json();
          const items =
            forced === 'N6'
              ? [...(body.items ?? []), { taskId: 990001, taskType: 'render', unitType: 'job', unitId: Number(jobId), status: 'done' }]
              : body.items;
          return new Response(JSON.stringify({ ...body, items, currentStep: forced, jobStatus: 'running' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        };
      },
      { forced: step, jobId: MOCK_JOB_ID },
    );
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
  }
  await expect(page.getByTestId('job-header-title')).toHaveText(TITLES[step]);
  await expect(page.getByTestId('s0-steps')).toBeVisible();
}

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;
const near = (actual: number, expected: number, label: string, tolerance = 1) =>
  expect(Math.abs(actual - expected), `${label}: ${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
const nearBox = (actual: { x: number; y: number; width: number; height: number }, [x, y, w, h]: number[], label: string) => {
  near(actual.x, x, `${label} x`);
  near(actual.y, y, `${label} y`);
  near(actual.width, w, `${label} w`);
  near(actual.height, h, `${label} h`);
};

test.describe('1920×1080 — header 1809:42006 작업용', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const step of STEPS) {
    test(`${step} — header·좌측·우측 bbox, 화면명, ✕·진행단계·본문 위치 유지`, async ({ page }) => {
      await openStep(page, step);

      const header = await box(page, 'job-header');
      console.log(`[${step}] header`, JSON.stringify(header));
      nearBox(header, [0, 0, 1920, 72], 'header');
      // 배경·border·shadow 없음
      const style = await page.getByTestId('job-header').evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, border: s.borderBottomWidth, shadow: s.boxShadow };
      });
      expect(style).toEqual({ bg: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });

      const home = await box(page, 'job-header-home');
      console.log(`[${step}] home`, JSON.stringify(home));
      nearBox(home, [124, 12, 102, 48], 'home');
      const logo = (await page.getByTestId('job-header-home').locator('img').boundingBox())!;
      console.log(`[${step}] logo`, JSON.stringify(logo));
      nearBox(logo, [124, 24, 78, 24], 'logo');

      const title = await box(page, 'job-header-title');
      console.log(`[${step}] title`, JSON.stringify(title));
      near(title.x, 238, 'title x');
      near(title.y, 27.5, 'title y');
      near(title.height, 17, 'title h');
      const titleStyle = await page.getByTestId('job-header-title').evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: s.fontSize, weight: s.fontWeight, color: s.color, spacing: s.letterSpacing };
      });
      expect(titleStyle).toEqual({ size: '14px', weight: '400', color: 'rgb(23, 23, 23)', spacing: '-0.14px' });

      const actions = await box(page, 'job-header-actions');
      console.log(`[${step}] actions`, JSON.stringify(actions));
      nearBox(actions, [1539, 24, 257, 24], 'actions');
      near(actions.x + actions.width, 1796, 'actions right edge');
      near(1920 - (actions.x + actions.width), 124, 'right margin');
      nearBox(await box(page, 'job-header-brand'), [1539, 24, 72, 24], 'brand');
      await expect(page.getByTestId('job-header-brand')).toHaveText('브랜드 관리');
      nearBox(await box(page, 'job-header-account'), [1623, 24, 80, 24], 'account');
      await expect(page.getByTestId('job-header-account')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('job-header-account-menu')).toBeHidden();
      nearBox(await box(page, 'job-header-divider'), [1719, 30, 1, 12], 'divider');
      nearBox((await page.getByTestId('job-header').getByTestId('account-logout').boundingBox())!, [1736, 24, 60, 24], 'logout');

      // 진행단계는 그대로다. 12월(PRD F-JOB-07 · F-NAV-01)에는 ✕ 가 없다
      await expect(page.getByTestId('s0-exit')).toHaveCount(0);
      nearBox(await box(page, 's0-steps'), [48, 96, 44, 924], 'steps');

      for (const { testId, box: expected } of BODY[step] ?? []) {
        const actual = await box(page, testId);
        console.log(`[${step}] ${testId}`, JSON.stringify(actual));
        nearBox(actual, expected, testId);
      }
      if (step === 'N2' || step === 'N4') {
        // 처리 화면 단계 목록 — Figma 1821:46419 · 1821:48003 로그(「Frame 300」) y + 122(N2 273 · N4 243.5). 로그는 패널 세로 가운데다
        const list = await box(page, 'processing-step-list');
        console.log(`[${step}] processing-step-list`, JSON.stringify(list));
        near(list.x, 1397, 'step list x');
        near(list.y, step === 'N2' ? 273 + 122 : 243.5 + 122, 'step list y');
      }

      for (const text of REMOVED_DESCRIPTIONS) await expect(page.getByText(text)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '이미지 입력' })).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`${step}-1920x1080.png`) });
    });
  }

  test('N1 — 최신 Figma 525:3023 국가·언어 행 y96 · 업로드 y147 · 우측 패널 y96, 예전 제목·설명 없음', async ({ page }) => {
    await openStep(page, 'N1');
    const row = await box(page, 'n1-target-row');
    console.log('[N1] target row', JSON.stringify(row));
    near(row.x, 141, 'row x');
    near(row.y, 96, 'row y');
    near(row.width, 810, 'row w');
    near(row.height, 39, 'row h');
    nearBox(await box(page, 'n1-image-dropzone'), [140, 147, 1184, 873], 'uploader');
    const panel = await box(page, 'n1-input-panel');
    near(panel.x, 1344, 'panel x');
    near(panel.y, 96, 'panel y');
    near(panel.width, 516, 'panel w');
    await expect(page.getByText('이미지 입력', { exact: true })).toHaveCount(0);
    await expect(page.getByText('번역할 원본 이미지를 등록하고 작업 조건을 설정합니다.')).toHaveCount(0);
  });
});

test.describe('헤더 동작', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  // 상단 메뉴는 작업 나가기다(PRD F-JOB-07) — 같은 확인을 거친 뒤 누른 곳으로 간다. 확인 흐름 전체는 job-exit.spec.ts 가 맡는다.
  // 로고의 PRD 목적지는 H0 홈이지만 H0 화면이 없어 보관함(/)이다
  test('로고 → 작업 취소 확인 → / (보관함)', async ({ page }) => {
    await openStep(page, 'N3');
    await page.getByTestId('job-header-home').click();
    await page.getByTestId('s0-exit-dialog').getByRole('button', { name: '작업 취소' }).click();
    await page.waitForURL((url) => url.pathname === '/');
  });

  test('브랜드관리 → 미저장 확인 → /brand', async ({ page }) => {
    await openStep(page, 'N1');
    await page.getByTestId('job-header-brand').click();
    await page.getByTestId('s0-exit-dialog').getByRole('button', { name: '나가기' }).click();
    await page.waitForURL((url) => url.pathname === '/brand');
  });

  test('로그아웃 — 작업 취소 확인 뒤 기존 logout() 흐름(POST /auth/logout 1회 → G1)을 그대로 쓴다', async ({ page }) => {
    const logouts: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/auth/logout') logouts.push(r.method());
    });
    await openStep(page, 'N6');
    await expect(page.locator('[data-exit-guard]')).toHaveAttribute('data-exit-guard', 'on');
    await page.getByTestId('job-header').getByTestId('account-logout').click();
    await page.getByTestId('s0-exit-dialog').getByRole('button', { name: '작업 취소' }).click();
    await page.waitForURL((url) => url.pathname === '/login');
    expect(logouts).toEqual(['POST']);
  });

  test('나가기 확인창은 헤더 위에 뜬다', async ({ page }) => {
    await openStep(page, 'N1');
    await page.getByTestId('job-header-home').click();
    await expect(page.getByTestId('s0-exit-dim')).toBeVisible();
    const topAtHeader = await page.evaluate(() => {
      const ids = ['job-header-home', 'job-header-actions'];
      return ids.map((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-testid="job-header"]') === null;
      });
    });
    expect(topAtHeader).toEqual([true, true]);
  });
});

// ── [내 계정] 드롭다운 ───────────────────────────────────────────

const account = (page: Page) => page.getByTestId('job-header-account');
const accountMenu = (page: Page) => page.getByTestId('job-header-account-menu');
const MOCK_EMAIL = 'kakao-seller@pixlate.mock';

/**
 * 계정은 이 탭의 메모리 세션에만 있다. G1 소셜 로그인 → M1 → [추가] 로 앱 안에서 N1 까지 간다(새로 불러오면 메모리가 비고,
 * Mock 의 작업 API 는 401 을 주지 않아 refresh·/auth/me 가 일어나지 않는다 — 그때는 「계정 정보 없음」이다)
 */
async function loginToN1(page: Page, provider: 'kakao' | 'google' = 'kakao') {
  await page.goto('/login');
  await page.getByTestId(`g1-social-${provider}`).click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.getByTestId('library-add-card-link').click();
  await page.waitForURL((url) => url.pathname === '/jobs/new');
  await expect(page.getByTestId('job-header-title')).toHaveText('정보 입력');
}

/** GET 이 아닌 요청(페이지 이동 제외)을 기록한다 — 메뉴를 열고 닫는 것만으로는 아무 요청도 없어야 한다 */
function recordWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && !request.isNavigationRequest()) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return writes;
}

async function expectClosed(page: Page) {
  await expect(account(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(accountMenu(page)).toBeHidden();
  await expect(page.getByTestId('job-header-account-chevron')).toHaveAttribute('data-direction', 'down');
}

async function expectOpen(page: Page) {
  await expect(account(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(accountMenu(page)).toBeVisible();
  await expect(page.getByTestId('job-header-account-chevron')).toHaveAttribute('data-direction', 'up');
}

test.describe('[내 계정] 드롭다운 — 1876:40072 · 1890:58502', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('기본 닫힘 → 누르면 열리고 다시 누르면 닫힌다 · Figma 크기·위치·색 · 메뉴 접근성 구조', async ({ page }) => {
    await openStep(page, 'N3');
    await expectClosed(page);
    const labelColor = () => account(page).locator('span').filter({ hasText: '내 계정' }).last().evaluate((el) => getComputedStyle(el).color);
    expect(await labelColor()).toBe('rgb(112, 112, 112)');
    await expect(account(page)).toHaveAttribute('aria-controls', (await accountMenu(page).getAttribute('id'))!);
    // 고를 항목이 없는 계정 정보라 menu 역할을 쓰지 않는다
    await expect(page.getByRole('menu')).toHaveCount(0);

    await account(page).click();
    await expectOpen(page);
    expect(await labelColor()).toBe('rgb(23, 23, 23)');
    nearBox(await box(page, 'job-header-account'), [1623, 24, 80, 24], 'account');
    nearBox(await box(page, 'job-header-account-menu'), [1613, 56, 102, 38], 'menu');
    const style = await accountMenu(page).evaluate((el) => {
      const s = getComputedStyle(el);
      const text = getComputedStyle(el.querySelector('[data-testid="job-header-account-email"]')!);
      return { bg: s.backgroundColor, radius: s.borderRadius, filter: s.filter, size: text.fontSize, color: text.color, spacing: text.letterSpacing };
    });
    expect(style).toEqual({
      bg: 'rgb(255, 255, 255)',
      radius: '8px',
      filter: 'drop-shadow(rgba(0, 0, 0, 0.06) 2px 2px 12px)',
      size: '10px',
      color: 'rgb(112, 112, 112)',
      spacing: '-0.4px',
    });
    await expect(page.getByRole('group', { name: '내 계정 정보' })).toBeVisible();
    // 열려 있는 동안 헤더가 rail·본문 위로 올라온다(확인창보다는 아래)
    expect(await page.getByTestId('job-header').evaluate((el) => getComputedStyle(el).zIndex)).toBe('30');
    await page.screenshot({ path: test.info().outputPath('account-open-1920x1080.png') });

    await account(page).click();
    await expectClosed(page);
    expect(await page.getByTestId('job-header').evaluate((el) => getComputedStyle(el).zIndex)).toBe('10');
  });

  test('바깥을 누르면 닫히고, 그 클릭은 작업 나가기가 아니다', async ({ page }) => {
    const writes = recordWrites(page);
    await openStep(page, 'N3');
    await account(page).click();
    await expectOpen(page);
    await page.mouse.click(960, 600);
    await expectClosed(page);
    await expect(page.getByTestId('s0-exit-dialog')).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test('Escape 는 닫고 버튼으로 포커스를 돌려준다 · Enter/Space 로 열고 닫는다 · Tab 으로 벗어나면 닫힌다', async ({ page }) => {
    await openStep(page, 'N5');
    await account(page).focus();
    await page.keyboard.press('Enter');
    await expectOpen(page);
    await page.keyboard.press('Escape');
    await expectClosed(page);
    await expect(account(page)).toBeFocused();

    await page.keyboard.press('Space');
    await expectOpen(page);
    await page.keyboard.press('Space');
    await expectClosed(page);

    await page.keyboard.press('Enter');
    await expectOpen(page);
    await page.keyboard.press('Tab');
    await expectClosed(page);
  });

  test('실제 세션 계정의 이메일만 보여 준다 — Figma 예시 이름·제공자를 만들지 않는다', async ({ page }) => {
    await loginToN1(page);
    await account(page).click();
    await expect(page.getByTestId('job-header-account-email')).toHaveText(MOCK_EMAIL);
    for (const sample of ['dabduck', 'dabduck@email.com', '카카오 로그인']) await expect(accountMenu(page)).not.toContainText(sample);
    await expect(accountMenu(page).locator('p')).toHaveCount(1);
  });

  test('세션 계정의 email 이 null 이면 오류 없이 중립 문구', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (e) => errors.push(e));
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(url, location.href).pathname !== '/auth/social' || !response.ok) return response;
        const body = await response.json();
        return new Response(JSON.stringify({ ...body, seller: { ...body.seller, email: null } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };
    });
    await loginToN1(page);
    await account(page).click();
    await expect(page.getByTestId('job-header-account-email')).toHaveText('이메일 정보 없음');
    await expect(accountMenu(page)).not.toContainText('@');
    expect(errors).toEqual([]);
  });

  test('이 탭이 아직 계정을 모르면(새로 불러옴) 중립 문구 — 계정을 알아내려고 새 API 를 부르지 않는다', async ({ page }) => {
    const authCalls: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/auth/')) authCalls.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await openStep(page, 'N3');
    const before = authCalls.length;
    await account(page).click();
    await expect(page.getByTestId('job-header-account-email')).toHaveText('계정 정보 없음');
    await page.waitForTimeout(300);
    expect(authCalls.length).toBe(before);
  });

  test('메뉴를 열고 안을 눌러도 확인창·DELETE·이동이 없다', async ({ page }) => {
    const writes = recordWrites(page);
    await openStep(page, 'N4');
    const before = page.url();
    await account(page).click();
    await page.getByTestId('job-header-account-email').click();
    await expectOpen(page);
    await page.waitForTimeout(300);
    expect(page.url()).toBe(before);
    await expect(page.getByTestId('s0-exit-dialog')).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test('메뉴가 열린 채 로그아웃 — 메뉴가 닫히고 작업 취소 확인 뒤에만 로그아웃한다', async ({ page }) => {
    const writes = recordWrites(page);
    await openStep(page, 'N3');
    await account(page).click();
    await expectOpen(page);
    await page.getByTestId('job-header').getByTestId('account-logout').click();
    await expectClosed(page);
    await expect(page.getByTestId('s0-exit-dialog')).toHaveAccessibleName('작업을 취소할까요?');
    expect(writes).toEqual([]);
    await page.getByTestId('s0-exit-dialog').getByRole('button', { name: '작업 취소' }).click();
    await page.waitForURL((url) => url.pathname === '/login');
    expect(writes).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`, 'POST /auth/logout']);
  });

  test('메뉴가 열린 채 로고 · 브라우저 뒤로 가기 — 메뉴는 닫히고 기존 작업 취소 확인이 뜬다', async ({ page }) => {
    await page.goto('/');
    await openStep(page, 'N3');
    await account(page).click();
    await page.getByTestId('job-header-home').click();
    await expectClosed(page);
    await expect(page.getByTestId('s0-exit-dialog')).toHaveAccessibleName('작업을 취소할까요?');
    await page.getByTestId('s0-exit-dialog').getByRole('button', { name: '계속하기' }).click();

    await account(page).click();
    await expectOpen(page);
    await page.evaluate(() => history.back());
    await expectClosed(page);
    await expect(page.getByTestId('s0-exit-dialog')).toHaveAccessibleName('작업을 취소할까요?');
  });

  test('다른 탭에서 다른 계정으로 바뀌면 이전 계정 정보를 남기지 않는다', async ({ context }) => {
    const a = await context.newPage();
    await loginToN1(a);
    await a.getByTestId('job-header-account').click();
    await expect(a.getByTestId('job-header-account-email')).toHaveText(MOCK_EMAIL);

    // 다른 탭이 Google 계정으로 로그인한다(G1 → 콜백 → M1)
    const b = await context.newPage();
    await b.goto('/login');
    await b.getByTestId('g1-social-google').click();
    await b.waitForURL((url) => url.pathname === '/');

    // 이 탭은 이전 계정 화면을 버리고 보관함으로 간다(기존 계정 전환 정책). 계정 세대가 바뀌며 이전 계정 정보(seller)는 지워진다 —
    // 다시 작업 화면을 열어도 이전 계정 이메일은 없다. 새 계정은 다음 401→refresh→/auth/me 가 정한다(Mock 작업 API 는 401 이 없어 미확인)
    await a.waitForURL((url) => url.pathname === '/');
    await a.getByTestId('library-add-card-link').click();
    await a.waitForURL((url) => url.pathname === '/jobs/new');
    await a.getByTestId('job-header-account').click();
    await expect(a.getByTestId('job-header-account-menu')).toBeVisible();
    await expect(a.getByTestId('job-header-account-menu')).not.toContainText(MOCK_EMAIL);
    await expect(a.getByTestId('job-header-account-email')).toHaveText(/^(google-seller@pixlate\.mock|계정 정보 없음)$/);
  });
});

// ── 반응형 ──────────────────────────────────────────────────────

const VIEWPORTS = [
  [1920, 1080],
  [1728, 885],
  [1512, 860],
  [1440, 900],
  [1280, 720],
] as const;

for (const [width, height] of VIEWPORTS) {
  test.describe(`${width}×${height} — [내 계정] 드롭다운`, () => {
    test.use({ viewport: { width, height } });

    for (const step of STEPS) {
      test(`${step} — 메뉴가 잘리거나 가려지지 않고, 헤더 요소가 겹치지 않으며 본문을 밀지 않는다`, async ({ page }) => {
        await openStep(page, step);
        const watched = step === 'N1' ? 'n1-input-panel' : step === 'N3' ? 'n3-section-list' : step === 'N5' ? 'n5-panel' : step === 'N6' ? 'n6-export-panel' : 'processing-panel';
        const bodyBefore = await box(page, watched);
        const stepsBefore = await box(page, 's0-steps');

        await account(page).click();
        await expectOpen(page);
        const menu = await box(page, 'job-header-account-menu');
        expect(menu.x).toBeGreaterThanOrEqual(0);
        expect(menu.y).toBeGreaterThanOrEqual(0);
        expect(menu.x + menu.width).toBeLessThanOrEqual(width);
        expect(menu.y + menu.height).toBeLessThanOrEqual(height);
        near(menu.width, 102, 'menu w');
        near(menu.height, 38, 'menu h');
        // 메뉴 가운데가 다른 요소에 가려지지 않는다
        const onTop = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="job-header-account-menu"]')!;
          const r = el.getBoundingClientRect();
          return [
            [r.x + r.width / 2, r.y + r.height / 2],
            [r.x + 4, r.y + 4],
            [r.right - 4, r.bottom - 4],
          ].every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
        });
        expect(onTop).toBe(true);

        // 로고·화면명·우측 메뉴가 겹치지 않는다
        const home = await box(page, 'job-header-home');
        const title = await box(page, 'job-header-title');
        const actions = await box(page, 'job-header-actions');
        expect(home.x + home.width).toBeLessThanOrEqual(title.x);
        expect(title.x + title.width).toBeLessThan(actions.x);
        near(width - (actions.x + actions.width), 124, 'right margin');

        // 드롭다운은 겹쳐 뜬다 — 본문·진행단계 위치가 그대로다
        nearBox(await box(page, watched), [bodyBefore.x, bodyBefore.y, bodyBefore.width, bodyBefore.height], watched);
        nearBox(await box(page, 's0-steps'), [stepsBefore.x, stepsBefore.y, stepsBefore.width, stepsBefore.height], 'steps');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
        if (step === 'N2' || step === 'N5') await page.screenshot({ path: test.info().outputPath(`${step}-account-${width}x${height}.png`) });
      });
    }
  });
}
