import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { enableN5GeneralHistoryForTest } from './helpers/n5-general-history';

// 보존한 일반 실행 취소·다시 실행 검증 — 12월 화면에서는 숨겼으므로 Mock 전용 스위치를 켠다(e2e/helpers/n5-general-history.ts)
test.beforeEach(async ({ page }) => {
  await enableN5GeneralHistoryForTest(page);
});

// ─────────────────────────────────────────────────────────────────
// N5 디자인 정합 1단계(Figma 544:3168 · 1860:48192 · 1821:49608 · 1898:45690 · 1898:36665) — Chromium Mock.
//   번호 배지 — 기본 #171717 · 선택 #FF6A38 · 제외 섹션 #F5F5F5(좌우 같은 번호)
//   [제외하기] — 섹션에 올렸을 때만 보인다(키보드 포커스 포함)
//   N5 제외 — 우측 그룹 회색·수정 막힘, 되돌려도 저장된 번역문은 그대로, 번역 전에서도 같은 제외 표시
//   전 섹션 제외 — [저장하러 가기] 비활성(#F5F5F5 · #999) + 버튼 위 안내. 하나 되돌리면 풀린다
//   제품 라벨(F-CFM-01) — 개별 카드 없이 그룹 헤더 요약, 요약 ↔ 캔버스 라벨 연결
// mock: 501(9101 · 9102 · 9111) · 502(9103 · 9104 · 9112, 제품 라벨 9105) · 503(시작부터 N5 제외) · 504 · 505
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const BLACK = 'rgb(23, 23, 23)';
const ORANGE = 'rgb(255, 106, 56)';
const SUBTLE = 'rgb(245, 245, 245)';
const GRAY_TEXT = 'rgb(153, 153, 153)';

const badgeColor = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .locator('span')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
const panelBadgeColor = (page: Page, blockId: number) =>
  page
    .getByTestId(`n5-block-row-${blockId}`)
    .getByTestId('n5-block-number')
    .evaluate((el) => getComputedStyle(el).backgroundColor);

test.beforeEach(async ({ page }) => {
  await reachN5(page);
  await expect(page.getByTestId('n5-viewport')).toBeVisible();
});

test('번호 배지 — 기본 검정·선택 주황, 좌우 같은 번호 · 선택 섹션 태그는 주황 테두리', async ({ page }) => {
  expect(await badgeColor(page, 'n5-block-pin-9102')).toBe(BLACK);
  expect(await panelBadgeColor(page, 9102)).toBe(BLACK);
  await expect(page.getByTestId('n5-block-pin-9102')).toHaveText('2');
  await expect(page.getByTestId('n5-block-row-9102').getByTestId('n5-block-number')).toHaveText('2');

  await page.getByTestId('n5-block-pin-9102').click();
  await expect(page.getByTestId('n5-block-row-9102')).toHaveAttribute('aria-pressed', 'true');
  expect(await badgeColor(page, 'n5-block-pin-9102')).toBe(ORANGE);
  expect(await panelBadgeColor(page, 9102)).toBe(ORANGE);
  expect(await panelBadgeColor(page, 9101)).toBe(BLACK);
  await expect(page.getByTestId('n5-section-tag-1')).toHaveCSS('border-top-color', ORANGE);
  await expect(page.getByTestId('n5-section-tag-2')).not.toHaveCSS('border-top-color', ORANGE);
});

test('[제외하기]는 섹션에 올렸을 때만 보이고(81×30 · 오른쪽 위 12), 키보드 포커스로도 보인다', async ({ page }) => {
  const wrapOpacity = () => page.getByTestId('n5-section-exclude-501').evaluate((el) => getComputedStyle(el.parentElement!).opacity);
  await page.mouse.move(1600, 600);
  await expect.poll(wrapOpacity).toBe('0');
  await page.getByTestId('n5-slice-translated-501').hover({ position: { x: 100, y: 200 } });
  await expect.poll(wrapOpacity).toBe('1');
  const slice = (await page.getByTestId('n5-slice-translated-501').boundingBox())!;
  const button = (await page.getByTestId('n5-section-exclude-501').boundingBox())!;
  expect(Math.round(button.height)).toBe(30);
  expect(Math.abs(button.width - 81)).toBeLessThanOrEqual(1);
  expect(Math.round(slice.x + slice.width - (button.x + button.width))).toBe(12);
  expect(Math.round(button.y - slice.y)).toBe(12);

  await page.mouse.move(1600, 600);
  await expect.poll(wrapOpacity).toBe('0');
  await page.getByTestId('n5-section-exclude-501').focus();
  await expect.poll(wrapOpacity).toBe('1');
});

test('N5 제외 — 우측 그룹 회색·수정 막힘 · 번역 전에서도 같은 제외 표시 · 되돌리면 저장된 번역문 그대로 다시 편집된다', async ({ page }) => {
  const editor = page.getByTestId('n5-block-editor-9101');
  const savedText = await editor.inputValue();
  await page.getByTestId('n5-section-exclude-501').click();
  await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();

  // 오버레이 — 섹션 크기 그대로 · #707070 24% · 블러 4px · 가운데 「저장 시 제외됩니다」 모달
  const overlay = page.getByTestId('n5-section-excluded-501');
  await expect(overlay).toHaveCSS('background-color', 'rgba(112, 112, 112, 0.24)');
  await expect(overlay).toHaveCSS('opacity', '1');
  const card = (await page.getByTestId('n5-section-excluded-card-501').boundingBox())!;
  const sliceBox = (await page.getByTestId('n5-slice-translated-501').boundingBox())!;
  expect(Math.abs(card.x + card.width / 2 - (sliceBox.x + sliceBox.width / 2))).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('n5-section-restore-501')).toHaveCSS('background-color', BLACK);

  // 우측 그룹 — 태그 Disabled · 번호 #F5F5F5 · 번역문 읽기 전용 · [확인] 비활성
  await expect(page.getByTestId('n5-section-tag-1')).toHaveAttribute('data-excluded', 'true');
  expect(await panelBadgeColor(page, 9101)).toBe(SUBTLE);
  await expect(editor).toHaveAttribute('readonly', '');
  await expect(editor).toHaveCSS('color', GRAY_TEXT);
  await editor.click();
  await page.keyboard.type('X');
  await expect(editor).toHaveValue(savedText);
  await expect(page.getByTestId('n5-block-save-9101')).toBeDisabled();
  // 제외 그룹의 행을 눌러도 캔버스에 없는 글 박스를 고르지 않고 그 섹션을 고른다
  await page.getByTestId('n5-block-row-9102').click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId('n5-section-tag-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-row-9102')).toHaveAttribute('aria-pressed', 'false');
  // 다른 섹션은 그대로 편집된다
  await expect(page.getByTestId('n5-block-editor-9103')).not.toHaveAttribute('readonly', '');

  // 번역 전에서도 같은 제외 표시
  await page.getByTestId('n5-view-mode-original').click();
  await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
  await page.getByTestId('n5-view-mode-translated').click();

  // 되돌리기 — 저장된 번역문은 그대로, 다시 편집된다
  await page.getByTestId('n5-section-restore-501').click();
  await expect(page.getByTestId('n5-section-excluded-501')).toHaveCount(0);
  await expect(editor).toHaveValue(savedText);
  await expect(editor).not.toHaveAttribute('readonly', '');
  expect(await panelBadgeColor(page, 9101)).toBe(BLACK);
});

test('전 섹션 제외 — [저장하러 가기] 비활성 + 버튼 위 안내(1898:46613), 하나 되돌리면 다시 활성', async ({ page }) => {
  const confirm = page.getByTestId('n5-confirm-button');
  await expect(confirm).toBeEnabled();
  await expect(page.getByTestId('n5-confirm-blocked-notice')).toHaveCount(0);
  for (const id of [501, 502, 504, 505]) {
    await page.getByTestId(`n5-section-exclude-${id}`).dispatchEvent('click');
    await expect(page.getByTestId(`n5-section-excluded-${id}`)).toBeVisible();
  }
  const notice = page.getByTestId('n5-confirm-blocked-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText('모든 섹션이 제외되었습니다저장하려면 섹션을 하나 이상 되돌려 주세요');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveCSS('background-color', SUBTLE);
  await expect(confirm).toHaveCSS('color', GRAY_TEXT);
  // 안내는 버튼 바로 위 가운데(Figma 1537/921/213×54)
  const n = (await notice.boundingBox())!;
  const c = (await confirm.boundingBox())!;
  expect(Math.round(n.y + n.height)).toBe(Math.round(c.y));
  expect(Math.abs(n.x + n.width / 2 - (c.x + c.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.round(n.height)).toBe(54);

  await page.getByTestId('n5-section-restore-504').dispatchEvent('click');
  await expect(page.getByTestId('n5-section-excluded-504')).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  await expect(confirm).toBeEnabled();
  await expect(confirm).toHaveCSS('background-color', BLACK);
});

test('제품 라벨 — 개별 카드 없이 그룹 헤더 요약 · 요약은 캔버스 라벨을 강조하고, 캔버스 라벨은 요약으로 간다', async ({ page }) => {
  // 9105(role=product_label · isExcluded=true)는 번역 카드가 없다
  await expect(page.getByTestId('n5-block-row-9105')).toHaveCount(0);
  const summary = page.getByTestId('n5-product-label-summary-2');
  await expect(summary).toHaveText('제품 라벨 1개 — 원본 유지');
  await expect(page.getByTestId('n5-product-label-summary-1')).toHaveCount(0);
  const label = page.getByTestId('n5-product-label-9105');
  await expect(label).toHaveAttribute('data-highlighted', 'false');

  await summary.click();
  await expect(label).toHaveAttribute('data-highlighted', 'true');
  await expect(summary).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-section-tag-2')).toHaveAttribute('aria-pressed', 'true');
  // 캔버스가 첫 라벨을 보이게 한다
  await expect(label).toBeInViewport();

  // 다른 블록을 고르면 강조가 풀린다
  await page.getByTestId('n5-block-pin-9101').dispatchEvent('click');
  await expect(label).toHaveAttribute('data-highlighted', 'false');

  // 캔버스 라벨 → 패널의 그 섹션 요약으로 간다(포커스)
  await page.getByTestId('n5-panel-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await label.dispatchEvent('click');
  await expect(summary).toBeFocused();
  await expect(summary).toBeInViewport();
  await expect(label).toHaveAttribute('data-highlighted', 'true');
});

// ── F-CFM-13 ④ — 왼쪽 글 박스 클릭 → 오른쪽 그 번역문 칸에 입력 포커스 ──────────────────
const activeTestId = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null);

async function dragFrom(page: Page, testId: string, dx: number, dy: number, at = { x: 0.4, y: 0.6 }) {
  const b = (await page.getByTestId(testId).boundingBox())!;
  const from = { x: b.x + b.width * at.x, y: b.y + b.height * at.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  await page.mouse.up();
}

test('글 박스 클릭·Enter → 그 번역문 칸에 포커스 · 패널은 nearest 이동만 · 선택 상태 그대로', async ({ page }) => {
  // 클릭
  await page.getByTestId('n5-block-overlay-9102').click();
  await expect(page.getByTestId('n5-block-row-9102')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('n5-block-editor-9102')).toBeFocused();
  await expect(page.getByTestId('n5-block-editor-9102')).toBeInViewport();
  expect(await badgeColor(page, 'n5-block-pin-9102')).toBe(ORANGE);

  // 키보드 — 캔버스 글 박스에서 Enter 로 골라도 같다
  await page.getByTestId('n5-block-overlay-9101').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('n5-block-editor-9101')).toBeFocused();

  // 패널 밖 block — 패널은 그 row 로 nearest 이동하고 포커스가 들어간다
  await page.getByTestId('n5-panel-body').evaluate((el) => (el.scrollTop = 0));
  await page.getByTestId('n5-block-pin-9110').dispatchEvent('click');
  await expect(page.getByTestId('n5-block-editor-9110')).toBeFocused();
  await expect.poll(async () => {
    const body = (await page.getByTestId('n5-panel-body').boundingBox())!;
    const editor = (await page.getByTestId('n5-block-editor-9110').boundingBox())!;
    return editor.y >= body.y && editor.y + editor.height <= body.y + body.height;
  }).toBe(true);
});

test('번역문 칸 입력 중 Space·Ctrl/⌘+Z·Shift+Z 는 칸 안에서만 동작하고 캔버스 pan·실행 취소를 부르지 않는다', async ({ page }) => {
  // 실행 취소할 캔버스 편집 하나를 만든다(섹션 제외 — 서버 저장)
  await page.getByTestId('n5-section-exclude-504').dispatchEvent('click');
  await expect(page.getByTestId('n5-section-excluded-504')).toBeVisible();
  await expect(page.getByTestId('n5-undo')).toBeEnabled();

  await page.getByTestId('n5-block-overlay-9102').click();
  const editor = page.getByTestId('n5-block-editor-9102');
  await expect(editor).toBeFocused();
  const original = await editor.inputValue();
  const pan = await page.getByTestId('n5-canvas').evaluate((el) => `${el.getAttribute('data-pan-x')},${el.getAttribute('data-pan-y')}`);
  const cursor = () => page.getByTestId('n5-viewport').evaluate((el) => getComputedStyle(el).cursor);

  // Space 는 글자로 들어가고 캔버스 끌기 모드(grab)가 되지 않는다
  await page.keyboard.down('Space');
  expect(await cursor()).not.toBe('grab');
  await page.keyboard.up('Space');
  await expect(editor).toHaveValue(`${original} `);
  await expect(page.getByTestId('n5-block-unsaved-9102')).toBeVisible();

  // Ctrl/⌘+Z 는 칸의 글자 실행 취소 — 캔버스의 섹션 제외는 그대로다
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(original);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveValue(`${original} `);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(original);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('n5-section-excluded-504')).toBeVisible();
  expect(await page.getByTestId('n5-canvas').evaluate((el) => `${el.getAttribute('data-pan-x')},${el.getAttribute('data-pan-y')}`)).toBe(pan);

  // 칸 밖(작업 영역 빈 곳)을 누른 뒤에는 같은 단축키가 캔버스 실행 취소다
  const viewport = (await page.getByTestId('n5-viewport').boundingBox())!;
  await page.mouse.click(viewport.x + 60, viewport.y + viewport.height / 2);
  await expect(editor).not.toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('n5-section-excluded-504')).toHaveCount(0);
});

test('끌기·크기 조정·제외하기는 번역문 칸으로 입력 포커스를 옮기지 않는다', async ({ page }) => {
  // 선택되지 않은 글 박스를 바로 끌기 — 선택은 되지만 포커스는 번역문 칸으로 가지 않는다
  await dragFrom(page, 'n5-block-overlay-9102', 24, 10);
  await expect(page.getByTestId('n5-block-row-9102')).toHaveAttribute('aria-pressed', 'true');
  expect(await activeTestId(page)).not.toBe('n5-block-editor-9102');
  await expect(page.locator('textarea:focus')).toHaveCount(0);

  // 선택된 글 박스의 크기 조정 손잡이
  const handle = (await page.getByTestId('n5-block-handle-se').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 20, handle.y + 12, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('textarea:focus')).toHaveCount(0);

  // 제외하기
  await page.getByTestId('n5-slice-translated-502').hover({ position: { x: 300, y: 40 } });
  await page.getByTestId('n5-section-exclude-502').click();
  await expect(page.getByTestId('n5-section-excluded-502')).toBeVisible();
  await expect(page.locator('textarea:focus')).toHaveCount(0);
});

// ── 2단계 — 셀 상태 · 인식 실패(F-CFM-05 · PL-26 · Figma 1893:68634) ──────────────────────────
test('인식 실패(empty_block + 원문 없음) — 원문 카드 없음 · 번역문 칸 입력 불가 · 「글자를 읽지 못했습니다」 · 근거 없음', async ({ page }) => {
  const row = page.getByTestId('n5-block-row-9108');
  const editor = page.getByTestId('n5-block-editor-9108');
  await editor.scrollIntoViewIfNeeded();
  await expect(row.getByTestId('n5-cell-failure-recognition')).toHaveText('글자를 읽지 못했습니다 — 필요하면 이 섹션을 제외하세요');
  await expect(editor).toHaveAttribute('readonly', '');
  await expect(editor).toHaveAttribute('placeholder', '인식된 텍스트가 없습니다.');
  await editor.click();
  await page.keyboard.type('abc');
  await expect(editor).toHaveValue('');
  await expect(page.getByTestId('n5-block-save-9108')).toBeDisabled();
  await expect(row.getByTestId('n5-block-source-reference-card')).toHaveCount(0);
  await expect(row.getByTestId('n5-block-evidence')).toHaveText('원문을 읽지 못해 번역 근거가 없습니다.');
  // 원문 신호는 번역문 경고 칩으로 다시 보이지 않는다
  await expect(page.getByTestId('n5-block-signal-9108-empty_block')).toHaveCount(0);
  // 번역 실패와 다르다 — 번역 실패 문구·직접 입력 안내가 없다
  await expect(row.getByTestId('n5-cell-failure-translate')).toHaveCount(0);
});

// ── 4단계 — 저장 정책(F-CFM-09 · Figma 1657:10490) ─────────────────────────────────────────
test('저장하지 않은 번역문 — [저장하러 가기]가 자동 저장하지 않고 확인창 「저장되지 않은 번역문」 · 돌아가면 그대로 · 저장하러 가기는 이전 문장으로 confirm', async ({ page }) => {
  const DRAFT = 'Unsaved draft — not saved';
  const blockPatches: string[] = [];
  let confirms = 0;
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (req.method() === 'PATCH' && /\/blocks\/\d+$/.test(path)) blockPatches.push(req.postData() ?? '');
    if (req.method() === 'POST' && path.endsWith('/confirm')) confirms += 1;
  });
  const editor = page.getByTestId('n5-block-editor-9101');
  const saved = await editor.inputValue();
  await editor.fill(DRAFT);
  await expect(page.getByTestId('n5-block-unsaved-9101')).toBeVisible();

  await page.getByTestId('n5-confirm-button').click();
  const dialog = page.getByTestId('n5-review-dialog');
  await expect(dialog).toBeVisible();
  const group = page.getByTestId('n5-review-group-unsaved-translation');
  await expect(group.locator('h3')).toHaveText('저장되지 않은 번역문');
  await expect(page.getByTestId('n5-review-count-unsaved-translation')).toHaveText('1건');
  await expect(group).toContainText('섹션 1 -1');
  await expect(group).toContainText('저장 이전 문장으로 들어갑니다');
  // 총건수 = 보이는 항목 수(예시 숫자를 쓰지 않는다)
  const items = await dialog.locator('[data-review-issue]').count();
  await expect(page.getByTestId('n5-review-total')).toHaveText(`${items}건`);
  await page.waitForTimeout(500);
  expect(blockPatches).toEqual([]);

  // 돌아가서 확인하기 — 모달만 닫히고 초안·미저장 표시는 그대로, 요청 없음
  await page.getByTestId('n5-review-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(editor).toHaveValue(DRAFT);
  await expect(page.getByTestId('n5-block-unsaved-9101')).toBeVisible();
  expect(confirms).toBe(0);

  // 저장하러 가기 — 초안을 저장하지 않고 confirm 1회(서버에 저장된 이전 문장으로 확정)
  await page.getByTestId('n5-confirm-button').click();
  await page.getByTestId('n5-review-continue').click();
  await expect.poll(() => confirms, { timeout: 20_000 }).toBe(1);
  expect(blockPatches.filter((body) => body.includes(DRAFT))).toEqual([]);
  expect(saved).not.toBe(DRAFT);
});
