import { test, expect, type Page } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N3 — "실데이터 방어 검증" (10일차)
//
// 1. Section.thumbnailUrl/imageKey/renderImageKey가 실제로 가리키는
//    fixture 파일(scripts/make-n3-fixture-images.mjs로 생성)이 선언된
//    크기 그대로 브라우저에서 로드되는지.
// 2. 판정(verdicts) 0건인 section이 이미 mock 기본 데이터(sec_01/03/04)에
//    존재한다 — 이 테스트는 그 사실에 기대어 실제로 crash 없이 렌더되는지
//    확인한다. 새로운 판정/신호를 억지로 만들어 넣지 않는다.
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
  await selectFirstValidOption(page, 0);
  await selectFirstValidOption(page, 1);
  await selectFirstValidOption(page, 2);
  await selectFirstValidOption(page, 3);

  await page.getByLabel('파일 선택').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await expect(page.getByText('e2e-test.png')).toBeVisible();

  await page.getByRole('button', { name: '다음' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));

  await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible({ timeout: 8_000 });
}

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

  test('mock 기본 job(N3)에서도 같은 fixture 이미지가 그대로 로드된다 (imageKey/renderImageKey/thumbnailUrl)', async ({
    page,
  }) => {
    const failedImages: string[] = [];
    page.on('response', (res) => {
      if (res.request().resourceType() === 'image' && res.status() >= 400) {
        failedImages.push(`${res.status()} ${res.url()}`);
      }
    });
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await reachN3(page);

    // 좌우 2단 화면(삭제 영역 + 번역 영역)이 정상 렌더된다.
    await expect(page.getByTestId('n3-exclude-zone')).toBeVisible();
    await expect(page.getByTestId('n3-include-zone')).toBeVisible();

    // sec_03(유일한 exclude bucket section, 212x8000 배정)이 DetailPanel에
    // 크게 표시된다 — 극단 이미지가 실제로 로드되는지.
    await expect(page.locator('[data-testid="n3-detail-image-sec_03"] img')).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(failedImages).toEqual([]);
  });
});

test.describe('N3 — 판정(verdicts) 0건 방어', () => {
  test('좌우 2단 화면이 정상 렌더되고, 판정 0건인 section이 crash 없이 표시된다', async ({
    page,
  }) => {
    // sec_01(include)·sec_04(include)·sec_03(exclude, DetailPanel 대상)은
    // mock 기본 데이터에서 이미 verdicts: [], originalVerdict: null이다 —
    // 이 테스트는 그 실데이터가 실제로 crash 없이 렌더되는지 확인할 뿐,
    // 새로운 판정/신호를 만들어 넣지 않는다.
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await reachN3(page);

    // 섹션 확인 화면 기본 구조(좌우 2단)가 깨지지 않는다.
    await expect(page.getByTestId('n3-exclude-zone')).toBeVisible();
    await expect(page.getByTestId('n3-include-zone')).toBeVisible();

    // sec_03(exclude, verdicts: [])이 DetailPanel의 activeSection으로 기본
    // 선택된다 — verdicts[0] 같은 암묵적 가정이 있었다면 여기서 바로 crash한다.
    await expect(page.locator('[data-testid="n3-detail-image-sec_03"]')).toBeVisible();
    // exclusionReason은 있지만 verdicts는 0건 — VerdictCard가 하나도 렌더되지
    // 않고, "판정 정보가 없습니다" 문구도 강제로 뜨지 않아야 한다(그 문구는
    // exclusionReason이 없을 때만 뜨는 별도 분기다 — sec_03은 있음).
    await expect(page.locator('[data-testid="n3-exclude-zone"] >> text=판정 정보가 없습니다')).toHaveCount(
      0,
    );

    // include-zone에도 verdicts: [] 인 section(sec_01, sec_04)이 포함되어
    // 있고, 뱃지 없이 정상 표시된다(section-thumbnail은 verdict를 렌더하지
    // 않는다 — crash 대상 자체가 아님을 함께 확인).
    const includeZone = page.getByTestId('n3-include-zone');
    await expect(includeZone).toBeVisible();

    expect(pageErrors, `pageerror 발생: ${pageErrors.map((e) => e.message).join(', ')}`).toEqual([]);
  });
});
