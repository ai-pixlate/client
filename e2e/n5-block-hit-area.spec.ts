import { test, expect, type Page } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 — 캔버스 block 클릭 영역(hit rect) 회귀 검증 (n5-viewport.tsx, 10/19).
//
// 보이는 bbox(visual rect, n5-block-overlay-*)는 그대로 두고 클릭 영역만 넓혔다:
// 화면 기준 8px 바깥 여백 + 최소 32px(n5-block-hit-*). 번호 배지(n5-block-pin-*)도
// 같은 선택 동작을 한다. 실제 마우스 좌표로 눌러, 그 지점에서 브라우저가 고르는 요소가
// 무엇이든 결과(선택 상태)로 확인한다.
// ─────────────────────────────────────────────────────────────────

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} 위치를 찾을 수 없습니다`);
  return box;
}

/** 화면 좌표 (x, y)에서 가장 위에 있는 요소의 data-testid(없으면 가장 가까운 조상의 것). */
async function testIdAtPoint(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
    [x, y] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await reachN5(page);
  // 전체 canvas를 화면에 넣어(축소 상태) 글씨가 작게 보이는 상황을 만든다.
  await page.getByTestId('n5-fit-height').click();
  await page.getByTestId('n5-block-row-9101').waitFor();
});

test('텍스트 선택 도구: 작은 bbox 중앙 · bbox 바깥 hit 여백 · 번호 배지를 누르면 그 block 이 선택된다', async ({
  page,
}) => {
  // 9103(502/price, 300×80) — fit-height 축소 상태에서 화면상 아주 작다.
  const visual = await boxOf(page, 'n5-block-overlay-9103');
  const hit = await boxOf(page, 'n5-block-hit-9103');

  // hit rect 는 visual rect 를 화면 기준 8px씩 감싼다. 단 소속 section 밖으로는 나가지 않는다
  // (9103 은 section 상단에 가까워 위쪽 여백이 section 경계에서 잘린다).
  const slice = await boxOf(page, 'n5-slice-translated-502');
  expect(visual.height).toBeLessThan(32); // 축소 상태라 실제 bbox 높이가 최소 클릭 크기보다 작다
  expect(hit.x).toBeCloseTo(visual.x - 8, 0);
  expect(hit.x + hit.width).toBeCloseTo(visual.x + visual.width + 8, 0);
  expect(hit.y + hit.height).toBeCloseTo(visual.y + visual.height + 8, 0);
  // 위쪽은 section 안쪽 경계(slice 테두리 1px × zoom)에서 멈춘다
  expect(hit.y).toBeGreaterThanOrEqual(Math.max(slice.y, visual.y - 8) - 0.1);
  expect(hit.y).toBeLessThanOrEqual(Math.max(slice.y + 1, visual.y - 8) + 0.1);
  expect(hit.height).toBeGreaterThan(visual.height + 8);

  // 1) 작은 bbox 중앙 클릭
  await page.mouse.click(visual.x + visual.width / 2, visual.y + visual.height / 2);
  await expect(page.getByTestId('n5-block-overlay-9103')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-row-9103')).toHaveAttribute('aria-pressed', 'true');

  // 다른 block 으로 옮겨 둔다
  await page.getByTestId('n5-block-row-9101').click();
  await expect(page.getByTestId('n5-block-overlay-9101')).toHaveAttribute('aria-pressed', 'true');

  // 2) 실제 bbox 아래쪽 가장자리 바깥(hit 여백) 클릭 — visual 밖, hit 안
  const outsideX = visual.x + visual.width / 2;
  const outsideY = visual.y + visual.height + (hit.y + hit.height - (visual.y + visual.height)) / 2;
  expect(outsideY).toBeGreaterThan(visual.y + visual.height);
  expect(outsideY).toBeLessThan(hit.y + hit.height);
  expect(await testIdAtPoint(page, outsideX, outsideY)).toBe('n5-block-hit-9103');
  await page.mouse.click(outsideX, outsideY);
  await expect(page.getByTestId('n5-block-overlay-9103')).toHaveAttribute('aria-pressed', 'true');
  // 부모 section 클릭으로 덮어써지지 않는다(section 선택이면 block 선택이 해제된다)
  await expect(page.getByTestId('n5-block-overlay-9101')).toHaveAttribute('aria-pressed', 'false');

  // 선택 테두리는 실제 bbox(visual rect)에만 있고, 크기도 그대로다
  expect(await boxOf(page, 'n5-block-overlay-9103')).toEqual(visual);
  await expect(page.getByTestId('n5-block-overlay-9103')).toHaveClass(/border-\[#ff6a38\]/);
  await expect(page.getByTestId('n5-block-hit-9103')).not.toHaveClass(/border/);

  // 3) 번호 배지 클릭 — 다른 block(9104)의 배지를 눌러 선택이 옮겨지는지 본다
  const pin = await boxOf(page, 'n5-block-pin-9104');
  await page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await expect(page.getByTestId('n5-block-overlay-9104')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-row-9104')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-overlay-9103')).toHaveAttribute('aria-pressed', 'false');

  // 4) keyboard 선택 회귀 — visual rect 는 여전히 tab 으로 닿는 button 이다
  await page.getByTestId('n5-block-overlay-9101').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('n5-block-overlay-9101')).toHaveAttribute('aria-pressed', 'true');
  // hit 층과 배지는 접근성 트리·tab 순서에 들어가지 않는다
  await expect(page.getByTestId('n5-block-hit-9101')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByTestId('n5-block-pin-9101')).toHaveAttribute('aria-hidden', 'true');
});

test('인접 block 의 hit 여백이 겹쳐도 실제 bbox 안을 누르면 그 block 이 선택된다', async ({ page }) => {
  // 같은 section(502)의 9103(y 420~500)과 9104 — 실제 bbox 안쪽은 항상 자기 block 이 맨 위다.
  for (const id of ['9103', '9104', '9101', '9110']) {
    const visual = await boxOf(page, `n5-block-overlay-${id}`);
    const points = [
      [visual.x + 1, visual.y + 1],
      [visual.x + visual.width - 1, visual.y + visual.height - 1],
      [visual.x + visual.width / 2, visual.y + visual.height / 2],
    ];
    for (const [x, y] of points) {
      const topId = await testIdAtPoint(page, x, y);
      // 배지가 bbox 좌상단에 걸쳐 있으므로 같은 block 의 배지도 허용한다
      expect([`n5-block-overlay-${id}`, `n5-block-pin-${id}`], `(${x}, ${y})`).toContain(topId);
    }
  }
});

test('섹션 선택 도구: block hit 여백과 번호 배지를 눌러도 그 section 이 선택된다', async ({ page }) => {
  await page.getByRole('button', { name: '섹션 선택' }).click();

  const visual = await boxOf(page, 'n5-block-overlay-9103');
  const hit = await boxOf(page, 'n5-block-hit-9103');
  await page.mouse.click(visual.x + visual.width / 2, (visual.y + visual.height + hit.y + hit.height) / 2);
  await expect(page.getByTestId('n5-section-selected-tag')).toHaveText('Section2');
  await expect(page.getByTestId('n5-block-overlay-9103')).toHaveAttribute('aria-pressed', 'false');

  const pin = await boxOf(page, 'n5-block-pin-9110');
  await page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await expect(page.getByTestId('n5-section-selected-tag')).toHaveText('Section5');
  await expect(page.getByTestId('n5-block-overlay-9110')).toHaveAttribute('aria-pressed', 'false');
});
