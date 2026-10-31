import { test, expect } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 실행 취소·다시 실행 — MVP 표시 전용(PRD F-CFM-03, Figma 544:3168 「After」 1512:23333).
//
// 버튼은 보이지만 동작하지 않고 「12월 제공 예정」을 안내한다. 캔버스 좌하단 독립 그룹이라
// PlacementToolbar와 별개다. 눌러도 선택·배율·이동·보기 모드·작성 중 번역문이 바뀌지 않아야 한다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

test('Undo/Redo가 캔버스 좌하단에 비활성 상태로 보이고 12월 안내를 단다', async ({ page }) => {
  await reachN5(page);

  const undo = page.getByTestId('n5-undo');
  const redo = page.getByTestId('n5-redo');
  for (const [btn, name] of [
    [undo, '실행 취소'],
    [redo, '다시 실행'],
  ] as const) {
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('aria-label', name);
    await expect(btn).toHaveAttribute('title', '12월 제공 예정');
  }
  await expect(page.getByRole('group', { name: '실행 취소·다시 실행' })).toBeVisible();

  // 기존 배치 편집 툴은 그대로 있다(별도 그룹)
  await expect(page.getByTestId('n5-placement-toolbar')).toBeVisible();

  // 위치: viewport(캔버스 영역) 왼쪽에서 24px, 아래에서 31px, 48×48 두 칸이 붙어 있다
  const vp = (await page.getByTestId('n5-viewport').boundingBox())!;
  const u = (await undo.boundingBox())!;
  const r = (await redo.boundingBox())!;
  expect(u.width).toBe(48);
  expect(u.height).toBe(48);
  expect(r.width).toBe(48);
  expect(r.height).toBe(48);
  expect(u.x - vp.x).toBe(24);
  expect(vp.y + vp.height - (u.y + u.height)).toBe(31);
  expect(r.x).toBe(u.x + 48);
  expect(r.y).toBe(u.y);
  test.info().annotations.push({
    type: 'measure',
    description: `viewport x=${vp.x} y=${vp.y} w=${vp.width} h=${vp.height} · undo x=${u.x} y=${u.y} · redo x=${r.x} y=${r.y}`,
  });
  await page.screenshot({ path: test.info().outputPath('n5-undo-redo-1920x1080.png') });
});

test('Undo/Redo를 눌러도 선택·배율·이동·보기 모드·작성 중 번역문이 바뀌지 않는다', async ({ page }) => {
  await reachN5(page);

  // 블록 선택 + 번역문 작성 중 상태를 만든다
  const row = page.getByTestId('n5-block-row-9101');
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  const editor = page.getByTestId('n5-block-editor-9101');
  await editor.fill('작성 중인 번역문');

  const canvas = page.getByTestId('n5-canvas');
  const before = {
    zoom: await canvas.getAttribute('data-zoom'),
    panX: await canvas.getAttribute('data-pan-x'),
    panY: await canvas.getAttribute('data-pan-y'),
  };

  for (const id of ['n5-undo', 'n5-redo']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(editor).toHaveValue('작성 중인 번역문');
  await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');
  expect(await canvas.getAttribute('data-zoom')).toBe(before.zoom);
  expect(await canvas.getAttribute('data-pan-x')).toBe(before.panX);
  expect(await canvas.getAttribute('data-pan-y')).toBe(before.panY);
});

test('기존 토글·배율·섹션 선택·배치 편집 툴은 그대로 동작한다', async ({ page }) => {
  await reachN5(page);

  await page.getByTestId('n5-view-mode-original').click();
  await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('n5-view-mode-translated').click();
  await expect(page.getByTestId('n5-view-mode-translated')).toHaveAttribute('aria-pressed', 'true');

  const canvas = page.getByTestId('n5-canvas');
  const zoomBefore = Number(await canvas.getAttribute('data-zoom'));
  await page.getByTestId('n5-zoom-in').click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(zoomBefore);

  await page.getByTestId('n5-section-tag-1').click();
  await expect(page.getByTestId('n5-section-tag-1')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('n5-tool-section').click();
  await expect(page.getByTestId('n5-tool-section')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-undo-redo')).toBeVisible();
});
