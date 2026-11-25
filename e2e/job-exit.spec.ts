import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

import { reachN6 } from './helpers/reach-n6';

// ─────────────────────────────────────────────────────────────────
// N1~N6 공통 작업 나가기(PRD v3.6.4 F-JOB-07 · 화면정의서 S0 · HD) — Chromium.
// 12월에는 ✕ 가 없다. 앱 안의 브라우저 뒤로 가기와 상단 메뉴(로고 · [브랜드 관리] · [로그아웃])가 같은 확인을 거친다.
// - 작업 없는 N1: 미저장 확인 → [나가기] · 요청 없음
// - 작업 있는 N1~N6: 작업 취소 확인(삭제 대상 열거) → 확인 전 DELETE 없음 → 성공 뒤 이동(뒤로 가기 = 보관함 · 메뉴 = 누른 곳 ·
//   로그아웃은 취소 성공 뒤에만) · 실패하면 작업·화면·확인창 유지
// - 완료된 작업(N6 서버 job.isSaved=true — [저장] 또는 첫 다운로드)은 묻지 않는다
// - 새로고침은 취소하지 않는다
// - 상태 조회 중 나가기는 잡아 두었다가 조회 뒤 처리한다(진행 중 = 작업 취소 확인 · 완료·404 = 취소 없이 이동 ·
//   조회 실패 = 「상태를 확인하지 못함」 창 — DELETE 없음, [계속하기]·[다시 확인]·[작업 남기고 나가기])
// - 취소한 작업 주소로 돌아오면 cache 없이 다시 묻고, archived 200·404 어느 쪽이든 편집 화면을 다시 그리지 않는다
// N2~N6 은 폴링 응답의 currentStep 만 고정해 바로 연다. 작업 있는 N1 은 n1-source-upload.spec.ts 가 맡는다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '작업 나가기 검증은 Chromium 기준이다');
test.use({ viewport: { width: 1920, height: 1080 } });

const JOB_URL = new RegExp(`/jobs/${MOCK_JOB_ID}$`);
const JOB_STEPS = ['N2', 'N3', 'N4', 'N5', 'N6'] as const;
const DELETE_TARGETS = ['원본 이미지', '섹션 분해 결과', '인페인팅 결과', '번역문', '판정 근거', '수정 전후 문구', '되돌릴 수 없습니다'];

const dialog = (page: Page) => page.getByTestId('s0-exit-dialog');
const guard = (page: Page) => page.locator('[data-exit-guard]');
const logo = (page: Page) => page.getByTestId('job-header-home');
const brand = (page: Page) => page.getByTestId('job-header-brand');
const logout = (page: Page) => page.getByTestId('job-header').getByTestId('account-logout');
const nav = (page: Page) => page.getByRole('navigation', { name: '작업 진행 단계' });

/** tasks 응답의 currentStep 을 고정한다(window.__s0Step 으로 바꿀 수 있다). isSaved 는 GET /jobs/{id} 의 서버 값을 대신한다 */
async function forceStep(page: Page, step: string, opts: { isSaved?: boolean | 'after-download' } = {}) {
  await page.addInitScript(
    ({ forced, jobId, isSaved }) => {
      const w = window as unknown as { __s0Step: string; __downloaded: boolean; __jobGets: number };
      w.__s0Step = forced;
      w.__downloaded = false;
      w.__jobGets = 0;
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const path = new URL(url, location.href).pathname;
        if (/\/download$/.test(path) && response.ok) w.__downloaded = true;
        if (path === `/jobs/${jobId}` && (!init?.method || init.method === 'GET') && response.ok) {
          w.__jobGets += 1;
          if (isSaved === null) return response;
          const body = await response.json();
          const saved = isSaved === 'after-download' ? w.__downloaded : isSaved;
          return new Response(JSON.stringify({ ...body, isSaved: saved }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (path !== `/jobs/${jobId}/tasks` || !response.ok) return response;
        const body = await response.json();
        const current = w.__s0Step;
        // N6 는 confirm 이 등록한 현재 최종 렌더 task 를 따라간다 — 강제로 들어갈 때도 완료된 job 단위 render task 를 준다
        const items =
          current === 'N6'
            ? [...(body.items ?? []), { taskId: 990001, taskType: 'render', unitType: 'job', unitId: Number(jobId), status: 'done' }]
            : body.items;
        return new Response(JSON.stringify({ ...body, items, currentStep: current, jobStatus: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    },
    { forced: step, jobId: MOCK_JOB_ID, isSaved: opts.isSaved ?? null },
  );
}

const setServerStep = (page: Page, step: string) =>
  page.evaluate((next) => {
    (window as unknown as { __s0Step: string }).__s0Step = next;
  }, step);

/** 보관함에서 들어온 것처럼 history 앞에 보관함을 두고 연다 — 뒤로 가기가 앱 안 이동이 되게 한다 */
async function openJob(page: Page, step: string, opts: { isSaved?: boolean | 'after-download'; expectGuard?: 'on' | 'off' } = {}) {
  await forceStep(page, step, opts);
  await page.goto('/');
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(nav(page).locator('[aria-current="step"]')).toBeVisible({ timeout: 15_000 });
  if (step === 'N6') await expect(page.getByTestId('n6-export-panel')).toBeVisible({ timeout: 15_000 });
  await expect(guard(page)).toHaveAttribute('data-exit-guard', opts.expectGuard ?? 'on');
}

async function openNewN1(page: Page) {
  await page.goto('/');
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  await expect(guard(page)).toHaveAttribute('data-exit-guard', 'on');
}

/** GET 이 아닌 요청(페이지 이동 제외)을 기록한다 */
function recordWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && !request.isNavigationRequest()) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return writes;
}
const cancels = (writes: string[]) => writes.filter((w) => w.startsWith('DELETE'));

/** DELETE /jobs/{id} 를 failures 만큼 500 으로 돌려준다. 그 뒤에는 원래대로 간다 */
async function failCancel(page: Page, failures = 1) {
  await page.addInitScript((count) => {
    let left = count;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'DELETE' && /^\/jobs\/[^/]+$/.test(new URL(url, location.href).pathname) && left > 0) {
        left -= 1;
        return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'fail', retryable: true, traceId: 't' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return original(input, init);
    };
  }, failures);
}

/** 브라우저 뒤로 가기 — 같은 문서 안의 popstate 라 load 를 기다리지 않는다 */
const pressBack = (page: Page) => page.evaluate(() => history.back());

async function expectCancelDialog(page: Page, after: string) {
  await expect(dialog(page)).toHaveAccessibleName('작업을 취소할까요?');
  for (const target of DELETE_TARGETS) await expect(dialog(page)).toContainText(target);
  await expect(dialog(page)).toContainText(after);
  await expect(dialog(page).getByRole('button')).toHaveText(['계속하기', '작업 취소']);
}

// ── 작업 없는 N1 ────────────────────────────────────────────────

test.describe('작업 없는 N1 — 미저장 확인 · 요청 없음', () => {
  test('뒤로 가기 — [계속 작성]은 N1 에 머물고, [나가기]는 보관함으로', async ({ page }) => {
    const writes = recordWrites(page);
    await openNewN1(page);
    await pressBack(page);
    await expect(dialog(page)).toHaveAccessibleName('작성을 그만두고 나갈까요?');
    await expect(dialog(page)).toContainText('입력한 정보와 선택한 이미지는 저장되지 않습니다.');
    await dialog(page).getByRole('button', { name: '계속 작성' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/jobs\/new/);

    await pressBack(page);
    await dialog(page).getByRole('button', { name: '나가기' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
    expect(writes).toEqual([]);
  });

  for (const [name, trigger, expected] of [
    ['로고', logo, /\/$/],
    ['브랜드관리', brand, /\/brand$/],
  ] as const) {
    test(`${name} — 미저장 확인 뒤 누른 곳으로`, async ({ page }) => {
      const writes = recordWrites(page);
      await openNewN1(page);
      await trigger(page).click();
      await expect(dialog(page)).toHaveAccessibleName('작성을 그만두고 나갈까요?');
      await expect(page).toHaveURL(/\/jobs\/new/);
      await dialog(page).getByRole('button', { name: '나가기' }).click();
      await expect(page).toHaveURL(expected);
      expect(writes).toEqual([]);
    });
  }

  test('로그아웃 — 미저장 확인 뒤에만 로그아웃한다', async ({ page }) => {
    const writes = recordWrites(page);
    await openNewN1(page);
    await logout(page).click();
    await expect(dialog(page)).toHaveAccessibleName('작성을 그만두고 나갈까요?');
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    await dialog(page).getByRole('button', { name: '계속 작성' }).click();
    await expect(page).toHaveURL(/\/jobs\/new/);
    expect(writes).toEqual([]);

    await logout(page).click();
    await dialog(page).getByRole('button', { name: '나가기' }).click();
    await page.waitForURL((url) => url.pathname === '/login');
    expect(writes).toEqual(['POST /auth/logout']);
  });
});

// ── 작업 있는 N2~N6 · 뒤로 가기 ─────────────────────────────────

for (const step of JOB_STEPS) {
  test(`${step} 뒤로 가기 — 작업 취소 확인 · [계속하기]는 머물고 · 확인 뒤에만 DELETE 하고 보관함으로`, async ({ page }) => {
    const writes = recordWrites(page);
    await openJob(page, step);
    const current = await nav(page).locator('[aria-current="step"]').textContent();

    await pressBack(page);
    await expectCancelDialog(page, '취소 후 보관함으로 이동합니다.');
    await expect(page).toHaveURL(JOB_URL);
    expect(cancels(writes)).toEqual([]);
    expect(writes.filter((w) => w.endsWith('/render'))).toEqual([]);

    await dialog(page).getByRole('button', { name: '계속하기' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(JOB_URL);
    await expect(nav(page).locator('[aria-current="step"]')).toHaveText(current!);
    expect(cancels(writes)).toEqual([]);

    // 계속한 뒤에도 뒤로 가기는 다시 같은 확인을 연다
    await pressBack(page);
    await expect(dialog(page)).toHaveAccessibleName('작업을 취소할까요?');
    await dialog(page).getByRole('button', { name: '작업 취소' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
    expect(cancels(writes)).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`]);
  });
}

test('뒤로 가기 취소 실패 — 작업·화면·확인창을 유지하고 다시 시도할 수 있다', async ({ page }) => {
  await failCancel(page, 1);
  const writes = recordWrites(page);
  await openJob(page, 'N5');
  await pressBack(page);
  await dialog(page).getByRole('button', { name: '작업 취소' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText('작업을 취소하지 못했습니다. 다시 시도해 주세요.');
  await expect(page).toHaveURL(JOB_URL);
  await expect(page.getByTestId('n5-viewport')).toBeVisible();

  await dialog(page).getByRole('button', { name: '작업 취소' }).click();
  await expect(page).toHaveURL(/\/$/);
  // 첫 실패는 페이지 안에서 만든 응답이라 네트워크에는 재시도 1건만 나간다
  expect(cancels(writes)).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`]);
});

// ── 상단 메뉴 ───────────────────────────────────────────────────

const MENU = [
  { name: '로고', trigger: logo, after: '취소 후 보관함으로 이동합니다.', arrive: (url: URL) => url.pathname === '/' },
  { name: '브랜드관리', trigger: brand, after: '취소 후 브랜드 관리로 이동합니다.', arrive: (url: URL) => url.pathname === '/brand' },
  { name: '로그아웃', trigger: logout, after: '취소 후 로그아웃합니다.', arrive: (url: URL) => url.pathname === '/login' },
] as const;

for (const item of MENU) {
  test.describe(`N3 상단 메뉴 ${item.name}`, () => {
    test('[계속하기] — 요청도 이동도 없다', async ({ page }) => {
      const writes = recordWrites(page);
      await openJob(page, 'N3');
      await item.trigger(page).click();
      await expectCancelDialog(page, item.after);
      await dialog(page).getByRole('button', { name: '계속하기' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await page.waitForTimeout(300);
      await expect(page).toHaveURL(JOB_URL);
      await expect(page.getByRole('heading', { name: '섹션 확인' })).toBeVisible();
      expect(writes).toEqual([]);
    });

    test('취소 성공 — DELETE 뒤에 누른 곳으로', async ({ page }) => {
      const writes = recordWrites(page);
      await openJob(page, 'N3');
      await item.trigger(page).click();
      await dialog(page).getByRole('button', { name: '작업 취소' }).click();
      await page.waitForURL(item.arrive);
      const expected = [`DELETE /jobs/${MOCK_JOB_ID}`];
      if (item.name === '로그아웃') expected.push('POST /auth/logout');
      expect(writes).toEqual(expected);
    });

    test('취소 실패 — 작업·화면을 유지하고, 로그아웃·이동하지 않는다', async ({ page }) => {
      await failCancel(page, Number.MAX_SAFE_INTEGER);
      const writes = recordWrites(page);
      await openJob(page, 'N3');
      await item.trigger(page).click();
      await dialog(page).getByRole('button', { name: '작업 취소' }).click();
      await expect(dialog(page).getByRole('alert')).toHaveText('작업을 취소하지 못했습니다. 다시 시도해 주세요.');
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(JOB_URL);
      await expect(page.getByRole('heading', { name: '섹션 확인' })).toBeVisible();
      expect(writes).toEqual([]);
    });
  });
}

test('확인창 — focus trap·Esc·연 요소로 포커스 복귀·배경 비활성', async ({ page }) => {
  await openJob(page, 'N3');
  await logo(page).focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeFocused();
  await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
  const buttons = dialog(page).getByRole('button');
  await page.keyboard.press('Tab');
  await expect(buttons.nth(0)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(buttons.nth(0)).toBeFocused();
  expect(await page.getByTestId('s0-steps').evaluate((el) => (el as HTMLElement).closest('[inert]') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(logo(page)).toBeFocused();
  expect(await page.getByTestId('s0-steps').evaluate((el) => (el as HTMLElement).closest('[inert]') !== null)).toBe(false);
});

// ── 자동 전환 · 진행 중 취소 ────────────────────────────────────

for (const [from, to] of [['N2', 'N3'], ['N4', 'N5']] as const) {
  test(`${from}→${to} 자동 전환은 나가기가 아니고, 열린 확인창은 유지되며 [계속하기]로 ${to} 에 머문다`, async ({ page }) => {
    const writes = recordWrites(page);
    await openJob(page, from);
    await pressBack(page);
    await expect(dialog(page)).toBeVisible();
    await setServerStep(page, to);
    const index = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'].indexOf(to);
    await expect(nav(page).getByRole('button').nth(index)).toHaveAttribute('aria-current', 'step', { timeout: 10_000 });
    await expect(dialog(page)).toHaveAccessibleName('작업을 취소할까요?');
    await dialog(page).getByRole('button', { name: '계속하기' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(JOB_URL);
    expect(cancels(writes)).toEqual([]);
  });
}

test('확인창 없이 자동 전환만 일어나면 확인창이 뜨지 않는다', async ({ page }) => {
  const writes = recordWrites(page);
  await openJob(page, 'N2');
  await setServerStep(page, 'N3');
  await expect(page.getByRole('heading', { name: '섹션 확인' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(JOB_URL);
  expect(cancels(writes)).toEqual([]);
});

// ── 완료된 작업 ─────────────────────────────────────────────────

test.describe('완료된 N6(서버 job.isSaved=true) — 묻지 않는다', () => {
  for (const [name, trigger, arrive] of [
    ['로고', logo, (url: URL) => url.pathname === '/'],
    ['브랜드관리', brand, (url: URL) => url.pathname === '/brand'],
  ] as const) {
    test(`${name} — 확인창·DELETE 없이 이동`, async ({ page }) => {
      const writes = recordWrites(page);
      await openJob(page, 'N6', { isSaved: true, expectGuard: 'off' });
      await trigger(page).click();
      await page.waitForURL(arrive);
      await expect(dialog(page)).toHaveCount(0);
      expect(cancels(writes)).toEqual([]);
    });
  }

  test('뒤로 가기 — 한 번에 확인창·DELETE 없이 보관함으로', async ({ page }) => {
    const writes = recordWrites(page);
    await openJob(page, 'N6', { isSaved: true, expectGuard: 'off' });
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(dialog(page)).toHaveCount(0);
    expect(cancels(writes)).toEqual([]);
  });

  test('로그아웃 — 확인창·DELETE 없이 바로 로그아웃', async ({ page }) => {
    const writes = recordWrites(page);
    await openJob(page, 'N6', { isSaved: true, expectGuard: 'off' });
    await logout(page).click();
    await page.waitForURL((url) => url.pathname === '/login');
    expect(writes).toEqual(['POST /auth/logout']);
  });

  /** 실제 흐름으로 N6 까지 간다(내보내기 구성요소가 만들어져 있어야 다운로드할 수 있다). GET /jobs/{id} 의 isSaved 만 서버 값 대신 준다 */
  async function reachN6WithSavedAfterDownload(page: Page, savedAfterDownload: boolean) {
    await page.addInitScript(
      ({ jobId, savedAfter }) => {
        const w = window as unknown as { __downloaded: boolean; __jobGets: number };
        w.__downloaded = false;
        w.__jobGets = 0;
        const original = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await original(input, init);
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const path = new URL(url, location.href).pathname;
          if (/\/download$/.test(path) && response.ok) w.__downloaded = true;
          if (path !== `/jobs/${jobId}` || (init?.method && init.method !== 'GET') || !response.ok) return response;
          w.__jobGets += 1;
          const body = await response.json();
          return new Response(JSON.stringify({ ...body, isSaved: savedAfter && w.__downloaded }), { status: 200, headers: { 'content-type': 'application/json' } });
        };
      },
      { jobId: MOCK_JOB_ID, savedAfter: savedAfterDownload },
    );
    await reachN6(page);
    await expect(page.getByTestId('n6-export-button')).toBeEnabled({ timeout: 15_000 });
    await expect(guard(page)).toHaveAttribute('data-exit-guard', 'on');
  }
  const jobGets = (page: Page) => page.evaluate(() => (window as unknown as { __jobGets: number }).__jobGets);

  test('첫 다운로드 뒤 job 을 다시 받아 서버가 완료로 알려 주면 묻지 않는다', async ({ page }) => {
    // N1 부터 실제 흐름(2초 polling 여러 번)을 지나므로 기본 30초보다 긴 전체 제한만 둔다
    test.setTimeout(60_000);
    await reachN6WithSavedAfterDownload(page, true);
    const writes = recordWrites(page);
    const before = await jobGets(page);
    const download = page.waitForEvent('download', { timeout: 10_000 });
    await page.getByTestId('n6-export-button').click();
    await download;
    // 다운로드 URL 을 받은 뒤 job 을 다시 받는다 — 완료 여부는 FE 가 정하지 않고 서버 값이다
    await expect.poll(() => jobGets(page)).toBeGreaterThan(before);
    await expect(guard(page)).toHaveAttribute('data-exit-guard', 'off');
    await logo(page).click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(dialog(page)).toHaveCount(0);
    expect(cancels(writes)).toEqual([]);
  });

  test('다운로드 뒤에도 서버가 완료가 아니라고 하면 계속 묻는다', async ({ page }) => {
    // N1 부터 실제 흐름(2초 polling 여러 번)을 지나므로 기본 30초보다 긴 전체 제한만 둔다
    test.setTimeout(60_000);
    await reachN6WithSavedAfterDownload(page, false);
    const before = await jobGets(page);
    const download = page.waitForEvent('download', { timeout: 10_000 });
    await page.getByTestId('n6-export-button').click();
    await download;
    await expect.poll(() => jobGets(page)).toBeGreaterThan(before);
    await expect(guard(page)).toHaveAttribute('data-exit-guard', 'on');
    await logo(page).click();
    await expect(dialog(page)).toHaveAccessibleName('작업을 취소할까요?');
  });
});

// ── 막지 못하는 이탈 ────────────────────────────────────────────

test('새로고침은 확인을 띄우지 않고 작업을 취소하지 않는다', async ({ page }) => {
  const writes = recordWrites(page);
  await openJob(page, 'N3');
  await page.reload();
  await expect(page.getByRole('heading', { name: '섹션 확인' })).toBeVisible({ timeout: 15_000 });
  await expect(dialog(page)).toHaveCount(0);
  expect(cancels(writes)).toEqual([]);
});

// ── 상태 조회 중 · 조회 실패 ────────────────────────────────────

/** tasks 첫 응답을 잡아 둔다. window.__releaseTasks() 로 푼다 */
async function holdTasks(page: Page) {
  await page.addInitScript((jobId) => {
    const w = window as unknown as { __releaseTasks: () => void };
    const gate = new Promise<void>((resolve) => {
      w.__releaseTasks = resolve;
    });
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === `/jobs/${jobId}/tasks`) await gate;
      return original(input, init);
    };
  }, MOCK_JOB_ID);
}

const releaseTasks = (page: Page) => page.evaluate(() => (window as unknown as { __releaseTasks: () => void }).__releaseTasks());
const exitState = (page: Page) => page.locator('[data-exit-state]');

/** GET path 응답을 status 로 바꾼다(재시도까지 계속). window.__failGetOff = true 로 원래대로 돌린다 */
async function failGet(page: Page, path: string, status: number, code: string) {
  await page.addInitScript(
    ({ target, statusCode, errorCode }) => {
      const w = window as unknown as { __failGetOff?: boolean };
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!w.__failGetOff && (!init?.method || init.method === 'GET') && new URL(url, location.href).pathname === target) {
          return new Response(JSON.stringify({ error: { code: errorCode, message: 'fail', retryable: statusCode >= 500, traceId: 't' } }), {
            status: statusCode,
            headers: { 'content-type': 'application/json' },
          });
        }
        return original(input, init);
      };
    },
    { target: path, statusCode: status, errorCode: code },
  );
}

test.describe('상태 조회 중 나가기 — 통과시키지도 취소하지도 않고, 조회가 끝난 뒤 처리한다', () => {
  test('진행 중 작업으로 밝혀지면 그때 작업 취소 확인을 연다', async ({ page }) => {
    await forceStep(page, 'N3');
    await holdTasks(page);
    const writes = recordWrites(page);
    await page.goto('/');
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
    await expect(page.getByText('작업 상태를 확인하고 있습니다.')).toBeVisible();
    await expect(exitState(page)).toHaveAttribute('data-exit-state', 'loading');
    await pressBack(page);
    await page.waitForTimeout(500);
    // 조회 중에는 나가지도, 묻지도, 취소하지도 않는다
    await expect(page).toHaveURL(JOB_URL);
    await expect(dialog(page)).toHaveCount(0);
    expect(cancels(writes)).toEqual([]);

    await releaseTasks(page);
    await expectCancelDialog(page, '취소 후 보관함으로 이동합니다.');
    expect(cancels(writes)).toEqual([]);
    await dialog(page).getByRole('button', { name: '작업 취소' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(cancels(writes)).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`]);
  });

  test('저장된 N6 로 밝혀지면 확인·DELETE 없이 보관함으로', async ({ page }) => {
    await forceStep(page, 'N6', { isSaved: true });
    await holdTasks(page);
    const writes = recordWrites(page);
    await page.goto('/');
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
    // 클라이언트에서만 보이는 조회 중 문구 — hydration 뒤 나가기 가드가 붙은 뒤에 누른다
    await expect(page.getByText('작업 상태를 확인하고 있습니다.')).toBeVisible();
    await expect(exitState(page)).toHaveAttribute('data-exit-state', 'loading');
    await pressBack(page);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(JOB_URL);
    await releaseTasks(page);
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(dialog(page)).toHaveCount(0);
    expect(cancels(writes)).toEqual([]);
  });

  test('N6 완료 여부(GET /jobs/{id}) 조회 중 로고 — 저장 전 작업이면 확인을 연다', async ({ page }) => {
    await forceStep(page, 'N6', { isSaved: false });
    // job 조회만 잡아 둔다
    await page.addInitScript((jobId) => {
      const w = window as unknown as { __releaseJob: () => void };
      const gate = new Promise<void>((resolve) => {
        w.__releaseJob = resolve;
      });
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if ((!init?.method || init.method === 'GET') && new URL(url, location.href).pathname === `/jobs/${jobId}`) await gate;
        return original(input, init);
      };
    }, MOCK_JOB_ID);
    const writes = recordWrites(page);
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
    await expect(logo(page)).toBeVisible({ timeout: 15_000 });
    await expect(exitState(page)).toHaveAttribute('data-exit-state', 'loading');
    await logo(page).click();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(JOB_URL);
    await expect(dialog(page)).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __releaseJob: () => void }).__releaseJob());
    await expectCancelDialog(page, '취소 후 보관함으로 이동합니다.');
    expect(cancels(writes)).toEqual([]);
  });

  test('조회 중 뒤로 가기 뒤 조회 실패(500)로 끝나면 이동하지 않고 「상태를 확인하지 못함」 창을 연다', async ({ page }) => {
    await failGet(page, `/jobs/${MOCK_JOB_ID}/tasks`, 500, 'INTERNAL_ERROR');
    const writes = recordWrites(page);
    await page.goto('/');
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
    // 클라이언트에서만 보이는 조회 중 문구 — hydration 뒤 나가기 가드가 붙은 뒤에 누른다
    await expect(page.getByText('작업 상태를 확인하고 있습니다.')).toBeVisible();
    await pressBack(page);
    // 재시도 1회 뒤 실패로 정해지면 잡아 둔 뒤로 가기를 처리한다 — 무한 대기 없이 창이 열린다
    await expectUnknownDialog(page, '나가면 작업은 취소되지 않고 남으며, 보관함으로 이동합니다.');
    await expect(exitState(page)).toHaveAttribute('data-exit-state', 'error');
    await expect(page).toHaveURL(JOB_URL);
    expect(cancels(writes)).toEqual([]);
  });

  test('조회 중 뒤로 가기 뒤 없는 작업(404)으로 밝혀지면 묻지 않고 나간다', async ({ page }) => {
    await failGet(page, `/jobs/${MOCK_JOB_ID}/tasks`, 404, 'NOT_FOUND');
    await holdTasks(page);
    const writes = recordWrites(page);
    await page.goto('/');
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
    // 클라이언트에서만 보이는 조회 중 문구 — hydration 뒤 나가기 가드가 붙은 뒤에 누른다
    await expect(page.getByText('작업 상태를 확인하고 있습니다.')).toBeVisible();
    await expect(exitState(page)).toHaveAttribute('data-exit-state', 'loading');
    await pressBack(page);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(JOB_URL);
    await releaseTasks(page);
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(dialog(page)).toHaveCount(0);
    expect(cancels(writes)).toEqual([]);
  });
});

// ── 조회 실패 — 취소하지 않고, 조용히 보내 주지도 않는다 ──────────────

async function expectUnknownDialog(page: Page, after: string) {
  await expect(dialog(page)).toHaveAccessibleName('작업 상태를 확인하지 못했습니다', { timeout: 15_000 });
  await expect(dialog(page)).toContainText('작업이 완료됐는지 확인할 수 없어 작업을 취소하지 않습니다.');
  await expect(dialog(page)).toContainText(after);
  await expect(dialog(page).getByRole('button')).toHaveText(['계속하기', '다시 확인', '작업 남기고 나가기']);
}

/** tasks 첫 조회부터 실패한 작업 화면(헤더 없음 — 뒤로 가기만 있다) */
async function openTasksFailed(page: Page) {
  await forceStep(page, 'N3');
  await failGet(page, `/jobs/${MOCK_JOB_ID}/tasks`, 500, 'INTERNAL_ERROR');
  await page.goto('/');
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(exitState(page)).toHaveAttribute('data-exit-state', 'error', { timeout: 15_000 });
  await expect(guard(page)).toHaveAttribute('data-exit-guard', 'on');
}

/** N6 에서 완료 여부(GET /jobs/{id}) 조회가 실패한 화면(헤더 있음) */
async function openN6JobFailed(page: Page, isSaved = false) {
  await forceStep(page, 'N6', { isSaved });
  await failGet(page, `/jobs/${MOCK_JOB_ID}`, 500, 'INTERNAL_ERROR');
  await page.goto('/');
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(logo(page)).toBeVisible({ timeout: 15_000 });
  await expect(exitState(page)).toHaveAttribute('data-exit-state', 'error', { timeout: 15_000 });
}

test.describe('작업 상태 조회 실패 — 실패를 알리고, 계속·다시 확인·작업 남기고 나가기 중에서 고른다', () => {
  test('뒤로 가기 — [계속하기]는 머물고, [작업 남기고 나가기]는 DELETE 없이 보관함으로', async ({ page }) => {
    const writes = recordWrites(page);
    await openTasksFailed(page);
    await pressBack(page);
    await expectUnknownDialog(page, '나가면 작업은 취소되지 않고 남으며, 보관함으로 이동합니다.');
    await dialog(page).getByRole('button', { name: '계속하기' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(JOB_URL);

    // 계속한 뒤에도 뒤로 가기는 같은 창을 연다(history 항목이 다시 쌓여 있다)
    await pressBack(page);
    await expectUnknownDialog(page, '나가면 작업은 취소되지 않고 남으며, 보관함으로 이동합니다.');
    await dialog(page).getByRole('button', { name: '작업 남기고 나가기' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
    expect(cancels(writes)).toEqual([]);
  });

  test('[다시 확인]이 또 실패하면 창에 알리고 머문다 · 성공해 진행 중이면 그때 작업 취소 확인으로 바뀐다', async ({ page }) => {
    const writes = recordWrites(page);
    await openTasksFailed(page);
    await pressBack(page);
    await dialog(page).getByRole('button', { name: '다시 확인' }).click();
    await expect(dialog(page).getByRole('alert')).toHaveText('작업 상태를 다시 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', { timeout: 15_000 });
    await expect(dialog(page)).toHaveAccessibleName('작업 상태를 확인하지 못했습니다');
    await expect(page).toHaveURL(JOB_URL);

    await page.evaluate(() => ((window as unknown as { __failGetOff: boolean }).__failGetOff = true));
    await dialog(page).getByRole('button', { name: '다시 확인' }).click();
    await expectCancelDialog(page, '취소 후 보관함으로 이동합니다.');
    expect(cancels(writes)).toEqual([]);
    await dialog(page).getByRole('button', { name: '작업 취소' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(cancels(writes)).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`]);
  });

  for (const item of [
    { name: '로고', trigger: logo, after: '나가면 작업은 취소되지 않고 남으며, 보관함으로 이동합니다.', arrive: (url: URL) => url.pathname === '/' },
    { name: '브랜드관리', trigger: brand, after: '나가면 작업은 취소되지 않고 남으며, 브랜드 관리로 이동합니다.', arrive: (url: URL) => url.pathname === '/brand' },
    { name: '로그아웃', trigger: logout, after: '나가면 작업은 취소되지 않고 남으며, 로그아웃합니다.', arrive: (url: URL) => url.pathname === '/login' },
  ] as const) {
    test(`N6 완료 여부 조회 실패 · ${item.name} — 이동하지 않고 묻는다 · [작업 남기고 나가기]는 DELETE 없이 누른 곳으로`, async ({ page }) => {
      const writes = recordWrites(page);
      await openN6JobFailed(page);
      await item.trigger(page).click();
      await expectUnknownDialog(page, item.after);
      await page.waitForTimeout(300);
      await expect(page).toHaveURL(JOB_URL);
      expect(writes).toEqual([]);
      await dialog(page).getByRole('button', { name: '작업 남기고 나가기' }).click();
      await page.waitForURL(item.arrive);
      expect(cancels(writes)).toEqual([]);
      expect(writes).toEqual(item.name === '로그아웃' ? ['POST /auth/logout'] : []);
    });
  }

  test('N6 완료 여부 조회 실패 · [다시 확인]으로 저장 완료가 확인되면 묻지 않고 누른 곳으로', async ({ page }) => {
    const writes = recordWrites(page);
    await openN6JobFailed(page, true);
    await brand(page).click();
    await expectUnknownDialog(page, '나가면 작업은 취소되지 않고 남으며, 브랜드 관리로 이동합니다.');
    await page.evaluate(() => ((window as unknown as { __failGetOff: boolean }).__failGetOff = true));
    await dialog(page).getByRole('button', { name: '다시 확인' }).click();
    await page.waitForURL((url) => url.pathname === '/brand');
    expect(cancels(writes)).toEqual([]);
  });
});

/** 취소 뒤 tasks 응답을 서버 계약 후보 중 하나로 바꾼다(window.__afterCancel = 'archived' | 'not-found') */
async function afterCancelResponse(page: Page) {
  await page.addInitScript((jobId) => {
    const w = window as unknown as { __afterCancel?: 'archived' | 'not-found' };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, location.href).pathname;
      if (!w.__afterCancel || path !== `/jobs/${jobId}/tasks`) return original(input, init);
      if (w.__afterCancel === 'not-found') {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no', retryable: false, traceId: 't' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      const response = await original(input, init);
      const body = await response.json();
      return new Response(JSON.stringify({ ...body, jobStatus: 'archived' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  }, MOCK_JOB_ID);
}

for (const [label, mode] of [
  ['archived 200', 'archived'],
  ['404', 'not-found'],
] as const) {
  test(`삭제된 작업 주소 재진입(${label}) — 보관함에서 뒤로 가도 편집 화면을 다시 그리지 않는다`, async ({ page }) => {
    await forceStep(page, 'N3');
    await afterCancelResponse(page);
    const writes = recordWrites(page);
    await page.goto('/');
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
    await expect(page.getByRole('heading', { name: '섹션 확인' })).toBeVisible({ timeout: 15_000 });
    await pressBack(page);
    await dialog(page).getByRole('button', { name: '작업 취소' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();

    await page.evaluate((m) => ((window as unknown as { __afterCancel: string }).__afterCancel = m), mode);
    await pressBack(page);
    await expect(page).toHaveURL(JOB_URL);
    await expect(page.getByTestId(mode === 'archived' ? 'job-archived' : 'job-not-found')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: '섹션 확인' })).toHaveCount(0);
    await expect(page.getByTestId('job-header')).toHaveCount(0);
    await expect(guard(page)).toHaveAttribute('data-exit-guard', 'off');
    // 다시 나가도 묻지 않고, 두 번째 DELETE 도 없다
    await page.getByTestId(mode === 'archived' ? 'job-archived-library' : 'job-not-found-library').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(dialog(page)).toHaveCount(0);
    expect(cancels(writes)).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`]);
  });
}

test('N3 뒤로 가기로 취소한 뒤 보관함에서 다시 뒤로 가면 cache 없이 서버에 다시 묻는다', async ({ page }) => {
  await forceStep(page, 'N3');
  // 취소 뒤 tasks 조회를 잡아 둘 수 있게 한다(window.__holdTasksAfter = true)
  await page.addInitScript((jobId) => {
    const w = window as unknown as { __holdTasksAfter: boolean; __tasksAfter: number };
    w.__holdTasksAfter = false;
    w.__tasksAfter = 0;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (w.__holdTasksAfter && new URL(url, location.href).pathname === `/jobs/${jobId}/tasks`) {
        w.__tasksAfter += 1;
        await new Promise(() => {});
      }
      return original(input, init);
    };
  }, MOCK_JOB_ID);
  const writes = recordWrites(page);
  await page.goto('/');
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(page.getByRole('heading', { name: '섹션 확인' })).toBeVisible({ timeout: 15_000 });
  await pressBack(page);
  await dialog(page).getByRole('button', { name: '작업 취소' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '보관함' })).toBeVisible();
  expect(cancels(writes)).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`]);

  await page.evaluate(() => ((window as unknown as { __holdTasksAfter: boolean }).__holdTasksAfter = true));
  await pressBack(page);
  // 확인창이 대신한 항목은 보관함으로 바뀌었고, 그 앞의 원래 작업 URL 항목이 남는다(브라우저 기록은 지우지 않는다)
  await expect(page).toHaveURL(JOB_URL);
  // 취소한 작업을 지난 cache 로 그리지 않는다 — 서버 응답을 기다린다
  await expect(page.getByText('작업 상태를 확인하고 있습니다.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '섹션 확인' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tasksAfter: number }).__tasksAfter)).toBeGreaterThan(0);
  expect(cancels(writes)).toEqual([`DELETE /jobs/${MOCK_JOB_ID}`]);
});

test('없는 작업(404)은 지킬 것이 없어 묻지 않는다', async ({ page }) => {
  await page.addInitScript((jobId) => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === `/jobs/${jobId}/tasks`) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no', retryable: false, traceId: 't' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return original(input, init);
    };
  }, MOCK_JOB_ID);
  await page.goto(`/jobs/${MOCK_JOB_ID}`);
  await expect(page.getByTestId('job-not-found')).toBeVisible({ timeout: 15_000 });
  await expect(guard(page)).toHaveAttribute('data-exit-guard', 'off');
  await page.getByTestId('job-not-found-library').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(dialog(page)).toHaveCount(0);
});

// ── X 제거 뒤 레이아웃 ──────────────────────────────────────────

for (const [width, height] of [[1920, 1080], [1280, 720]] as const) {
  for (const step of ['N2', 'N4'] as const) {
    test(`${step} ${width}×${height} — ✕ 없이 헤더·진행단계·처리 화면이 겹치지 않는다`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openJob(page, step);
      await expect(page.getByTestId('s0-exit')).toHaveCount(0);
      const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
      const header = await box('job-header');
      const steps = await box('s0-steps');
      const panel = await box('processing-panel');
      expect([header.x, header.y, header.width, header.height]).toEqual([0, 0, width, 72]);
      expect([steps.x, steps.y, steps.width, steps.height]).toEqual([48, 96, 44, height - 156]);
      expect(panel.y).toBe(96);
      expect(panel.x).toBeGreaterThanOrEqual(steps.x + steps.width);
      if (width === 1920) expect([panel.x, panel.width, panel.height]).toEqual([120, 1740, 924]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
      await page.screenshot({ path: test.info().outputPath(`${step}-${width}x${height}.png`) });
    });
  }
}
