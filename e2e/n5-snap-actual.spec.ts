import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { useLocalLayoutEditing } from './helpers/layout-write';

// ─────────────────────────────────────────────────────────────────
// 일반 /jobs/1 경로(기본 fixture)에서 사용자가 잡는 block 본체 중앙을 실제 mouse로 끈다.
// 판정은 화면 DOM 측정값으로 한다. dispatchEvent나 내부 함수를 쓰지 않는다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

// 박스·배율은 세션 local 편집만 본다 — Mock 에서도 layoutAdjust 쓰기를 끈다(실서버 쓰기 차단과 같은 동작). 저장 흐름은 n5-layout-adjust.spec.ts
test.beforeEach(async ({ page }) => {
  await useLocalLayoutEditing(page);
});

const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;
const centerOf = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

function probe(page: Page, blockId: number, sectionId: number) {
  const block = `n5-block-overlay-${blockId}`;
  const slice = `n5-slice-translated-${sectionId}`;
  return {
    block,
    delta: async () => {
      const b = centerOf(await box(page, block));
      const s = centerOf(await box(page, slice));
      return { x: b.x - s.x, y: b.y - s.y };
    },
    /** 잡은 뒤 화면 기준으로 block 중심이 section 중심에서 (ox, oy)에 오도록 커서를 옮긴다 */
    grab: async () => {
      const b = await box(page, block);
      const hit = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'),
        [b.x + b.width / 2, b.y + b.height / 2],
      );
      expect(hit, '본체 중앙을 다른 요소가 가리지 않는다').toBe(block);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
    },
  };
}

async function moveTo(page: Page, p: ReturnType<typeof probe>, ox: number | null, oy: number | null) {
  const d = await p.delta();
  const b = centerOf(await box(page, p.block));
  // 커서는 잡은 중앙이므로 현재 block 중심과 커서의 차이는 snap 양만큼이다. 후보는 커서 기준이라 HUD 대신 누적으로 움직인다
  await page.mouse.move(b.x + (ox == null ? 0 : ox - d.x), b.y + (oy == null ? 0 : oy - d.y), { steps: 6 });
}

const guideX = (page: Page) => page.getByTestId('n5-snap-guide-x');
const guideY = (page: Page) => page.getByTestId('n5-snap-guide-y');

for (const zoomClicks of [0, 1]) {
  const label = zoomClicks === 0 ? '100%' : '110%';

  test(`${label} — 선택된 block 본체를 끌면 Y가 붙고, 풀리면 guide도 사라진다 (HUD 증거)`, async ({ page }) => {
    await reachN5(page, { debugSnap: true });
    for (let i = 0; i < zoomClicks; i += 1) await page.getByTestId('n5-zoom-in').click();
    await page.getByTestId('n5-block-pin-9102').click();
    await expect(page.getByTestId('n5-block-selection')).toBeVisible();
    await expect(page.getByTestId('n5-block-overlay-9102')).toHaveCSS('cursor', 'move');
    const p = probe(page, 9102, 501);
    const hud = page.getByTestId('n5-snap-hud');
    await p.grab();

    // snap 진입 전
    await moveTo(page, p, null, -40);
    const before = await p.delta();
    await expect(hud).toHaveAttribute('data-snapped-y', 'false');
    await expect(guideY(page)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`snap-${label}-1-before.png`) });

    // snap lock 중
    await moveTo(page, p, null, -5);
    const locked = await p.delta();
    await expect(hud).toHaveAttribute('data-snapped-y', 'true');
    await expect(guideY(page)).toBeVisible();
    expect(Math.abs(locked.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath(`snap-${label}-2-lock.png`) });

    // 벗어난 뒤
    const bb = await box(page, p.block);
    const cx = centerOf(bb);
    await page.mouse.move(cx.x, cx.y + 40, { steps: 8 });
    const after = await p.delta();
    await expect(hud).toHaveAttribute('data-snapped-y', 'false');
    await expect(guideY(page)).toHaveCount(0);
    expect(Math.abs(after.y)).toBeGreaterThan(20);
    await page.screenshot({ path: test.info().outputPath(`snap-${label}-3-after.png`) });
    await page.mouse.up();

    console.log(`SNAP ${label} 9102 Y: before ${before.y.toFixed(2)} lock ${locked.y.toFixed(2)} after ${after.y.toFixed(2)}`);
  });

  test(`${label} — 폭이 넓은 block도 옆으로 움직이고, 돌아오면 X가 붙는다`, async ({ page }) => {
    await reachN5(page);
    for (let i = 0; i < zoomClicks; i += 1) await page.getByTestId('n5-zoom-in').click();
    await page.getByTestId('n5-block-pin-9102').click();
    const p = probe(page, 9102, 501);
    const start = await p.delta();
    await p.grab();
    const scale = zoomClicks === 0 ? 1 : 1.1;
    const range = 20 * scale; // 폭 900/1000 × scale 0.4 × zoom — 오른쪽 끝까지

    const c = centerOf(await box(page, p.block));
    // 시작 위치가 구간 안이어도 묶이지 않는다
    await page.mouse.move(c.x + 6, c.y, { steps: 3 });
    const free = await p.delta();
    expect(Math.abs(free.x - (start.x + 6))).toBeLessThanOrEqual(1);
    await expect(guideX(page)).toHaveCount(0);

    // 구간을 벗어났다가
    await page.mouse.move(c.x + 200, c.y, { steps: 6 });
    const edge = await p.delta();
    expect(Math.abs(edge.x - range)).toBeLessThanOrEqual(1.5);
    await expect(guideX(page)).toHaveCount(0);

    // 돌아오면 붙는다
    await page.mouse.move(c.x + 30 - start.x - 25, c.y, { steps: 6 });
    const snapped = await p.delta();
    expect(Math.abs(snapped.x)).toBeLessThanOrEqual(1);
    await expect(guideX(page)).toBeVisible();
    await page.mouse.up();
    await expect(guideX(page)).toHaveCount(0);
    console.log(`SNAP ${label} 9102 X: start ${start.x.toFixed(2)} free ${free.x.toFixed(2)} edge ${edge.x.toFixed(2)} lock ${snapped.x.toFixed(2)}`);
  });

  test(`${label} — 선택 안 된 block을 바로 끌어도 선택되며 X·Y가 붙고, 텍스트 유무와 무관하다`, async ({ page }) => {
    await reachN5(page);
    for (let i = 0; i < zoomClicks; i += 1) await page.getByTestId('n5-zoom-in').click();

    // 번역문 있는 block(9111), 선택하지 않은 채
    const p = probe(page, 9111, 501);
    await p.grab();
    await moveTo(page, p, 40, 40);
    await expect(page.getByTestId('n5-block-row-9111')).toHaveAttribute('aria-pressed', 'true');
    await moveTo(page, p, 4, 4);
    const both = await p.delta();
    expect(Math.abs(both.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(both.y)).toBeLessThanOrEqual(1);
    await expect(guideX(page)).toBeVisible();
    await expect(guideY(page)).toBeVisible();
    await page.mouse.up();
    await expect(guideX(page)).toHaveCount(0);
    // 놓은 뒤 그 자리에 남는다
    const kept = await p.delta();
    expect(Math.abs(kept.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(kept.y)).toBeLessThanOrEqual(1);

    // 번역문 없는 block(9105, 읽기 전용 · trans1=null)
    await page.getByTestId('n5-block-row-9105').click();
    await expect(page.getByTestId('n5-block-row-9105')).toContainText('번역문 (읽기 전용)'); // trans1=null
    const q = probe(page, 9105, 502);
    await q.grab();
    await moveTo(page, q, 40, 40);
    await moveTo(page, q, 4, 40);
    const emptyX = await q.delta();
    expect(Math.abs(emptyX.x)).toBeLessThanOrEqual(1);
    await expect(guideX(page)).toBeVisible();
    await page.mouse.up();
    console.log(`SNAP ${label} unselected 9111 both ${both.x.toFixed(2)},${both.y.toFixed(2)} · empty 9105 X ${emptyX.x.toFixed(2)}`);
  });
}

test('handle은 resize이고 snap이 없으며, 빠른 끌기로 선을 건너뛰어도 붙는다', async ({ page }) => {
  await reachN5(page);
  await page.getByTestId('n5-block-pin-9111').click();
  const p = probe(page, 9111, 501);

  // handle: 중앙 근처로 넓혀도 guide가 없다
  const e = await box(page, 'n5-block-handle-e');
  await expect(page.getByTestId('n5-block-handle-e')).toHaveCSS('cursor', 'ew-resize');
  await page.mouse.move(e.x + 4, e.y + 4);
  await page.mouse.down();
  await page.mouse.move(e.x + 100, e.y + 4, { steps: 5 });
  await expect(guideX(page)).toHaveCount(0);
  await page.mouse.up();

  // 선택되어 커서가 잡는 중앙에서, 한 번의 pointermove로 중앙선을 건너뛴다(-60 → +16)
  await p.grab();
  await moveTo(page, p, -60, null);
  const c = centerOf(await box(page, p.block));
  await page.mouse.move(c.x + 76, c.y);
  expect(Math.abs((await p.delta()).x)).toBeLessThanOrEqual(1);
  await page.mouse.up();
});
