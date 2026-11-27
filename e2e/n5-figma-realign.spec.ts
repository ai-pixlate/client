import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { enableN5GeneralHistoryForTest } from './helpers/n5-general-history';

// 보존한 일반 실행 취소·다시 실행 검증 — 12월 화면에서는 숨겼으므로 Mock 전용 스위치를 켠다(e2e/helpers/n5-general-history.ts)
test.beforeEach(async ({ page }) => {
  await enableN5GeneralHistoryForTest(page);
});

// ─────────────────────────────────────────────────────────────────
// N5 Figma 재정합(544:3168) — shell·canvas·패널 geometry, 선택 block UI(1512:23496),
// 선택 즉시 보이는 글자크기 툴바(저장 계약 없음), 패널 목록·저장 버튼 분리.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

// 박스·배율 조작은 N5 에서 local 초안만 바꾼다(PATCH 없음) — 이 spec 은 화면 계산만 본다. [저장하러 가기]의 저장 흐름은 n5-layout-adjust.spec.ts

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;
const near = (actual: number, expected: number, tolerance = 2) => expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);

test.beforeEach(async ({ page }) => {
  await reachN5(page);
  await expect(page.getByTestId('n5-viewport')).toBeVisible();
});

test('1920×1080 — 핵심 container가 Figma 좌표에 있다', async ({ page }) => {
  // 12월(PRD F-JOB-07 · F-NAV-01)에는 ✕ 가 없다
  await expect(page.getByTestId('s0-exit')).toHaveCount(0);

  // 진행단계 라벨은 Figma 525:3023 진행단계(608:1440) x48 · w44 칸 가운데다 — 48 + 44/2 = 70 (s0-steps-figma.spec.ts 와 같은 정본)
  const stepNav = (await page.getByRole('navigation', { name: '작업 진행 단계' }).getByText('정보 입력', { exact: true }).boundingBox())!;
  near(stepNav.x + stepNav.width / 2, 70);

  // 최신 Figma(544:3168): 회색 작업 영역은 공통 헤더(0/0/1920/72) 아래 y72 부터 — 헤더와 검사 기준 칩이 겹치지 않는다
  const workspace = await box(page, 'n5-viewport');
  expect([workspace.x, workspace.y, workspace.width, workspace.height]).toEqual([120, 72, 1255, 1008]);

  const panel = await box(page, 'n5-panel');
  near(panel.x, 1427, 1);
  near(panel.width, 433, 1);

  const save = await box(page, 'n5-confirm-button');
  near(save.x, 1428);
  // Figma 604:5593 — [저장하러 가기] 1428/975/433×45(아래 60)
  expect([save.y, save.height]).toEqual([975, 45]);
  near(save.width, 433, 1);

  const undo = await box(page, 'n5-undo-redo');
  expect([undo.x, undo.y, undo.width, undo.height]).toEqual([144, 1001, 96, 48]);

  const zoom = await box(page, 'n5-zoom-controls');
  near(zoom.x + zoom.width, 1347, 1);
  // Figma 602:5437 — 배율 x1281 y92(작업 영역 위 20)
  near(zoom.y, 92, 1);
  near(zoom.height, 14, 1);

  // Figma에 없는 하단 중앙 도구는 없고, 좌측 하단 도구만 남는다
  await expect(page.getByTestId('n5-placement-toolbar')).toHaveCount(0);
  for (const id of ['n5-tool-text', 'n5-tool-section', 'n5-tool-delete']) await expect(page.getByTestId(id)).toHaveCount(0);

  // 데이터 scale은 그대로 두고 시작 위치만 Figma(y156)에 맞춘다
  const canvas = await box(page, 'n5-canvas');
  expect(canvas.y).toBe(156);
  expect(canvas.width).toBe(400);
  await expect(page.getByTestId('n5-canvas')).toHaveAttribute('data-zoom', '1');
  near(canvas.x + canvas.width / 2, workspace.x + workspace.width / 2, 1);
  await page.screenshot({ path: test.info().outputPath('n5-1920x1080.png') });
});

test('상단 정보는 실제 Job 값이고 Figma 위치에 있다', async ({ page }) => {
  const meta = page.getByTestId('n5-job-meta');
  // 국가 · 판매 채널(Job.channelSpecId → /master/channel-specs) · 규제 분류 · 카테고리 순서(공용 JobMetaTags)
  await expect(meta).toContainText('아마존');
  expect((await meta.locator('p, span').allTextContents()).slice(0, 3)).toEqual(['미국', '아마존', '화장품']);
  await expect(meta).not.toContainText('OTC');
  await expect(meta).not.toContainText('선크림');
  const rect = await box(page, 'n5-job-meta');
  // Figma 1507:21672 「N3 섹션 상단」 x152 y96(헤더 72 아래 24)
  expect([rect.x, rect.y]).toEqual([152, 96]);
  expect(rect.height).toBeLessThanOrEqual(29); // 채널이 더해져도 한 줄
  const workspace = await box(page, 'n5-viewport');
  expect(rect.x + rect.width).toBeLessThan(workspace.x + workspace.width);
});

test('선택 block은 글자 바깥 12px 테두리·번호·핸들 8개·글자크기 툴바를 보이고, 다른 block을 고르면 옮겨 간다', async ({ page }) => {
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(0);
  await page.getByTestId('n5-block-pin-9112').click();

  await expect(page.getByTestId('n5-block-selection-frame')).toHaveCSS('border-top-color', 'rgb(255, 106, 56)');
  await expect(page.getByTestId('n5-block-pin-9112').locator('span')).toHaveCSS('background-color', 'rgb(255, 106, 56)');
  const handles = page.locator('[data-testid^="n5-block-handle-"]');
  await expect(handles).toHaveCount(8);
  const overlay = await box(page, 'n5-block-overlay-9112');
  const frame = await box(page, 'n5-block-selection-frame');
  near(frame.x, overlay.x - 12, 1);
  near(frame.y + frame.height, overlay.y + overlay.height + 12, 1);
  const nw = await box(page, 'n5-block-handle-nw');
  const se = await box(page, 'n5-block-handle-se');
  near(nw.x + nw.width / 2, frame.x, 1);
  near(se.y + se.height / 2, frame.y + frame.height, 1);
  near(nw.width, 7.667, 0.5);

  // 따로 여는 손잡이 없이 툴바가 바로 보인다(Figma 1512:23496)
  await expect(page.getByTestId('n5-font-scale-handle')).toHaveCount(0);
  await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();

  // 번호 배지는 테두리 바깥 왼쪽 위라 손잡이를 가리지 않고, 선택된 배지는 누르는 대상이 아니다
  const pin = page.getByTestId('n5-block-pin-9112');
  await expect(pin).toHaveCSS('pointer-events', 'none');
  const badge = (await pin.locator('span').boundingBox())!;
  expect(badge.y + badge.height).toBeLessThan(nw.y);

  const firstHandle = await box(page, 'n5-block-handle-nw');
  await page.getByTestId('n5-block-pin-9103').click();
  await expect(handles).toHaveCount(8);
  expect((await box(page, 'n5-block-handle-nw')).y).not.toBe(firstHandle.y);
});

test('글자크기 버튼은 서버 요청 없이 동작하고 선택이 풀리지 않는다', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) writes.push(`${r.method()} ${r.url()}`);
  });
  await page.getByTestId('n5-block-pin-9112').click();
  for (const id of ['n5-font-scale-increase', 'n5-font-scale-decrease']) {
    await expect(page.getByTestId(id)).toBeEnabled();
    await expect(page.getByTestId(id)).not.toHaveAttribute('title');
    await page.getByTestId(id).click();
  }
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(1);
  await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
  expect(writes).toEqual([]);
});

test('글자크기 툴바 — 선택 즉시 보이고(117×34, 버튼 28×28 간격 2), 키보드로 누를 수 있고, 다른 block으로 옮겨 간다', async ({ page }) => {
  const toolbar = page.getByTestId('n5-font-scale-toolbar');
  await page.getByTestId('n5-block-pin-9112').click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toContainText('글자크기');
  const plus = await box(page, 'n5-font-scale-increase');
  const minus = await box(page, 'n5-font-scale-decrease');
  expect([plus.width, plus.height]).toEqual([28, 28]);
  near(minus.x - (plus.x + plus.width), 2, 0.5);
  const rect = await box(page, 'n5-font-scale-toolbar');
  expect([Math.round(rect.width), Math.round(rect.height)]).toEqual([117, 34]);
  await page.screenshot({ path: test.info().outputPath('n5-font-toolbar-open.png') });

  // 키보드 — Enter·Space(pan 키와 겹치지 않는다)로 누른다
  const overlay = page.getByTestId('n5-block-overlay-9112');
  const start = Number(await overlay.getAttribute('data-font-scale'));
  await page.getByTestId('n5-font-scale-increase').focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => Number(await overlay.getAttribute('data-font-scale'))).toBeGreaterThan(start);
  await page.getByTestId('n5-font-scale-decrease').focus();
  await page.keyboard.press('Space');
  await expect.poll(async () => Number(await overlay.getAttribute('data-font-scale'))).toBe(start);

  // 다른 block을 고르면 그 block 테두리 위로 옮겨 간다(툴바는 하나)
  await page.getByTestId('n5-block-pin-9103').click();
  await expect(toolbar).toHaveCount(1);
  const frame = await box(page, 'n5-block-selection-frame');
  near((await box(page, 'n5-font-scale-toolbar')).x, frame.x + 4, 1);
});

test('툴바를 눌러도 선택이 바뀌지 않고 section이 선택되지 않는다', async ({ page }) => {
  await page.getByTestId('n5-block-pin-9112').click();
  const before = await page.getByTestId('n5-section-selected-tag').textContent();
  const toolbar = await box(page, 'n5-font-scale-toolbar');
  await page.mouse.click(toolbar.x + 20, toolbar.y + 17);
  await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
  await expect(page.getByTestId('n5-block-overlay-9112')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-section-selected-tag')).toHaveText(before!);
});

test('넓은 block — 툴바가 테두리 위 왼쪽(4, -46)에 뜨고 그 자리에서 눌린다', async ({ page }) => {
  await page.getByTestId('n5-block-pin-9102').click();
  const frame = await box(page, 'n5-block-selection-frame');
  const rect = await box(page, 'n5-font-scale-toolbar');
  near(rect.x, frame.x + 4, 1);
  near(rect.y, frame.y - 46, 1);

  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="n5-font-scale-toolbar"]') !== null,
    [rect.x + rect.width - 6, rect.y + rect.height / 2],
  );
  expect(hit).toBe(true);
  await page.screenshot({ path: test.info().outputPath('n5-font-toolbar-wide.png') });
});

test('높은 block도 툴바는 테두리 위 46, 손잡이는 테두리 위에 있다', async ({ page }) => {
  // 진입부터 Auto Height 라 박스 높이 = 글 높이다 — 여러 줄 글로 높은 block 을 만든다(편집 중 글로 다시 잰다)
  const editor = page.getByTestId('n5-block-editor-9102');
  const sentence = (await editor.inputValue()).slice(0, 60);
  await editor.fill(Array.from({ length: 6 }, () => sentence).join(' '));
  // 입력칸을 고르면 그 block 이 선택된다
  await expect(page.getByTestId('n5-block-overlay-9102')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await box(page, 'n5-block-overlay-9102')).height).toBeGreaterThanOrEqual(68);
  const frame = await box(page, 'n5-block-selection-frame');
  const e = await box(page, 'n5-block-handle-e');
  near((await box(page, 'n5-font-scale-toolbar')).y, frame.y - 46, 1);
  near(e.x + e.width / 2, frame.x + frame.width, 1);
  near(e.y + e.height / 2, frame.y + frame.height / 2, 1);
});

test('zoom·pan — 툴바가 테두리와 함께 움직이고 화면 크기·간격은 그대로다', async ({ page }) => {
  await page.getByTestId('n5-block-pin-9112').click();
  const relative = async () => {
    const overlay = await box(page, 'n5-block-overlay-9112');
    const frame = await box(page, 'n5-block-selection-frame');
    const rect = await box(page, 'n5-font-scale-toolbar');
    return { rect, overlay, frame, dx: rect.x - frame.x, dy: rect.y - frame.y, pad: overlay.x - frame.x };
  };
  const start = await relative();

  await page.getByTestId('n5-zoom-in').click();
  await expect(page.getByTestId('n5-canvas')).not.toHaveAttribute('data-zoom', '1');
  const zoomed = await relative();
  expect(zoomed.overlay.width).toBeGreaterThan(start.overlay.width);
  near(zoomed.dx, 4, 1);
  near(zoomed.dy, -46, 1);
  near(zoomed.pad, 12, 1);
  near(zoomed.rect.width, 117, 1);
  near(zoomed.rect.height, 34, 1);

  const viewport = await box(page, 'n5-viewport');
  await page.mouse.move(viewport.x + 200, viewport.y + 400);
  await page.mouse.wheel(0, 80);
  await expect.poll(async () => (await relative()).rect.y).not.toBe(zoomed.rect.y);
  const panned = await relative();
  near(panned.dx, 4, 1);
  near(panned.dy, -46, 1);
  near(panned.overlay.y - zoomed.overlay.y, panned.rect.y - zoomed.rect.y, 1);
});

test('선택한 section 태그는 section 바로 위에 뜨고 canvas 크기를 바꾸지 않는다', async ({ page }) => {
  const before = await box(page, 'n5-canvas');
  await page.getByTestId('n5-section-tag-1').click();
  const tag = await box(page, 'n5-section-selected-tag');
  const slice = await box(page, 'n5-slice-translated-501');
  near(tag.y + tag.height, slice.y - 4, 1);
  expect(tag.x).toBe(slice.x);
  expect(await box(page, 'n5-canvas')).toEqual(before);
});

test('토글 전환에도 zoom·pan·선택이 유지되고 화면 구조가 그대로다', async ({ page }) => {
  await page.getByTestId('n5-zoom-in').click();
  await page.getByTestId('n5-block-pin-9112').click();
  const canvas = page.getByTestId('n5-canvas');
  const before = [await canvas.getAttribute('data-zoom'), await canvas.getAttribute('data-pan-x'), await canvas.getAttribute('data-pan-y')];
  const translated = await box(page, 'n5-view-mode-translated');
  expect([translated.width, translated.height]).toEqual([74, 30]);

  await page.getByTestId('n5-view-mode-original').click();
  await expect(page.getByTestId('n5-view-mode-original')).toHaveAttribute('aria-pressed', 'true');
  expect([await canvas.getAttribute('data-zoom'), await canvas.getAttribute('data-pan-x'), await canvas.getAttribute('data-pan-y')]).toEqual(before);
  // 선택은 유지되고, 조정 UI는 「번역 후」 화면에만 있다(F-CFM-15)
  await expect(page.getByTestId('n5-block-overlay-9112')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(0);
  await page.getByTestId('n5-view-mode-translated').click();
  await expect(page.getByTestId('n5-block-selection')).toHaveCount(1);
});

test('우측 패널 위계 — 목록만 스크롤하고 저장 버튼은 하단에 남으며 내용 폭은 433이다', async ({ page }) => {
  const panel = page.getByTestId('n5-panel');
  // 최신 Figma(1256:6916 · 1792:34899): 제목 「번역문 확인 및 수정」, 카드는 번역문 칸 · 원문 · 번역근거. 「직접 수정하기」·「번역문」 라벨은 없다
  for (const text of ['번역문 확인 및 수정', '원문', '번역근거']) await expect(panel.getByText(text, { exact: true }).first()).toBeVisible();
  for (const text of ['번역 결과', '직접 수정하기', '번역문']) await expect(panel.getByText(text, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('n5-section-tag-1')).toBeVisible();
  await expect(page.getByTestId('n5-block-save-9101')).toHaveText('확인');

  // Figma Frame 495 — 첫 Section 태그 y154(제목 y96 + 30 + 28)
  const tag = await box(page, 'n5-section-tag-1');
  near(tag.y, 154, 1);
  const editor = page.getByTestId('n5-block-editor-9101');
  const card = (await editor.locator('xpath=..').boundingBox())!;
  near(card.width, 433, 1);
  near(card.x, 1427, 1);
  const save = await box(page, 'n5-block-save-9101');
  near(save.height, 24, 1);
  near(save.x + save.width, card.x + card.width - 20, 1);
  await expect(page.getByTestId('n5-block-source-reference').first()).toHaveText('순수 비타민 C 세럼');

  const body = page.getByTestId('n5-panel-body');
  const metrics = await body.evaluate((el) => ({ overflow: el.scrollHeight > el.clientHeight, sideways: el.scrollWidth > el.clientWidth }));
  expect(metrics).toEqual({ overflow: true, sideways: false });
  const confirmBefore = await box(page, 'n5-confirm-button');
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await box(page, 'n5-confirm-button')).toEqual(confirmBefore);
  // 끝까지 내리면 마지막 블록이 페이드에 가려지지 않고 번역근거 박스까지 보인다
  const lastBox = (await page.getByTestId('n5-panel-fade').boundingBox())!;
  const lastEvidence = (await page.getByTestId('n5-block-evidence-card').last().boundingBox())!;
  expect(lastEvidence.y + lastEvidence.height).toBeLessThanOrEqual(lastBox.y + 1);
});

for (const size of [
  { width: 1512, height: 860 },
  { width: 1440, height: 800 },
]) {
  test(`${size.width}×${size.height} — 도구와 저장 버튼이 잘리지 않는다`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const id of ['n5-undo-redo', 'n5-zoom-controls', 'n5-confirm-button', 'n5-job-meta']) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const tag = page.getByTestId('n5-section-tag-1');
    await tag.click();
    await expect(page.getByTestId('n5-section-selected-tag')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: test.info().outputPath(`n5-${size.width}.png`) });
  });
}
