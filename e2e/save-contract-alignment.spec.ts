import { test, expect, type Page } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// 3차 FE — 저장 계약 정합(blockPatch · sectionPatch 「저장 공통」) · 일반 Undo/Redo 12월 비노출 · N6 렌더 중 미리보기.
// Mock(MSW) 검증이다 — 실서버 dev 배포 동작은 따로 확인해야 한다. 판정 로직 전체는 scripts/verify-save-idempotency.mjs ·
// scripts/verify-n6-interim-preview.mjs 가 본다.
// ─────────────────────────────────────────────────────────────────

const BLOCK = 9101;

interface CapturedPatch {
  path: string;
  key: string | null;
  body: string;
}

function trackPatches(page: Page, pattern: RegExp) {
  const patches: CapturedPatch[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'PATCH') return;
    const path = new URL(req.url()).pathname;
    if (pattern.test(path)) patches.push({ path, key: req.headers()['idempotency-key'] ?? null, body: req.postData() ?? '' });
  });
  return patches;
}

/** Mock 시나리오 쿼리를 지금 주소에 더한다(MSW 가 request.referrer 로 읽는다) */
async function addMockQuery(page: Page, key: string, value: string) {
  await page.evaluate(
    ({ key, value }) => {
      const url = new URL(location.href);
      url.searchParams.set(key, value);
      history.replaceState(history.state, '', url.pathname + url.search);
    },
    { key, value },
  );
}

test('번역문 [확인] 응답 유실 → 같은 키·같은 본문으로 재전송해 최초 성공을 확인한다(이력·저장 1회)', async ({ page }) => {
  await reachN5(page);
  // 키가 있는 첫 PATCH 를 서버에 반영·기록한 뒤 응답만 잃는다(lib/msw/handlers.ts ?mockSave=drop-first)
  await addMockQuery(page, 'mockSave', 'drop-first');
  const patches = trackPatches(page, new RegExp(`/blocks/${BLOCK}$`));
  const replayHeaders: (string | null)[] = [];
  page.on('response', (res) => {
    if (res.request().method() === 'PATCH' && res.url().endsWith(`/blocks/${BLOCK}`)) replayHeaders.push(res.headers()['idempotent-replayed'] ?? null);
  });

  const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
  const save = page.getByTestId(`n5-block-save-${BLOCK}`);
  await editor.scrollIntoViewIfNeeded();
  await editor.fill('Recovered after a lost response');
  await save.click();

  await expect.poll(() => patches.length).toBe(2);
  // 재전송 = 같은 대상 · 같은 키 · 같은 본문(revision 포함). 새 키를 만들거나 revision 을 바꾸지 않는다
  expect(patches[0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(patches[1]).toEqual(patches[0]);
  expect(JSON.parse(patches[0].body)).toEqual({ trans1: 'Recovered after a lost response', revision: expect.any(Number) });
  await expect.poll(() => replayHeaders).toContain('true');

  // 최초 요청 성공으로 확인 — 초안이 저장 상태가 되고, 결과 확인 안내 · 잠금이 풀린다
  await expect(save).toBeDisabled();
  await expect(editor).toHaveValue('Recovered after a lost response');
  await expect(page.getByTestId('n5-uncertain-save-notice')).toHaveCount(0);
  await expect(page.getByTestId('n5-confirm-button')).toBeEnabled();
  expect(patches).toHaveLength(2); // 추가 저장 없음
});

test('섹션 제외·되돌리기 PATCH 는 서버 revision 과 새 멱등 키를 보낸다', async ({ page }) => {
  await reachN5(page);
  await page.getByTestId('n5-fit-height').click();
  const patches = trackPatches(page, /\/sections\/\d+$/);

  await page.getByTestId('n5-section-exclude-501').click();
  await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
  await page.getByTestId('n5-section-restore-501').click();
  await expect(page.getByTestId('n5-section-excluded-501')).toHaveCount(0);

  expect(patches.map((p) => JSON.parse(p.body))).toEqual([
    { action: 'exclude', revision: 1 },
    { action: 'restore', revision: 2 }, // 제외 응답의 revision(서버 +1) — FE 가 만들지 않는다
  ]);
  expect(patches.every((p) => p.key && /^[0-9a-f-]{36}$/.test(p.key))).toBe(true);
  expect(patches[0].key).not.toBe(patches[1].key); // 새 사용자 조작 = 새 키
});

test('12월 화면 — 일반 Undo/Redo 버튼과 캔버스 단축키가 없고, 섹션 제외 뒤 [되돌리기]는 그대로다', async ({ page }) => {
  await reachN5(page);
  await page.getByTestId('n5-fit-height').click();
  await expect(page.getByTestId('n5-undo-redo')).toHaveCount(0);
  await expect(page.getByTestId('n5-undo')).toHaveCount(0);

  const patches = trackPatches(page, /\/(sections|blocks)\/\d+$/);
  await page.getByTestId('n5-section-exclude-501').click();
  await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
  expect(patches).toHaveLength(1);

  // 캔버스 단축키 — 이력이 있어도 실행 취소 저장을 보내지 않는다
  await page.getByTestId('n5-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(500);
  expect(patches).toHaveLength(1);
  await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();

  // [되돌리기](F-CFM-14)는 유지
  await page.getByTestId('n5-section-restore-501').click();
  await expect(page.getByTestId('n5-section-excluded-501')).toHaveCount(0);
  expect(JSON.parse(patches.at(-1)!.body).action).toBe('restore');

  // 번역문 입력칸의 글자 실행 취소는 브라우저 기본 동작 그대로
  const editor = page.getByTestId(`n5-block-editor-${BLOCK}`);
  await editor.scrollIntoViewIfNeeded();
  const original = await editor.inputValue();
  await editor.click();
  await editor.press('End');
  await editor.pressSequentially('X');
  await expect(editor).toHaveValue(`${original}X`);
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveValue(original);
});

test('N6 최종 렌더 중 — 좌측 뷰어에 /preview 미리보기(포함 섹션)를 보이고 최종 산출물로 표시하지 않는다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-clean' });
  const previewGets: number[] = [];
  page.on('request', (req) => {
    if (req.method() === 'GET' && new URL(req.url()).pathname.endsWith('/preview')) previewGets.push(Date.now());
  });
  await page.getByTestId('n5-confirm-button').click();

  await expect(page.getByTestId('n6-render-progress')).toBeVisible({ timeout: 10_000 });
  const interim = page.getByTestId('n6-interim-preview');
  await expect(interim).toBeVisible();
  await expect(interim.locator('img').first()).toBeVisible();
  await expect(page.getByTestId('n6-interim-preview-notice')).toContainText('최종 결과물이 아닌 미리보기입니다.');
  await expect(page.getByTestId('n6-final-preview')).toHaveCount(0);
  await expect(page.getByTestId('n6-preparing-banner')).toBeVisible();
  expect(previewGets.length).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('n6-interim-preview.png') });
});

test('N6 최종 렌더 성공 — 실제 산출물로 바뀌고, 늦게 도착한 미리보기 응답이 덮지 않는다', async ({ page }) => {
  await reachN5(page, { mockScenario: 'n5-clean' });
  // N6 의 /preview 응답을 렌더 완료 뒤에 도착하게 늦춘다
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const isN6 = !document.querySelector('[data-testid="n5-panel"]');
      if (isN6 && (init?.method ?? 'GET') === 'GET' && /\/preview$/.test(new URL(url, location.href).pathname)) {
        return new Promise((resolve) => setTimeout(resolve, 9_000)).then(() => originalFetch(input, init));
      }
      return originalFetch(input, init);
    };
  });
  await page.getByTestId('n5-confirm-button').click();

  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 15_000 });
  const finalPreview = page.getByTestId('n6-final-preview');
  await expect(finalPreview.locator('img').first()).toBeVisible();
  await expect(finalPreview.locator('img').first()).toHaveAttribute('alt', '번역 결과 이미지');
  // 늦은 미리보기 응답이 도착할 시간을 넘겨도 최종 산출물 그대로
  await page.waitForTimeout(9_500);
  await expect(page.getByTestId('n6-interim-preview')).toHaveCount(0);
  await expect(finalPreview).toBeVisible();
  await expect(page.getByTestId('n6-completion-banner')).toBeVisible();
});
