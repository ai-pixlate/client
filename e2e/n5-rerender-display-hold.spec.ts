import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 재렌더 중 편집 화면 유지 — 사용자가 수정한 섹션은 그 수정의 재렌더가 끝날 때까지 이전 서버 미리보기
// (previous-rendered-image)로 돌아가지 않고 local-typeset 을 유지한다(lib/n5/preview-state.ts resolvePreviewSectionDisplay).
// 섹션 표시 값(data-preview-display)을 MutationObserver 로 바뀔 때마다 기록해 한 번이라도 이전 이미지가 나오면 실패로 본다.
// ?mockRenderHold=<sectionId> 는 그 섹션 재렌더를 running 에 붙잡는다(주소에서 빼면 끝난다). Mock 이다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const SECTION = 501;

async function setMockParams(page: Page, params: Record<string, string | null>) {
  await page.evaluate((params) => {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(params)) {
      if (value == null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    history.replaceState(history.state, '', url);
  }, params);
}

/** 섹션 표시 값이 바뀔 때마다 기록한다 */
async function recordDisplays(page: Page, sectionId: number) {
  await page.evaluate((sectionId) => {
    const w = window as unknown as { __displays: string[]; __previewGets: number };
    const el = document.querySelector(`[data-testid="n5-slice-translated-${sectionId}"]`)!;
    w.__displays = [el.getAttribute('data-preview-display') ?? ''];
    new MutationObserver(() => w.__displays.push(el.getAttribute('data-preview-display') ?? '')).observe(el, {
      attributes: true,
      attributeFilter: ['data-preview-display'],
    });
    w.__previewGets = 0;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if ((init?.method ?? 'GET').toUpperCase() === 'GET' && /\/preview$/.test(url.pathname)) w.__previewGets += 1;
      return original(input, init);
    };
  }, sectionId);
}
const displays = (page: Page) => page.evaluate(() => (window as unknown as { __displays: string[] }).__displays);
const previewGets = (page: Page) => page.evaluate(() => (window as unknown as { __previewGets: number }).__previewGets);

/** 탭을 떠났다 돌아온 것처럼 focus·visibility 재조회를 일으킨다 */
async function refocus(page: Page) {
  await page.evaluate(() => {
    // TanStack Query focusManager 는 window 의 visibilitychange 를 듣는다(브라우저의 실제 이벤트는 document 에서 window 로 올라온다)
    window.dispatchEvent(new Event('visibilitychange'));
  });
}

test('A. 수정 → PATCH → 재렌더 중 focus/visibility 재조회(isCurrent=false)에도 local-typeset 유지', async ({ page }) => {
  await reachN5(page);
  const slice = page.getByTestId(`n5-slice-translated-${SECTION}`);
  await expect(slice).toHaveAttribute('data-preview-display', 'local-typeset');
  await setMockParams(page, { mockRenderHold: String(SECTION) });
  await recordDisplays(page, SECTION);

  const editor = page.getByTestId('n5-block-editor-9101');
  await editor.fill('재렌더 중 유지 확인');
  await page.getByTestId('n5-block-save-9101').click();
  // 재렌더가 붙잡힌 동안 데이터가 오래되기(staleTime 60초)를 기다렸다가 focus/visibility 로 재조회한다 — 실서버 job 64 와 같은 순서.
  // /blocks·/preview 가 각자 다시 오고, /preview 는 isCurrent=false(running)다
  test.setTimeout(test.info().timeout + 90_000);
  await page.waitForTimeout(61_000);
  const before = await previewGets(page);
  for (let i = 0; i < 3; i += 1) {
    await refocus(page);
    await page.waitForTimeout(700);
  }
  await expect.poll(() => previewGets(page)).toBeGreaterThan(before);
  const preview = await page.evaluate(async (sectionId) => {
    const base = location.pathname.replace(/\/$/, '');
    const body = (await (await fetch(`${base}/preview`)).json()) as { sections: { id: number; render: { isCurrent: boolean } }[] };
    return body.sections.find((section) => section.id === sectionId)!.render.isCurrent;
  }, SECTION);
  expect(preview).toBe(false);
  await expect(page.getByTestId(`n5-text-layer-${SECTION}`)).toContainText('재렌더 중 유지 확인');

  // 재렌더를 끝낸다 → 최신 결과
  await setMockParams(page, { mockRenderHold: null });
  await expect(page.getByTestId('n5-block-row-9101').getByText('재렌더링 중…')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  expect([...new Set(await displays(page))]).toEqual(['local-typeset']);
});

test('B. [저장하러 가기] 두 블록 연속 저장 — 앞 블록 재렌더만 끝난 중간 /preview 에도 local-typeset 유지', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-clean' });
  const slice = page.getByTestId(`n5-slice-translated-${SECTION}`);
  await expect(slice).toHaveAttribute('data-preview-display', 'local-typeset');
  await recordDisplays(page, SECTION);

  await page.getByTestId('n5-block-editor-9101').fill('연속 저장 첫 번째');
  await page.getByTestId('n5-block-editor-9102').fill('연속 저장 두 번째');
  await page.getByTestId('n5-confirm-button').click();
  // 저장·재렌더·장벽이 끝나 N6 으로 넘어갈 때까지 N5 표시를 기록한다
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 40_000 });
  const seen = await displays(page);
  expect(seen.filter((value) => value !== '')).not.toContain('previous-rendered-image');
  expect(seen.filter((value) => value !== '' && value !== 'local-typeset')).toEqual([]);
});

test('D. 박스 폭을 넓힌 뒤 [확인]·재조회가 있어도 화면 박스 폭이 되돌아가지 않는다', async ({ page }) => {
  await reachN5(page);
  await setMockParams(page, { mockRenderHold: String(SECTION) });
  await recordDisplays(page, SECTION);
  await page.getByTestId('n5-block-hit-9102').click({ force: true });
  const frame = page.getByTestId('n5-block-selection-frame');
  const widthBefore = (await frame.boundingBox())!.width;
  const handle = (await page.getByTestId('n5-block-handle-e').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 10, handle.y + handle.height / 2, { steps: 2 });
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  const widened = (await frame.boundingBox())!.width;
  expect(widened).toBeGreaterThan(widthBefore + 20);

  await page.getByTestId('n5-block-editor-9102').fill('폭 유지 문장');
  await page.getByTestId('n5-block-save-9102').click();
  test.setTimeout(test.info().timeout + 90_000);
  await page.waitForTimeout(61_000); // staleTime 60초 — 이후 focus 재조회가 실제로 /blocks·/preview 를 다시 받는다
  for (let i = 0; i < 3; i += 1) {
    await refocus(page);
    await page.waitForTimeout(700);
    expect(Math.abs((await frame.boundingBox())!.width - widened)).toBeLessThanOrEqual(1);
  }
  expect(await displays(page)).not.toContain('previous-rendered-image');
});
