import { type Page, expect, test } from '@playwright/test';

import { reachN3 } from './helpers/reach-n3';

// ─────────────────────────────────────────────────────────────────
// N3 상세 칼럼(Figma 1502:20200) — 판정과 버튼이 12 간격의 한 흐름이다. 버튼을 칼럼 아래에 고정하지 않는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '화면 수치 검증은 Chromium 기준이다');

const rectOf = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

async function verdictRects(page: Page) {
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

test.describe('1920×1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('판정 1건 — 판정 바로 아래 12에 버튼이 있고 큰 빈 공간이 없다', async ({ page }) => {
    await reachN3(page);
    await expect(page.getByTestId('n3-detail-title')).toHaveText('SECTION 02');
    const rects = await verdictRects(page);
    expect(rects).toHaveLength(2);
    expectTwelveGaps(rects);
    const flow = await rectOf(page, 'n3-detail-flow');
    const action = await rectOf(page, 'n3-detail-action');
    expect(action.y + action.height).toBeLessThan(flow.y + 300);
    expect(action.x).toBe(896);
    expect(action.width).toBe(385);
    await page.screenshot({ path: test.info().outputPath('n3-single.png') });
  });

  test('판정 없음 — 안내 문구 다음에 버튼이 이어진다', async ({ page }) => {
    await reachN3(page);
    await page.getByTestId('n3-section-card-1').click({ position: { x: 300, y: 20 } });
    await expect(page.getByTestId('n3-verdict-empty')).toHaveText('걸린 판정이 없어요');
    const rects = await verdictRects(page);
    expect(rects.map((r) => r.testId)).toEqual(['n3-verdict-empty', 'n3-detail-action']);
    expectTwelveGaps(rects);
  });

  test('판정이 여러 건이면 모두 12 간격이고, 넘치면 상세 영역만 스크롤하며 버튼이 마지막 항목이다', async ({ page }) => {
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
    await expect.poll(async () => (await verdictRects(page)).length).toBe(10);
    const rects = await verdictRects(page);
    expectTwelveGaps(rects);
    expect(rects.at(-1)?.testId).toBe('n3-detail-action');

    const flow = page.getByTestId('n3-detail-flow');
    const metrics = await flow.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(metrics.scroll).toBeGreaterThan(metrics.client);
    const title = (await rectOf(page, 'n3-detail-title')).y;
    await page.getByTestId('n3-detail-action').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('n3-detail-action')).toBeInViewport();
    expect((await rectOf(page, 'n3-detail-title')).y).toBe(title); // 제목은 함께 움직이지 않는다
  });
});

test.describe('1512×860', () => {
  test.use({ viewport: { width: 1512, height: 860 } });

  test('노트북에서도 같은 흐름이고 버튼이 보인다', async ({ page }) => {
    await reachN3(page);
    expectTwelveGaps(await verdictRects(page));
    await expect(page.getByTestId('n3-detail-action')).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath('n3-1512.png') });
  });
});
