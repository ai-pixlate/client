import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N1~N6 작업용 공통 헤더 — Figma header component set 1809:42006 「속성 1=작업용」(N1 525:3023 instance 1792:21551).
// 1920×1080: header 0/0/1920/72 · home 124/12/102/48 · 화면명 x238 y27.5 h17 · 우측 1547/24/249/24(오른쪽 끝 1796).
// 헤더는 화면 위에 겹쳐 놓아 본문 geometry 를 바꾸지 않는다 — S0 ✕·진행단계와 화면별 본문 위치가 그대로인지 함께 본다.
// ─────────────────────────────────────────────────────────────────

test.skip(({ browserName }) => browserName !== 'chromium', '화면 수치 검증은 Chromium 기준이다');

const STEPS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'] as const;
type Step = (typeof STEPS)[number];

/** N4 Figma(1821:48003)의 「이미지 분석」은 복사 잔여로 보고 서비스 단계명 「번역 중」을 쓴다 */
const TITLES: Record<Step, string> = {
  N1: '정보 입력',
  N2: '이미지 분석',
  N3: '섹션 확인',
  N4: '번역 중',
  N5: '번역 중',
  N6: '저장 및 내보내기',
};

/** 헤더 추가 전(dd1707f) 실측 본문 위치 — 이번 변경으로 움직이면 안 된다 */
const BODY: Partial<Record<Step, { testId: string; box: [number, number, number, number] }[]>> = {
  N1: [
    { testId: 'n1-image-dropzone', box: [140, 147, 1184, 873] },
    { testId: 'n1-input-panel', box: [1344, 96, 516, 795] },
  ],
  N3: [
    { testId: 'n3-work-area', box: [200, 112, 1600, 920] },
    { testId: 'n3-section-list', box: [1112, 112, 688, 863] },
  ],
  N5: [
    { testId: 'n5-viewport', box: [120, 0, 1255, 1080] },
    { testId: 'n5-panel', box: [1427, 0, 433, 1080] },
  ],
  N6: [
    { testId: 'n6-final-preview', box: [140, 86, 1195, 962] },
    { testId: 'n6-export-panel', box: [1404, 86, 456, 962] },
  ],
};

/** 예전 화면별 제목 옆 설명 문구 — 최신 Figma 에서 빠졌다 */
const REMOVED_DESCRIPTIONS = [
  '번역할 원본 이미지를 등록하고 작업 조건을 설정합니다.',
  '등록한 이미지의 텍스트와 구조를 분석하고 있습니다.',
  '전체 섹션에서 제외 판정을 확인하고, 필요한 경우 번역에 포함하세요.',
  '확정한 섹션을 번역하고 이미지에 적용하고 있습니다.',
  '최종 결과물을 확인하고 내려받거나 보관함에 저장합니다.',
];

async function openStep(page: Page, step: Step) {
  if (step === 'N1') {
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  } else {
    await page.addInitScript(
      ({ forced, jobId }) => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const response = await original(input, init);
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (new URL(url, location.href).pathname !== `/jobs/${jobId}/tasks` || !response.ok) return response;
          const body = await response.json();
          const items =
            forced === 'N6'
              ? [...(body.items ?? []), { taskId: 990001, taskType: 'render', unitType: 'job', unitId: Number(jobId), status: 'done' }]
              : body.items;
          return new Response(JSON.stringify({ ...body, items, currentStep: forced, jobStatus: 'running' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        };
      },
      { forced: step, jobId: MOCK_JOB_ID },
    );
    await page.goto(`/jobs/${MOCK_JOB_ID}`);
  }
  await expect(page.getByTestId('job-header-title')).toHaveText(TITLES[step]);
  await expect(page.getByTestId('s0-steps')).toBeVisible();
}

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;
const near = (actual: number, expected: number, label: string, tolerance = 1) =>
  expect(Math.abs(actual - expected), `${label}: ${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
const nearBox = (actual: { x: number; y: number; width: number; height: number }, [x, y, w, h]: number[], label: string) => {
  near(actual.x, x, `${label} x`);
  near(actual.y, y, `${label} y`);
  near(actual.width, w, `${label} w`);
  near(actual.height, h, `${label} h`);
};

test.describe('1920×1080 — header 1809:42006 작업용', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const step of STEPS) {
    test(`${step} — header·좌측·우측 bbox, 화면명, ✕·진행단계·본문 위치 유지`, async ({ page }) => {
      await openStep(page, step);

      const header = await box(page, 'job-header');
      console.log(`[${step}] header`, JSON.stringify(header));
      nearBox(header, [0, 0, 1920, 72], 'header');
      // 배경·border·shadow 없음
      const style = await page.getByTestId('job-header').evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, border: s.borderBottomWidth, shadow: s.boxShadow };
      });
      expect(style).toEqual({ bg: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });

      const home = await box(page, 'job-header-home');
      console.log(`[${step}] home`, JSON.stringify(home));
      nearBox(home, [124, 12, 102, 48], 'home');
      const logo = (await page.getByTestId('job-header-home').locator('img').boundingBox())!;
      console.log(`[${step}] logo`, JSON.stringify(logo));
      nearBox(logo, [124, 24, 78, 24], 'logo');

      const title = await box(page, 'job-header-title');
      console.log(`[${step}] title`, JSON.stringify(title));
      near(title.x, 238, 'title x');
      near(title.y, 27.5, 'title y');
      near(title.height, 17, 'title h');
      const titleStyle = await page.getByTestId('job-header-title').evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: s.fontSize, weight: s.fontWeight, color: s.color, spacing: s.letterSpacing };
      });
      expect(titleStyle).toEqual({ size: '14px', weight: '400', color: 'rgb(23, 23, 23)', spacing: '-0.14px' });

      const actions = await box(page, 'job-header-actions');
      console.log(`[${step}] actions`, JSON.stringify(actions));
      nearBox(actions, [1547, 24, 249, 24], 'actions');
      near(actions.x + actions.width, 1796, 'actions right edge');
      near(1920 - (actions.x + actions.width), 124, 'right margin');
      nearBox(await box(page, 'job-header-brand'), [1547, 24, 72, 24], 'brand');
      nearBox(await box(page, 'job-header-account'), [1631, 24, 72, 24], 'account');
      nearBox(await box(page, 'job-header-divider'), [1719, 30, 1, 12], 'divider');
      nearBox((await page.getByTestId('job-header').getByTestId('account-logout').boundingBox())!, [1736, 24, 60, 24], 'logout');

      // ✕ 와 진행단계는 그대로다
      nearBox(await box(page, 's0-exit'), [40, 40, 40, 40], 'exit');
      nearBox(await box(page, 's0-steps'), [48, 96, 44, 924], 'steps');

      for (const { testId, box: expected } of BODY[step] ?? []) {
        const actual = await box(page, testId);
        console.log(`[${step}] ${testId}`, JSON.stringify(actual));
        nearBox(actual, expected, testId);
      }
      if (step === 'N2' || step === 'N4') {
        // 처리 화면 본문 패널은 예전 제목 자리(h94) 아래 그대로다
        const list = await box(page, 'processing-step-list');
        console.log(`[${step}] processing-step-list`, JSON.stringify(list));
        near(list.x, 1397, 'step list x');
        if (step === 'N4') near(list.y, 305.94, 'step list y');
      }

      for (const text of REMOVED_DESCRIPTIONS) await expect(page.getByText(text)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '이미지 입력' })).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`${step}-1920x1080.png`) });
    });
  }

  test('N1 — 최신 Figma 525:3023 국가·언어 행 y96 · 업로드 y147 · 우측 패널 y96, 예전 제목·설명 없음', async ({ page }) => {
    await openStep(page, 'N1');
    const row = await box(page, 'n1-target-row');
    console.log('[N1] target row', JSON.stringify(row));
    near(row.x, 141, 'row x');
    near(row.y, 96, 'row y');
    near(row.width, 810, 'row w');
    near(row.height, 39, 'row h');
    nearBox(await box(page, 'n1-image-dropzone'), [140, 147, 1184, 873], 'uploader');
    const panel = await box(page, 'n1-input-panel');
    near(panel.x, 1344, 'panel x');
    near(panel.y, 96, 'panel y');
    near(panel.width, 516, 'panel w');
    await expect(page.getByText('이미지 입력', { exact: true })).toHaveCount(0);
    await expect(page.getByText('번역할 원본 이미지를 등록하고 작업 조건을 설정합니다.')).toHaveCount(0);
  });
});

test.describe('헤더 동작', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('로고 → / (보관함)', async ({ page }) => {
    await openStep(page, 'N3');
    await page.getByTestId('job-header-home').click();
    await page.waitForURL((url) => url.pathname === '/');
  });

  test('브랜드관리 → /brand', async ({ page }) => {
    await openStep(page, 'N1');
    await page.getByTestId('job-header-brand').click();
    await page.waitForURL((url) => url.pathname === '/brand');
  });

  test('내 계정 — 계약이 없어 이동·메뉴를 만들지 않는다(흐리게 만들지도 않는다)', async ({ page }) => {
    await openStep(page, 'N5');
    const account = page.getByTestId('job-header-account');
    await expect(account).toHaveText('내 계정');
    await expect(account).toBeEnabled();
    expect(await account.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const before = page.url();
    await account.click();
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('로그아웃 — 기존 logout() 흐름(POST /auth/logout 1회 → G1)을 그대로 쓴다', async ({ page }) => {
    const logouts: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/auth/logout') logouts.push(r.method());
    });
    await openStep(page, 'N6');
    await page.getByTestId('job-header').getByTestId('account-logout').click();
    await page.waitForURL((url) => url.pathname === '/login');
    expect(logouts).toEqual(['POST']);
  });

  test('S0 ✕ 는 헤더와 겹쳐도 눌리고, 확인창은 헤더 위에 뜬다', async ({ page }) => {
    await openStep(page, 'N1');
    // ✕ 중심에서 실제로 맨 위에 있는 요소가 ✕ 자신이다
    const topAtExit = await page.evaluate(() => document.elementFromPoint(60, 60)?.closest('[data-testid]')?.getAttribute('data-testid'));
    expect(topAtExit).toBe('s0-exit');
    await page.getByTestId('s0-exit').click();
    await expect(page.getByTestId('s0-exit-dim')).toBeVisible();
    const topAtHeader = await page.evaluate(() => {
      const ids = ['job-header-home', 'job-header-actions'];
      return ids.map((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-testid="job-header"]') === null;
      });
    });
    expect(topAtHeader).toEqual([true, true]);
  });
});
