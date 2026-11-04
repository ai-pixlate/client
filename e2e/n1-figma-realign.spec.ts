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
  await pickRegulatoryClass(page, '잘 모름');
  await page.getByRole('button', { name: '선택하기' }).click();
  await categoryModal(page).getByRole('button', { name: '선케어', exact: true }).click();
  await categoryModal(page).getByRole('button', { name: '선크림', exact: true }).click();
  await categoryModal(page).getByRole('button', { name: '확인' }).click();
  await page.getByRole('checkbox', { name: CONSENT }).check();
  await page.locator('#image-upload').setInputFiles({ name: 'n1.png', mimeType: 'image/png', buffer: TINY_PNG });
}

const categoryInput = (page: Page) => page.getByRole('searchbox', { name: '카테고리 검색' });
const columnButtons = (page: Page, heading: string) => page.getByTestId(`n1-category-column-${heading}`).getByRole('button');

test.describe('카테고리 검색', () => {
  test('검색칸을 눌러도 창이 열리지 않고 직접 입력할 수 있다', async ({ page }) => {
    await page.goto('/jobs/new');
    await categoryInput(page).click();
    await expect(categoryInput(page)).toBeFocused();
    await expect(categoryModal(page)).toHaveCount(0);
    await page.keyboard.type('아이크림');
    await expect(categoryInput(page)).toHaveValue('아이크림');
    await expect(categoryModal(page)).toHaveCount(0);
  });

  test('Enter는 맞는 leaf와 상위만 남기고, leaf를 골라 [확인]해야 값이 바뀐다', async ({ page }) => {
    await page.goto('/jobs/new');
    await categoryInput(page).fill('  아이크림 ');
    await page.keyboard.press('Enter');
    await expect(categoryModal(page).getByRole('button', { name: '확인' })).toBeDisabled();
    // 아이크림은 Mock 트리의 두 대분류에 있다. 첫 결과 가지를 펼쳐 둔다
    await expect(columnButtons(page, '대분류')).toHaveText(['스킨케어', '더모코스메틱']);
    await expect(columnButtons(page, '중분류')).toHaveText(['크림']);
    await expect(columnButtons(page, '소분류')).toHaveText(['아이크림']);
    expect(await categoryModal(page).boundingBox()).toEqual({ x: 364, y: 332, width: 1192, height: 468 });

    await columnButtons(page, '소분류').first().click();
    await categoryModal(page).getByRole('button', { name: '확인' }).click();
    await expect(categoryInput(page)).toHaveValue('스킨케어 > 크림 > 아이크림');
    await expect(page.getByText('카테고리를 선택해 주세요.')).toHaveCount(0);
  });

  test('아이콘으로도 검색하고, 하위가 있는 항목은 확정할 수 없다', async ({ page }) => {
    await page.goto('/jobs/new');
    await categoryInput(page).fill('크림');
    await page.getByTestId('n1-category-search').click();
    await expect(categoryModal(page)).toBeVisible();
    await expect(categoryModal(page).getByRole('button', { name: '스킨케어', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(categoryModal(page).getByRole('button', { name: '확인' })).toBeDisabled();
    await categoryModal(page).getByRole('button', { name: '스킨케어', exact: true }).click();
    await expect(categoryModal(page).getByRole('button', { name: '확인' })).toBeDisabled();
  });

  test('결과가 없으면 창 안에 안내하고 크기는 그대로이며, 빈 검색은 창을 열지 않는다', async ({ page }) => {
    await page.goto('/jobs/new');
    await categoryInput(page).fill('   ');
    await page.keyboard.press('Enter');
    await expect(categoryModal(page)).toHaveCount(0);

    await categoryInput(page).fill('없는카테고리');
    await page.keyboard.press('Enter');
    await expect(categoryModal(page).getByRole('status')).toHaveText('검색 결과가 없습니다.');
    expect(await categoryModal(page).boundingBox()).toEqual({ x: 364, y: 332, width: 1192, height: 468 });
    await expect(categoryModal(page).getByRole('button', { name: '확인' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(categoryInput(page)).toBeFocused();
    await expect(categoryInput(page)).toHaveValue('없는카테고리');
  });

  test('검색어가 있어도 「선택하기」는 전체 트리를 연다', async ({ page }) => {
    await page.goto('/jobs/new');
    await categoryInput(page).fill('아이크림');
    await page.getByRole('button', { name: '선택하기' }).click();
    await expect(columnButtons(page, '대분류')).toHaveCount(11);
  });

  test('값을 고른 뒤 실행하지 않은 입력은 벗어나면 고른 값으로 돌아간다', async ({ page }) => {
    await page.goto('/jobs/new');
    await page.getByRole('button', { name: '선택하기' }).click();
    await categoryModal(page).getByRole('button', { name: '선케어', exact: true }).click();
    await categoryModal(page).getByRole('button', { name: '선크림', exact: true }).click();
    await categoryModal(page).getByRole('button', { name: '확인' }).click();
    await categoryInput(page).fill('다른말');
    await page.getByPlaceholder('상품 이름을 입력해주세요').click();
    await expect(categoryInput(page)).toHaveValue('선케어 > 선크림');
  });
});

test.describe('카테고리 검색 — IME 조합', () => {
  // Chrome 전용 CDP로 조합 이벤트를 만든다. 실제 macOS 한글 입력기를 그대로 재현하지는 않는다
  test('조합 중 Enter는 검색하지 않고 preventDefault도 하지 않으며, 확정 뒤 Enter로 정확한 값을 검색한다', async ({ page, browserName, context }) => {
    test.skip(browserName !== 'chromium', 'CDP IME는 Chromium에서만 쓴다');
    await page.goto('/jobs/new');
    await categoryInput(page).click();
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('input[type=search]')!;
      const w = window as unknown as { __prevented: boolean[] };
      w.__prevented = [];
      window.addEventListener('keydown', (e) => w.__prevented.push(e.defaultPrevented));
      el.dataset.ready = 'true';
    });
    const cdp = await context.newCDPSession(page);
    for (const text of ['ㅋ', '크', '클', '크리', '크림']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await expect(categoryModal(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented)).toEqual([false]);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
    await cdp.send('Input.insertText', { text: '크림' });
    await expect(categoryInput(page)).toHaveValue('크림');

    await page.keyboard.press('Enter');
    await expect(categoryModal(page)).toBeVisible();
    await expect(categoryInput(page)).toHaveValue('크림');
    await expect(columnButtons(page, '소분류')).toHaveText(['크림', '아이크림']);
  });

  test('조합 중 아이콘을 눌러도 글자가 중복·유실되지 않고 그 값으로 검색한다', async ({ page, browserName, context }) => {
    test.skip(browserName !== 'chromium', 'CDP IME는 Chromium에서만 쓴다');
    await page.goto('/jobs/new');
    await categoryInput(page).click();
    const cdp = await context.newCDPSession(page);
    for (const text of ['ㅅ', '스', '슥', '스키', '스킨']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    }
    await page.getByTestId('n1-category-search').click();
    await expect(categoryModal(page)).toBeVisible();
    await expect(categoryModal(page).getByRole('status')).toHaveCount(0);
    await expect(categoryInput(page)).toHaveValue('스킨');
    await expect(columnButtons(page, '대분류').first()).toHaveText('스킨케어');
  });
});

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

  test('사이즈 변경은 Figma 상태대로 조작되고, 조건에 맞는 요소만 보인다', async ({ page }) => {
    await page.goto('/jobs/new');
    await page.getByRole('tab', { name: '사이즈 변경' }).click();
    await expect(page.getByText('사이트 규격에 맞게 이미지를 다시 구성해요.', { exact: false })).toBeVisible();

    // 판매처 맞춤(1093:10289) — 판매처 · 규격 태그만, W/H 없음
    await expect(page.getByRole('radio', { name: '판매처 맞춤' })).toBeChecked();
    await expect(page.getByRole('combobox', { name: '판매처' })).toHaveValue('amazon');
    await expect(page.getByText('베이직(기본 등록)', { exact: false })).toBeVisible();
    const specs = page.getByRole('radiogroup', { name: '판매처 규격' }).getByRole('radio');
    await expect(specs).toHaveText(['Premium A+(1464 x 600)', 'Basic A+(970 x 300)', 'Basic']);
    await expect(specs.nth(1)).toHaveAttribute('aria-checked', 'true');
    await specs.nth(0).click();
    await expect(specs.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(specs.nth(1)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('textbox', { name: '가로 크기(px)' })).toHaveCount(0);

    // 커스텀(1093:10290) — W/H만, 판매처 없음
    await page.getByRole('radio', { name: '커스텀' }).check();
    await expect(page.getByRole('combobox', { name: '판매처' })).toHaveCount(0);
    const width = page.getByRole('textbox', { name: '가로 크기(px)' });
    await expect(width).toHaveValue('80');
    await expect(page.getByRole('textbox', { name: '세로 크기(px)' })).toHaveValue('80');
    expect(Math.round((await width.locator('xpath=..').boundingBox())!.height)).toBe(48);
    await width.fill('12a0');
    await expect(width).toHaveValue('120');

    // Figma에 없는 설명을 평소 레이아웃에 두지 않는다
    await expect(page.getByText('준비 중', { exact: false })).toHaveCount(0);
    await expect(page.getByText('아직 작업에 반영할 수 없습니다.', { exact: false })).toBeHidden();

    // 탭을 오가도 고른 값이 남는다
    await page.getByRole('tab', { name: '원본 유지' }).click();
    await expect(page.getByRole('radio', { name: '커스텀' })).toHaveCount(0);
    await page.getByRole('tab', { name: '사이즈 변경' }).click();
    await expect(width).toHaveValue('120');
  });

  test('사이즈 변경이면 [다음]을 막고 이유를 알리며, 서버 요청 없이 선택을 그대로 둔다', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await page.goto('/jobs/new');
    await fillRequired(page);
    await expect(nextButton(page)).toBeEnabled();

    await page.getByRole('tab', { name: '사이즈 변경' }).click();
    await expect(nextButton(page)).toBeDisabled();
    await nextButton(page).hover();
    await expect(page.getByTestId('n1-next-tooltip')).toHaveText('사이즈 변경 기능은 아직 작업에 반영할 수 없습니다. 원본 유지를 선택해 주세요.');
    await nextButton(page).click({ force: true });
    await expect(page.locator('#n1-size-error')).toBeVisible();
    await expect(page.locator('#n1-size-error')).toBeInViewport();
    await expect(page).toHaveURL(/\/jobs\/new$/);
    await expect(page.getByRole('tab', { name: '사이즈 변경' })).toHaveAttribute('aria-selected', 'true');
    expect(writes).toEqual([]);
  });

  test('원본 유지로 돌아오면 [다음]이 열리고 PATCH는 specType original뿐이다', async ({ page }) => {
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
    await page.getByRole('radio', { name: '커스텀' }).check();
    await page.getByRole('tab', { name: '원본 유지' }).click();
    await expect(page.locator('#n1-size-error')).toHaveCount(0);
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/jobs\/1$/, { timeout: 30_000 });
    expect(patches).toHaveLength(1);
    expect(patches[0].specType).toBe('original');
    for (const key of ['channelSpecId', 'width', 'height', 'customWidth', 'customHeight', 'siteSpec']) expect(patches[0]).not.toHaveProperty(key);
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

  for (const [width, height] of [[1920, 1080], [1728, 885], [1440, 900]] as const) {
    test(`${width}×${height} [다음] 툴팁과 화살표가 버튼 중심에 있고 화면 안에 있다`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/jobs/new');
      await nextButton(page).hover();
      const tooltip = page.getByTestId('n1-next-tooltip');
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toBeInViewport({ ratio: 1 });
      const center = (b: { x: number; width: number }) => b.x + b.width / 2;
      const button = center((await nextButton(page).boundingBox())!);
      const box = center((await tooltip.boundingBox())!);
      const arrow = center((await tooltip.locator('svg').boundingBox())!);
      console.log(`[n1-tooltip] ${width}×${height} button ${button} tooltip ${box} arrow ${arrow}`);
      expect(Math.abs(button - box)).toBeLessThanOrEqual(1);
      expect(Math.abs(button - arrow)).toBeLessThanOrEqual(1);
    });
  }

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

test('analyze 뒤 화면 이동이 늦어도 [다음]을 다시 보낼 수 없고, 이유를 보여 준 뒤 N2로 간다', async ({ page }) => {
  // dev 서버의 첫 컴파일처럼 /jobs/1 이동이 늦은 상황을 만든다
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (headers.has('rsc') && !headers.has('next-router-prefetch') && /\/jobs\/1/.test(url)) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      return originalFetch(input, init);
    };
  });
  const patches: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PATCH') patches.push(new URL(r.url()).pathname);
  });
  await page.goto('/jobs/new');
  await fillRequired(page);
  await nextButton(page).click();
  const pending = page.getByRole('button', { name: '생성 중...' });
  await expect(pending).toBeDisabled();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/jobs\/new$/);
  await pending.click({ force: true });
  await expect(page.getByTestId('n1-next-tooltip')).toHaveText('작업을 만들고 있습니다. 잠시만 기다려 주세요.');
  await expect(page).toHaveURL(/\/jobs\/1$/, { timeout: 15_000 });
  expect(patches).toEqual(['/jobs/1']);
  await expect(page.getByRole('heading', { name: '이미지 분석' })).toBeVisible();
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
