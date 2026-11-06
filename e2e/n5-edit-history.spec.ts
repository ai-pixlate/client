import { type Page, test, expect } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { reachN5 } from './helpers/reach-n5';
import { useLocalLayoutEditing } from './helpers/layout-write';

// ─────────────────────────────────────────────────────────────────
// N5 통합 편집 이력(F-CFM-03) + 글자 크기 [+][-](F-CFM-15 2차).
//
// 번역문·섹션은 기존 PATCH 로 저장하고 성공한 뒤에만 pointer 가 움직인다. 박스·글자 배율은 세션 local 이다.
// 박스 값은 화면 위치가 아니라 overlay 의 section-local style 로 비교한다 — 섹션을 제외하면 상태 공간이 사라져 화면 위치가
// 함께 움직일 수 있어서다.
// 실패·지연은 MSW 가 응답하기 전에 window.fetch 를 감싸 만든다(e2e/n5-confirm.spec.ts 참고).
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

// 박스·배율은 세션 local 편집만 본다 — Mock 에서도 layoutAdjust 쓰기를 끈다(실서버 쓰기 차단과 같은 동작). 저장 흐름은 n5-layout-adjust.spec.ts
test.beforeEach(async ({ page }) => {
  await useLocalLayoutEditing(page);
});

const NOTICE = {
  undo: '실행 취소를 하지 못했습니다. 현재 상태를 유지합니다.',
  redo: '재실행하지 못했습니다. 현재 상태를 유지합니다.',
};

type LocalBox = { left: number; top: number; width: number; height: number };

const localBox = (page: Page, blockId: number) =>
  page.getByTestId(`n5-block-overlay-${blockId}`).evaluate((el): LocalBox => {
    const { left, top, width, height } = (el as HTMLElement).style;
    return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), height: parseFloat(height) };
  });

function expectSameBox(actual: LocalBox, expected: LocalBox) {
  for (const key of ['left', 'top', 'width', 'height'] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${key}: ${actual[key]} ≈ ${expected[key]}`).toBeLessThanOrEqual(0.01);
  }
}

const fontScale = (page: Page, blockId: number) => page.getByTestId(`n5-block-overlay-${blockId}`).getAttribute('data-font-scale');

async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

async function dragBody(page: Page, blockId: number, dx: number, dy: number) {
  const b = (await page.getByTestId(`n5-block-overlay-${blockId}`).boundingBox())!;
  await drag(page, b.x + b.width * 0.4, b.y + b.height * 0.6, dx, dy);
}

async function dragHandle(page: Page, key: string, dx: number, dy: number) {
  const h = (await page.getByTestId(`n5-block-handle-${key}`).boundingBox())!;
  // 오른쪽 변 손잡이는 낮은 block에서 action handle과 겹친다 — 그 옆을 잡는다(누르는 영역 안)
  await drag(page, h.x + h.width / 2 + (key.includes('e') ? 6.5 : 0), h.y + h.height / 2, dx, dy);
}

async function selectWithToolbar(page: Page, blockId: number) {
  await page.getByTestId(`n5-block-pin-${blockId}`).click();
  await page.getByTestId('n5-font-scale-handle').click();
  await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
}

async function saveTranslation(page: Page, blockId: number, text: string) {
  await page.getByTestId(`n5-block-editor-${blockId}`).fill(text);
  await page.getByTestId(`n5-block-save-${blockId}`).click();
  await expect(page.getByTestId(`n5-block-save-${blockId}`)).toHaveText('확인');
  await expect(page.getByTestId(`n5-block-save-${blockId}`)).toBeDisabled();
}

type Patch = { path: string; body: Record<string, unknown> };

function trackPatches(page: Page) {
  const patches: Patch[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PATCH') patches.push({ path: new URL(req.url()).pathname.replace(`/jobs/${MOCK_JOB_ID}`, ''), body: req.postDataJSON() });
  });
  return patches;
}

/** 조건에 맞는 PATCH 를 제어한다 — window.__patchMode: 'pass' | 'fail' | 숫자(그만큼 지연). fetch 호출 수도 센다 */
async function controlPatches(page: Page, pattern: 'blocks' | 'sections') {
  await page.evaluate((pattern) => {
    const w = window as unknown as { __patchMode: 'pass' | 'fail' | number; __patchCalls: number };
    w.__patchMode = 'pass';
    w.__patchCalls = 0;
    const originalFetch = window.fetch.bind(window);
    const matcher = new RegExp(`/${pattern}/\\d+$`);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method !== 'PATCH' || !matcher.test(url)) return originalFetch(input, init);
      w.__patchCalls += 1;
      const mode = w.__patchMode;
      if (mode === 'fail') {
        return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'mock 실패', retryable: true, traceId: 't' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (typeof mode === 'number') await new Promise((resolve) => setTimeout(resolve, mode));
      return originalFetch(input, init);
    };
  }, pattern);
}

const setPatchMode = (page: Page, mode: 'pass' | 'fail' | number) =>
  page.evaluate((mode) => {
    (window as unknown as { __patchMode: typeof mode }).__patchMode = mode;
  }, mode);

const patchCalls = (page: Page) => page.evaluate(() => (window as unknown as { __patchCalls: number }).__patchCalls);

test.beforeEach(async ({ page }) => {
  await reachN5(page);
  await page.getByTestId('n5-fit-height').click();
});

test.describe('글자 크기 [+][-]', () => {
  test('0.05씩 바뀌고 폭이 같은 비율로 바뀌며(높이는 Auto Height) 정렬 정보가 없으면 왼쪽 위를 유지하고 서버 요청이 없다', async ({ page }) => {
    const patches = trackPatches(page);
    await selectWithToolbar(page, 9112);
    const start = await localBox(page, 9112);
    expect(await fontScale(page, 9112)).toBe('1');

    await page.getByTestId('n5-font-scale-increase').click();
    expect(await fontScale(page, 9112)).toBe('1.05');
    const up = await localBox(page, 9112);
    expect(Math.abs(up.width - start.width * 1.05)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(up.left - start.left)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(up.top - start.top)).toBeLessThanOrEqual(0.01);

    await page.getByTestId('n5-font-scale-increase').click();
    expect(await fontScale(page, 9112)).toBe('1.1');
    await page.getByTestId('n5-font-scale-decrease').click();
    expect(await fontScale(page, 9112)).toBe('1.05');
    expect(patches).toEqual([]);
  });

  test('한 번 누름이 한 단계이고 박스와 배율이 함께 복구된다', async ({ page }) => {
    await selectWithToolbar(page, 9112);
    const increase = page.getByTestId('n5-font-scale-increase');
    const undo = page.getByTestId('n5-undo');
    const redo = page.getByTestId('n5-redo');
    const start = await localBox(page, 9112);

    await increase.click();
    const first = await localBox(page, 9112);
    await increase.click();
    const second = await localBox(page, 9112);

    await undo.click();
    expect(await fontScale(page, 9112)).toBe('1.05');
    expectSameBox(await localBox(page, 9112), first);
    await undo.click();
    expect(await fontScale(page, 9112)).toBe('1');
    expectSameBox(await localBox(page, 9112), start);
    await expect(undo).toBeDisabled();

    await redo.click();
    await redo.click();
    expect(await fontScale(page, 9112)).toBe('1.1');
    expectSameBox(await localBox(page, 9112), second);
    await expect(redo).toBeDisabled();
  });

  test('섹션 경계에서 안쪽으로 밀고, 섹션보다 커지는 [+]만 따로 막는다', async ({ page }) => {
    await selectWithToolbar(page, 9101); // 폭 1000 섹션의 900 폭 블록
    const increase = page.getByTestId('n5-font-scale-increase');
    const decrease = page.getByTestId('n5-font-scale-decrease');

    await increase.click();
    await increase.click();
    const atEdge = await localBox(page, 9101);
    expect(atEdge.left).toBeGreaterThanOrEqual(0); // 왼쪽으로 나가지 않고 민다
    expect(await fontScale(page, 9101)).toBe('1.1');
    await expect(increase).toBeDisabled();
    await expect(decrease).toBeEnabled(); // 툴바 전체를 막지 않는다
    await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();

    // Figma 1507:21925(활성 #171717) · Icon Button XS Disabled 116:982(#999), 둘 다 바탕 #f5f5f5, 28px
    await expect(decrease).toHaveCSS('color', 'rgb(23, 23, 23)');
    await expect(increase).toHaveCSS('color', 'rgb(153, 153, 153)');
    await expect(decrease).toHaveCSS('background-color', 'rgb(245, 245, 245)');
    await expect(increase).toHaveCSS('background-color', 'rgb(245, 245, 245)');
    await expect(decrease).toHaveCSS('width', '28px');
    await page.getByTestId('n5-font-scale-toolbar').screenshot({ path: test.info().outputPath('font-scale-toolbar.png'), scale: 'css' });
  });

  test('N5 이력은 50단계까지만 남는다', async ({ page }) => {
    await selectWithToolbar(page, 9112);
    for (let i = 0; i < 26; i += 1) {
      await page.getByTestId('n5-font-scale-increase').click();
      await page.getByTestId('n5-font-scale-decrease').click();
    }
    const undo = page.getByTestId('n5-undo');
    for (let i = 0; i < 50; i += 1) await undo.click();
    await expect(undo).toBeDisabled();
    await expect(page.getByTestId('n5-redo')).toBeEnabled();
  });
});

test.describe('섹션 이력', () => {
  test('제외 — 성공 뒤 1단계, Undo는 restore PATCH, Redo는 exclude PATCH', async ({ page }) => {
    const patches = trackPatches(page);
    const undo = page.getByTestId('n5-undo');
    const redo = page.getByTestId('n5-redo');

    await page.getByTestId('n5-section-exclude-501').click();
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
    await expect(undo).toBeEnabled();

    await undo.click();
    await expect(page.getByTestId('n5-section-excluded-501')).toHaveCount(0);
    await expect(page.getByTestId('n5-section-tag-1')).toHaveAttribute('aria-pressed', 'true'); // 되돌아간 대상을 고른다
    await expect(redo).toBeEnabled();

    await redo.click();
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
    await expect(redo).toBeDisabled();

    expect(patches).toEqual([
      { path: '/sections/501', body: { action: 'exclude' } },
      { path: '/sections/501', body: { action: 'restore' } },
      { path: '/sections/501', body: { action: 'exclude' } },
    ]);
  });

  test('되돌리기 — Undo는 exclude PATCH, Redo는 restore PATCH', async ({ page }) => {
    const patches = trackPatches(page);
    await page.getByTestId('n5-section-restore-503').click();
    await expect(page.getByTestId('n5-section-excluded-503')).toHaveCount(0);

    await page.getByTestId('n5-undo').click();
    await expect(page.getByTestId('n5-section-excluded-503')).toBeVisible();
    await expect(page.getByTestId('n5-section-restore-503')).toBeVisible();

    await page.getByTestId('n5-redo').click();
    await expect(page.getByTestId('n5-section-excluded-503')).toHaveCount(0);

    expect(patches.map((p) => p.body.action)).toEqual(['restore', 'exclude', 'restore']);
  });

  test('저장 실패 — 이력이 늘지 않고, Undo·Redo 실패는 화면과 pointer를 유지한다', async ({ page }) => {
    await controlPatches(page, 'sections');
    const undo = page.getByTestId('n5-undo');
    const redo = page.getByTestId('n5-redo');

    await setPatchMode(page, 'fail');
    await page.getByTestId('n5-section-exclude-501').click();
    await expect(page.getByTestId('n5-section-save-error-501')).toBeVisible();
    await expect(undo).toBeDisabled();

    await setPatchMode(page, 'pass');
    await page.getByTestId('n5-section-exclude-501').click();
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();

    await setPatchMode(page, 'fail');
    await undo.click();
    await expect(page.getByTestId('n5-history-notice')).toHaveText(NOTICE.undo);
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
    await expect(redo).toBeDisabled();
    await expect(undo).toBeEnabled();

    await setPatchMode(page, 'pass');
    await undo.click();
    await expect(page.getByTestId('n5-section-excluded-501')).toHaveCount(0);
    await expect(page.getByTestId('n5-history-notice')).toHaveCount(0);

    await setPatchMode(page, 'fail');
    await redo.click();
    await expect(page.getByTestId('n5-history-notice')).toHaveText(NOTICE.redo);
    await expect(page.getByTestId('n5-section-excluded-501')).toHaveCount(0);
    await expect(redo).toBeEnabled();
  });

  test('N3 제외로 바뀐 섹션은 Undo여도 되살리지 않는다', async ({ page }) => {
    const patches = trackPatches(page);
    await page.getByTestId('n5-section-exclude-501').click();
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();

    // 서버 정본이 N3 제외로 바뀐 상황 — 프리뷰 응답을 바꾸고 다른 섹션 조작으로 재조회한다
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const res = await originalFetch(input, init);
        if (!url.endsWith('/preview')) return res;
        const body = (await res.json()) as { sections: { id: number; excludedStage: string | null }[] };
        body.sections = body.sections.map((s) => (s.id === 501 ? { ...s, excludedStage: 'N3' } : s));
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });
    await page.getByTestId('n5-section-exclude-502').click();
    await expect(page.getByTestId('n5-section-excluded-502')).toBeVisible();
    await expect(page.getByTestId('n5-section-restore-501')).toHaveCount(0);

    await page.getByTestId('n5-undo').click(); // 502 되돌림
    await expect(page.getByTestId('n5-section-excluded-502')).toHaveCount(0);
    const before = patches.length;
    await page.getByTestId('n5-undo').click(); // 501 — 시도하지 않는다
    await expect(page.getByTestId('n5-history-notice')).toHaveText(NOTICE.undo);
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
    expect(patches.length).toBe(before);
  });
});

test.describe('번역문 이력', () => {
  const BLOCK = 9101;
  const A = 'Pure Vitamin C Serum';
  const B = 'Pure Vitamin C Serum (edited)';

  test('타이핑은 단계가 아니고 저장 성공만 1단계, Undo·Redo는 최신 revision으로 저장하고 재렌더를 이어 간다', async ({ page }) => {
    const patches = trackPatches(page);
    const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
    const undo = page.getByTestId('n5-undo');
    const redo = page.getByTestId('n5-redo');

    await editor.fill(B);
    await expect(undo).toBeDisabled();
    await page.getByTestId(`n5-block-save-${BLOCK}`).click();
    await expect(undo).toBeEnabled();

    await page.getByTestId('n5-block-row-9103').click();
    await undo.click();
    await expect(editor).toHaveValue(A);
    await expect(page.getByTestId(`n5-block-row-${BLOCK}`)).toHaveAttribute('aria-pressed', 'true'); // 되돌아간 대상을 고른다
    await expect(redo).toBeEnabled();

    // 저장과 같은 재렌더 흐름 — task 완료 뒤 블록을 다시 받는다
    await expect(page.getByText('재렌더링 중…')).toBeVisible();
    const blockGet = page.waitForRequest((req) => req.method() === 'GET' && req.url().endsWith('/blocks'), { timeout: 30_000 });
    await blockGet;
    await expect(page.getByText('재렌더링 중…')).toHaveCount(0);

    await redo.click();
    await expect(editor).toHaveValue(B);

    const revisions = patches.map((p) => p.body.revision as number);
    expect(patches.map((p) => p.body.trans1)).toEqual([B, A, B]);
    expect(revisions[1]).toBe(revisions[0] + 1);
    expect(revisions[2]).toBeGreaterThan(revisions[1]); // 매 요청 최신값
  });

  test('저장 실패 — 초안을 지키고 이력이 늘지 않는다', async ({ page }) => {
    await controlPatches(page, 'blocks');
    await setPatchMode(page, 'fail');
    await page.getByTestId(`n5-block-editor-${BLOCK}`).fill(B);
    await page.getByTestId(`n5-block-save-${BLOCK}`).click();
    await expect(page.getByTestId(`n5-block-save-${BLOCK}`)).toBeEnabled();
    await expect(page.getByTestId(`n5-block-editor-${BLOCK}`)).toHaveValue(B);
    await expect(page.getByTestId('n5-undo')).toBeDisabled();
  });

  test('Undo 409 — pointer를 옮기지 않고 서버값을 덮어쓰지 않으며, 기존 충돌 표시로 고른 뒤 다시 할 수 있다', async ({ page }) => {
    const patches = trackPatches(page);
    const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
    const undo = page.getByTestId('n5-undo');
    await saveTranslation(page, BLOCK, B);

    const otherClient = 'Edited by another client';
    const status = await page.evaluate(
      async ({ jobId, blockId, revision, otherClient }) => {
        const res = await fetch(`/jobs/${jobId}/blocks/${blockId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trans1: otherClient, revision }),
        });
        return res.status;
      },
      { jobId: MOCK_JOB_ID, blockId: BLOCK, revision: (patches[0].body.revision as number) + 1, otherClient },
    );
    expect(status).toBe(200);

    await undo.click();
    await expect(page.getByTestId(`n5-block-conflict-${BLOCK}`)).toContainText(otherClient);
    await expect(page.getByTestId('n5-history-notice')).toHaveText(NOTICE.undo);
    await expect(editor).toHaveValue(B); // 자동으로 바뀌지 않는다
    await expect(page.getByTestId('n5-redo')).toBeDisabled(); // pointer 불변
    await expect(undo).toBeEnabled();

    await page.getByTestId(`n5-block-conflict-load-${BLOCK}`).click();
    await expect(editor).toHaveValue(otherClient);
    await expect(page.getByTestId(`n5-block-conflict-${BLOCK}`)).toHaveCount(0);

    await undo.click();
    await expect(editor).toHaveValue(A);
    await expect(page.getByTestId('n5-redo')).toBeEnabled();
    expect(patches.at(-1)?.body.trans1).toBe(A);
  });

  test('저장하지 않은 초안이 있는 칸의 Undo는 시도하지 않고 초안을 지킨다', async ({ page }) => {
    const patches = trackPatches(page);
    const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
    await saveTranslation(page, BLOCK, B);
    await editor.fill('아직 저장하지 않은 초안');
    const before = patches.length;

    await page.getByTestId('n5-undo').click();
    await expect(page.getByTestId('n5-history-notice')).toHaveText(NOTICE.undo);
    await expect(editor).toHaveValue('아직 저장하지 않은 초안');
    await expect(page.getByTestId('n5-redo')).toBeDisabled();
    expect(patches.length).toBe(before);
  });

  test('진행 중에는 더블클릭·단축키로 요청이 겹치지 않고 다른 편집을 시작하지 않는다', async ({ page }) => {
    const undo = page.getByTestId('n5-undo');
    const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
    await saveTranslation(page, BLOCK, B);
    await controlPatches(page, 'blocks');
    await setPatchMode(page, 1500);

    await undo.dblclick();
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(undo).toBeDisabled();
    await expect(page.getByTestId('n5-section-exclude-501')).toBeDisabled();
    await expect(editor).toHaveValue(A, { timeout: 5000 });
    expect(await patchCalls(page)).toBe(1);
    await expect(page.getByTestId('n5-section-exclude-501')).toBeEnabled();
  });
});

test.describe('혼합 이력', () => {
  const BLOCK_TEXT = 9101;
  const BLOCK_MOVE = 9102;
  const BLOCK_FONT = 9112;
  const SECTION = 504;
  const TEXT_BEFORE = 'Pure Vitamin C Serum';
  const TEXT_AFTER = 'Mixed history text';

  /** 번역 → 박스 이동 → 섹션 제외 → 글자 + → 크기 조절. 단계마다의 화면 값을 돌려준다 */
  async function runFiveEdits(page: Page) {
    const moveStart = await localBox(page, BLOCK_MOVE);
    const fontStart = await localBox(page, BLOCK_FONT);

    await saveTranslation(page, BLOCK_TEXT, TEXT_AFTER);

    await page.getByTestId(`n5-block-pin-${BLOCK_MOVE}`).click();
    await dragBody(page, BLOCK_MOVE, 15, 12);
    const moved = await localBox(page, BLOCK_MOVE);
    expect(moved.top).not.toBe(moveStart.top);

    await page.getByTestId(`n5-section-exclude-${SECTION}`).click();
    await expect(page.getByTestId(`n5-section-excluded-${SECTION}`)).toBeVisible();

    await selectWithToolbar(page, BLOCK_FONT);
    await page.getByTestId('n5-font-scale-increase').click();
    const fontUp = await localBox(page, BLOCK_FONT);

    // 축소 화면에서는 오른쪽 손잡이가 글자크기 손잡이와 겹쳐 왼쪽 손잡이를 쓴다
    await dragHandle(page, 'w', 30, 0);
    const resized = await localBox(page, BLOCK_FONT);
    expect(resized.width).toBeLessThan(fontUp.width);

    return { moveStart, moved, fontStart, fontUp, resized };
  }

  async function verifyRoundTrip(page: Page, undoStep: () => Promise<void>, redoStep: () => Promise<void>) {
    const editor = page.getByTestId(`n5-block-editor-${BLOCK_TEXT}`);
    const excluded = page.getByTestId(`n5-section-excluded-${SECTION}`);
    const v = await runFiveEdits(page);

    // 역순으로 되돌아간다
    await undoStep();
    await expect.poll(() => localBox(page, BLOCK_FONT).then((b) => b.width)).toBeCloseTo(v.fontUp.width, 1);
    expect(await fontScale(page, BLOCK_FONT)).toBe('1.05');

    await undoStep();
    await expect.poll(() => fontScale(page, BLOCK_FONT)).toBe('1');
    expectSameBox(await localBox(page, BLOCK_FONT), v.fontStart);
    await expect(excluded).toBeVisible(); // 아직 섹션은 그대로다

    await undoStep();
    await expect(excluded).toHaveCount(0);
    expectSameBox(await localBox(page, BLOCK_MOVE), v.moved); // 아직 박스는 그대로다

    await expect(page.getByTestId('n5-undo')).toBeEnabled();
    await undoStep();
    await expect.poll(() => localBox(page, BLOCK_MOVE).then((b) => b.top)).toBeCloseTo(v.moveStart.top, 1);
    await expect(editor).toHaveValue(TEXT_AFTER); // 아직 번역은 그대로다

    await undoStep();
    await expect(editor).toHaveValue(TEXT_BEFORE);
    await expect(page.getByTestId('n5-undo')).toBeDisabled();

    // 원래 순서로 다시 실행된다
    await redoStep();
    await expect(editor).toHaveValue(TEXT_AFTER);
    await expect(page.getByTestId('n5-redo')).toBeEnabled();

    await redoStep();
    await expect.poll(() => localBox(page, BLOCK_MOVE).then((b) => b.top)).toBeCloseTo(v.moved.top, 1);
    await expect(excluded).toHaveCount(0);

    await redoStep();
    await expect(excluded).toBeVisible();
    expect(await fontScale(page, BLOCK_FONT)).toBe('1');

    await expect(page.getByTestId('n5-redo')).toBeEnabled();
    await redoStep();
    await expect.poll(() => fontScale(page, BLOCK_FONT)).toBe('1.05');
    expectSameBox(await localBox(page, BLOCK_FONT), v.fontUp);

    await redoStep();
    await expect.poll(() => localBox(page, BLOCK_FONT).then((b) => b.width)).toBeCloseTo(v.resized.width, 1);
    await expect(page.getByTestId('n5-redo')).toBeDisabled();
  }

  test('버튼 — Undo 5번은 역순, Redo 5번은 원래 순서이고 서버 저장 조작만 요청이 나간다', async ({ page }) => {
    const patches = trackPatches(page);
    await verifyRoundTrip(
      page,
      () => page.getByTestId('n5-undo').click(),
      () => page.getByTestId('n5-redo').click(),
    );
    expect(patches.map((p) => p.path)).toEqual([
      `/blocks/${BLOCK_TEXT}`,
      `/sections/${SECTION}`,
      `/sections/${SECTION}`,
      `/blocks/${BLOCK_TEXT}`,
      `/blocks/${BLOCK_TEXT}`,
      `/sections/${SECTION}`,
    ]);
  });

  test('단축키 — 같은 이력을 쓴다', async ({ page }) => {
    await verifyRoundTrip(
      page,
      () => page.keyboard.press('ControlOrMeta+z'),
      () => page.keyboard.press('ControlOrMeta+Shift+z'),
    );
  });

  test('되돌린 뒤 새 조작을 하면 다시 실행 영역이 사라진다', async ({ page }) => {
    await saveTranslation(page, BLOCK_TEXT, TEXT_AFTER);
    await page.getByTestId(`n5-section-exclude-${SECTION}`).click();
    await expect(page.getByTestId(`n5-section-excluded-${SECTION}`)).toBeVisible();
    await page.getByTestId('n5-undo').click();
    await expect(page.getByTestId(`n5-section-excluded-${SECTION}`)).toHaveCount(0);
    await expect(page.getByTestId('n5-redo')).toBeEnabled();

    await selectWithToolbar(page, BLOCK_FONT);
    await page.getByTestId('n5-font-scale-increase').click();
    await expect(page.getByTestId('n5-redo')).toBeDisabled();

    await page.getByTestId('n5-undo').click();
    await expect.poll(() => fontScale(page, BLOCK_FONT)).toBe('1');
    await page.getByTestId('n5-undo').click();
    await expect(page.getByTestId(`n5-block-editor-${BLOCK_TEXT}`)).toHaveValue(TEXT_BEFORE);
    await expect(page.getByTestId('n5-undo')).toBeDisabled();
  });
});

test.describe('단축키 예외·재조회', () => {
  test('번역 입력칸에서는 글자 실행 취소가 먼저이고 N5 이력을 건드리지 않는다', async ({ page }) => {
    const patches = trackPatches(page);
    await selectWithToolbar(page, 9112);
    await page.getByTestId('n5-font-scale-increase').click();

    const editor = page.getByTestId('n5-block-editor-9112');
    const original = await editor.inputValue();
    await editor.focus();
    await editor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.type('X');
    await expect(editor).toHaveValue(`${original}X`);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).toHaveValue(original); // 브라우저 글자 실행 취소
    expect(await fontScale(page, 9112)).toBe('1.05'); // N5 이력은 그대로
    expect(patches).toEqual([]);
  });

  test('확인창이 열려 있으면 단축키가 동작하지 않는다', async ({ page }) => {
    await selectWithToolbar(page, 9112);
    await page.getByTestId('n5-font-scale-increase').click();

    await page.getByTestId('n5-confirm-button').click();
    await expect(page.getByTestId('n5-review-dialog')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    expect(await fontScale(page, 9112)).toBe('1.05');

    await page.getByTestId('n5-review-cancel').click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => fontScale(page, 9112)).toBe('1');
  });

  test('프리뷰·블록을 다시 받아도 박스·글자 배율 초안이 남는다', async ({ page }) => {
    await selectWithToolbar(page, 9112);
    await page.getByTestId('n5-font-scale-increase').click();
    const adjusted = await localBox(page, 9112);

    const refetched = page.waitForResponse((res) => res.request().method() === 'GET' && res.url().endsWith('/preview'));
    await page.getByTestId('n5-section-exclude-501').click();
    await refetched;
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();

    expect(await fontScale(page, 9112)).toBe('1.05');
    expectSameBox(await localBox(page, 9112), adjusted);
  });
});
