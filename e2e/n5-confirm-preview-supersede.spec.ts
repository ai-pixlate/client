import { type Page, expect, test } from '@playwright/test';

import { MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { enableN5GeneralHistoryForTest } from './helpers/n5-general-history';

// 보존한 일반 실행 취소·다시 실행 검증 — 12월 화면에서는 숨겼으므로 Mock 전용 스위치를 켠다(e2e/helpers/n5-general-history.ts)
test.beforeEach(async ({ page }) => {
  await enableN5GeneralHistoryForTest(page);
});

// ─────────────────────────────────────────────────────────────────
// N5 [저장하러 가기] 미리보기 장벽 — 같은 섹션의 앞선 미리보기 시도가 대체(superseded)되는 실제 BE 동작.
//
// 실 BE 재현: 같은 섹션 블록 A·B·C 를 이어서 저장하면 PATCH 응답 task 133·134·135 중 133·134 는 cancelled/superseded 되고
// /tasks 는 현재 시도만 돌려준다. 예전 FE 는 받은 task 가 모두 done 이 되길 기다려 timeout 됐다.
// 이제 완료 기준은 「모든 PATCH 성공 → 영향받은 섹션의 /preview 현재 상태(input ready + render.isCurrent)」다.
//
// Mock 은 ?mockRender=supersede(앞선 task 를 /tasks 에서 뺀다 — 계약상 cancelled 제외) ·
// supersede-cancelled(cancelled 로 남긴다) · mockRenderHold=<sectionId>(그 섹션 현재 시도를 running 에 붙잡는다)로 그 동작을 흉내 낸다.
// 이 모드에서는 /tasks polling 없이도 /preview 조회만으로 시도가 진행된다. 실서버 검증이 아니다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const S501 = [9101, 9102, 9111] as const;
const B502 = 9103;

type Rewrite = { patchTaskId: Record<string, number | null | 'keep'> };
type Recorder = { log: string[]; rewrite: Rewrite; tasksSeen: number[][]; previewGets: number };

/**
 * fetch 를 감싸 순서를 남기고, 필요하면 PATCH 응답의 rerenderTaskId 를 바꾼다(MSW 응답 뒤 · 앱이 읽기 전).
 * page.route 는 Service Worker 응답을 가로채지 못해 window.fetch 를 감싼다.
 */
async function instrument(page: Page, rewrite: Rewrite = { patchTaskId: {} }) {
  await page.evaluate((rewrite) => {
    const w = window as unknown as { __rec: Recorder };
    w.__rec = { log: [], rewrite, tasksSeen: [], previewGets: 0 };
    const original = window.fetch.bind(window);
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
        if (!response.ok) {
          rec.log.push(`PATCH fail ${id}`);
          return response;
        }
        const body = await response.json();
        rec.log.push(`PATCH ok ${id} task=${body.rerenderTaskId}`);
        const replacement = rec.rewrite.patchTaskId[id];
        if (replacement !== undefined && replacement !== 'keep') body.rerenderTaskId = replacement;
        return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
      }
      if (method === 'POST' && pathname.endsWith('/confirm')) rec.log.push('POST confirm');
      if (method === 'GET' && pathname.endsWith('/preview')) rec.previewGets += 1;
      if (method === 'GET' && pathname.endsWith('/tasks')) {
        const response = await original(input, init);
        const body = await response.clone().json().catch(() => null);
        rec.tasksSeen.push(((body?.items ?? []) as { taskId: number; unitType: string }[]).filter((i) => i.unitType === 'text_block').map((i) => i.taskId));
        return response;
      }
      return original(input, init);
    };
  }, rewrite);
}

const rec = (page: Page) => page.evaluate(() => (window as unknown as { __rec: Recorder }).__rec);
const confirms = async (page: Page) => (await rec(page)).log.filter((entry) => entry === 'POST confirm').length;
/** PATCH 응답이 준 task(서버 원본 값) */
const patchTasks = async (page: Page) =>
  (await rec(page)).log.flatMap((entry) => {
    const match = entry.match(/^PATCH ok (\d+) task=(\d+|null)$/);
    return match ? [{ blockId: Number(match[1]), taskId: match[2] === 'null' ? null : Number(match[2]) }] : [];
  });

async function open(page: Page, extra: Record<string, string>) {
  const search = new URLSearchParams({ qaTypeset: '1', mockScenario: 'n5-clean', ...extra });
  await page.goto(`/jobs/${MOCK_JOB_ID}?${search}`);
  await expect(page.getByTestId('n5-qa-badge')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('n5-slice-translated-501')).toHaveAttribute('data-preview-display', 'local-typeset');
}

/** 주소의 Mock 옵션을 바꾼다(MSW 가 request.referrer 로 읽는다) */
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

async function editDraft(page: Page, blockId: number, text: string) {
  const editor = page.getByTestId(`n5-block-editor-${blockId}`);
  await editor.scrollIntoViewIfNeeded();
  await editor.fill(text);
}

async function expectN6(page: Page) {
  await expect(page.getByTestId('n5-panel')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('번역이 완료되었습니다.')).toBeVisible({ timeout: 30_000 });
}

/** 서버(Mock) 정본 블록 — confirm 이 최종 렌더 입력으로 고정한 값과 같은 저장소 */
const serverBlocks = (page: Page) =>
  page.evaluate(async (jobId) => {
    const res = await fetch(`/jobs/${jobId}/blocks`);
    return (await res.json()) as { id: number; trans1: string; layoutAdjust: { box: { x: number; y: number; w: number; h: number } | null; fontScale: number | null } | null }[];
  }, MOCK_JOB_ID);

test('A — 같은 섹션 번역문 3 block: 앞선 task 2개가 /tasks 에서 사라져도 현재 미리보기 완료로 confirm 1회 · N6', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page);
  await editDraft(page, S501[0], 'Supersede A');
  await editDraft(page, S501[1], 'Supersede B');
  await editDraft(page, S501[2], 'Supersede C');
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  const tasks = await patchTasks(page);
  expect(tasks.map((t) => t.blockId)).toEqual([...S501]);
  const [t1, t2, t3] = tasks.map((t) => t.taskId as number);
  // 앞선 두 task 는 대체돼 /tasks 에서 사라졌다(현재 시도만 남는다) — 그런데도 기다리지 않고 진행했다
  const current = await page.evaluate(async (jobId) => {
    const body = (await (await fetch(`/jobs/${jobId}/tasks`)).json()) as { items: { taskId: number; unitType: string }[] };
    return body.items.filter((item) => item.unitType === 'text_block').map((item) => item.taskId);
  }, MOCK_JOB_ID);
  expect(current).not.toContain(t1);
  expect(current).not.toContain(t2);
  expect(current).toContain(t3);
  const log = (await rec(page)).log;
  expect(log.indexOf(`PATCH ok ${S501[2]} task=${t3}`)).toBeLessThan(log.indexOf('POST confirm'));
  await expectN6(page);
  expect(await confirms(page)).toBe(1);
});

test('B — 같은 섹션 혼합(번역 · 박스 · 번역+배율): 최종 current 미리보기로 진행 · 서버 최종값에 모두 반영', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page);
  await editDraft(page, S501[0], 'Mixed translation A');
  // B — 박스 이동
  await page.getByTestId(`n5-block-pin-${S501[1]}`).click();
  await expect(page.getByTestId('n5-block-selection')).toBeVisible();
  const overlay = page.getByTestId(`n5-block-overlay-${S501[1]}`);
  const b = (await overlay.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.4 + 15, b.y + b.height * 0.6 + 10, { steps: 6 });
  await page.mouse.move(b.x + b.width * 0.4 + 30, b.y + b.height * 0.6 + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('n5-undo')).toBeEnabled();
  // C — 번역 + 글자 배율
  await page.getByTestId(`n5-block-pin-${S501[2]}`).click();
  await expect(page.getByTestId('n5-font-scale-toolbar')).toBeVisible();
  await page.getByTestId('n5-font-scale-increase').click();
  await expect(page.getByTestId(`n5-block-overlay-${S501[2]}`)).toHaveAttribute('data-font-scale', '1.05');
  await editDraft(page, S501[2], 'Mixed translation C');

  await page.getByTestId('n5-confirm-button').click();
  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  expect((await patchTasks(page)).map((t) => t.blockId)).toEqual([...S501]);
  await expectN6(page);

  const latest = await serverBlocks(page);
  const byId = new Map(latest.map((block) => [block.id, block]));
  expect(byId.get(S501[0])!.trans1).toBe('Mixed translation A');
  expect(byId.get(S501[1])!.layoutAdjust?.box).not.toBeNull();
  expect(byId.get(S501[2])!.trans1).toBe('Mixed translation C');
  expect(byId.get(S501[2])!.layoutAdjust?.fontScale).toBe(1.05);
});

test('C — 여러 섹션: 501 완료 · 502 진행 중이면 confirm 0 → 502 도 current 가 된 뒤 confirm 1회', async ({ page }) => {
  await open(page, { mockRender: 'supersede', mockRenderHold: '502' });
  await instrument(page);
  await editDraft(page, S501[0], 'Multi 501 A');
  await editDraft(page, S501[1], 'Multi 501 B');
  await editDraft(page, B502, 'Multi 502');
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(async () => (await patchTasks(page)).length, { timeout: 20_000 }).toBe(3);
  // 501 은 끝났지만 502 가 running — 몇 번의 polling 동안 확정하지 않는다
  await page.waitForTimeout(7_000);
  expect(await confirms(page)).toBe(0);
  await expect(page.getByTestId('n5-confirm-button')).toBeDisabled();
  await expect(page.getByTestId('n5-confirm-error')).toHaveCount(0);

  await setMockParam(page, 'mockRenderHold', null);
  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  await expectN6(page);
});

test('D — 앞선 task 가 cancelled 로 남아도(supersede-cancelled) 현재 미리보기가 current 면 진행한다', async ({ page }) => {
  await open(page, { mockRender: 'supersede-cancelled' });
  await instrument(page);
  await editDraft(page, S501[0], 'Cancelled A');
  await editDraft(page, S501[1], 'Cancelled B');
  await editDraft(page, S501[2], 'Cancelled C');
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  await expect(page.getByTestId('n5-confirm-error')).toHaveCount(0);
  await expectN6(page);
});

test('E — 마지막 PATCH 응답 taskId 를 최신 시도로 쓰지 않는다(엉뚱한 번호로 바꿔도 /preview 기준으로 진행)', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  // 마지막 응답만 존재하지 않는 task 로, 첫 응답은 가장 큰 번호로 바꾼다 — max(taskId)·마지막 응답 추정이면 영원히 기다리거나 틀린다
  await instrument(page, { patchTaskId: { [S501[0]]: 999_999, [S501[2]]: 1 } });
  await editDraft(page, S501[0], 'Order A');
  await editDraft(page, S501[1], 'Order B');
  await editDraft(page, S501[2], 'Order C');
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  // 최종 저장 PATCH 는 순차다 — 앞 응답을 받은 뒤 다음 요청을 시작한다(응답 역전이 생기지 않는다)
  const patchEntries = (await rec(page)).log.filter((entry) => entry.startsWith('PATCH')).map((entry) => entry.replace(/ task=.*$/, ''));
  expect(patchEntries).toEqual(S501.flatMap((id) => [`PATCH start ${id}`, `PATCH ok ${id}`]));
  await expectN6(page);
});

test('F — no-op: PATCH 응답 rerenderTaskId=null 이어도 그 섹션의 /preview 를 확인하고 current 면 진행한다', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page, { patchTaskId: { [S501[0]]: null } });
  await editDraft(page, S501[0], 'No task A');
  await page.getByTestId('n5-confirm-button').click();

  await expect.poll(() => confirms(page), { timeout: 30_000 }).toBe(1);
  expect((await rec(page)).previewGets).toBeGreaterThan(0);
  await expectN6(page);
});

test('G — 현재 시도 실패: 이전 성공 결과가 있어도 confirm 0 · N5 유지 · polling 이 멈춘다', async ({ page }) => {
  await open(page, { mockRender: 'supersede' });
  await instrument(page);
  await editDraft(page, S501[0], 'Before failure A');
  // 같은 섹션의 마지막 저장이 현재 시도 — 이 블록의 렌더가 실패한다(Mock hook)
  await editDraft(page, S501[1], '실패유도 B');
  await page.getByTestId('n5-confirm-button').click();

  await expect(page.getByTestId('n5-confirm-error')).toContainText('미리보기를 다시 만들지 못한 칸', { timeout: 30_000 });
  expect(await confirms(page)).toBe(0);
  await expect(page.getByTestId('n5-panel')).toBeVisible();
  const gets = (await rec(page)).previewGets;
  await page.waitForTimeout(5_000);
  // 장벽 polling 은 멈췄다(화면의 한 번 재조회 정도만 허용)
  expect((await rec(page)).previewGets - gets).toBeLessThanOrEqual(1);
  expect(await confirms(page)).toBe(0);
});

for (const mode of ['supersede', 'supersede-cancelled'] as const) {
  test(`개별 [확인] — 앞선 칸의 task 가 대체돼도(${mode}) 「재렌더링 중…」에 머물거나 실패로 보이지 않는다`, async ({ page }) => {
    await open(page, { mockRender: mode });
    for (const [id, text] of [
      [S501[0], 'Individual A'],
      [S501[1], 'Individual B'],
    ] as const) {
      await editDraft(page, id, text);
      await page.getByTestId(`n5-block-save-${id}`).click();
      await expect(page.getByTestId(`n5-block-editor-${id}`)).toHaveValue(text);
    }
    const rowA = page.getByTestId(`n5-block-row-${S501[0]}`);
    const rowB = page.getByTestId(`n5-block-row-${S501[1]}`);
    // 섹션 현재 시도(B 의 task)가 끝나면 두 칸 모두 재렌더 표시가 사라진다
    await expect(rowA.getByText('재렌더링 중…')).toHaveCount(0, { timeout: 15_000 });
    await expect(rowB.getByText('재렌더링 중…')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('n5-slice-translated-501')).toHaveAttribute('data-preview-display', 'local-typeset');
    // 대체는 실패가 아니다
    await expect(rowA.getByText('미리보기를 갱신하지 못했습니다')).toHaveCount(0);
    await expect(page.getByTestId(`n5-block-preview-retry-${S501[0]}`)).toHaveCount(0);
  });
}
