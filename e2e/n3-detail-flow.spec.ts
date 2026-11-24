import { type Page, expect, test } from '@playwright/test';

import { reachN3 } from './helpers/reach-n3';

// ─────────────────────────────────────────────────────────────────
// N3 판정 상세(Figma 1759:11529 왼쪽 묶음의 오른쪽 칸 — Frame 948 · 본문 1759:11545).
// 제목(h24) 아래 12 에 본문(pl8 · pr12 · py12). 판정 목록(gap 12)만 스크롤하고 [그래도 번역하기](1759:11591, 폭 384 · h45)는
// 본문 아래에 고정된다 — 판정이 많아도 버튼까지 스크롤할 필요가 없다.
// (이전 기준 Figma 1502:20200 의 「버튼이 판정 다음 12 에 이어지는 한 흐름」은 최신 Figma 에서 바뀌었다.)
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '화면 수치 검증은 Chromium 기준이다');

const rectOf = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

async function flowChildren(page: Page) {
  return page.getByTestId('n3-detail-flow').evaluate((flow) =>
    [...flow.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, testId: el.getAttribute('data-testid') };
    }),
  );
}

function expectTwelveGaps(rects: { top: number; bottom: number }[]) {
  for (let i = 1; i < rects.length; i += 1) {
    expect(Math.abs(rects[i].top - rects[i - 1].bottom - 12), `child ${i} gap`).toBeLessThanOrEqual(0.5);
  }
}

/** 버튼은 판정 목록 밖, 상세 칸 아래(본문 py12 안쪽)에 고정된다 */
async function expectActionPinned(page: Page) {
  const panel = await rectOf(page, 'n3-detail-panel');
  const flow = await rectOf(page, 'n3-detail-flow');
  const action = await rectOf(page, 'n3-detail-action');
  expect(Math.abs(action.y + action.height - (panel.y + panel.height - 12))).toBeLessThanOrEqual(1);
  expect(action.y).toBeGreaterThanOrEqual(flow.y + flow.height - 0.5);
  expect(Math.round(action.height)).toBe(45);
  await expect(page.getByTestId('n3-detail-action')).toBeInViewport();
  return { panel, action };
}

test.describe('1920×1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('판정 1건 — 제목 아래 12 에 판정, 버튼은 상세 칸 아래에 고정(폭 384 · 왼쪽 8)', async ({ page }) => {
    await reachN3(page);
    await expect(page.getByTestId('n3-detail-title')).toHaveText('SECTION 02');
    const rects = await flowChildren(page);
    expect(rects).toHaveLength(1);
    const title = await rectOf(page, 'n3-detail-title');
    expect(Math.round(title.height)).toBe(24);
    // 제목 아래 12(본문 간격) + 본문 py12
    expect(Math.abs(rects[0].top - (title.y + title.height + 12 + 12))).toBeLessThanOrEqual(1);
    const { panel, action } = await expectActionPinned(page);
    expect(Math.abs(action.x - (panel.x + 8))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(action.width - 384)).toBeLessThanOrEqual(0.5);
    await page.screenshot({ path: test.info().outputPath('n3-single.png') });
  });

  test('판정 없음 — 안내 문구만 목록에 있고 버튼은 아래에 고정', async ({ page }) => {
    await reachN3(page);
    await page.getByTestId('n3-section-card-1').click({ position: { x: 300, y: 20 } });
    await expect(page.getByTestId('n3-verdict-empty')).toHaveText('걸린 판정이 없어요');
    expect((await flowChildren(page)).map((r) => r.testId)).toEqual(['n3-verdict-empty']);
    await expectActionPinned(page);
  });

  test('판정이 여러 건이면 모두 12 간격이고, 넘치면 판정 목록만 스크롤하며 버튼은 스크롤 없이 보인다', async ({ page }) => {
    // 상세 응답의 판정을 늘려 넘치는 상황을 만든다
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!/\/sections\/\d+$/.test(new URL(url, location.href).pathname) || (init?.method ?? 'GET') !== 'GET' || !response.ok) return response;
        const body = await response.json();
        const first = body.verdicts?.[0];
        if (first) body.verdicts = Array.from({ length: 9 }, (_, i) => ({ ...first, id: 1000 + i }));
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    });
    await reachN3(page);
    await expect.poll(async () => (await flowChildren(page)).length).toBe(9);
    expectTwelveGaps(await flowChildren(page));

    const flow = page.getByTestId('n3-detail-flow');
    const metrics = await flow.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(metrics.scroll).toBeGreaterThan(metrics.client);
    const title = (await rectOf(page, 'n3-detail-title')).y;
    const before = await rectOf(page, 'n3-detail-action');
    await expectActionPinned(page);
    await flow.evaluate((el) => el.scrollBy(0, 400));
    // 목록만 움직이고 제목·버튼은 그대로다
    expect((await rectOf(page, 'n3-detail-title')).y).toBe(title);
    expect((await rectOf(page, 'n3-detail-action')).y).toBe(before.y);
  });
});

test.describe('1512×860', () => {
  test.use({ viewport: { width: 1512, height: 860 } });

  test('노트북에서도 같은 구조이고 버튼이 보인다', async ({ page }) => {
    await reachN3(page);
    expectTwelveGaps(await flowChildren(page));
    await expectActionPinned(page);
    await page.screenshot({ path: test.info().outputPath('n3-1512.png') });
  });
});
