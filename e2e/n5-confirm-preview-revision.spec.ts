import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { enableN5GeneralHistoryForTest } from './helpers/n5-general-history';

// 보존한 일반 실행 취소·다시 실행 검증 — 12월 화면에서는 숨겼으므로 Mock 전용 스위치를 켠다(e2e/helpers/n5-general-history.ts)
test.beforeEach(async ({ page }) => {
  await enableN5GeneralHistoryForTest(page);
});

// ─────────────────────────────────────────────────────────────────
// N5 [저장하러 가기] 저장 revision 정합 + 최종 저장 중 편집 잠금.
//
// 완료 조건 = 저장한 모든 block 의 PATCH 응답 revision 이 /blocks 와 /preview renderInput 에 그대로 있고(빈 번역은 renderInput 에서 빠짐),
// 섹션 render.isCurrent=true. 더 큰 revision(다른 탭 저장)은 정상 완료가 아니다. 확정 직전(확인창 경로 포함)에 한 번 더 확인한다.
// [저장하러 가기]부터 확정까지 편집 세션을 잠가, 저장 대상을 정한 뒤 생긴 local 수정이 confirm 에서 조용히 빠지지 않게 한다.
//
// 「다른 탭」은 같은 Mock 서버 상태에 화면 캐시를 거치지 않는 직접 PATCH 로 흉내 낸다. 이전·더 큰 revision 의 /preview,
// 입력 오류는 화면이 받는 응답을 테스트에서 바꿔 만든다(page.route 는 Service Worker 응답을 가로채지 못해 window.fetch 를 감싼다).
// Mock 이다 — 실서버 검증이 아니다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const A = 9101;
const B = 9102;
const C = 9111;

type PreviewRewrite =
  | { kind: 'lag'; blockId: number; count: number }
  | { kind: 'newer'; blockId: number }
  | { kind: 'input-error'; sectionId: number }
  | null;
type Opts = { holdBlock: number | null; preview: PreviewRewrite };
type Recorder = {
  log: string[];
  opts: Opts;
  release: (() => void) | null;
  original: typeof fetch;
  patchRevisions: Record<string, number>;
  lastPreview: { sections: { id: number; renderInput: { blocks: { blockId: number; revision: number }[] } | null; render: { isCurrent: boolean } | null }[] } | null;
};

async function instrument(page: Page, opts: Opts = { holdBlock: null, preview: null }) {
  await page.evaluate((opts) => {
    const w = window as unknown as { __rec: Recorder };
    const original = window.fetch.bind(window);
    w.__rec = { log: [], opts, release: null, original, patchRevisions: {}, lastPreview: null };
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, location.href);
      const method = (init?.method ?? 'GET').toUpperCase();
      const rec = w.__rec;
      const block = pathname.match(/\/blocks\/(\d+)$/);
      if (method === 'PATCH' && block) {
        const id = block[1];
        rec.log.push(`PATCH start ${id}`);
        const response = await original(input, init);
        if (rec.opts.holdBlock === Number(id)) await new Promise<void>((resolve) => (rec.release = resolve));
        if (!response.ok) {
          rec.log.push(`PATCH fail ${id}`);
          return response;
        }
        const body = await response.clone().json();
        rec.patchRevisions[id] = body.block.revision;
        rec.log.push(`PATCH ok ${id} rev=${body.block.revision}`);
        return response;
      }
      if (method === 'POST' && pathname.endsWith('/confirm')) rec.log.push('POST confirm');
      if (method === 'GET' && pathname.endsWith('/preview')) {
        const response = await original(input, init);
        const body = await response.json();
        const rewrite = rec.opts.preview;
        const patchedAll = Object.keys(rec.patchRevisions).length > 0;
        for (const section of body.sections ?? []) {
          if (rewrite?.kind === 'input-error' && patchedAll && section.id === rewrite.sectionId) {
            section.renderInput = null;
            section.inputFingerprint = null;
            section.inputError = { code: 'RENDER_INPUT_INVALID', blockIds: [] };
            section.render = { ...section.render, isCurrent: false };
          }
          for (const item of section.renderInput?.blocks ?? []) {
            // 서버가 isCurrent=true 를 낸 응답에서만 낮춘다 — 「현재 미리보기」만 보면 바로 확정해 버리는 상태
            if (rewrite?.kind === 'lag' && item.blockId === rewrite.blockId && rec.patchRevisions[String(item.blockId)] != null && rewrite.count > 0 && section.render?.isCurrent) {
              item.revision -= 1;
              rewrite.count -= 1;
              rec.log.push(`PREVIEW lag ${item.blockId}`);
            }
            if (rewrite?.kind === 'newer' && item.blockId === rewrite.blockId && rec.patchRevisions[String(item.blockId)] != null) item.revision += 1;
          }
        }
        rec.lastPreview = body;
        rec.log.push('GET preview');
        return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
      }
      return original(input, init);
    };
  }, opts);
}

const rec = (page: Page) => page.evaluate(() => (window as unknown as { __rec: Omit<Recorder, 'original' | 'release'> }).__rec);
const log = async (page: Page) => (await rec(page)).log;
const confirms = async (page: Page) => (await log(page)).filter((entry) => entry === 'POST confirm').length;
const release = (page: Page) => page.evaluate(() => (window as unknown as { __rec: Recorder }).__rec.release?.());

async function open(page: Page, extra: Record<string, string> = {}, scenario: string | null = 'n5-clean') {
  const search = new URLSearchParams({ qaTypeset: '1', ...(scenario ? { mockScenario: scenario } : {}), ...extra });
  await page.goto(`/jobs/${MOCK_JOB_ID}?${search}`);
  await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('n5-slice-translated-501')).toHaveAttribute('data-preview-display', 'local-typeset');
}

async function setMockParam(page: Page, key: string, value: string | null) {
  await page.evaluate(
    ([key, value]) => {
      const url = new URL(location.href);
      if (value == null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
      history.replaceState(history.state, '', url);
    },
    [key, value] as const,
  );
}

const editor = (page: Page, id: number) => page.getByTestId(`n5-block-editor-${id}`);
async function editDraft(page: Page, blockId: number, text: string) {
  await editor(page, blockId).scrollIntoViewIfNeeded();
  await editor(page, blockId).fill(text);
}

/** 다른 탭의 저장 — 화면 캐시·감싼 fetch 를 거치지 않고 같은 서버(Mock)에 PATCH 한다 */
async function externalSave(page: Page, blockId: number, text: string) {
  return page.evaluate(
    async ([jobId, blockId, text]) => {
      const original = (window as unknown as { __rec: Recorder }).__rec.original;
      const blocks = (await (await original(`/jobs/${jobId}/blocks`)).json()) as { id: number; revision: number }[];
      const current = blocks.find((block) => block.id === blockId)!;
      const res = await original(`/jobs/${jobId}/blocks/${blockId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trans1: text, revision: current.revision }),
      });
      return { status: res.status, revision: ((await res.json()) as { block: { revision: number } }).block.revision };
    },
    [MOCK_JOB_ID, blockId, text] as const,
  );
}

const serverBlocks = (page: Page) =>
  page.evaluate(async (jobId) => {
    const original = (window as unknown as { __rec: Recorder }).__rec.original;
    return (await (await original(`/jobs/${jobId}/blocks`)).json()) as {
      id: number;
      revision: number;
      trans1: string;
      layoutAdjust: { box: unknown; fontScale: number | null } | null;
    }[];
  }, MOCK_JOB_ID);

async function expectN6(page: Page) {
  await expect(page.getByTestId('n5-panel')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 30_000 });
}

/** React 가 듣는 input 이벤트를 강제로 보낸다(readOnly·disabled 를 우회한 입력 — handler 잠금 확인용) */
async function forceInput(page: Page, blockId: number, text: string) {
  await editor(page, blockId).evaluate((el, text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

test('1 — 같은 섹션 3 block: 확정 직전 /preview renderInput 이 세 PATCH 응답 revision 을 모두 담고 isCurrent', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page);
  await editDraft(page, A, 'Revision A');
  await editDraft(page, B, 'Revision B');
  await editDraft(page, C, 'Revision C');
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  const { patchRevisions, lastPreview } = await rec(page);
  const s501 = lastPreview!.sections.find((section) => section.id === 501)!;
  expect(s501.render!.isCurrent).toBe(true);
  const inPreview = Object.fromEntries(s501.renderInput!.blocks.map((block) => [String(block.blockId), block.revision]));
  for (const id of [A, B, C]) expect(inPreview[String(id)]).toBe(patchRevisions[String(id)]);
  await expectN6(page);
});

test('4 — 다른 탭 저장(내 PATCH 뒤 revision +1) → 미리보기가 current 여도 confirm 0 · N5 유지 · 그 칸 선택', async ({ page }) => {
  await open(page, { mockRender: 'supersede', mockRenderHold: '501' });
  await instrument(page);
  await editDraft(page, A, 'Mine A');
  await page.getByTestId('n5-confirm-button').click();
  await expect.poll(async () => (await log(page)).some((entry) => entry.startsWith(`PATCH ok ${A}`)), { timeout: 20_000 }).toBe(true);
  const mine = (await rec(page)).patchRevisions[String(A)];

  const other = await externalSave(page, A, 'Other tab A');
  expect(other.status).toBe(200);
  expect(other.revision).toBe(mine + 1);
  await setMockParam(page, 'mockRenderHold', null);

  await expect(page.getByTestId('n5-confirm-error')).toContainText('다른 곳에서 내용이 바뀌어', { timeout: 30_000 });
  expect(await confirms(page)).toBe(0);
  await expect(page.getByTestId('n5-panel')).toBeVisible();
  await expect(page.getByTestId(`n5-block-row-${A}`)).toHaveAttribute('aria-pressed', 'true');
  // 서버 최신값으로 덮어쓰거나 지우지 않고, 다른 탭 값이 서버 정본으로 보인다(내 초안은 이미 저장됐다)
  await expect(editor(page, A)).toHaveValue('Other tab A');
  await page.waitForTimeout(1_000);
  expect(await confirms(page)).toBe(0);
  await expect(page.getByTestId('n5-confirm-button')).toBeEnabled();
});

test('5·6 — 저장 중(PATCH 대기) 번역 입력 · 박스 이동 · 배율 · 실행 취소가 시작되지 않고, 이미 있던 초안만 저장된 뒤 N6', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page, { holdBlock: A, preview: null });
  await editDraft(page, A, 'Locked A');
  await editDraft(page, B, 'Locked B');
  const before = new Map((await serverBlocks(page)).map((block) => [block.id, block]));
  await page.getByTestId('n5-confirm-button').click();
  await expect.poll(async () => (await log(page)).includes(`PATCH start ${A}`), { timeout: 20_000 }).toBe(true);
  await expect(page.getByTestId('n5-confirm-button')).toHaveText('저장하는 중…');

  // 번역 입력 — UI 는 readOnly, 강제 input 이벤트도 handler 가 무시한다
  await expect(editor(page, C)).toHaveAttribute('readonly', '');
  await forceInput(page, C, 'Sneaky C');
  await expect(editor(page, C)).toHaveValue(before.get(C)!.trans1);
  // [확인] 강제 클릭도 저장을 시작하지 않는다
  await page.getByTestId(`n5-block-save-${C}`).click({ force: true }).catch(() => {});
  // 박스 이동 · 배율 · 실행 취소(단축키)
  await page.getByTestId(`n5-block-pin-${C}`).click({ force: true });
  const overlay = page.getByTestId(`n5-block-overlay-${C}`);
  const box = (await overlay.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4 + 40, box.y + box.height * 0.6 + 20, { steps: 8 });
  await page.mouse.up();
  const increase = page.getByTestId('n5-font-scale-increase');
  if (await increase.count()) await increase.click({ force: true });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Meta+z');

  await release(page);
  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  const patched = (await log(page)).filter((entry) => entry.startsWith('PATCH start')).map((entry) => Number(entry.split(' ')[2]));
  expect(patched).toEqual([A, B]);
  await expectN6(page);
  const after = new Map((await serverBlocks(page)).map((block) => [block.id, block]));
  expect(after.get(A)!.trans1).toBe('Locked A');
  expect(after.get(B)!.trans1).toBe('Locked B');
  // C 는 저장 중 시작된 어떤 수정도 남기지 않았다(서버 그대로 · local 초안이 남은 채 N6 로 가지 않았다)
  expect(after.get(C)!.trans1).toBe(before.get(C)!.trans1);
  expect(after.get(C)!.revision).toBe(before.get(C)!.revision);
  expect(after.get(C)!.layoutAdjust ?? null).toEqual(before.get(C)!.layoutAdjust ?? null);
});

test('7 — 빈 번역 저장: renderInput 에서 빠진 것을 정상 완료로 보고 상한 polling 없이 N6', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page);
  await editDraft(page, A, '');
  const started = Date.now();
  await page.getByTestId('n5-confirm-button').click();
  const dialog = page.getByTestId('n5-review-dialog');
  await expect.poll(async () => (await confirms(page)) > 0 || (await dialog.isVisible()), { timeout: 30_000 }).toBe(true);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: '저장하러 가기' }).click();
  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  expect(Date.now() - started).toBeLessThan(40_000);
  const { patchRevisions, lastPreview } = await rec(page);
  expect(patchRevisions[String(A)]).toBeGreaterThan(0);
  const s501 = lastPreview!.sections.find((section) => section.id === 501)!;
  expect(s501.render!.isCurrent).toBe(true);
  expect(s501.renderInput!.blocks.map((block) => block.blockId)).not.toContain(A);
  await expectN6(page);
  expect((await serverBlocks(page)).find((block) => block.id === A)!.trans1).toBe('');
});

test('9 — /preview 가 current 인데 아직 이전 revision 이면 기다렸다가 기대 revision 이 된 뒤 confirm', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page, { holdBlock: null, preview: { kind: 'lag', blockId: A, count: 6 } });
  await editDraft(page, A, 'Lagging A');
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(() => confirms(page), { timeout: 40_000 }).toBe(1);
  const entries = await log(page);
  const confirmAt = entries.indexOf('POST confirm');
  const lags = entries.filter((entry, i) => entry === `PREVIEW lag ${A}` && i < confirmAt).length;
  // 이전 revision 응답이 남아 있는 동안에는 확정하지 않았다(현재 미리보기만 보면 첫 current 응답에서 확정한다)
  expect(lags).toBe(6);
  expect(entries.lastIndexOf('GET preview', confirmAt)).toBeGreaterThan(entries.lastIndexOf(`PREVIEW lag ${A}`));
  const { patchRevisions, lastPreview } = await rec(page);
  const s501 = lastPreview!.sections.find((section) => section.id === 501)!;
  expect(s501.renderInput!.blocks.find((block) => block.blockId === A)!.revision).toBe(patchRevisions[String(A)]);
  await expectN6(page);
});

test('10 — /preview renderInput 이 기대보다 큰 revision → 다른 저장으로 보고 confirm 0', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page, { holdBlock: null, preview: { kind: 'newer', blockId: A } });
  await editDraft(page, A, 'Newer A');
  await page.getByTestId('n5-confirm-button').click();

  await expect(page.getByTestId('n5-confirm-error')).toContainText('다른 곳에서 내용이 바뀌어', { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  expect(await confirms(page)).toBe(0);
  await expect(page.getByTestId('n5-panel')).toBeVisible();
});

test('11 — inputError → 바로 멈춘다(confirm 0 · 무한 polling 없음)', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page, { holdBlock: null, preview: { kind: 'input-error', sectionId: 501 } });
  await editDraft(page, A, 'Input error A');
  await page.getByTestId('n5-confirm-button').click();

  await expect(page.getByTestId('n5-confirm-error')).toContainText('미리보기를 다시 만들지 못한 칸', { timeout: 20_000 });
  // 장벽의 2초 polling 은 멈췄다 — Mock 시도가 끝날 때 화면이 한 번 다시 받는 재조회(약 4초 뒤)가 지난 뒤에는 더 늘지 않는다
  await page.waitForTimeout(8_000);
  const gets = (await log(page)).filter((entry) => entry === 'GET preview').length;
  await page.waitForTimeout(6_000);
  expect((await log(page)).filter((entry) => entry === 'GET preview').length - gets).toBeLessThanOrEqual(1);
  expect(await confirms(page)).toBe(0);
  await expect(editor(page, A)).toHaveValue('Input error A');
});

test('14 — 확인창이 열린 사이 다른 탭 저장 → [확인하고 저장]에서 다시 확인해 confirm 0', async ({ page }) => {
  // 기본 fixture 는 확인 항목이 있어 장벽 통과 뒤 확인창이 열린다
  await open(page, { mockRender: 'supersede' }, null);
  await instrument(page);
  await editDraft(page, A, 'Dialog A');
  await page.getByTestId('n5-confirm-button').click();
  const dialog = page.getByTestId('n5-review-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  expect(await confirms(page)).toBe(0);

  const other = await externalSave(page, A, 'Other tab during dialog');
  expect(other.status).toBe(200);
  await dialog.getByRole('button', { name: '저장하러 가기' }).click();

  await expect(page.getByTestId('n5-confirm-error')).toContainText('다른 곳에서 내용이 바뀌어', { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  expect(await confirms(page)).toBe(0);
  await expect(page.getByTestId('n5-panel')).toBeVisible();
});
