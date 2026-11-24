import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 번역문 아래 원문 참고 카드(Figma 544:3168 → 1792:34883) — Chromium · Mock.
// 흰 바탕 · #eaeaea 테두리 · radius 6 · 좌우 20 / 위아래 16 카드 안에 「원문」 라벨(12 Light #999)과 원문(14 Regular #707070).
// testid n5-block-source-reference 는 원문 텍스트만 가리킨다(라벨 제외). 원문이 없으면 카드가 없다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

const card = (page: Page, blockId: number) => page.getByTestId(`n5-block-row-${blockId}`).getByTestId('n5-block-source-reference-card');

test('번역 후 기본 화면 — 원문 카드는 「원문」 라벨과 원문을 Figma 카드 스타일로 보인다', async ({ page }) => {
  await reachN5(page);
  const c = card(page, 9101);
  await expect(c).toBeVisible();
  await expect(c.getByText('원문', { exact: true })).toBeVisible();
  await expect(page.getByTestId('n5-block-row-9101').getByTestId('n5-block-source-reference')).toHaveText('순수 비타민 C 세럼');

  const style = await c.evaluate((el) => {
    const css = getComputedStyle(el);
    const [label, text] = Array.from(el.children).map((child) => getComputedStyle(child));
    return {
      bg: css.backgroundColor,
      border: `${css.borderTopWidth} ${css.borderTopStyle} ${css.borderTopColor}`,
      radius: css.borderTopLeftRadius,
      padding: [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft],
      gap: css.rowGap,
      label: [label.fontSize, label.fontWeight, label.color],
      text: [text.fontSize, text.fontWeight, text.color],
    };
  });
  expect(style).toEqual({
    bg: 'rgb(255, 255, 255)',
    border: '1px solid rgb(234, 234, 234)',
    radius: '6px',
    padding: ['16px', '20px', '16px', '20px'],
    gap: '4px',
    label: ['12px', '300', 'rgb(153, 153, 153)'],
    text: ['14px', '400', 'rgb(112, 112, 112)'],
  });
});

test('원문/번역 토글 — 번역 전에서는 원문 카드 대신 기존 원문 표시, 번역 후로 돌아오면 카드가 다시 보인다', async ({ page }) => {
  await reachN5(page);
  await expect(card(page, 9101)).toBeVisible();
  await page.getByTestId('n5-view-mode-original').click();
  await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-source-reference-card')).toHaveCount(0);
  await expect(page.getByTestId('n5-block-row-9101').getByText('순수 비타민 C 세럼')).toBeVisible();
  await page.getByTestId('n5-view-mode-translated').click();
  await expect(card(page, 9101)).toBeVisible();
});

test('원문이 없는 block 은 원문 카드를 그리지 않는다', async ({ page }) => {
  // 9101 의 원문을 비운 /blocks 응답(앱이 쓰는 window.fetch 를 문서 시작 때 감싼다)
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const res = await originalFetch(input, init);
      if (!new URL(url, location.href).pathname.endsWith('/blocks') || !res.ok) return res;
      const blocks = (await res.json()) as { id: number; sourceKo: string | null }[];
      return new Response(JSON.stringify(blocks.map((b) => (b.id === 9101 ? { ...b, sourceKo: '' } : b))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });
  await reachN5(page);
  await expect(page.getByTestId('n5-block-row-9102')).toBeVisible();
  await expect(card(page, 9102)).toBeVisible();
  await expect(page.getByTestId('n5-block-row-9101')).toBeVisible();
  await expect(card(page, 9101)).toHaveCount(0);
});
