import { expect, test } from '@playwright/test';

// N1 카테고리 단별 스크롤바 표시. Playwright 기본 headless는 --hide-scrollbars라 실제 막대가 그려지지 않아
// 이 파일만 인자를 빼고 실행한다(launchOptions는 파일 단위로만 바꿀 수 있다).
test.use({
  viewport: { width: 1920, height: 1080 },
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
});

test('마우스가 있는 단에서만 막대가 그려지고, 내용 폭은 움직이지 않는다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '--hide-scrollbars는 Chromium 인자다');
  await page.addInitScript(() => {
    const nodes = Array.from({ length: 60 }, (_, i) => ({ id: 1000 + i, parentId: null, name: `대분류항목${i}`, isLeaf: true, path: `대분류항목${i}` }));
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === '/master/categories') {
        return new Response(JSON.stringify(nodes), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
  });
  await page.goto('/jobs/new');
  await page.getByRole('button', { name: '선택하기' }).click();
  const modal = page.getByTestId('n1-category-modal');
  const major = page.getByTestId('n1-category-scroller-대분류');
  const middle = page.getByTestId('n1-category-scroller-중분류');
  const gutter = async (locator: typeof major) => {
    const box = (await locator.boundingBox())!;
    return page.screenshot({ clip: { x: box.x + box.width - 6, y: box.y, width: 6, height: box.height } });
  };
  const itemWidth = async () => (await modal.getByRole('button', { name: '대분류항목1', exact: true }).boundingBox())!.width;

  await page.mouse.move(5, 5);
  await expect(modal).toBeFocused();
  const [majorIdle, middleIdle, widthIdle] = [await gutter(major), await gutter(middle), await itemWidth()];

  await major.hover();
  await expect.poll(async () => (await gutter(major)).equals(majorIdle)).toBe(false);
  expect((await gutter(middle)).equals(middleIdle)).toBe(true);
  expect(await itemWidth()).toBe(widthIdle);
  await page.screenshot({ path: test.info().outputPath('n1-category-scrollbar-hover.png') });

  await page.mouse.move(5, 5);
  await expect.poll(async () => (await gutter(major)).equals(majorIdle)).toBe(true);
});

test('N1 입력 패널도 hover 때만 막대가 그려지고, 입력칸 폭은 Figma 474를 유지한다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '--hide-scrollbars는 Chromium 인자다');
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/jobs/new');
  const panel = page.getByTestId('n1-input-panel');
  const gutter = async () => {
    const box = (await panel.boundingBox())!;
    return page.screenshot({ clip: { x: box.x + box.width - 7, y: box.y + 8, width: 6, height: box.height - 16 } });
  };
  await expect.poll(() => panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await panel.evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth - 2)).toBe(6);
  expect((await page.getByPlaceholder('상품 이름을 입력해주세요').boundingBox())!.width).toBe(474);

  await page.mouse.move(5, 5);
  const idle = await gutter();
  await panel.hover();
  await expect.poll(async () => (await gutter()).equals(idle)).toBe(false);
  await page.mouse.move(5, 5);
  await expect.poll(async () => (await gutter()).equals(idle)).toBe(true);
  await page.getByPlaceholder('상품 이름을 입력해주세요').focus();
  await expect.poll(async () => (await gutter()).equals(idle)).toBe(false);
});
