import { test, expect, type Page, type Locator } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// F-CFM-14 — N3 섹션 제외 서버 반영 (확정 시점 배치 PATCH).
//
// N3 드래그는 이제 로컬 bucket만 바꾸고(네트워크 호출 없음), "번역 시작"
// 클릭(확정) 시점에만 그 순간 exclude 상태인 section 중 서버가 아직 모르는
// 것만 PATCH(action=exclude)한다. 서버가 이미 exclude로 응답한 section
// (fixture의 sec_03)은 사용자가 아무것도 안 건드렸어도 다시 PATCH하지 않는다
// — 그래서 "제외 없음" 케이스도 PATCH 0회여야 한다(lib/queries/pixate.ts의
// useSectionProceedMutation, app/jobs/[jobId]/_components/n3/n3-view.tsx의
// syncedExcludeIdsRef 참고).
// ─────────────────────────────────────────────────────────────────

async function selectFirstValidOption(page: Page, index: number) {
  const select = page.getByRole('combobox').nth(index);
  const firstRealOption = select.locator('option').nth(1);
  const value = await firstRealOption.getAttribute('value');
  if (!value) throw new Error(`combobox[${index}]에 선택 가능한 option이 없습니다`);
  await select.selectOption(value);
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function dragBetweenZones(page: Page, source: Locator, targetZone: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await targetZone.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('drag source 또는 target 영역의 위치를 찾을 수 없습니다');
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + (endX - startX) / 2, startY + (endY - startY) / 2, { steps: 8 });
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
  // dnd-kit의 PointerSensor는 drop 직후 짧게 "고스트 클릭" 억제 구간을 둔다
  // (실사용자는 드롭과 다음 클릭 사이에 자연히 이 정도 여유가 있다). 이제
  // 드래그가 네트워크 호출 없이 로컬 상태만 바꾸다 보니 그 다음 클릭까지의
  // 실제 경과 시간이 이전(PATCH 왕복 포함)보다 짧아져 이 구간에 걸릴 수
  // 있어, 테스트에서만 그 여유를 흉내낸다.
  await page.waitForTimeout(250);
}

/** N1 진입부터 N3(섹션 확인) 화면 도달까지만 이동한다 — "번역 시작"은 누르지 않는다. */
async function reachN3(page: Page): Promise<void> {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);

  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('E2E 테스트 상품');
  await selectFirstValidOption(page, 0); // 국가
  await selectFirstValidOption(page, 1); // 언어

  await page.getByRole('button', { name: '선택하기' }).click();
  await page.getByRole('dialog', { name: '카테고리 선택' }).getByRole('button', { name: '바디/헤어' }).click();

  await selectFirstValidOption(page, 2); // 규제 분류

  await page.getByLabel('파일 선택').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await expect(page.locator('img[alt="e2e-test.png"]')).toBeVisible();

  await page.getByRole('button', { name: '다음' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));

  await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible({ timeout: 8_000 });
}

function trackSectionPatchRequests(page: Page) {
  const patchRequests: { url: string; sectionId: string; body: unknown }[] = [];
  const proceedRequests: string[] = [];
  const previewRequests: string[] = [];

  page.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'PATCH' && /\/jobs\/[^/]+\/sections\/[^/]+$/.test(url)) {
      const sectionId = url.split('/').pop()!;
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = null;
      }
      patchRequests.push({ url, sectionId, body });
    }
    if (req.method() === 'POST' && url.endsWith('/sections/proceed')) {
      proceedRequests.push(url);
    }
    if (url.includes('/preview')) {
      previewRequests.push(url);
    }
  });

  return { patchRequests, proceedRequests, previewRequests };
}

test('제외 없음 — 확정해도 section PATCH가 나가지 않고 N4로 진입한다', async ({ page }) => {
  await reachN3(page);
  const { patchRequests, proceedRequests, previewRequests } = trackSectionPatchRequests(page);

  // fixture 자체에 이미 exclude(sec_03) 1개가 있지만, 서버가 이미 아는
  // 상태이므로(사용자가 아무 것도 건드리지 않음) PATCH가 나가면 안 된다.
  await page.getByRole('button', { name: '번역 시작' }).click();
  await expect(page.getByRole('heading', { name: '번역을 진행하고 있습니다' })).toBeVisible();

  expect(patchRequests).toHaveLength(0);
  expect(proceedRequests).toHaveLength(1);
  expect(previewRequests).toHaveLength(0);
});

test('섹션 1개 신규 제외 — 확정 시 PATCH 1회 후 N4로 진입한다', async ({ page }) => {
  await reachN3(page);

  const includeThumb = page.locator('[data-testid^="n3-thumb-include-"]').first();
  const movedSectionId = (await includeThumb.getAttribute('data-testid'))!.replace(
    'n3-thumb-include-',
    '',
  );
  const excludeZone = page.locator('[data-testid="n3-exclude-zone"]');
  await dragBetweenZones(page, includeThumb, excludeZone);
  await expect(page.locator(`[data-testid="n3-thumb-exclude-${movedSectionId}"]`)).toBeVisible();

  const { patchRequests, proceedRequests, previewRequests } = trackSectionPatchRequests(page);

  await page.getByRole('button', { name: '번역 시작' }).click();
  await expect(page.getByRole('heading', { name: '번역을 진행하고 있습니다' })).toBeVisible();

  expect(patchRequests).toHaveLength(1);
  expect(patchRequests[0].sectionId).toBe(movedSectionId);
  expect(patchRequests[0].body).toEqual({ action: 'exclude' });
  expect(proceedRequests).toHaveLength(1);
  expect(previewRequests).toHaveLength(0);
});

test('섹션 여러 개 신규 제외 — 각각 PATCH되고, 이미 서버가 아는 section은 다시 PATCH되지 않는다', async ({
  page,
}) => {
  await reachN3(page);

  const excludeZone = page.locator('[data-testid="n3-exclude-zone"]');
  const movedIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const includeThumb = page.locator('[data-testid^="n3-thumb-include-"]').first();
    const sectionId = (await includeThumb.getAttribute('data-testid'))!.replace(
      'n3-thumb-include-',
      '',
    );
    await dragBetweenZones(page, includeThumb, excludeZone);
    await expect(page.locator(`[data-testid="n3-thumb-exclude-${sectionId}"]`)).toBeVisible();
    movedIds.push(sectionId);
  }

  const { patchRequests, proceedRequests } = trackSectionPatchRequests(page);

  await page.getByRole('button', { name: '번역 시작' }).click();
  await expect(page.getByRole('heading', { name: '번역을 진행하고 있습니다' })).toBeVisible();

  expect(patchRequests).toHaveLength(2);
  expect(new Set(patchRequests.map((p) => p.sectionId))).toEqual(new Set(movedIds));
  // fixture가 원래부터 exclude였던 section(sec_03)은 이 목록에 없어야 한다.
  expect(patchRequests.some((p) => p.sectionId === 'sec_03')).toBe(false);
  expect(proceedRequests).toHaveLength(1);
});

test('PATCH 실패 — 다음 단계로 넘어가지 않고 N3에 머무르며, 재시도하면 성공한다', async ({ page }) => {
  await reachN3(page);

  const includeThumb = page.locator('[data-testid^="n3-thumb-include-"]').first();
  const movedSectionId = (await includeThumb.getAttribute('data-testid'))!.replace(
    'n3-thumb-include-',
    '',
  );
  const excludeZone = page.locator('[data-testid="n3-exclude-zone"]');
  await dragBetweenZones(page, includeThumb, excludeZone);
  await expect(page.locator(`[data-testid="n3-thumb-exclude-${movedSectionId}"]`)).toBeVisible();

  // 이 section의 PATCH만 첫 호출에서 500으로 실패시킨다(MSW Service Worker에
  // 도달하기 전에 window.fetch 자체를 가로챈다 — e2e/n5-confirm.spec.ts와
  // 같은 이유로 page.route()는 이 프로젝트에서 동작하지 않는다).
  await page.evaluate((sectionId) => {
    const originalFetch = window.fetch.bind(window);
    let failedOnce = false;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (!failedOnce && init?.method === 'PATCH' && url.endsWith(`/sections/${sectionId}`)) {
        failedOnce = true;
        return Promise.resolve(new Response('server error', { status: 500 }));
      }
      return originalFetch(input, init);
    };
  }, movedSectionId);

  const { proceedRequests } = trackSectionPatchRequests(page);

  await page.getByRole('button', { name: '번역 시작' }).click();

  // N4로 넘어가지 않고 N3에 그대로 머문다 — proceed 자체가 호출되지 않는다.
  await expect(page.getByRole('heading', { name: '번역을 진행하고 있습니다' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible();
  expect(proceedRequests).toHaveLength(0);

  // 재시도 — 이번엔 실제 mock 서버가 응답하므로 성공하고 N4로 진입한다.
  await page.getByRole('button', { name: '번역 시작' }).click();
  await expect(page.getByRole('heading', { name: '번역을 진행하고 있습니다' })).toBeVisible();
  expect(proceedRequests).toHaveLength(1);
});
