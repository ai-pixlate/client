import { test, expect, type Page } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID, mockSectionsResponse } from '@/lib/mock-api/fixtures';

/**
 * lib/msw/handlers.ts의 toNumericId와 동일한 규칙(끝자리 숫자 추출)이다 —
 * section id는 항상 fixture에서 파생시켜 특정 id 하드코딩을 줄인다.
 */
function toNumericId(id: string): number {
  const digits = id.match(/\d+/)?.[0];
  return digits ? Number(digits) : 0;
}

// ─────────────────────────────────────────────────────────────────
// N3 — "실데이터 방어 검증" (Figma 1422:10176 · PRD v3.5.10 구조로 갱신)
//
// N3는 sectionOrder 순 단일 목록 + 선택 섹션 판정 상세 + 선택 섹션 이미지 +
// 카드 버튼식 bucket 변경이다(드래그·2버킷 영역 없음). mock 기본 데이터:
// 1(포함) · 2(자동 제외, 규제 위반) · 3(자동 제외, 현지) · 4(포함) · 5(자동 제외, 규제 위반).
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

/** N1 진입부터 N3(섹션 확인) 화면 도달까지만 이동한다 — N4로 넘어가지 않는다. */
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

  // 기본 mock N2(analyze → finalize → judge, poll 6회)와 N3 전환 전 완료 표시(app/jobs/[jobId]/page.tsx)를 감안한 여유 타임아웃.
  await expect(page.getByRole('button', { name: '이대로 진행' })).toBeVisible({ timeout: 30_000 });
}

const card = (page: Page, id: number) => page.getByTestId(`n3-section-card-${id}`);
const action = (page: Page, id: number) => page.getByTestId(`n3-section-action-${id}`);

test.describe('N3 section 이미지 — 실측 크기 방어 검증', () => {
  const targets = [
    { path: '/mock/n3/section-1000x1360.png', width: 1000, height: 1360 },
    { path: '/mock/n3/section-212x8000.png', width: 212, height: 8000 },
    { path: '/mock/n3/section-830x3225.png', width: 830, height: 3225 },
    { path: '/mock/n3/section-800x220.png', width: 800, height: 220 },
  ];

  test('4개 fixture 이미지 모두 브라우저가 실제로 로드한 naturalWidth/naturalHeight가 파일명과 일치한다', async ({
    page,
  }) => {
    await page.goto('/');

    const results = await page.evaluate(async (items) => {
      const load = (src: string) =>
        new Promise<{ width: number; height: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
          img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
          img.src = src;
        });
      const out: { path: string; width: number; height: number }[] = [];
      for (const item of items) {
        out.push({ path: item.path, ...(await load(item.path)) });
      }
      return out;
    }, targets);

    for (const target of targets) {
      const found = results.find((r) => r.path === target.path);
      expect(found, `${target.path} 로드 결과 없음`).toBeTruthy();
      expect(found?.width, `${target.path} width`).toBe(target.width);
      expect(found?.height, `${target.path} height`).toBe(target.height);
    }
  });

  test('mock 기본 job(N3)에서 선택 섹션 이미지(crop)가 실제로 로드된다', async ({ page }) => {
    const failedImages: string[] = [];
    page.on('response', (res) => {
      if (res.request().resourceType() === 'image' && res.status() >= 400) {
        failedImages.push(`${res.status()} ${res.url()}`);
      }
    });
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await reachN3(page);

    await expect(page.getByTestId('n3-section-image').locator('img')).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(failedImages).toEqual([]);
  });
});

test.describe('N3 — 단일 목록 구조', () => {
  test('모든 섹션이 sectionOrder 순 단일 목록이고, 2버킷 영역·드래그 안내가 없다', async ({ page }) => {
    await reachN3(page);

    const expectedOrder = [...mockSectionsResponse.sections]
      .sort((a, b) => a.sectionOrder - b.sectionOrder)
      .map((s) => `n3-section-card-${toNumericId(s.sectionId)}`);
    const cards = page.getByTestId('n3-section-list').locator('[data-testid^="n3-section-card-"]');
    await expect(cards).toHaveCount(expectedOrder.length);
    expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))).toEqual(expectedOrder);

    await expect(page.getByTestId('n3-exclude-zone')).toHaveCount(0);
    await expect(page.getByTestId('n3-include-zone')).toHaveCount(0);
    await expect(page.getByText('삭제할 섹션', { exact: true })).toHaveCount(0);
    await expect(page.getByText('번역할 섹션', { exact: true })).toHaveCount(0);
    await expect(page.getByText('끌어다 놓', { exact: false })).toHaveCount(0);
  });

  test('포함·자동 제외 카드의 칩과 버튼 문구가 상태별로 다르다', async ({ page }) => {
    await reachN3(page);
    for (const s of mockSectionsResponse.sections) {
      const id = toNumericId(s.sectionId);
      if (s.bucket === 'include') {
        await expect(card(page, id)).toHaveAttribute('data-kind', 'include');
        await expect(card(page, id)).toContainText('번역 예정');
        await expect(action(page, id)).toHaveText('제외하기');
      } else {
        await expect(card(page, id)).toHaveAttribute('data-kind', 'autoExcluded');
        await expect(action(page, id)).toHaveText('그래도 번역하기');
      }
    }
  });
});

test.describe('N3 — 선택', () => {
  test('기본으로 첫 제외 섹션 하나만 선택되고, 상세 제목·이미지가 그 섹션을 가리킨다', async ({ page }) => {
    await reachN3(page);
    const firstExclude = [...mockSectionsResponse.sections]
      .sort((a, b) => a.sectionOrder - b.sectionOrder)
      .find((s) => s.bucket === 'exclude')!;
    const id = toNumericId(firstExclude.sectionId);

    await expect(page.locator('[data-testid^="n3-section-card-"][aria-pressed="true"]')).toHaveCount(1);
    await expect(card(page, id)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n3-detail-title')).toHaveText(`SECTION ${String(firstExclude.sectionOrder).padStart(2, '0')}`);
    await expect(page.getByTestId('n3-section-image')).toHaveAttribute('data-section-id', String(id));
  });

  test('모든 카드를 클릭으로 선택할 수 있고, 선택 카드에만 orange 테두리가 붙는다', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    await reachN3(page);

    for (const s of mockSectionsResponse.sections) {
      const id = toNumericId(s.sectionId);
      await card(page, id).click({ position: { x: 150, y: 20 } });
      await expect(card(page, id)).toHaveAttribute('aria-pressed', 'true');
      await expect(card(page, id)).toHaveClass(/border-\[#ff6a38\]/);
      await expect(page.locator('[data-testid^="n3-section-card-"][class*="border-[#ff6a38]"]')).toHaveCount(1);
      await expect(page.getByTestId('n3-detail-title')).toHaveText(`SECTION ${String(s.sectionOrder).padStart(2, '0')}`);
      await expect(page.getByTestId('n3-section-image')).toHaveAttribute('data-section-id', String(id));
    }
    expect(pageErrors).toEqual([]);
  });

  test('상세 API는 선택한 섹션만 부른다(카드 수만큼 부르지 않는다)', async ({ page }) => {
    const detailIds: string[] = [];
    page.on('request', (req) => {
      const m = new URL(req.url()).pathname.match(new RegExp(`^/jobs/${MOCK_JOB_ID}/sections/(\\d+)$`));
      if (req.method() === 'GET' && m) detailIds.push(m[1]);
    });
    await reachN3(page);
    await expect(page.getByTestId('n3-detail-title')).toBeVisible();
    await expect.poll(() => detailIds.length).toBe(1);

    const includeId = toNumericId(mockSectionsResponse.sections.find((s) => s.bucket === 'include')!.sectionId);
    await card(page, includeId).click({ position: { x: 150, y: 20 } });
    await expect.poll(() => detailIds.includes(String(includeId))).toBe(true);
    expect(new Set(detailIds).size).toBe(2);
  });

  test('판정이 없는 포함 섹션은 「걸린 판정이 없어요」를 보여 준다', async ({ page }) => {
    await reachN3(page);
    const emptyInclude = mockSectionsResponse.sections.find((s) => s.bucket === 'include' && s.verdicts.length === 0)!;
    await card(page, toNumericId(emptyInclude.sectionId)).click({ position: { x: 150, y: 20 } });
    await expect(page.getByTestId('n3-verdict-empty')).toHaveText('걸린 판정이 없어요');
  });
});

test.describe('N3 — 버튼식 bucket 변경', () => {
  test('[제외하기] → PATCH exclude, 다시 [번역하기] → PATCH restore, 선택은 유지된다', async ({ page }) => {
    const patches: { id: string; action: string }[] = [];
    page.on('request', (req) => {
      const m = new URL(req.url()).pathname.match(/\/sections\/(\d+)$/);
      if (req.method() === 'PATCH' && m) patches.push({ id: m[1], action: JSON.parse(req.postData() ?? '{}').action });
    });
    await reachN3(page);

    const selectedBefore = await page.locator('[data-testid^="n3-section-card-"][aria-pressed="true"]').getAttribute('data-testid');
    const includeId = toNumericId(mockSectionsResponse.sections.find((s) => s.bucket === 'include')!.sectionId);

    await action(page, includeId).click();
    await expect.poll(() => patches.at(-1)).toEqual({ id: String(includeId), action: 'exclude' });
    await expect(card(page, includeId)).toHaveAttribute('data-bucket', 'exclude');
    // 버튼은 선택을 바꾸지 않는다
    await expect(page.locator('[data-testid^="n3-section-card-"][aria-pressed="true"]')).toHaveAttribute('data-testid', selectedBefore!);

    // mock PATCH는 exclusionReason을 비우므로 사유를 단정하지 않는 [번역하기]가 된다
    await expect(action(page, includeId)).toHaveText('번역하기');
    await action(page, includeId).click();
    await expect.poll(() => patches.at(-1)).toEqual({ id: String(includeId), action: 'restore' });
    await expect(card(page, includeId)).toHaveAttribute('data-bucket', 'include');
  });

  test('자동 제외 [그래도 번역하기] → PATCH restore', async ({ page }) => {
    const patches: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && /\/sections\/\d+$/.test(new URL(req.url()).pathname)) {
        patches.push(JSON.parse(req.postData() ?? '{}').action);
      }
    });
    await reachN3(page);
    const excludeId = toNumericId(mockSectionsResponse.sections.find((s) => s.bucket === 'exclude')!.sectionId);
    await action(page, excludeId).click();
    await expect.poll(() => patches.at(-1)).toBe('restore');
    await expect(card(page, excludeId)).toHaveAttribute('data-bucket', 'include');
  });
});

test.describe('N3 — CTA', () => {
  test('「이대로 진행」은 포함 섹션이 0개면 비활성 + 이유 안내, 하나라도 되살리면 다시 활성', async ({ page }) => {
    await reachN3(page);
    const cta = page.getByTestId('n3-proceed');
    await expect(cta).toHaveText('이대로 진행');
    await expect(cta).toBeEnabled();
    await expect(page.getByRole('button', { name: '번역 시작' })).toHaveCount(0);

    const includeIds = mockSectionsResponse.sections.filter((s) => s.bucket === 'include').map((s) => toNumericId(s.sectionId));
    for (const id of includeIds) {
      await action(page, id).click();
      await expect(card(page, id)).toHaveAttribute('data-bucket', 'exclude');
    }
    await expect(cta).toBeDisabled();
    await expect(page.getByTestId('n3-proceed-notice')).toHaveText('번역 가능한 섹션이 있어야 진행 가능합니다');

    await action(page, includeIds[0]).click();
    await expect(card(page, includeIds[0])).toHaveAttribute('data-bucket', 'include');
    await expect(cta).toBeEnabled();
    await expect(page.getByTestId('n3-proceed-notice')).toHaveCount(0);
  });
});

test.describe('N3 — 9월 표시 범위', () => {
  test('서버 fixture에 channel_policy verdict가 있어도 현재 N3 카드/상세에는 표시되지 않는다', async ({ page }) => {
    const withChannel = mockSectionsResponse.sections.find((s) => s.verdicts.some((v) => v.verdictType === 'channel_policy'));
    expect(withChannel, 'fixture에 channel_policy verdict가 있어야 이 검증이 의미 있다').toBeTruthy();
    const id = toNumericId(withChannel!.sectionId);
    const channelProblem = withChannel!.verdicts.find((v) => v.verdictType === 'channel_policy')!.problemText;
    const visibleProblem = withChannel!.verdicts.find((v) => v.verdictType !== 'channel_policy')!.problemText;

    await reachN3(page);

    // 카드: 9월 배지(규제 위반)는 보이고 채널 정책 배지는 없다
    await expect(card(page, id)).toContainText('규제 위반');
    await expect(card(page, id)).not.toContainText('채널 정책');

    // 상세: 같은 섹션의 9월 판정 행은 보이고 채널 정책 판정 행은 없다
    await card(page, id).click({ position: { x: 150, y: 20 } });
    const detail = page.getByTestId('n3-detail-panel');
    await expect(detail).toContainText(visibleProblem);
    await expect(detail).not.toContainText(channelProblem);
    await expect(detail).not.toContainText('채널 정책');
    await expect(page.getByText('채널 정책')).toHaveCount(0);
  });

  test('상세 패널에 옛 「제외 사유」 요약 배지가 없다(사유는 카드 칩·판정 행으로만 보인다)', async ({ page }) => {
    await reachN3(page);
    for (const s of mockSectionsResponse.sections) {
      await card(page, toNumericId(s.sectionId)).click({ position: { x: 150, y: 20 } });
      const detail = page.getByTestId('n3-detail-panel');
      await expect(detail).not.toContainText('(자동)');
      await expect(detail).not.toContainText('직접 제외');
      await expect(detail).not.toContainText('직접 되살림');
    }
  });
});

test.describe('N3 — ALL_SECTIONS_EXCLUDED 경쟁 상태', () => {
  test('화면은 포함 섹션이 있는데 서버가 409 ALL_SECTIONS_EXCLUDED로 거절하면 N3에 남아 안내하고 목록을 다시 받는다', async ({
    page,
  }) => {
    await reachN3(page);
    const cta = page.getByTestId('n3-proceed');
    await expect(cta).toBeEnabled();

    // 다른 탭/사용자가 포함 섹션을 전부 뺀 상황 — 화면 cache는 그대로 두고 서버(MSW) 상태만 바꾼다
    const includeIds = mockSectionsResponse.sections.filter((s) => s.bucket === 'include').map((s) => toNumericId(s.sectionId));
    for (const id of includeIds) {
      const status = await page.evaluate(
        async ({ path }) =>
          (await fetch(path, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'exclude' }),
          })).status,
        { path: `/jobs/${MOCK_JOB_ID}/sections/${id}` },
      );
      expect(status).toBe(200);
    }
    await expect(cta, '화면 cache는 아직 포함 섹션이 있다고 본다').toBeEnabled();

    let sectionListGets = 0;
    page.on('request', (req) => {
      if (req.method() === 'GET' && new URL(req.url()).pathname === `/jobs/${MOCK_JOB_ID}/sections`) sectionListGets += 1;
    });
    const proceedResponse = page.waitForResponse(
      (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === `/jobs/${MOCK_JOB_ID}/sections/proceed`,
    );
    await cta.click();
    const res = await proceedResponse;
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe('ALL_SECTIONS_EXCLUDED');

    // 화면 유지 + 안내 + 목록 재조회(서버 정본으로 CTA가 다시 막힌다)
    await expect(page.getByRole('heading', { level: 1, name: '섹션 확인' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '번역 중' })).toHaveCount(0);
    await expect(page.getByTestId('n3-proceed-notice')).toHaveText('번역 가능한 섹션이 있어야 진행 가능합니다');
    await expect.poll(() => sectionListGets).toBeGreaterThan(0);
    for (const id of includeIds) await expect(card(page, id)).toHaveAttribute('data-bucket', 'exclude');
    await expect(cta).toBeDisabled();
  });
});

test.describe('N3 — 규제 위반(regulatory) verdict bucket 회귀 방지', () => {
  test('regulatory verdict section은 기본적으로 제외 상태(data-bucket=exclude)다', async ({ page }) => {
    const regulatorySectionIds = mockSectionsResponse.sections
      .filter((s) => s.verdicts.some((v) => v.verdictType === 'regulatory'))
      .map((s) => toNumericId(s.sectionId));

    expect(
      regulatorySectionIds.length,
      'mock fixture에 verdictType=regulatory section이 하나도 없어 이 회귀 테스트가 무의미합니다 — fixture 구성을 확인하세요',
    ).toBeGreaterThan(0);

    await reachN3(page);

    for (const id of regulatorySectionIds) {
      await expect(card(page, id), `regulatory section(id=${id})은 기본 bucket이 exclude여야 합니다`).toHaveAttribute(
        'data-bucket',
        'exclude',
      );
    }
  });
});
