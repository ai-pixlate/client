import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

import { reachN3 } from './helpers/reach-n3';

// ─────────────────────────────────────────────────────────────────
// N3 섹션 확인 — Figma 1759:11529(공통 작업 헤더 도입 뒤) 좌표 · 반응형.
// 1920×1080: 헤더 0/0/1920/72 · 진행 단계 48/96/44/924 · 왼쪽 묶음 262/96/832/924(이미지 404×924 · gap 24 · 상세 690/96/404/863,
// 상세 버튼 698/902/384/45) · 목록 1112/72/688/891(작업 정보 x28 · y24 · h28, 첫 카드 y136) · [이대로 진행] 1112/975/688/45.
// 1728·1512·1440·1280: [이미지 | 상세] [목록 + CTA] 가로 구조 · 가로 넘침 없음 · CTA·상세 버튼이 창 안 · 이미지 원본 비율 ·
// 목록과 상세는 각자 세로 스크롤. 서버 응답 모양은 Mock 응답을 브라우저 fetch 에서 바꿔 만든다(Mock 자체는 그대로).
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '화면 수치 검증은 Chromium 기준이다');

const VIEWPORTS = [
  [1920, 1080],
  [1728, 885],
  [1512, 860],
  [1440, 900],
  [1280, 720],
] as const;

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, testId: string): Promise<Box> => (await page.getByTestId(testId).boundingBox())!;
const near = (actual: number, expected: number, label: string, tolerance = 1) =>
  expect(Math.abs(actual - expected), `${label}: ${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
const nearBox = (actual: Box, [x, y, w, h]: number[], label: string) => {
  near(actual.x, x, `${label} x`);
  near(actual.y, y, `${label} y`);
  near(actual.width, w, `${label} w`);
  near(actual.height, h, `${label} h`);
};
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

interface Shape {
  /** 선택될 섹션(첫 제외 섹션 2)의 bbox — 세로 · 가로로 긴 crop */
  bbox?: { x: number; y: number; w: number; h: number };
  /** 섹션을 이만큼 더 만든다(목록 스크롤) */
  extra?: number;
  /** 모든 섹션을 사용자 제외로 */
  allExcluded?: boolean;
  /** 모든 섹션을 포함(판정 없음)으로 */
  onlyIncluded?: boolean;
}

/** N3 로 바로 연다 — /tasks 는 N3, /sections · 상세는 shape 대로 바꾼다 */
async function openN3(page: Page, shape: Shape = {}, scenario?: string) {
  await page.addInitScript(
    ({ jobId, shape }) => {
      type Sec = { id: number; sectionOrder: number; bucket: string; exclusionReason: string | null; verdicts: unknown[]; bbox: unknown };
      const restyle = (s: Sec): Sec => {
        if (shape.onlyIncluded) return { ...s, bucket: 'include', exclusionReason: null, verdicts: [] };
        if (shape.allExcluded) return { ...s, bucket: 'exclude', exclusionReason: s.exclusionReason ?? 'user_manual' };
        if (shape.bbox && s.id === 2) return { ...s, bbox: shape.bbox };
        return s;
      };
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const path = new URL(url, location.href).pathname;
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'GET' && path === `/jobs/${jobId}/tasks`) {
          const res = await original(input, init);
          const body = await res.json();
          return json({ ...body, currentStep: 'N3', jobStatus: 'review', userFacingStatus: 'section_review' });
        }
        const detail = new RegExp(`^/jobs/${jobId}/sections/(\\d+)$`).exec(path);
        if (method === 'GET' && detail) {
          const id = Number(detail[1]);
          const baseId = id >= 100 ? (id % 5) + 1 : id;
          const res = await original(url.replace(/\/sections\/\d+/, `/sections/${baseId}`), init);
          return json(restyle({ ...(await res.json()), id }));
        }
        if (method === 'GET' && path === `/jobs/${jobId}/sections`) {
          const res = await original(input, init);
          const body = (await res.json()) as { include: Sec[]; exclude: Sec[] };
          let all = [...body.include, ...body.exclude];
          for (let i = 0; i < (shape.extra ?? 0); i++) {
            const base = all[i % all.length];
            all.push({ ...base, id: 100 + i, sectionOrder: 6 + i });
          }
          all = all.map(restyle);
          return json({ include: all.filter((s) => s.bucket === 'include'), exclude: all.filter((s) => s.bucket === 'exclude') });
        }
        return original(input, init);
      };
    },
    { jobId: MOCK_JOB_ID, shape },
  );
  await page.goto(`/jobs/${MOCK_JOB_ID}${scenario ? `?mockScenario=${scenario}` : ''}`);
  await expect(page.getByTestId('n3-proceed')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid^="n3-section-card-"]').first()).toBeVisible();
}

/** 넘침 — 요소 안 글자가 잘리지 않는다(가로) */
const noHorizontalClip = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.getAttribute('data-testid') ?? el.tagName));

test('1920×1080 — 최신 Figma 좌표와 같다(±1px)', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openN3(page);
  nearBox(await box(page, 'job-header'), [0, 0, 1920, 72], 'header');
  const rail = (await page.getByRole('navigation', { name: '작업 진행 단계' }).boundingBox())!;
  nearBox(rail, [48, 96, 44, 924], 'rail');
  nearBox(await box(page, 'n3-left-group'), [262, 96, 832, 924], 'left group');
  nearBox(await box(page, 'n3-section-image'), [262, 96, 404, 924], 'image');
  nearBox(await box(page, 'n3-detail-panel'), [690, 96, 404, 863], 'detail');
  nearBox(await box(page, 'n3-detail-title'), [690, 96, 404, 24], 'detail title');
  nearBox(await box(page, 'n3-detail-action'), [698, 902, 384, 45], 'detail action');
  nearBox(await box(page, 'n3-section-list'), [1112, 72, 688, 891], 'list');
  const meta = await box(page, 'n3-job-meta');
  near(meta.x, 1140, 'meta x');
  near(meta.y, 96, 'meta y');
  near(meta.height, 28, 'meta h');
  const first = (await page.locator('[data-testid^="n3-section-card-"]').first().boundingBox())!;
  near(first.x, 1140, 'first card x');
  near(first.y, 136, 'first card y');
  nearBox(await box(page, 'n3-proceed'), [1112, 975, 688, 45], 'proceed');
  // 왼쪽 묶음 ↔ 목록 18 · 이미지 ↔ 상세 24 · 목록 ↔ CTA 12
  near((await box(page, 'n3-section-list')).x - right(await box(page, 'n3-left-group')), 18, 'outer gap');
  near((await box(page, 'n3-detail-panel')).x - right(await box(page, 'n3-section-image')), 24, 'inner gap');
  near((await box(page, 'n3-proceed')).y - bottom(await box(page, 'n3-section-list')), 12, 'list → CTA');
});

for (const [width, height] of VIEWPORTS) {
  test.describe(`${width}×${height}`, () => {
    test.use({ viewport: { width, height } });

    test('가로 구조 · 넘침 없음 · CTA 와 상세 버튼이 창 안 · 카드 글자 잘림 없음(제외·판정 실패 섞인 작업)', async ({ page }) => {
      await openN3(page, {}, 'n3-card-variants');
      const image = await box(page, 'n3-section-image');
      const detail = await box(page, 'n3-detail-panel');
      const list = await box(page, 'n3-section-list');
      const cta = await box(page, 'n3-proceed');
      const action = await box(page, 'n3-detail-action');
      // [이미지 | 상세] [목록] — 1:1, 서로 겹치지 않고 오른쪽으로 이어진다
      expect(right(image)).toBeLessThanOrEqual(detail.x);
      expect(right(detail)).toBeLessThanOrEqual(list.x);
      near(image.width, detail.width, 'image : detail = 1 : 1');
      // 헤더 아래에서 시작하고 창 안에서 끝난다
      expect(list.y).toBeGreaterThanOrEqual(72);
      expect(image.y).toBeGreaterThanOrEqual(72);
      for (const [label, b] of [['cta', cta], ['detail action', action], ['image', image], ['list', list]] as const) {
        expect(bottom(b), `${label} bottom`).toBeLessThanOrEqual(height);
        expect(right(b), `${label} right`).toBeLessThanOrEqual(width);
      }
      expect(cta.height).toBe(45);
      await expect(page.getByTestId('n3-proceed')).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // 카드 최소 가독성 — 카드 폭 360 이상 · 카드 · 버튼 안 글자가 가로로 잘리지 않는다
      const cards = page.locator('[data-testid^="n3-section-card-"]');
      for (let i = 0; i < (await cards.count()); i++) {
        const card = (await cards.nth(i).boundingBox())!;
        expect(card.width, `card ${i} width`).toBeGreaterThanOrEqual(360);
        const button = (await cards.nth(i).locator('button').last().boundingBox())!;
        expect(right(button), `card ${i} button`).toBeLessThanOrEqual(right(card));
      }
      expect(await noHorizontalClip(page, '[data-testid^="n3-section-card-"], [data-testid^="n3-section-action-"], [data-testid="n3-detail-action"], [data-testid="n3-proceed"]')).toEqual([]);
      // 판정 실패 카드도 그대로 보인다
      await expect(page.getByTestId('n3-section-card-4')).toHaveAttribute('data-variant', 'judgement-failed');
      // 상세 · 목록은 각자 세로 스크롤 영역이다(화면 전체가 스크롤되지 않는다)
      expect(await page.getByTestId('n3-detail-flow').evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
      expect(await page.getByTestId('n3-section-list').evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    });

    test('세로로 긴 이미지 — 원본 비율 그대로 폭에 맞추고 이미지 칸만 스크롤한다', async ({ page }) => {
      await openN3(page, { bbox: { x: 0, y: 0, w: 300, h: 1300 } });
      const column = page.getByTestId('n3-section-image');
      const crop = (await column.locator('img').locator('..').boundingBox())!;
      near(crop.width / crop.height, 300 / 1300, 'crop ratio', 0.01);
      near(crop.width, (await column.boundingBox())!.width, 'crop fills column width');
      const { scrollHeight, clientHeight } = await column.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      expect(scrollHeight).toBeGreaterThan(clientHeight);
      // 이미지 칸을 스크롤해도 목록 · 화면은 움직이지 않는다
      const listTop = await page.getByTestId('n3-section-list').evaluate((el) => el.scrollTop);
      await column.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      expect(await column.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await page.getByTestId('n3-section-list').evaluate((el) => el.scrollTop)).toBe(listTop);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test('가로로 긴 이미지 — 원본 비율 그대로 칸 세로 가운데', async ({ page }) => {
      await openN3(page, { bbox: { x: 0, y: 0, w: 1000, h: 120 } });
      const column = (await box(page, 'n3-section-image'))!;
      const crop = (await page.getByTestId('n3-section-image').locator('img').locator('..').boundingBox())!;
      near(crop.width / crop.height, 1000 / 120, 'crop ratio', 0.1);
      near(crop.width, column.width, 'crop width');
      near(crop.y + crop.height / 2, column.y + column.height / 2, 'vertical center', 1.5);
    });

    test('섹션이 많은 작업 — 목록만 스크롤되고 CTA 는 그대로 창 안', async ({ page }) => {
      await openN3(page, { extra: 12 });
      const list = page.getByTestId('n3-section-list');
      const ctaBefore = await box(page, 'n3-proceed');
      const { scrollHeight, clientHeight } = await list.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
      expect(scrollHeight).toBeGreaterThan(clientHeight);
      await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      const last = page.locator('[data-testid^="n3-section-card-"]').last();
      await expect(last).toBeInViewport();
      nearBox(await box(page, 'n3-proceed'), [ctaBefore.x, ctaBefore.y, ctaBefore.width, ctaBefore.height], 'cta stays');
      expect(bottom(ctaBefore)).toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  });
}

test.describe('1280×720 — 데이터 상태', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('모든 섹션 제외 — [이대로 진행]은 막히고 이유가 보이며 진행 요청이 없다', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await openN3(page, { allExcluded: true });
    const cta = page.getByTestId('n3-proceed');
    await expect(cta).toHaveAttribute('aria-disabled', 'true');
    await cta.hover();
    await expect(page.getByTestId('n3-proceed-tooltip')).toBeVisible();
    const tip = (await page.getByTestId('n3-proceed-tooltip').boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(right(tip)).toBeLessThanOrEqual(1280);
    await cta.click({ force: true });
    await page.waitForTimeout(500);
    expect(writes.filter((w) => w.endsWith('/sections/proceed'))).toEqual([]);
  });

  test('포함 섹션만 있는 작업 — 판정 없음 안내 · 제외하기 버튼 · 진행 가능', async ({ page }) => {
    await openN3(page, { onlyIncluded: true });
    await expect(page.getByTestId('n3-verdict-empty')).toBeVisible();
    await expect(page.getByTestId('n3-detail-action')).toHaveText('제외하기');
    await expect(page.getByTestId('n3-proceed')).toBeEnabled();
    await expect(page.getByTestId('n3-proceed')).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('실제 조작 — N2 → N3 → 카드 선택 · 제외/포함 · 선택 유지 → [이대로 진행] → N4', async ({ page }) => {
    await reachN3(page);
    await expect(page.getByTestId('n3-proceed')).toBeVisible();
    // 다른 카드 선택 → 상세 · 이미지가 바뀐다
    await page.getByTestId('n3-section-card-1').click();
    await expect(page.getByTestId('n3-section-image')).toHaveAttribute('data-section-id', '1');
    await expect(page.getByTestId('n3-detail-title')).toHaveText('SECTION 01');
    // 선택한 섹션을 제외 → 선택이 그대로이고 카드 bucket 이 바뀐다
    const patch = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/sections\/1$/.test(new URL(r.url()).pathname));
    await page.getByTestId('n3-detail-action').click();
    expect((await patch).ok()).toBe(true);
    await expect(page.getByTestId('n3-section-card-1')).toHaveAttribute('data-bucket', 'exclude');
    await expect(page.getByTestId('n3-section-image')).toHaveAttribute('data-section-id', '1');
    // 다른 카드의 버튼으로 포함 — 선택은 1 그대로
    await page.getByTestId('n3-section-action-2').click();
    await expect(page.getByTestId('n3-section-card-2')).toHaveAttribute('data-bucket', 'include');
    await expect(page.getByTestId('n3-section-card-1')).toHaveAttribute('data-selected', 'true');
    // 다시 포함으로 되돌린 뒤 진행
    await page.getByTestId('n3-detail-action').click();
    await expect(page.getByTestId('n3-section-card-1')).toHaveAttribute('data-bucket', 'include');
    await page.getByTestId('n3-proceed').click();
    await expect(page.getByRole('navigation', { name: '작업 진행 단계' }).locator('[aria-current="step"]')).toContainText('번역 중', { timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
