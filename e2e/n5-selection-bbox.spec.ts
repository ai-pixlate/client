import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 선택 박스 = 서버 박스. 선택 테두리·클릭 영역(overlay)은 서버 박스를 preview scale 한 번으로 그린다.
//   「번역 전」 = /blocks bbox, 「번역 후」 = /preview renderInput 적용 box(없으면 bbox).
//   x = bbox.x × scale, y = bbox.y × scale(section-local — slice 가 section 위치를 맡는다), w·h 도 같은 scale.
// 번역문 길이(DOM 글 크기)로 박스를 다시 계산하지 않는다 — 글 높이에 맞춘 Auto Height 는 조판 글 박스에만 쓴다.
// 선택 테두리 frame 은 overlay 바깥으로 화면 12px(Figma 1512:23496) 고정 여백만 더한다. Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

type ApiBox = { x: number; y: number; w: number; h: number };
type Box = { left: number; top: number; width: number; height: number };

const CASES = [
  { label: '한 줄 제목', id: 9109, draft: 'Gift Set' },
  { label: '여러 줄 제목', id: 9101, draft: 'A high-concentration vitamin C serum that brightens skin tone, protects and keeps moisture all day long.' },
  {
    label: '긴 본문',
    id: 9102,
    draft:
      'This serum delivers a high concentration of pure vitamin C to brighten dull skin, even out tone, and support a healthy moisture barrier. Apply two to three drops after cleansing, morning and night, and follow with sunscreen during the day.',
  },
];

async function serverBoxes(page: Page) {
  return page.evaluate(async () => {
    const base = location.pathname.replace(/\/$/, '');
    const blocks = (await (await fetch(`${base}/blocks`)).json()) as { id: number; bbox: { x: number; y: number; w: number; h: number } }[];
    const preview = (await (await fetch(`${base}/preview`)).json()) as {
      scale: number;
      sections: { renderInput: { blocks: { blockId: number; box: { x: number; y: number; w: number; h: number } }[] } | null }[];
    };
    const renderBox = new Map<number, { x: number; y: number; w: number; h: number }>();
    for (const section of preview.sections) for (const block of section.renderInput?.blocks ?? []) renderBox.set(block.blockId, block.box);
    return {
      scale: preview.scale,
      blocks: blocks.map((block) => ({ id: block.id, bbox: block.bbox, renderBox: renderBox.get(block.id) ?? null })),
    };
  });
}

const overlayStyle = (page: Page, id: number) =>
  page.getByTestId(`n5-block-overlay-${id}`).evaluate((el): Box => {
    const { left, top, width, height } = (el as HTMLElement).style;
    return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) };
  });

function expectScaledBox(actual: Box, box: ApiBox, scale: number, label: string) {
  const expected = { left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale };
  for (const key of ['left', 'top', 'width', 'height'] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${label} ${key} ${actual[key]} ≈ ${expected[key]}`).toBeLessThanOrEqual(0.02);
  }
}

/** 선택 테두리 frame 은 overlay 화면 박스에 화면 12px 여백만 더한 것이다(scale 을 다시 곱하지 않는다) */
async function expectFrameWrapsOverlay(page: Page, id: number, label: string) {
  const overlay = (await page.getByTestId(`n5-block-overlay-${id}`).boundingBox())!;
  const frame = (await page.getByTestId('n5-block-selection-frame').boundingBox())!;
  const zoom = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid^="n5-block-overlay-"]')!.closest('[style*="scale("]') as HTMLElement | null;
    const match = /scale\(([^)]+)\)/.exec(canvas?.style.transform ?? '');
    return match ? Number(match[1]) : 1;
  });
  const near = (a: number, b: number, key: string) => expect(Math.abs(a - b), `${label} frame ${key} ${a} ≈ ${b} (zoom ${zoom})`).toBeLessThanOrEqual(1);
  near(frame.x, overlay.x - 12, 'left');
  near(frame.y, overlay.y - 12, 'top');
  near(frame.width, overlay.width + 24, 'width');
  near(frame.height, overlay.height + 24, 'height');
}

test('한 줄 제목·여러 줄 제목·긴 본문 — 선택 박스는 서버 박스 × scale 한 번이고, 번역문 길이로 바뀌지 않는다', async ({ page }) => {
  await reachN5(page);
  const { scale, blocks } = await serverBoxes(page);
  expect(scale).toBeGreaterThan(0);
  const byId = new Map(blocks.map((block) => [block.id, block]));

  for (const { label, id, draft } of CASES) {
    const server = byId.get(id)!;
    const translatedBox = server.renderBox ?? server.bbox;

    // 「번역 후」 — renderInput 적용 box(없으면 bbox)
    const editor = page.getByTestId(`n5-block-editor-${id}`);
    await editor.scrollIntoViewIfNeeded();
    // 오른쪽 번역문 칸을 누르면 같은 block 이 선택되고 미리보기가 그 block 으로 옮겨 간다(block 선택 ↔ 미리보기 선택 연동)
    await editor.click();
    await expect(page.getByTestId(`n5-block-overlay-${id}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n5-block-selection')).toBeVisible();
    expectScaledBox(await overlayStyle(page, id), translatedBox, scale, `${label}(${id}) 번역 후`);
    await expectFrameWrapsOverlay(page, id, `${label}(${id}) 번역 후`);

    // 번역문을 아주 짧게·길게 바꿔도(저장 전 초안) 선택 박스는 그대로다
    await editor.fill(draft);
    await page.waitForTimeout(300);
    expectScaledBox(await overlayStyle(page, id), translatedBox, scale, `${label}(${id}) 초안 뒤`);
    await expectFrameWrapsOverlay(page, id, `${label}(${id}) 초안 뒤`);

    // 「번역 전」 — /blocks bbox 그대로
    await page.getByTestId('n5-view-mode-original').click();
    expectScaledBox(await overlayStyle(page, id), server.bbox, scale, `${label}(${id}) 번역 전`);
    await page.getByTestId('n5-view-mode-translated').click();
  }
});
