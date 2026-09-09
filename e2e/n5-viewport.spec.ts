import { test, expect } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 — 캔버스형 viewport interaction (9일차, Figma 544:3168 기준)
//
// Before/After 비교 슬라이더(8일차)를 폐기하고 도입한 zoom/pan/fit/mode
// 조작 기반을 검증한다. n5-canvas의 data-zoom/data-pan-x/data-pan-y는
// 화면에 보이지 않는 테스트 전용 hook이다(transform CSS 문자열을 파싱하지
// 않기 위함) — app/jobs/[jobId]/_components/n5/n5-viewport.tsx 참고.
// ─────────────────────────────────────────────────────────────────

async function readTransform(page: import('@playwright/test').Page) {
  const canvas = page.locator('[data-testid="n5-canvas"]');
  const [zoom, panX, panY] = await Promise.all([
    canvas.getAttribute('data-zoom'),
    canvas.getAttribute('data-pan-x'),
    canvas.getAttribute('data-pan-y'),
  ]);
  return { zoom: Number(zoom), panX: Number(panX), panY: Number(panY) };
}

test.describe('N5 캔버스형 viewport', () => {
  test.beforeEach(async ({ page }) => {
    await reachN5(page);
  });

  test('Before/After 슬라이더는 더 이상 존재하지 않는다', async ({ page }) => {
    await expect(page.locator('[data-testid="n5-before-after-slider"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="n5-compare-stack"]')).toHaveCount(0);
  });

  test('기본 view mode는 번역문이고, 원문으로 전환 후 다시 복귀할 수 있다', async ({ page }) => {
    await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'false');
    // 번역문 layer만 실제로 렌더된다 (동일 viewport에서 image source만 교체하므로
    // 두 layer가 동시에 DOM에 있지 않다)
    await expect(page.locator('[data-testid^="n5-slice-translated-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="n5-slice-original-"]')).toHaveCount(0);

    await page.getByTestId('n5-view-mode-original').click();
    await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid^="n5-slice-original-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="n5-slice-translated-"]')).toHaveCount(0);

    await page.getByTestId('n5-view-mode-translated').click();
    await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid^="n5-slice-translated-"]').first()).toBeVisible();
  });

  test('+/- 로 zoom이 바뀌고 표시값에 반영된다', async ({ page }) => {
    await expect(page.getByTestId('n5-zoom-value')).toHaveText('100%');

    await page.getByTestId('n5-zoom-in').click();
    await expect(page.getByTestId('n5-zoom-value')).toHaveText('110%');
    const afterIn = await readTransform(page);
    expect(afterIn.zoom).toBeCloseTo(1.1, 5);

    await page.getByTestId('n5-zoom-out').click();
    await page.getByTestId('n5-zoom-out').click();
    await expect(page.getByTestId('n5-zoom-value')).toHaveText('90%');
  });

  test('mode 전환 후에도 zoom과 pan(viewport 위치)이 유지된다', async ({ page }) => {
    // zoom을 바꿔둔다
    await page.getByTestId('n5-zoom-in').click();
    await page.getByTestId('n5-zoom-in').click();
    const beforeSwitch = await readTransform(page);
    expect(beforeSwitch.zoom).toBeCloseTo(1.2, 5);

    // Space+drag로 pan도 바꿔둔다
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.keyboard.down('Space');
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 60, centerY - 40, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    const afterPan = await readTransform(page);
    expect(afterPan.panX).not.toBe(0);
    expect(afterPan.panY).not.toBe(0);
    expect(afterPan.zoom).toBeCloseTo(beforeSwitch.zoom, 5); // pan만 바뀌고 zoom은 그대로

    // ── mode 전환 — zoom/pan이 그대로인지 확인 ──
    await page.getByTestId('n5-view-mode-original').click();
    const afterSwitchToOriginal = await readTransform(page);
    expect(afterSwitchToOriginal.zoom).toBeCloseTo(afterPan.zoom, 5);
    expect(afterSwitchToOriginal.panX).toBeCloseTo(afterPan.panX, 5);
    expect(afterSwitchToOriginal.panY).toBeCloseTo(afterPan.panY, 5);

    await page.getByTestId('n5-view-mode-translated').click();
    const afterSwitchBack = await readTransform(page);
    expect(afterSwitchBack.zoom).toBeCloseTo(afterPan.zoom, 5);
    expect(afterSwitchBack.panX).toBeCloseTo(afterPan.panX, 5);
    expect(afterSwitchBack.panY).toBeCloseTo(afterPan.panY, 5);
  });

  test('일반 wheel/Shift+Wheel이 transform.pan을 움직인다 (native scroll 아님)', async ({ page }) => {
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    const before = await readTransform(page);
    expect(before.panX).toBe(0);
    expect(before.panY).toBe(0);

    // 일반 wheel 아래 방향(deltaY>0) — canvas가 위로 이동(pan.y가 음수로)해서
    // 아래쪽 내용이 보인다. native scrollTop은 만들지 않았으므로 이 element
    // 자체의 scrollTop은 항상 0이어야 한다.
    await page.mouse.wheel(0, 200);
    const afterDown = await readTransform(page);
    expect(afterDown.panY).toBeLessThan(before.panY);
    expect(afterDown.panX).toBe(0);
    const scrollTop = await viewport.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBe(0);

    // 일반 wheel 위 방향 — 반대로 이동
    await page.mouse.wheel(0, -50);
    const afterUp = await readTransform(page);
    expect(afterUp.panY).toBeGreaterThan(afterDown.panY);

    // Shift+Wheel — 세로 delta를 가로 이동으로 사용한다 (pan.y는 그대로)
    const beforeShift = afterUp;
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Shift');
    const afterShift = await readTransform(page);
    expect(afterShift.panX).toBeLessThan(beforeShift.panX);
    expect(afterShift.panY).toBeCloseTo(beforeShift.panY, 5);
  });

  test('wheel pan 후 이어서 Space+Drag가 자연스럽게 동작한다', async ({ page }) => {
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 150);
    const afterWheel = await readTransform(page);

    await page.keyboard.down('Space');
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX - 40, centerY - 30, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    const afterDrag = await readTransform(page);
    // wheel pan 결과 위에서 이어서 움직여야 한다 (드래그가 wheel 이전 값으로
    // 리셋되지 않는다 — 같은 transform.pan을 공유한다는 증거)
    expect(afterDrag.panY).not.toBe(afterWheel.panY);
    expect(afterDrag.panX).not.toBe(afterWheel.panX);
  });

  test('wheel pan 후 mode 전환 / zoom 조작을 해도 같은 좌표계를 유지한다', async ({ page }) => {
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.mouse.wheel(0, 300);
    const afterWheel = await readTransform(page);
    expect(afterWheel.panY).toBeLessThan(0);

    // mode 전환해도 pan/zoom 그대로
    await page.getByTestId('n5-view-mode-original').click();
    const afterMode = await readTransform(page);
    expect(afterMode.panY).toBeCloseTo(afterWheel.panY, 5);
    expect(afterMode.zoom).toBeCloseTo(afterWheel.zoom, 5);

    // +/- zoom은 zoom만 바꾸고, pan은 pointer-centered 재계산만 될 뿐
    // wheel로 만든 좌표계(같은 transform.pan 기준) 위에서 이어진다 — 0으로
    // 리셋되지 않는다.
    await page.getByTestId('n5-zoom-in').click();
    const afterZoom = await readTransform(page);
    expect(afterZoom.zoom).toBeGreaterThan(afterMode.zoom);
    expect(afterZoom.panY).not.toBe(0);
  });

  test('Ctrl+Wheel로 pointer 위치 중심 zoom이 되고, 페이지 자체 zoom은 막힌다', async ({ page }) => {
    const viewport = page.locator('[data-testid="n5-viewport"]');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('n5-viewport 위치를 찾을 수 없습니다');

    const before = await readTransform(page);
    expect(before.zoom).toBeCloseTo(1, 5);

    // pointer를 viewport 중앙에 두고 Ctrl+Wheel(위로 굴림 = 확대)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');

    const after = await readTransform(page);
    expect(after.zoom).toBeGreaterThan(before.zoom);

    // 브라우저 기본 page zoom(visualViewport.scale)이 바뀌지 않았는지 — Ctrl+Wheel을
    // 우리 핸들러가 preventDefault로 가로챈 것을 방증한다.
    const pageZoom = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(pageZoom).toBeCloseTo(1, 2);
  });

  test('Fit Width / Fit Height 계산 — 반복 실행해도 같은 값(오차 누적 없음)', async ({ page }) => {
    await page.getByTestId('n5-fit-width').click();
    const fitWidthOnce = await readTransform(page);
    expect(fitWidthOnce.zoom).not.toBeCloseTo(1, 2);

    await page.getByTestId('n5-fit-width').click();
    const fitWidthTwice = await readTransform(page);
    expect(fitWidthTwice.zoom).toBeCloseTo(fitWidthOnce.zoom, 5);

    await page.getByTestId('n5-fit-height').click();
    const fitHeight = await readTransform(page);
    expect(fitHeight.zoom).not.toBeCloseTo(fitWidthOnce.zoom, 5);

    await page.getByTestId('n5-fit-height').click();
    const fitHeightTwice = await readTransform(page);
    expect(fitHeightTwice.zoom).toBeCloseTo(fitHeight.zoom, 5);
  });

  test('SRC_A/SRC_B 여러 소스 이미지에 걸친 canvas에서도 조작이 동작하고 이미지 404가 없다', async ({
    page,
  }) => {
    const failedImages: string[] = [];
    page.on('response', (res) => {
      if (res.request().resourceType() === 'image' && res.status() >= 400) {
        failedImages.push(`${res.status()} ${res.url()}`);
      }
    });

    // 두 소스 이미지(SRC_A/SRC_B) slice가 모두 canvas에 존재한다
    const sliceCount = await page.locator('[data-testid^="n5-slice-translated-"]').count();
    expect(sliceCount).toBeGreaterThanOrEqual(2);

    // 전체를 한 화면에 담아 SRC_B 영역까지 내려간 상태에서 mode 전환 + zoom
    await page.getByTestId('n5-fit-height').click();
    await page.getByTestId('n5-view-mode-original').click();
    await page.getByTestId('n5-zoom-in').click();

    await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
    expect(failedImages).toEqual([]);
  });
});
