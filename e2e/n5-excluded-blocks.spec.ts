import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 — 번역 제외 블록(isExcluded=true)은 텍스트 블록으로 보이지 않는다(release/1.1.0 QA · GS-02_002).
// 단일 기준은 서버 isExcluded 다. /blocks 응답(raw)은 그대로 받고, N5 표시용 블록만 거른다(n5-view.tsx · isN5VisibleBlock).
//
// GS-02_002 재현: 섹션 501 의 /blocks 를 blockOrder 1~15 로 바꿔 돌려준다. 3·4·5·6·7·9·10·11·12·13·14 는 isExcluded=true
// (제품 라벨 10 · 브랜드 로고 1 — id 2164 "Retinal"), 1·2·8·15 는 isExcluded=false. 이미지는 그대로 둔다. Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const SECTION = 501; // 1000 × 900
const EXCLUDED_ORDERS = [3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14];
const VISIBLE_ORDERS = [1, 2, 8, 15];
const BRAND_LOGO_ORDER = 13;
const idOf = (order: number) => (order === BRAND_LOGO_ORDER ? 2164 : 95000 + order);
const VISIBLE_IDS = VISIBLE_ORDERS.map(idOf);
const EXCLUDED_IDS = EXCLUDED_ORDERS.map(idOf);

/** 섹션 501 블록을 GS-02_002 모양 15개로 바꾼다. window.__gsExcludeAlso 에 넣은 id 는 그 뒤 응답부터 isExcluded=true 가 된다 */
async function installGs02(page: Page) {
  await page.addInitScript(
    ({ section, excluded, brandLogoOrder }) => {
      const w = window as unknown as { __gsExcludeAlso: number[] };
      w.__gsExcludeAlso = [];
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
        if ((init?.method ?? 'GET').toUpperCase() !== 'GET' || !/^\/jobs\/[^/]+\/blocks$/.test(url.pathname) || !response.ok) return response;
        const blocks = (await response.clone().json()) as Record<string, unknown>[];
        const template = blocks.find((block) => block.sectionId === section)!;
        const synthetic = Array.from({ length: 15 }, (_, i) => {
          const order = i + 1;
          const id = order === brandLogoOrder ? 2164 : 95000 + order;
          const isExcluded = excluded.includes(order) || w.__gsExcludeAlso.includes(id);
          const isBrandLogo = order === brandLogoOrder;
          return {
            ...template,
            id,
            blockOrder: order,
            role: isExcluded && !isBrandLogo ? 'product_label' : 'body',
            sourceKo: isBrandLogo ? 'Retinal' : `원문 ${order}`,
            trans1: isBrandLogo ? 'Retinal' : `Text ${order}`,
            charCount: 6,
            charLimit: null,
            overflow: false,
            autoAdjust: null,
            layoutAdjust: null,
            signals: [],
            revision: 1,
            isExcluded,
            isBrandLogo,
            isProductLabel: isExcluded && !isBrandLogo,
            bbox: { x: 20 + (i % 3) * 330, y: 20 + Math.floor(i / 3) * 175, w: 300, h: 150 },
          };
        });
        const others = blocks.filter((block) => block.sectionId !== section);
        return new Response(JSON.stringify([...synthetic, ...others]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    },
    { section: SECTION, excluded: EXCLUDED_ORDERS, brandLogoOrder: BRAND_LOGO_ORDER },
  );
}

/** 섹션 501 의 패널 행 id(화면 순서) */
const panelRowIds = (page: Page) =>
  page.getByTestId('n5-panel').evaluate((panel) =>
    [...panel.querySelectorAll('[data-testid^="n5-block-row-"]')]
      .map((el) => Number(el.getAttribute('data-testid')!.replace('n5-block-row-', '')))
      .filter((id) => id === 2164 || (id > 95000 && id <= 95015)),
  );

/** 캔버스 섹션 501 의 블록 UI(overlay·번호·hit) id */
const canvasIds = (page: Page, kind: 'overlay' | 'pin' | 'hit', mode: 'translated' | 'original') =>
  page.getByTestId(`n5-slice-${mode}-${SECTION}`).evaluate(
    (slice, prefix) =>
      [...slice.querySelectorAll(`[data-testid^="${prefix}"]`)].map((el) => Number(el.getAttribute('data-testid')!.replace(prefix, ''))).sort((a, b) => a - b),
    `n5-block-${kind}-`,
  );

test('GS-02_002 — 15개 중 isExcluded=true 11개는 패널·캔버스(번역 전/후)·선택 어디에도 없고, 1·2·8·15 4개만 보인다', async ({ page }) => {
  await installGs02(page);
  await reachN5(page);

  // 서버(raw) 응답은 그대로 15개(제외 11개)
  const raw = await page.evaluate(async (section) => {
    const base = location.pathname.replace(/\/$/, '');
    const blocks = (await (await fetch(`${base}/blocks`)).json()) as { sectionId: number; isExcluded: boolean; blockOrder: number }[];
    const inSection = blocks.filter((block) => block.sectionId === section);
    return { total: inSection.length, excluded: inSection.filter((block) => block.isExcluded).length };
  }, SECTION);
  expect(raw).toEqual({ total: 15, excluded: 11 });

  // 오른쪽 패널 — 보이는 행은 1·2·8·15 순서 4개
  await expect.poll(() => panelRowIds(page)).toEqual(VISIBLE_IDS);
  for (const id of EXCLUDED_IDS) await expect(page.getByTestId(`n5-block-row-${id}`)).toHaveCount(0);
  await expect(page.getByTestId('n5-panel')).not.toContainText('Retinal');
  // 번호는 보이는 블록 기준 1~4
  const pins = await page.getByTestId(`n5-slice-translated-${SECTION}`).evaluate((slice) =>
    [...slice.querySelectorAll('[data-testid^="n5-block-pin-"]')].map((el) => el.textContent?.trim()),
  );
  expect(pins.sort()).toEqual(['1', '2', '3', '4']);

  // 왼쪽 캔버스 — 번역 후·번역 전 모두 visible 4개만 overlay·번호·hit 가 있다
  const sortedVisible = [...VISIBLE_IDS].sort((a, b) => a - b);
  for (const mode of ['translated', 'original'] as const) {
    if (mode === 'original') await page.getByTestId('n5-view-mode-original').click();
    for (const kind of ['overlay', 'pin', 'hit'] as const) expect(await canvasIds(page, kind, mode), `${mode} ${kind}`).toEqual(sortedVisible);
  }
  await page.getByTestId('n5-view-mode-translated').click();

  // 제외 블록 자리(blockOrder 4 — 두 번째 줄 왼쪽)를 눌러도 블록이 선택되지 않는다(섹션만 선택될 수 있다)
  const slice = page.getByTestId(`n5-slice-translated-${SECTION}`);
  await slice.scrollIntoViewIfNeeded();
  const box = (await slice.boundingBox())!;
  const k = box.width / 1000;
  await page.mouse.click(box.x + (20 + 150) * k, box.y + (20 + 175 + 75) * k);
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(0);
  await expect(page.locator('[data-testid^="n5-block-overlay-"][aria-pressed="true"]')).toHaveCount(0);

  // 오른쪽 행 클릭 → 왼쪽 같은 블록 선택(보이는 블록만)
  await page.getByTestId(`n5-block-row-${idOf(8)}`).click();
  await expect(page.getByTestId(`n5-block-overlay-${idOf(8)}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();
});

test('선택된 블록이 재조회 뒤 isExcluded=true 가 되면 행·캔버스에서 사라지고 선택이 풀린다', async ({ page }) => {
  await installGs02(page);
  await reachN5(page);
  const target = idOf(2);

  // 서버가 그 블록을 제외로 바꾼다. 다른 섹션(9103) 저장의 재렌더가 끝나면 /blocks 가 다시 조회된다(몇 초 뒤)
  await page.evaluate((id) => (window as unknown as { __gsExcludeAlso: number[] }).__gsExcludeAlso.push(id), target);
  const other = page.getByTestId('n5-block-editor-9103');
  await other.fill(`${await other.inputValue()}!`);
  await page.getByTestId('n5-block-save-9103').click();
  // 재조회 전에 대상 블록을 선택해 둔다
  await page.getByTestId(`n5-block-row-${target}`).click();
  await expect(page.getByTestId(`n5-block-overlay-${target}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();

  await expect(page.getByTestId(`n5-block-row-${target}`)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId(`n5-block-overlay-${target}`)).toHaveCount(0);
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(0);
  await expect.poll(() => panelRowIds(page)).toEqual([idOf(1), idOf(8), idOf(15)]);
});
