import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N5 [저장하러 가기] 섹션 입력 지문 A=B 조건 — 기존 revision 정합에 더하는 조건이다.
//
// A = 장벽 회차의 /blocks sectionInputFingerprint, B = 같은 회차 /preview sections[].inputFingerprint.
// A·B 가 둘 다 값이고 같을 때만 confirm 한다. 다르거나 null 이면 오류로 멈추지 않고 bounded polling 안에서 다시 조회한다.
//
// 화면이 받는 /blocks 응답의 지문을 테스트에서 바꿔 A≠B·A=null 을 만든다(page.route 는 Service Worker 응답을
// 가로채지 못해 window.fetch 를 감싼다). Mock 이다 — 실서버 검증이 아니다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(120_000);

const A = 9101;
const B = 9102;
const C = 9111;
const SECTION = 501;

/** 저장 뒤 /blocks 응답 중 SECTION 의 지문을 count 번 바꾼다 */
type BlocksRewrite = { kind: 'mismatch' | 'null'; count: number } | null;
type Recorder = { log: string[]; rewrite: BlocksRewrite; patched: boolean };

async function instrument(page: Page, rewrite: BlocksRewrite = null) {
  await page.evaluate(
    ([rewrite, section]) => {
      const w = window as unknown as { __fp: Recorder };
      const original = window.fetch.bind(window);
      w.__fp = { log: [], rewrite, patched: false };
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const { pathname, search } = new URL(url, location.href);
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const rec = w.__fp;
        if (method === 'PATCH' && /\/blocks\/\d+$/.test(pathname)) {
          const response = await original(input, init);
          if (response.ok) rec.patched = true;
          rec.log.push(`PATCH ${response.status}`);
          return response;
        }
        if (method === 'POST' && pathname.endsWith('/confirm')) rec.log.push('POST confirm');
        if (method === 'POST' && pathname.endsWith('/render')) rec.log.push('POST render');
        // 장벽은 sectionId 없이 /blocks 전체를 받는다
        if (method === 'GET' && pathname.endsWith('/blocks') && !search.includes('sectionId')) {
          const response = await original(input, init);
          const body = (await response.json()) as { sectionId: number; sectionInputFingerprint: string | null }[];
          const r = rec.rewrite;
          if (r && rec.patched && r.count > 0) {
            for (const block of body) {
              if (block.sectionId !== section) continue;
              block.sectionInputFingerprint = r.kind === 'null' ? null : 'f'.repeat(64);
            }
            r.count -= 1;
            rec.log.push(`BLOCKS ${r.kind}`);
          }
          const a = [...new Set(body.filter((block) => block.sectionId === section).map((block) => block.sectionInputFingerprint ?? 'null'))];
          rec.log.push(`A ${a.join(',')}`);
          return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
        }
        if (method === 'GET' && pathname.endsWith('/preview')) {
          const response = await original(input, init);
          const body = await response.clone().json();
          const s = (body.sections ?? []).find((item: { id: number }) => item.id === section);
          rec.log.push('GET preview');
          rec.log.push(`B ${s?.inputFingerprint ?? 'null'}`);
          (rec as unknown as { lastPreview: unknown }).lastPreview = s;
          return response;
        }
        return original(input, init);
      };
    },
    [rewrite, SECTION] as const,
  );
}

type Snapshot = Omit<Recorder, 'rewrite'> & {
  lastPreview: { inputFingerprint: string | null; renderInput: { blocks: { blockId: number }[] } | null; render: { isCurrent: boolean } | null };
};
const rec = (page: Page) => page.evaluate(() => (window as unknown as { __fp: Snapshot }).__fp);
const count = async (page: Page, entry: string) => (await rec(page)).log.filter((item) => item === entry).length;

async function open(page: Page, scenario: string | null = 'n5-clean') {
  const search = new URLSearchParams({ qaTypeset: '1', mockRender: 'supersede', ...(scenario ? { mockScenario: scenario } : {}) });
  await page.goto(`/jobs/${MOCK_JOB_ID}?${search}`);
  await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`n5-slice-translated-${SECTION}`)).toHaveAttribute('data-preview-display', 'local-typeset');
}

const editor = (page: Page, id: number) => page.getByTestId(`n5-block-editor-${id}`);
async function editDraft(page: Page, blockId: number, text: string) {
  await editor(page, blockId).scrollIntoViewIfNeeded();
  await editor(page, blockId).fill(text);
}

/** [저장하러 가기] 한 번 — 확인창이 열리면 [확인하고 저장](같은 클릭 흐름의 확인 단계) */
async function confirmOnce(page: Page) {
  await page.getByTestId('n5-confirm-button').click();
  const dialog = page.getByTestId('n5-review-dialog');
  await expect.poll(async () => (await count(page, 'POST confirm')) > 0 || (await dialog.isVisible()), { timeout: 40_000 }).toBe(true);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: '저장하러 가기' }).click();
  await expect.poll(() => count(page, 'POST confirm'), { timeout: 40_000 }).toBe(1);
}

async function expectN6WithoutRenderPost(page: Page) {
  await expect(page.getByTestId('n5-panel')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  expect(await count(page, 'POST render')).toBe(0);
}

/** confirm 직전 마지막 /blocks 지문 A 와 /preview 지문 B — 둘 다 값이고 같아야 한다 */
async function expectLastPairMatched(page: Page) {
  const before = (await rec(page)).log.slice(0, (await rec(page)).log.indexOf('POST confirm'));
  const a = before.findLast((entry) => entry.startsWith('A '))!.slice(2);
  const b = before.findLast((entry) => entry.startsWith('B '))!.slice(2);
  expect(b).not.toBe('null');
  expect(a).toBe(b);
}

test('1·6·7 — 정상 저장 1건: A=B → [저장하러 가기] 한 번으로 N6 · N6 자동 POST /render 0회', async ({ page }) => {
  await open(page);
  await instrument(page);
  await editDraft(page, A, 'Fingerprint A');
  await confirmOnce(page);
  await expectLastPairMatched(page);
  await expectN6WithoutRenderPost(page);
});

test('2 — A≠B: confirm 하지 않고 다시 조회 → 다음 조회에서 A=B 가 되면 진행', async ({ page }) => {
  await open(page);
  await instrument(page, { kind: 'mismatch', count: 3 });
  await editDraft(page, A, 'Mismatch A');
  await page.getByTestId('n5-confirm-button').click();
  await expect.poll(async () => (await rec(page)).log.filter((entry) => entry === 'BLOCKS mismatch').length, { timeout: 30_000 }).toBe(3);
  await expect.poll(() => count(page, 'POST confirm'), { timeout: 40_000 }).toBe(1);
  const { log } = await rec(page);
  // 바꾼 응답이 남아 있는 동안에는 확정하지 않았고, 오류 안내도 없었다
  expect(log.indexOf('POST confirm')).toBeGreaterThan(log.lastIndexOf('BLOCKS mismatch'));
  await expect(page.getByTestId('n5-confirm-error')).toHaveCount(0);
  await expectLastPairMatched(page);
  await expectN6WithoutRenderPost(page);
});

test('3 — A=null: 비교할 수 없으면 완료로 보지 않는다(confirm 0) · 값이 돌아오면 진행', async ({ page }) => {
  await open(page);
  await instrument(page, { kind: 'null', count: 4 });
  await editDraft(page, A, 'Null A');
  await page.getByTestId('n5-confirm-button').click();
  await expect.poll(async () => (await rec(page)).log.filter((entry) => entry === 'BLOCKS null').length, { timeout: 30_000 }).toBe(4);
  const { log } = await rec(page);
  expect(log.filter((entry, i) => entry === 'POST confirm' && i < log.lastIndexOf('BLOCKS null'))).toEqual([]);
  await expect.poll(() => count(page, 'POST confirm'), { timeout: 40_000 }).toBe(1);
  const after = await rec(page);
  expect(after.log.indexOf('POST confirm')).toBeGreaterThan(after.log.lastIndexOf('BLOCKS null'));
  await expectLastPairMatched(page);
});

test('4 — 일부 번역문 비우기: renderInput 에서 빠지고 A=B 후 N6', async ({ page }) => {
  await open(page);
  await instrument(page);
  await editDraft(page, A, '');
  await confirmOnce(page);
  const { lastPreview } = await rec(page);
  expect(lastPreview.render!.isCurrent).toBe(true);
  expect(lastPreview.renderInput!.blocks.map((block) => block.blockId)).not.toContain(A);
  await expectLastPairMatched(page);
  await expectN6WithoutRenderPost(page);
});

test('5 — 섹션 전체 번역문 비우기: renderInput.blocks=[] · A=B 후 N6', async ({ page }) => {
  await open(page);
  await instrument(page);
  for (const id of [A, B, C]) await editDraft(page, id, '');
  await confirmOnce(page);
  const { lastPreview } = await rec(page);
  expect(lastPreview.render!.isCurrent).toBe(true);
  expect(lastPreview.renderInput!.blocks).toEqual([]);
  expect(lastPreview.inputFingerprint).not.toBeNull();
  await expectLastPairMatched(page);
  await expectN6WithoutRenderPost(page);
});
