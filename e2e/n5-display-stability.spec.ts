import { type Page, expect, test } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 표시 안정화 · 읽기 전용 block · 확인 항목 시점 (11-18 진단에서 원인이 확정된 회귀).
//
// A. [확인] 저장 → 재렌더 진행 → 완료 → 번역 전/후 전환 동안
//    - 섹션 면이 local-typeset 에서 이전 서버 이미지로 바뀌지 않고 새 문장이 계속 보인다
//      (PATCH 응답 한 건의 새 지문 A 를 섹션 snapshot 에 섞지 않는다 — usePatchN5BlockMutation)
//    - ?mockPresign=rotate(실 BE 처럼 /preview 마다 새 presigned URL)에서도 같은 asset 이면 보이는 URL 을 바꾸지 않는다(다시 받지 않는다)
//    - 번역 전/후 전환은 /blocks·/preview 를 다시 받지 않는다
// B. 박스 폭을 늘린 뒤 [확인] — 화면 폭 유지 · 읽기 전용 block 은 선택만 되고 조정(손잡이·글자크기·끌기·이력·배치 PATCH)이 없다
// C. 확인 항목이 있으면 Phase A(PATCH) 직후 확인창 — 미리보기 장벽을 기다리지 않는다. [확인하고 저장] 뒤에는 장벽이 끝나야만 confirm
//
// Mock 이다 — 실 BE presigned URL·렌더 시간은 검증하지 않는다. Chromium 기준.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');

const SECTION = 501;
const BLOCK = 9101;
const NARROW_BLOCK = 9102;
const READ_ONLY_BLOCK = 9105; // product_label · isExcluded=true → editable=false

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

type Net = { log: { t: number; entry: string }[]; previewBgUrls: string[] };

/** fetch 를 감싸 /blocks·/preview·PATCH·confirm 을 기록하고, /preview 응답의 501 바탕 URL 을 모은다(MSW 응답 전에 감싼다) */
async function instrumentNetwork(page: Page) {
  await page.evaluate((sectionId) => {
    const w = window as unknown as { __net: Net };
    w.__net = { log: [], previewBgUrls: [] };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, location.href);
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = pathname.replace(/^\/jobs\/[^/]+/, '');
      const response = await original(input, init);
      if (/^\/(blocks|preview|confirm)/.test(path)) w.__net.log.push({ t: performance.now(), entry: `${method} ${path}` });
      if (method === 'GET' && path === '/preview') {
        response
          .clone()
          .json()
          .then((body: { sections: { id: number; renderInput?: { section: { background: { url: string } } } | null }[] }) => {
            const bg = body.sections.find((section) => section.id === sectionId)?.renderInput?.section.background.url;
            if (bg) w.__net.previewBgUrls.push(bg);
          })
          .catch(() => undefined);
      }
      return response;
    };
  }, SECTION);
}
const net = (page: Page) => page.evaluate(() => (window as unknown as { __net: Net }).__net);
const count = async (page: Page, entry: string) => (await net(page)).log.filter((item) => item.entry === entry).length;

type Frame = { mode: string; display: string | null; bg: string; text: string };

/** 매 frame 섹션 면(보기·표시 소스·backgroundImage·HTML 글자)을 기록한다 */
async function recordFrames(page: Page) {
  await page.evaluate((sectionId) => {
    const w = window as unknown as { __frames: Frame[]; __recording: boolean };
    w.__frames = [];
    w.__recording = true;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-testid="n5-slice-translated-${sectionId}"], [data-testid="n5-slice-original-${sectionId}"]`);
      if (el) {
        w.__frames.push({
          mode: el.dataset.testid?.includes('original') ? 'original' : 'translated',
          display: el.getAttribute('data-preview-display'),
          bg: el.style.backgroundImage,
          text: document.querySelector(`[data-testid="n5-text-layer-${sectionId}"]`)?.textContent ?? '',
        });
      }
      if (w.__recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, SECTION);
}
const takeFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[] };
    const frames = w.__frames;
    w.__frames = [];
    return frames;
  });
/** 섹션 501 이미지를 네트워크로 받은 횟수(Resource Timing) */
const sectionImageLoads = (page: Page, name: string) =>
  page.evaluate(
    ({ sectionId, name }) => performance.getEntriesByType('resource').filter((e) => e.name.includes(`/mock/n5/sections/${sectionId}-${name}`)).length,
    { sectionId: SECTION, name },
  );

test('A. [확인] → 재렌더 → 완료 → 번역 전/후: local-typeset 유지 · 새 문장 유지 · 같은 asset 은 다시 받지 않음 · 전환 재조회 0', async ({ page }) => {
  await reachN5(page);
  await setMockParams(page, { mockPresign: 'rotate' });
  await instrumentNetwork(page);
  const slice = page.getByTestId(`n5-slice-translated-${SECTION}`);
  await expect(slice).toHaveAttribute('data-preview-display', 'local-typeset');

  const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
  await editor.scrollIntoViewIfNeeded();
  await editor.fill('안정화 확인 문장');
  // 입력 중 — local-typeset 이 초안을 바로 그린다
  await expect(page.getByTestId(`n5-text-layer-${SECTION}`)).toContainText('안정화 확인 문장');

  const bgBefore = await slice.evaluate((el) => (el as HTMLElement).style.backgroundImage);
  const backgroundLoadsBefore = await sectionImageLoads(page, 'background');
  const translatedLoadsBefore = await sectionImageLoads(page, 'translated');
  await recordFrames(page);
  const previewBefore = await count(page, 'GET /preview');
  await page.getByTestId(`n5-block-save-${BLOCK}`).click();
  // 재렌더 완료 → 화면 snapshot 재조회(한 번)까지 기다린다
  await expect.poll(() => count(page, 'GET /preview'), { timeout: 20_000 }).toBeGreaterThan(previewBefore);
  await expect(page.getByText('재렌더링 중…')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(1_000);

  const saveFrames = await takeFrames(page);
  expect(saveFrames.length).toBeGreaterThan(30);
  // 저장·재렌더·완료 내내 local-typeset · 새 문장 · 같은 바탕(빈 면 없음)
  expect(saveFrames.filter((frame) => frame.display !== 'local-typeset')).toEqual([]);
  expect(saveFrames.filter((frame) => !frame.text.includes('안정화 확인 문장'))).toEqual([]);
  expect([...new Set(saveFrames.map((frame) => frame.bg))]).toEqual([bgBefore]);
  expect(bgBefore).not.toBe('none');
  // 실 BE 처럼 /preview 마다 URL 이 바뀌었는데도(이 시나리오가 의미 있다는 확인) 보이는 바탕은 다시 받지 않았다
  const { previewBgUrls } = await net(page);
  expect(new Set(previewBgUrls).size).toBeGreaterThanOrEqual(1);
  expect(previewBgUrls.every((url) => url.includes('X-Amz-Date='))).toBe(true);
  expect(bgBefore).not.toContain(previewBgUrls[previewBgUrls.length - 1]);
  expect(await sectionImageLoads(page, 'background')).toBe(backgroundLoadsBefore);
  expect(await sectionImageLoads(page, 'translated')).toBe(translatedLoadsBefore);

  // 번역 전/후 전환 — /blocks·/preview 를 다시 받지 않고, 각 보기의 마지막 이미지를 그대로 쓴다
  const blocksBeforeToggle = await count(page, 'GET /blocks');
  const previewBeforeToggle = await count(page, 'GET /preview');
  for (const mode of ['original', 'translated', 'original', 'translated'] as const) {
    await page.getByTestId(`n5-view-mode-${mode}`).click();
    await page.waitForTimeout(700);
  }
  const toggleFrames = await takeFrames(page);
  expect(await count(page, 'GET /blocks')).toBe(blocksBeforeToggle);
  expect(await count(page, 'GET /preview')).toBe(previewBeforeToggle);
  expect(toggleFrames.filter((frame) => frame.bg === 'none' || frame.bg === '')).toEqual([]);
  expect([...new Set(toggleFrames.filter((frame) => frame.mode === 'translated').map((frame) => frame.bg))]).toEqual([bgBefore]);
  expect(new Set(toggleFrames.filter((frame) => frame.mode === 'original').map((frame) => frame.bg)).size).toBe(1);
  expect(await sectionImageLoads(page, 'original')).toBeLessThanOrEqual(1);
  expect(await sectionImageLoads(page, 'background')).toBe(backgroundLoadsBefore);
});

test('B. 박스 폭을 늘린 뒤 [확인] 해도 화면 폭 유지 · 읽기 전용 block 은 선택만 되고 조정·배치 PATCH 가 없다', async ({ page }) => {
  await reachN5(page);
  await instrumentNetwork(page);

  // 읽기 전용 block — 선택 표시는 있고 조정 UI 는 없다
  const roHit = page.getByTestId(`n5-block-hit-${READ_ONLY_BLOCK}`);
  await roHit.scrollIntoViewIfNeeded();
  await roHit.click({ force: true });
  const selection = page.getByTestId('n5-block-selection');
  await expect(selection).toBeVisible();
  await expect(selection).toHaveAttribute('data-adjustable', 'false');
  await expect(page.getByTestId('n5-block-selection-frame')).toBeVisible();
  await expect(page.locator('[data-testid^="n5-block-handle-"]')).toHaveCount(0);
  await expect(page.getByTestId('n5-font-scale-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('n5-block-resize-zone-right')).toHaveCount(0);
  // 끌어도 움직이지 않는다(박스 초안 없음) · 이력도 생기지 않는다
  const overlay = page.getByTestId(`n5-block-overlay-${READ_ONLY_BLOCK}`);
  const before = await overlay.boundingBox();
  const hit = (await roHit.boundingBox())!;
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.mouse.down();
  await page.mouse.move(hit.x + hit.width / 2 + 30, hit.y + hit.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  expect(await overlay.boundingBox()).toEqual(before);
  await expect(page.getByTestId('n5-undo')).toBeDisabled();

  // 편집 가능한 block — 폭을 늘리고 [확인]
  const narrowHit = page.getByTestId(`n5-block-hit-${NARROW_BLOCK}`);
  await narrowHit.click({ force: true });
  await expect(selection).toHaveAttribute('data-adjustable', 'true');
  const frame = page.getByTestId('n5-block-selection-frame');
  const widthBefore = (await frame.boundingBox())!.width;
  const handle = (await page.getByTestId('n5-block-handle-e').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 10, handle.y + handle.height / 2, { steps: 2 });
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2, { steps: 10 });
  await page.mouse.up();
  const widened = (await frame.boundingBox())!.width;
  expect(widened).toBeGreaterThan(widthBefore + 20);

  const editor = page.getByTestId(`n5-block-editor-${NARROW_BLOCK}`);
  await editor.fill('폭 유지 확인 문장');
  await page.getByTestId(`n5-block-save-${NARROW_BLOCK}`).click();
  const slice = page.getByTestId(`n5-slice-translated-${SECTION}`);
  const widths: number[] = [];
  const displays = new Set<string | null>();
  for (let i = 0; i < 12; i += 1) {
    widths.push(Math.round((await frame.boundingBox())!.width));
    displays.add(await slice.getAttribute('data-preview-display'));
    await page.waitForTimeout(400);
  }
  expect([...displays]).toEqual(['local-typeset']);
  expect(widths.every((width) => Math.abs(width - widened) <= 1)).toBe(true);

  // [저장하러 가기] — 읽기 전용 block 은 PATCH 하지 않는다(배치 PATCH 0). 편집한 9102 의 배치는 저장된다
  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByTestId('n5-review-dialog')).toBeVisible({ timeout: 20_000 });
  expect(await count(page, `PATCH /blocks/${READ_ONLY_BLOCK}`)).toBe(0);
});

test('C. 확인 항목은 PATCH 직후(미리보기 running 중) 바로 · [확인하고 저장] 뒤 장벽 완료 전 confirm 0 · 완료 후 confirm 1', async ({ page }) => {
  await reachN5(page);
  await setMockParams(page, { mockRenderHold: String(SECTION) });
  await instrumentNetwork(page);

  await page.getByTestId(`n5-block-editor-${BLOCK}`).fill('확인 항목 시점 문장');
  await page.getByTestId('n5-confirm-button').click();
  const dialog = page.getByTestId('n5-review-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  // PATCH 는 끝났고, 장벽 조회(/preview)는 아직 하지 않았다 — 미리보기는 running 에 붙잡혀 있다
  const atDialog = (await net(page)).log.map((item) => item.entry);
  const patchIndex = atDialog.lastIndexOf(`PATCH /blocks/${BLOCK}`);
  expect(patchIndex).toBeGreaterThanOrEqual(0);
  expect(atDialog.slice(patchIndex + 1).filter((entry) => entry === 'GET /preview')).toEqual([]);
  expect(await count(page, 'POST /confirm')).toBe(0);

  await page.getByTestId('n5-review-continue').click();
  await page.waitForTimeout(5_000);
  // 장벽이 기다리는 중 — confirm 0
  expect(await count(page, 'POST /confirm')).toBe(0);
  expect(await count(page, 'GET /preview')).toBeGreaterThan(0);

  await setMockParams(page, { mockRenderHold: null });
  await expect.poll(() => count(page, 'POST /confirm'), { timeout: 30_000 }).toBe(1);
  await page.waitForTimeout(1_000);
  expect(await count(page, 'POST /confirm')).toBe(1);
});
