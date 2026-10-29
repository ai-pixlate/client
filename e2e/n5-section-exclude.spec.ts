import { test, expect, type Page } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';

// ─────────────────────────────────────────────────────────────────
// N5 — 섹션 제외·되돌리기 서버 저장(SEC-03, PATCH /jobs/{jobId}/sections/{sectionId}).
//
// 제외 여부의 정본은 프리뷰 응답의 bucket/excludedStage다. 저장이 끝난 뒤에 화면이
// 바뀌고(낙관적 반영 없음), 실패하면 마지막 저장 상태 그대로 + PM 확정 안내 문구.
//
// mock(lib/mock-api/n5-fixtures.ts): 501·502·504·505 include, 503 exclude(excludedStage='N5').
// 실패·지연·N3 제외 응답은 MSW 가 만들기 전에 window.fetch 를 감싸 재현한다
// (page.route 는 MSW Service Worker 응답을 가로채지 못한다 — e2e/n5-confirm.spec.ts 참고).
// ─────────────────────────────────────────────────────────────────

const FAILURE_NOTICE = '변경 사항을 저장하지 못했습니다. 마지막으로 저장된 상태로 돌아갑니다.';

function trackSectionPatches(page: Page) {
  const patches: { sectionId: string; body: string }[] = [];
  page.on('request', (req) => {
    const match = req.method() === 'PATCH' ? req.url().match(/\/sections\/(\d+)$/) : null;
    if (match) patches.push({ sectionId: match[1], body: req.postData() ?? '' });
  });
  return patches;
}

function countPreviewGets(page: Page) {
  const counter = { count: 0 };
  page.on('request', (req) => {
    if (req.method() === 'GET' && req.url().endsWith('/preview')) counter.count += 1;
  });
  return counter;
}

/** 섹션 PATCH 를 가로챈다 — mode='fail' 은 500, mode='delay' 는 ms 만큼 늦게 원래 요청을 보낸다 */
async function interceptSectionPatch(page: Page, mode: 'fail' | 'delay', ms = 0) {
  await page.evaluate(
    ({ mode, ms }) => {
      const w = window as unknown as { __sectionPatchCalls: number };
      w.__sectionPatchCalls = 0;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (init?.method === 'PATCH' && /\/sections\/\d+$/.test(url)) {
          w.__sectionPatchCalls += 1;
          if (mode === 'fail') {
            return Promise.resolve(
              new Response(
                JSON.stringify({ error: { code: 'INTERNAL', message: 'mock 실패', retryable: true, traceId: 't' } }),
                { status: 500, headers: { 'Content-Type': 'application/json' } },
              ),
            );
          }
          return new Promise((resolve) => setTimeout(resolve, ms)).then(() => originalFetch(input, init));
        }
        return originalFetch(input, init);
      };
    },
    { mode, ms },
  );
}

test.beforeEach(async ({ page }) => {
  await reachN5(page);
  // 캔버스는 transform pan 이라 아래쪽 섹션 버튼을 누르려면 전체를 화면에 넣는다
  await page.getByTestId('n5-fit-height').click();
});

test.describe('N5 섹션 제외·되돌리기 — 서버 저장', () => {
  test('제외하기 → SEC-03 exclude 저장 → 프리뷰 재조회 → 제외 표시', async ({ page }) => {
    const patches = trackSectionPatches(page);
    const previewGets = countPreviewGets(page);

    await page.getByTestId('n5-section-exclude-501').click();

    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
    expect(patches).toEqual([{ sectionId: '501', body: JSON.stringify({ action: 'exclude' }) }]);
    await expect.poll(() => previewGets.count).toBeGreaterThan(0);
    // 재조회 뒤에도(서버 정본) 제외 상태가 유지되고 되돌리기를 낼 수 있다
    await expect(page.getByTestId('n5-section-restore-501')).toBeVisible();
  });

  test('N5에서 제외된 섹션 되돌리기 → SEC-03 restore 저장 → 포함 상태 복구', async ({ page }) => {
    const patches = trackSectionPatches(page);

    await expect(page.getByTestId('n5-section-excluded-503')).toBeVisible();
    await page.getByTestId('n5-section-restore-503').click();

    await expect(page.getByTestId('n5-section-excluded-503')).toHaveCount(0);
    await expect(page.getByTestId('n5-section-exclude-503')).toBeVisible();
    expect(patches).toEqual([{ sectionId: '503', body: JSON.stringify({ action: 'restore' }) }]);
  });

  test('제외 → 되돌리기 왕복 후 다시 조회해도 서버 상태와 같다', async ({ page }) => {
    await page.getByTestId('n5-section-exclude-502').click();
    await expect(page.getByTestId('n5-section-excluded-502')).toBeVisible();
    await page.getByTestId('n5-section-restore-502').click();
    await expect(page.getByTestId('n5-section-excluded-502')).toHaveCount(0);

    const serverBuckets = await page.evaluate(async () => {
      const res = await fetch('/jobs/1/preview');
      const body = (await res.json()) as { sections: { id: number; bucket: string }[] };
      return Object.fromEntries(body.sections.map((s) => [s.id, s.bucket]));
    });
    expect(serverBuckets).toEqual({ 501: 'include', 502: 'include', 503: 'exclude', 504: 'include', 505: 'include' });
  });

  test('저장 실패 → 제외 상태로 바뀌지 않고 정확한 안내 문구', async ({ page }) => {
    await interceptSectionPatch(page, 'fail');

    await page.getByTestId('n5-section-exclude-501').click();

    const notice = page.getByTestId('n5-section-save-error-501');
    await expect(notice).toHaveText(FAILURE_NOTICE);
    await expect(notice).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('n5-section-excluded-501')).toHaveCount(0);
    await expect(page.getByTestId('n5-section-exclude-501')).toBeEnabled();
  });

  test('되돌리기 저장 실패 → 제외 상태 그대로 + 안내', async ({ page }) => {
    await interceptSectionPatch(page, 'fail');

    await page.getByTestId('n5-section-restore-503').click();

    await expect(page.getByTestId('n5-section-save-error-503')).toHaveText(FAILURE_NOTICE);
    await expect(page.getByTestId('n5-section-excluded-503')).toBeVisible();
  });

  test('저장 중에는 같은 섹션 추가 요청이 없고, 다른 섹션은 막지 않는다', async ({ page }) => {
    await interceptSectionPatch(page, 'delay', 1500);

    const button = page.getByTestId('n5-section-exclude-501');
    await button.click();
    await expect(button).toBeDisabled();
    await button.click({ force: true });
    await button.dispatchEvent('click');
    // 다른 섹션 버튼은 그대로 쓸 수 있다
    await expect(page.getByTestId('n5-section-exclude-502')).toBeEnabled();

    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __sectionPatchCalls: number }).__sectionPatchCalls)).toBe(1);
  });

  test('N3에서 제외된 섹션은 N5에서 되돌리기 버튼이 없다', async ({ page }) => {
    // 계약상 N3 제외 섹션은 프리뷰에 오지 않는다 — 와도 막는지 보려고 503 을 N3 제외로 바꿔 돌려준다
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const res = await originalFetch(input, init);
        if (!url.endsWith('/preview')) return res;
        const body = (await res.json()) as { sections: { id: number; excludedStage: string | null }[] };
        body.sections = body.sections.map((s) => (s.id === 503 ? { ...s, excludedStage: 'N3' } : s));
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });
    // 다른 섹션 제외로 프리뷰 재조회를 일으킨다
    await page.getByTestId('n5-section-exclude-501').click();
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();

    await expect(page.getByTestId('n5-section-excluded-503')).toBeVisible();
    await expect(page.getByTestId('n5-section-restore-503')).toHaveCount(0);
    // N5 에서 제외한 501 은 그대로 되돌릴 수 있다
    await expect(page.getByTestId('n5-section-restore-501')).toBeVisible();
  });

  test('선택된 블록이 있는 섹션을 제외하면 선택이 정리된다', async ({ page }) => {
    const row = page.getByTestId('n5-block-row-9101'); // 501/title
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('n5-section-exclude-501').click();
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
    await expect(row).toHaveAttribute('aria-pressed', 'false');
  });

  test('다른 섹션의 선택은 유지된다', async ({ page }) => {
    const row = page.getByTestId('n5-block-row-9103'); // 502/price
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('n5-section-exclude-501').click();
    await expect(page.getByTestId('n5-section-excluded-501')).toBeVisible();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
  });

  test('제외 전후 섹션 위치·캔버스 크기가 바뀌지 않는다', async ({ page }) => {
    const readLayout = () =>
      page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="n5-canvas"]') as HTMLElement;
        const tops = [501, 502, 503, 504, 505].map(
          (id) => (document.querySelector(`[data-testid="n5-slice-translated-${id}"]`) as HTMLElement).offsetTop,
        );
        return { w: canvas.style.width, h: canvas.style.height, tops };
      });
    const before = await readLayout();

    await page.getByTestId('n5-section-exclude-502').click();
    await expect(page.getByTestId('n5-section-excluded-502')).toBeVisible();
    expect(await readLayout()).toEqual(before);

    await page.getByTestId('n5-section-restore-503').click();
    await expect(page.getByTestId('n5-section-excluded-503')).toHaveCount(0);
    expect(await readLayout()).toEqual(before);
  });

  test('포함 섹션을 모두 제외하면 서버 상태 기준으로 확정 버튼이 막힌다', async ({ page }) => {
    for (const id of [501, 502, 504, 505]) {
      await page.getByTestId(`n5-section-exclude-${id}`).click();
      await expect(page.getByTestId(`n5-section-excluded-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('n5-confirm-button')).toBeDisabled();

    await page.getByTestId('n5-section-restore-505').click();
    await expect(page.getByTestId('n5-confirm-button')).toBeEnabled();
  });
});
