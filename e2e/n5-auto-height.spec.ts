import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 Auto Height(Figma Text의 Auto height)와 Mock 조판 미리보기(?qaTypeset=1).
// 폭을 바꾸면 조판 규칙대로 다시 줄바꿈되고, 그 줄 수에 맞춰 박스 높이가 따라온다. 글자를 줄이거나 자르지 않는다.
// 값 비교는 overlay 의 section-local style(표시 px)로 한다. zoom 1 이라 화면 글 높이와 바로 비교할 수 있다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '조판 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const QA_URL = `/jobs/${MOCK_JOB_ID}?qaTypeset=1`;
const BLOCK = 9102; // 501 body, 폭 900 × 높이 200
type Box = { left: number; top: number; width: number; height: number };

const boxOf = (page: Page, id = BLOCK) =>
  page.getByTestId(`n5-block-overlay-${id}`).evaluate((el): Box => {
    const { left, top, width, height } = (el as HTMLElement).style;
    return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) };
  });

/** 실제로 그려진 조판 블록의 줄 수 — 브라우저가 줄바꿈한 결과를 Range 로 읽는다 */
const lineCount = (page: Page, id = BLOCK) =>
  page.locator(`[data-typeset-render="${id}"]`).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });

/** 조판 블록의 실제 글 높이(화면 px) */
const textHeight = (page: Page, id = BLOCK) =>
  page.locator(`[data-typeset-render="${id}"]`).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().height;
  });

async function dragHandle(page: Page, key: string, dx: number, dy: number, hold?: () => Promise<void>) {
  const h = (await page.getByTestId(`n5-block-handle-${key}`).boundingBox())!;
  const x = h.x + h.width / 2;
  const y = h.y + h.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await hold?.();
  await page.mouse.up();
}

const near = (a: number, b: number, label = '', tolerance = 0.6) => expect(Math.abs(a - b), `${label} ${a} ≈ ${b}`).toBeLessThanOrEqual(tolerance);
const sameBox = (a: Box, b: Box) => {
  for (const key of ['left', 'top', 'width', 'height'] as const) near(a[key], b[key], key, 0.02);
};

function recordWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/jobs')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return writes;
}

async function openQa(page: Page) {
  await page.goto(QA_URL);
  await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`n5-block-pin-${BLOCK}`).click();
  await expect(page.getByTestId('n5-block-selection')).toHaveAttribute('data-auto-height', 'true');
}

test.describe('Auto Height', () => {
  test('가로 손잡이 — 끄는 동안 줄바꿈과 높이가 따라오고 위쪽·왼쪽은 그대로이며, 한 번이 한 단계다', async ({ page }) => {
    const writes = recordWrites(page);
    await openQa(page);
    const start = await boxOf(page);
    const undo = page.getByTestId('n5-undo');
    const redo = page.getByTestId('n5-redo');

    // 좁히면 줄이 늘고 높이가 늘어난다. 손을 놓기 전에 이미 바뀌어 있어야 한다
    let during: Box | null = null;
    let duringLines = 0;
    await dragHandle(page, 'e', -180, 25, async () => {
      during = await boxOf(page);
      duringLines = await lineCount(page);
    });
    const narrow = await boxOf(page);
    const narrowLines = await lineCount(page);
    expect(during!.width).toBeLessThan(start.width);
    sameBox(during!, narrow);
    expect(duringLines).toBe(narrowLines);
    near(narrow.left, start.left);
    near(narrow.top, start.top); // 세로 이동은 쓰지 않는다
    // 높이 = 실제 줄 높이 합(글자 수 추정이 아니다)
    near(narrow.height, await textHeight(page), 'height', 1);
    await page.screenshot({ path: test.info().outputPath('auto-height-narrow.png') });

    // 넓히면 줄이 줄고 높이도 준다
    await dragHandle(page, 'e', 120, 0);
    const wider = await boxOf(page);
    const widerLines = await lineCount(page);
    expect(widerLines).toBeLessThan(narrowLines);
    expect(wider.height).toBeLessThan(narrow.height);
    near(wider.top, start.top);
    await page.screenshot({ path: test.info().outputPath('auto-height-wide.png') });

    // Undo·Redo 는 폭과 높이를 그대로 되돌린다
    await undo.click();
    sameBox(await boxOf(page), narrow);
    await undo.click();
    sameBox(await boxOf(page), start);
    await expect(undo).toBeDisabled();
    await redo.click();
    sameBox(await boxOf(page), narrow);
    await redo.click();
    sameBox(await boxOf(page), wider);
    expect(writes).toEqual([]);
  });

  test('한 줄로 낮아져도 오른쪽 손잡이를 다시 잡아 넓힐 수 있고 글자크기 손잡이도 눌린다', async ({ page }) => {
    await page.goto(QA_URL);
    await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
    const short = 9103; // 가격 한 줄, 폭 300
    await page.getByTestId(`n5-block-pin-${short}`).click();
    await dragHandle(page, 'e', 40, 0);
    const low = await boxOf(page, short);
    expect(await lineCount(page, short)).toBe(1);
    expect(low.height).toBeLessThan(68);
    await dragHandle(page, 'e', 20, 0);
    near((await boxOf(page, short)).width, low.width + 20, 'width', 1);
    await page.getByTestId('n5-font-scale-handle').click();
    await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
  });

  test('왼쪽 손잡이 — 오른쪽 변과 위쪽이 고정되고 높이가 다시 맞는다', async ({ page }) => {
    await openQa(page);
    const start = await boxOf(page);
    await dragHandle(page, 'w', 150, 0);
    const now = await boxOf(page);
    near(now.left + now.width, start.left + start.width);
    near(now.top, start.top);
    near(now.height, await textHeight(page), 'height', 1);
  });

  test('모서리 — 세로로 끌어도 높이는 줄바꿈 결과가 정본이고 위쪽은 그대로다', async ({ page }) => {
    await openQa(page);
    await dragHandle(page, 'e', -100, 0);
    const base = await boxOf(page);
    for (const key of ['se', 'ne', 'nw', 'sw']) {
      await dragHandle(page, key, key.includes('e') ? -10 : 10, key.includes('n') ? -40 : 40);
      const now = await boxOf(page);
      near(now.top, base.top, `${key} top`);
      near(now.height, await textHeight(page), `${key} height`, 1);
    }
  });

  test('세로 손잡이 — 보이지만 끌리지 않고 이력도 남지 않는다', async ({ page }) => {
    await openQa(page);
    const start = await boxOf(page);
    for (const key of ['n', 's']) {
      await expect(page.getByTestId(`n5-block-handle-${key}`)).toBeVisible();
      await dragHandle(page, key, 0, key === 'n' ? -30 : 30);
      sameBox(await boxOf(page), start);
    }
    await expect(page.getByTestId('n5-undo')).toBeDisabled();
  });

  test('글자 크기 — 같은 폭에서 다시 줄바꿈한 높이가 되고, Undo 로 박스와 배율이 함께 돌아간다', async ({ page }) => {
    await openQa(page);
    await dragHandle(page, 'e', -180, 0);
    const before = await boxOf(page);
    await page.getByTestId('n5-font-scale-handle').click();
    await page.getByTestId('n5-font-scale-increase').click();
    const after = await boxOf(page);
    near(after.width, before.width * 1.05, 'width');
    near(after.left, before.left);
    near(after.top, before.top);
    near(after.height, await textHeight(page), 'height', 1);
    await page.screenshot({ path: test.info().outputPath('auto-height-font.png') });
    await page.getByTestId('n5-undo').click();
    sameBox(await boxOf(page), before);
    await expect(page.getByTestId(`n5-block-overlay-${BLOCK}`)).toHaveAttribute('data-font-scale', '1');
  });

  test('번역문 저장 — 다시 줄바꿈해 높이가 바뀌고 서버에는 글만 가며, Undo 로 글과 박스가 함께 돌아간다', async ({ page }) => {
    const bodies: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && /\/blocks\/\d+$/.test(r.url())) bodies.push(r.postDataJSON());
    });
    await openQa(page);
    await dragHandle(page, 'e', -100, 0);
    const before = await boxOf(page);
    const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
    const original = await editor.inputValue();
    const long = `${original} ${original} ${original}`;
    await editor.fill(long);
    await page.getByTestId(`n5-block-save-${BLOCK}`).click();
    await expect.poll(async () => (await boxOf(page)).height).toBeGreaterThan(before.height);
    const after = await boxOf(page);
    near(after.width, before.width);
    near(after.top, before.top);
    expect(Object.keys(bodies[0] as object).sort()).toEqual(['revision', 'trans1']);

    await page.getByTestId('n5-undo').click();
    await expect(editor).toHaveValue(original);
    sameBox(await boxOf(page), before);
    await page.getByTestId('n5-redo').click();
    await expect(editor).toHaveValue(long);
    sameBox(await boxOf(page), after);
  });

  test('section 아래로 넘치면 박스는 경계까지만 늘고 글은 그대로 보이며 넘침을 알린다', async ({ page }) => {
    await openQa(page);
    const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
    await editor.fill(Array.from({ length: 60 }, () => 'A long translated sentence for overflow check.').join(' '));
    await page.getByTestId(`n5-block-save-${BLOCK}`).click();
    await expect(page.getByTestId('n5-block-selection')).toHaveAttribute('data-auto-height-overflow', 'true');
    await expect(page.getByTestId('n5-qa-overflow')).toBeVisible();
    const now = await boxOf(page);
    const sectionHeight = (await page.getByTestId('n5-slice-translated-501').boundingBox())!.height;
    near(now.top + now.height, sectionHeight, 'bottom', 1);
    expect(await textHeight(page)).toBeGreaterThan(now.height);
    // 넘친 글이 다음 section 면에 가리지 않는다
    await expect(page.getByTestId('n5-qa-text-layer-501')).toHaveCSS('z-index', '1');
    await page.screenshot({ path: test.info().outputPath('auto-height-overflow.png') });
  });

  test('글이 비어 재지 못하는 block은 8방향 자유 조절을 그대로 쓴다', async ({ page }) => {
    await page.goto(QA_URL);
    await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('n5-fit-height').click();
    const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
    await editor.fill(''); // 입력칸을 고르면 그 block이 선택된다
    await expect(page.getByTestId('n5-block-selection')).toHaveAttribute('data-auto-height', 'false');
    const start = await boxOf(page);
    await dragHandle(page, 's', 0, -20);
    expect((await boxOf(page)).height).toBeLessThan(start.height);
  });
});

test.describe('Mock 조판 미리보기', () => {
  test('글자 없는 면 위에 실제 조판 블록을 그리고 조작을 막지 않으며, 작성 중 초안을 보여 준다', async ({ page }) => {
    await page.goto(QA_URL);
    await expect(page.getByTestId('n5-qa-badge')).toContainText('Mock 조판 미리보기');
    // 렌더 이미지를 쓰지 않는다(이중 글자 방지)
    const slice = page.getByTestId('n5-slice-translated-501');
    await expect(slice).toHaveCSS('background-image', 'none');
    const block = page.locator(`[data-typeset-render="${BLOCK}"]`);
    await expect(block).toContainText('high-concentration');
    const font = await block.evaluate((el) => ({ family: getComputedStyle(el).fontFamily, lineHeight: (el as HTMLElement).style.lineHeight, whiteSpace: getComputedStyle(el).whiteSpace }));
    expect(font.family).toContain('Pretendard');
    expect(font.lineHeight).toBe('1.2');
    expect(font.whiteSpace).toBe('pre-line');
    // 글자는 이벤트를 받지 않는다
    await expect(page.getByTestId('n5-qa-text-layer-501')).toHaveCSS('pointer-events', 'none');
    await page.getByTestId(`n5-block-pin-${BLOCK}`).click();
    await expect(page.getByTestId(`n5-block-row-${BLOCK}`)).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId(`n5-block-editor-${BLOCK}`).fill('Draft text only');
    await expect(block).toHaveText('Draft text only');
    await page.screenshot({ path: test.info().outputPath('qa-preview.png') });
  });

  test('「번역 전」에는 조판 글자를 그리지 않는다', async ({ page }) => {
    await page.goto(QA_URL);
    await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('n5-view-mode-original').click();
    await expect(page.getByTestId('n5-qa-badge')).toHaveCount(0);
    await expect(page.locator('[data-typeset-render]')).toHaveCount(0);
  });

  test('주소에 값이 없으면 기존 N5 그대로이고 조판 글자가 없다', async ({ page }) => {
    await page.goto(`/jobs/${MOCK_JOB_ID}?qaTypeset=1`);
    await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => history.replaceState(history.state, '', location.pathname));
    await page.reload();
    await expect(page.locator('[data-typeset-render]')).toHaveCount(0);
    await expect(page.getByTestId('n5-qa-badge')).toHaveCount(0);
  });
});
