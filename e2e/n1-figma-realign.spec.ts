import { type Page, expect, test } from '@playwright/test';

import { pickRegulatoryClass } from './helpers/n1-regulatory-class';

// ─────────────────────────────────────────────────────────────────
// N1 Figma 재정합 — 카테고리 창 고정 크기·단별 스크롤(1094:10968), 사이즈 선택 구조(1093:10288),
// brandId 쿼리 없는 Mock 진입의 [다음] 활성과 N2 이동.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const CONSENT = /외부 AI 서비스로 전송됨을 확인했습니다/;

const categoryModal = (page: Page) => page.getByTestId('n1-category-modal');
const scroller = (page: Page, heading: string) => page.getByTestId(`n1-category-scroller-${heading}`);
const nextButton = (page: Page) => page.getByRole('button', { name: '다음', exact: true });

/** GET /master/categories를 대분류 n개 · 첫 대분류 아래 중분류 n개 · 첫 중분류 아래 소분류 n개로 바꾼다 */
async function useManyCategories(page: Page, n: number) {
  await page.addInitScript((count) => {
    const nodes: { id: number; parentId: number | null; name: string; isLeaf: boolean; path: string }[] = [];
    for (let i = 0; i < count; i += 1) {
      nodes.push({ id: 1000 + i, parentId: null, name: `대분류항목${i}`, isLeaf: i !== 0, path: `대분류항목${i}` });
      nodes.push({ id: 2000 + i, parentId: 1000, name: `중분류항목${i}`, isLeaf: i !== 0, path: `중분류항목${i}` });
      nodes.push({ id: 3000 + i, parentId: 2000, name: `소분류항목${i}`, isLeaf: true, path: `소분류항목${i}` });
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === '/master/categories') {
        return new Response(JSON.stringify(nodes), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
  }, n);
}

async function fillRequired(page: Page) {
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('N1 재정합 상품');
  await page.getByRole('combobox').nth(0).selectOption('US');
  await page.getByRole('combobox').nth(1).selectOption('en');
  await pickRegulatoryClass(page, '잘모름');
  await page.getByRole('button', { name: '선택하기' }).click();
  await categoryModal(page).getByRole('button', { name: '선케어', exact: true }).click();
  await categoryModal(page).getByRole('button', { name: '선크림', exact: true }).click();
  await categoryModal(page).getByRole('button', { name: '확인' }).click();
  await page.getByRole('checkbox', { name: CONSENT }).check();
  await page.locator('#image-upload').setInputFiles({ name: 'n1.png', mimeType: 'image/png', buffer: TINY_PNG });
}

test.describe('카테고리 창 — Figma 1192×468 고정', () => {
  test('Figma 위치·크기를 지키고, 항목 수가 달라도 외곽 크기는 그대로다', async ({ page }) => {
    await page.goto('/jobs/new');
    await page.getByRole('button', { name: '선택하기' }).click();
    const small = (await categoryModal(page).boundingBox())!;
    expect(small).toEqual({ x: 364, y: 332, width: 1192, height: 468 });

    await useManyCategories(page, 60);
    await page.goto('/jobs/new');
    await page.getByRole('button', { name: '선택하기' }).click();
    await categoryModal(page).getByRole('button', { name: '대분류항목0', exact: true }).click();
    await categoryModal(page).getByRole('button', { name: '중분류항목0', exact: true }).click();
    expect(await categoryModal(page).boundingBox()).toEqual(small);

    // 세 단의 폭·높이가 같고 가로로 넘치지 않는다
    const heights = await Promise.all(['대분류', '중분류', '소분류'].map(async (h) => (await page.getByTestId(`n1-category-column-${h}`).boundingBox())!));
    expect(new Set(heights.map((b) => Math.round(b.height))).size).toBe(1);
    expect(new Set(heights.map((b) => Math.round(b.width))).size).toBe(1);
    for (const h of ['대분류', '중분류', '소분류']) {
      expect(await scroller(page, h).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath('n1-category-60.png') });
  });

  test('휠 스크롤은 마우스가 있는 단에서만 일어나고, 다른 단의 위치·크기는 바뀌지 않는다', async ({ page }) => {
    await useManyCategories(page, 60);
    await page.goto('/jobs/new');
    await page.getByRole('button', { name: '선택하기' }).click();
    await categoryModal(page).getByRole('button', { name: '대분류항목0', exact: true }).click();
    await categoryModal(page).getByRole('button', { name: '중분류항목0', exact: true }).click();

    const before = (await page.getByTestId('n1-category-column-중분류').boundingBox())!;
    await scroller(page, '대분류').hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => scroller(page, '대분류').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await scroller(page, '중분류').evaluate((el) => el.scrollTop)).toBe(0);
    expect(await scroller(page, '소분류').evaluate((el) => el.scrollTop)).toBe(0);
    expect(await page.getByTestId('n1-category-column-중분류').boundingBox()).toEqual(before);
    // 단 끝까지 내리면 마지막 항목에 닿는다
    await scroller(page, '대분류').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(categoryModal(page).getByRole('button', { name: '대분류항목59', exact: true })).toBeInViewport();

    // Firefox는 직전 스크롤 대상을 잠시 유지하므로(wheel transaction) 옮겨 갈 때까지 다시 굴린다
    await scroller(page, '소분류').hover();
    await expect(async () => {
      await page.mouse.wheel(0, 300);
      expect(await scroller(page, '소분류').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });
    expect(await scroller(page, '중분류').evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('키보드 Tab으로 단 목록에 들어가면 포커스 항목이 보이게 스크롤되고, Esc로 닫으면 연 버튼으로 돌아간다', async ({ page, browserName }) => {
    // macOS Firefox·WebKit은 기본 설정에서 Tab이 버튼에 멈추지 않는다
    test.skip(browserName !== 'chromium', 'Tab 순서는 Chromium에서 확인한다');
    await useManyCategories(page, 60);
    await page.goto('/jobs/new');
    const opener = page.getByRole('button', { name: '선택하기' });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(categoryModal(page)).toBeFocused();
    await page.keyboard.press('Tab'); // 닫기
    for (let i = 0; i < 30; i += 1) await page.keyboard.press('Tab');
    await expect(categoryModal(page).getByRole('button', { name: '대분류항목29', exact: true })).toBeFocused();
    await expect.poll(() => scroller(page, '대분류').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  });

  test('상위를 바꾸면 하위 단 스크롤은 처음으로 돌아가고, 다시 열면 고른 항목이 보인다', async ({ page }) => {
    await useManyCategories(page, 60);
    await page.goto('/jobs/new');
    await page.getByRole('button', { name: '선택하기' }).click();
    await categoryModal(page).getByRole('button', { name: '대분류항목0', exact: true }).click();
    await categoryModal(page).getByRole('button', { name: '중분류항목1', exact: true }).click();
    await scroller(page, '중분류').evaluate((el) => el.scrollTo(0, 400));
    await categoryModal(page).getByRole('button', { name: '대분류항목1', exact: true }).click();
    await categoryModal(page).getByRole('button', { name: '대분류항목0', exact: true }).click();
    await expect.poll(() => scroller(page, '중분류').evaluate((el) => el.scrollTop)).toBe(0);

    await scroller(page, '대분류').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await categoryModal(page).getByRole('button', { name: '대분류항목59', exact: true }).click();
    await expect(categoryModal(page).getByRole('button', { name: '확인' })).toBeEnabled();
    await categoryModal(page).getByRole('button', { name: '확인' }).click();
    await page.getByRole('button', { name: '선택하기' }).click();
    await expect(categoryModal(page).getByRole('button', { name: '대분류항목59', exact: true })).toBeInViewport();
  });

  test('낮은 창에서도 창이 화면 안에 있고 [확인]이 보인다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.goto('/jobs/new');
    await page.getByRole('button', { name: '선택하기' }).click();
    await expect(categoryModal(page)).toBeInViewport({ ratio: 1 });
    await expect(categoryModal(page).getByRole('button', { name: '확인' })).toBeInViewport({ ratio: 1 });
  });
});

test.describe('사이즈 선택 — Figma 1093:10288', () => {
  test('라벨·탭 구조가 Figma와 같고 예전 3탭 구조가 없다', async ({ page }) => {
    await page.goto('/jobs/new');
    await expect(page.getByText('사이즈 선택', { exact: true })).toBeVisible();
    const tabs = page.getByTestId('n1-size-tabs').getByRole('tab');
    await expect(tabs).toHaveText(['원본 유지', '사이즈 변경']);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    for (const stale of ['결과물 규격', '원본 사이즈', '사이트 맞춤']) await expect(page.getByText(stale, { exact: true })).toHaveCount(0);
    await expect(page.getByText('원본 크기와 배치를 유지하고 글자만 번역해요.', { exact: false })).toBeVisible();

    const tab = (await tabs.nth(0).boundingBox())!;
    expect(Math.round(tab.height)).toBe(32);
    const underline = (await page.getByTestId('n1-size-tab-underline').boundingBox())!;
    expect([underline.width, underline.height]).toEqual([56, 2]);
    expect(Math.round(underline.x + underline.width / 2)).toBe(Math.round(tab.x + tab.width / 2));
    await expect(page.getByRole('radio', { name: '커스텀' })).toHaveCount(0);
  });

  test('사이즈 변경 탭은 구조를 보이되 모두 비활성이고, 준비 중임을 알린다', async ({ page }) => {
    await page.goto('/jobs/new');
    await page.getByRole('tab', { name: '사이즈 변경' }).click();
    await expect(page.getByRole('tab', { name: '사이즈 변경' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('사이트 규격에 맞게 이미지를 다시 구성해요.', { exact: false })).toBeVisible();
    for (const name of ['판매처 맞춤', '커스텀']) await expect(page.getByRole('radio', { name })).toBeDisabled();
    for (const name of ['가로 크기(px)', '세로 크기(px)']) {
      const input = page.getByRole('spinbutton', { name });
      await expect(input).toBeDisabled();
      const box = (await input.locator('xpath=..').boundingBox())!;
      expect(Math.round(box.height)).toBe(48);
    }
    await expect(page.getByTestId('n1-size-change-notice')).toBeVisible();
    await page.getByRole('tab', { name: '원본 유지' }).click();
    await expect(page.getByTestId('n1-size-change-notice')).toHaveCount(0);
  });

  test('어느 탭이든 PATCH에는 specType original만 가고 크기·채널 필드가 없다', async ({ page }) => {
    const patches: Record<string, unknown>[] = [];
    await page.exposeFunction('__n1Patch', (body: string) => {
      patches.push(JSON.parse(body));
    });
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET').toUpperCase() === 'PATCH' && typeof init?.body === 'string') {
          await (window as unknown as { __n1Patch: (b: string) => Promise<void> }).__n1Patch(init.body);
        }
        return originalFetch(input, init);
      };
    });
    await page.goto('/jobs/new');
    await fillRequired(page);
    await page.getByRole('tab', { name: '사이즈 변경' }).click();
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/jobs\/1$/, { timeout: 30_000 });
    expect(patches).toHaveLength(1);
    expect(patches[0].specType).toBe('original');
    for (const key of ['channelSpecId', 'width', 'height', 'customWidth', 'customHeight']) expect(patches[0]).not.toHaveProperty(key);
  });
});

test.describe('[다음] — brandId 쿼리 없는 Mock 진입', () => {
  test('보관함 → 이미지 생성 → 필수값 입력 → [다음] 활성 → POST /jobs 1회 → N2 이동', async ({ page }) => {
    const posts: string[] = [];
    await page.exposeFunction('__n1Post', (body: string) => {
      posts.push(body);
    });
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if ((init?.method ?? 'GET').toUpperCase() === 'POST' && new URL(url, location.href).pathname === '/jobs') {
          await (window as unknown as { __n1Post: (b: string) => Promise<void> }).__n1Post(String(init?.body));
        }
        return originalFetch(input, init);
      };
    });
    await page.goto('/');
    await page.getByTestId('library-add-card-link').click();
    await expect(page).toHaveURL(/\/jobs\/new$/);
    await expect(page.getByTestId('n1-brand-missing')).toHaveCount(0);
    await expect(nextButton(page)).toBeDisabled();
    await fillRequired(page);
    await expect(nextButton(page)).toBeEnabled();
    await nextButton(page).dblclick();
    await expect(page).toHaveURL(/\/jobs\/1$/, { timeout: 30_000 });
    expect(posts).toHaveLength(1);
  });

  test('막힌 [다음]은 빠진 항목을 알려 주고, 눌러도 요청 없이 필드 오류를 보여 준다', async ({ page }) => {
    await page.goto('/jobs/new');
    const tooltip = page.getByTestId('n1-next-tooltip');
    await expect(tooltip).toBeHidden();
    await nextButton(page).hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText('입력이 필요해요: 국가, 언어, 이미지, 상품명, 카테고리, 규제 분류, 책임 동의');
    await expect(tooltip).toBeInViewport({ ratio: 1 });
    await nextButton(page).click({ force: true });
    for (const message of ['상품명을 입력해 주세요.', '카테고리를 선택해 주세요.', '규제 분류를 선택해 주세요.']) {
      await expect(page.getByText(message)).toBeVisible();
    }
    await expect(page).toHaveURL(/\/jobs\/new$/);
    await page.getByPlaceholder('상품 이름을 입력해주세요').fill('상품');
    await expect(tooltip).toHaveText('입력이 필요해요: 국가, 언어, 이미지, 카테고리, 규제 분류, 책임 동의');
    await page.screenshot({ path: test.info().outputPath('n1-next-tooltip.png') });
  });
});

test('1920×1080 — Figma 525:3023 주요 좌표', async ({ page }) => {
  await page.goto('/jobs/new');
  const uploader = (await page.getByTestId('n1-image-dropzone').boundingBox())!;
  expect([uploader.x, uploader.y, uploader.width, uploader.height]).toEqual([140, 162, 1184, 838]);
  const panel = (await page.getByTestId('n1-category-field').locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]').boundingBox())!;
  expect([panel.x, panel.y, panel.width]).toEqual([1344, 162, 516]);
  // 패널 아래 동의 문구 높이가 브라우저 글꼴 계측에 따라 조금 달라진다
  expect(Math.abs(panel.height - 721)).toBeLessThanOrEqual(2);
  const consent = (await page.getByTestId('n1-consent').boundingBox())!;
  expect(Math.round(consent.x)).toBe(1344);
  expect(Math.abs(consent.y - 913)).toBeLessThanOrEqual(4);
  const next = (await nextButton(page).boundingBox())!;
  expect([next.y, next.width, next.height]).toEqual([965, 148, 45]);
  const exit = (await page.getByRole('button', { name: '보관함으로 나가기' }).boundingBox())!;
  expect([exit.x, exit.y, exit.width, exit.height]).toEqual([40, 40, 40, 40]);
  // 우측 패널 입력칸 — Figma Text Input 474×39, 상품명 입력 top 214, 상품코드 입력 top 292
  const name = (await page.getByPlaceholder('상품 이름을 입력해주세요').boundingBox())!;
  const code = (await page.getByPlaceholder('상품 코드를 입력해주세요').boundingBox())!;
  expect([name.width, name.height]).toEqual([474, 39]);
  expect(Math.abs(name.y - 214)).toBeLessThanOrEqual(1);
  expect(Math.abs(code.y - 292)).toBeLessThanOrEqual(2); // 라벨 글꼴 계측 차이(브라우저별)
  await page.screenshot({ path: test.info().outputPath('n1-1920x1080.png') });
});
