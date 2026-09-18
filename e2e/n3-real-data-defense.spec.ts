import { test, expect, type Locator, type Page } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

/** dnd-kit PointerSensor(activationConstraint distance:4)를 넘기는 최소 drag. */
async function dragBetweenZones(page: Page, source: Locator, targetZone: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await targetZone.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('drag source 또는 target 영역의 위치를 찾을 수 없습니다');
  }
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();
}

// ─────────────────────────────────────────────────────────────────
// N3 — "실데이터 방어 검증" (10일차 작성, 3단계 Figma 재구성에 맞춰 갱신)
//
// 3단계부터 Section 자체엔 이미지 URL이 없다 — 중앙 뷰포트는
// SourceImage.fileUrl 전체를 보여주고(테스트에서는 n3-source-viewport로
// 찾는다), 좌측 nav/우측 sidebar 썸네일은 SourceImage+bbox를 FE가 crop해
// 만든다. fixture 파일 자체(scripts/make-n3-fixture-images.mjs 생성물)는
// 그대로이므로 1번 테스트는 손대지 않았다.
//
// sectionId는 이제 숫자다(mock: 'sec_03' → id 3, msw handler의 toNumericId
// 참고) — 문자열 id를 하드코딩하지 않는다.
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

  // mock 환경 N2 최소 체류(7초, app/jobs/[jobId]/page.tsx)를 감안한 여유 타임아웃.
  await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible({ timeout: 10_000 });
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

  test('mock 기본 job(N3)에서 중앙 뷰포트가 SourceImage 전체를 로드한다', async ({ page }) => {
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

    // 중앙 원본 상세페이지 뷰포트가 실제 이미지를 로드한다 — Section 자체가
    // 아니라 SourceImage.fileUrl 전체를 보여준다(3단계 데이터 가정).
    await expect(page.getByTestId('n3-source-viewport').locator('img')).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(failedImages).toEqual([]);
  });
});

test.describe('N3 — 판정(verdicts) 0건 방어', () => {
  test('좌우 2단 화면이 정상 렌더되고, 판정 0건인 section이 crash 없이 표시된다', async ({ page }) => {
    // mock 기본 데이터의 include 2건(옛 sec_01/sec_04)·exclude 1건(옛
    // sec_03, DetailPanel 기본 active)이 verdicts: []다 — 이 테스트는 그
    // 실데이터가 crash 없이 렌더되는지 확인할 뿐, 새 판정/신호를 만들지 않는다.
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await reachN3(page);

    await expect(page.getByTestId('n3-exclude-zone')).toBeVisible();
    await expect(page.getByTestId('n3-include-zone')).toBeVisible();

    // exclude 기본 active section(verdicts: [])이 crash 없이 뷰포트에 뜬다 —
    // verdicts[0] 같은 암묵적 가정이 있었다면 여기서 바로 crash한다.
    await expect(page.getByTestId('n3-source-viewport')).toBeVisible();
    // exclusionReason은 있지만 verdicts는 0건 — "판정 정보가 없습니다"는
    // exclusionReason도 없을 때만 뜨는 별도 분기라 뜨지 않아야 한다.
    await expect(page.locator('text=판정 정보가 없습니다')).toHaveCount(0);

    expect(pageErrors, `pageerror 발생: ${pageErrors.map((e) => e.message).join(', ')}`).toEqual([]);
  });
});

test.describe('N3 — drag 후 다른 thumbnail click 회귀 방지', () => {
  test('drag→drop 직후(지연 없이) 다른 exclude thumbnail을 클릭해도 active section이 바뀐다', async ({
    page,
  }) => {
    // 4단계에서 재현·확정한 회귀: dnd-kit AbstractPointerSensor.detach()가
    // drag 종료 시 document capture 단계의 click 억제 리스너를 즉시 지우지
    // 않고 setTimeout(..., 50)으로 50ms 뒤에 지운다 — 그 사이의 click은
    // 어떤 엘리먼트를 눌러도 capture 단계에서 stopPropagation되어 target까지
    // 도달하지 못한다(React onClick도, native addEventListener('click')도
    // 실행되지 않음을 실측 확인). optimistic update로 화면이 즉시 갱신되는
    // 이 앱에서는 drop 직후 바로 이어지는 클릭이 그 50ms 창에 들어가는 게
    // 충분히 재현 가능하다 — 그래서 이 테스트는 일부러 drag→click 사이에
    // 아무 대기도 넣지 않는다(가장 나쁜 타이밍을 그대로 재현).
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await reachN3(page);

    // 1~2. N3 진입 + 현재 active exclude section 확인 — mock 기본 데이터는
    // exclude 1건(옛 sec_03, id=3, exclusionReason 있음·verdicts:[])뿐이라
    // 그게 기본 active다.
    const originalExcludeThumb = page.getByTestId('n3-thumb-exclude-3');
    await expect(originalExcludeThumb).toBeVisible();
    await expect(originalExcludeThumb).toHaveClass(/ring-\[#ff6a38\]/);
    await expect(page.getByTestId('n3-source-viewport').locator('img')).toHaveAttribute(
      'alt',
      /^섹션 3 /,
    );

    // 3~4. include 섹션 하나(옛 sec_01, id=1)를 exclude로 drag → drop 완료 확인.
    const includeThumb = page.locator('[data-testid^="n3-thumb-include-"]').first();
    await dragBetweenZones(page, includeThumb, page.getByTestId('n3-exclude-zone'));
    await expect(page.locator('[data-testid^="n3-thumb-exclude-"]')).toHaveCount(2);
    // 방금 옮긴 섹션(id=1, exclusionReason·verdicts 없음)이 자동으로 active가
    // 된다 — 판정 컬럼이 "판정 정보가 없습니다"로 바뀐 것으로 확인.
    await expect(page.locator('text=판정 정보가 없습니다')).toBeVisible();
    await expect(page.getByTestId('n3-source-viewport').locator('img')).toHaveAttribute(
      'alt',
      /^섹션 1 /,
    );

    // 5. drop 직후 지연 없이 원래 exclude 후보(id=3)를 바로 클릭한다.
    await originalExcludeThumb.click();

    // 6. active ring이 옮겨간다.
    await expect(originalExcludeThumb).toHaveClass(/ring-\[#ff6a38\]/);
    // 7. 중앙 source 뷰포트의 대상 section이 바뀐다(같은 sourceImage라
    // 이미지 자체는 같아도, alt에 반영되는 활성 section은 바뀌어야 한다).
    await expect(page.getByTestId('n3-source-viewport').locator('img')).toHaveAttribute(
      'alt',
      /^섹션 3 /,
    );
    // 8. verdict 컬럼도 그 section 데이터(exclusionReason 배지)로 바뀐다.
    await expect(page.locator('text=판정 정보가 없습니다')).toHaveCount(0);
    await expect(page.locator('text=현지 무의미(자동)')).toBeVisible();

    expect(pageErrors, `pageerror 발생: ${pageErrors.map((e) => e.message).join(', ')}`).toEqual([]);
  });

  test('drag 없이 일반 click만으로도 active section이 정상 전환된다', async ({ page }) => {
    // 회귀 수정이 "drag를 거친 뒤"만 고치고 평범한 클릭 경로를 깨지
    // 않았는지 확인한다 — include→exclude drag로 두 번째 exclude 후보를
    // 만든 뒤, 이번엔 그 지점과 무관하게 순수 클릭만 반복해 왕복 전환된다.
    await reachN3(page);
    const includeThumb = page.locator('[data-testid^="n3-thumb-include-"]').first();
    await dragBetweenZones(page, includeThumb, page.getByTestId('n3-exclude-zone'));
    await expect(page.locator('[data-testid^="n3-thumb-exclude-"]')).toHaveCount(2);

    const thumb1 = page.getByTestId('n3-thumb-exclude-1');
    const thumb3 = page.getByTestId('n3-thumb-exclude-3');

    await thumb3.click();
    await expect(thumb3).toHaveClass(/ring-\[#ff6a38\]/);
    await expect(thumb1).not.toHaveClass(/ring-\[#ff6a38\]/);

    await thumb1.click();
    await expect(thumb1).toHaveClass(/ring-\[#ff6a38\]/);
    await expect(thumb3).not.toHaveClass(/ring-\[#ff6a38\]/);
  });
});

test.describe('N3 — active section 자동 보정', () => {
  test('active exclude section을 include로 옮기면 남은 exclude 후보로 자동 전환되고, 0개가 되면 empty state로 간다', async ({
    page,
  }) => {
    await reachN3(page);

    // 기본 active(id=3)를 다시 include로 되돌린다 — 남은 exclude 후보가
    // 0개가 되므로, moveSection의 "다음 exclude 후보로 전환" 대신 empty
    // state 문구가 보여야 한다.
    const activeExcludeThumb = page.getByTestId('n3-thumb-exclude-3');
    await dragBetweenZones(page, activeExcludeThumb, page.getByTestId('n3-include-zone'));

    await expect(page.locator('[data-testid^="n3-thumb-exclude-"]')).toHaveCount(0);
    await expect(page.locator('text=삭제 후보로 남은 섹션이 없습니다')).toBeVisible();

    // include→exclude로 두 개를 순서대로 옮긴다. moveSection은 include→
    // exclude 이동마다 "방금 옮긴 섹션"을 active로 세우므로, 두 번째로
    // 옮긴 섹션이 지금 active다 — 각 drag 직후 testid를 그대로 기록해
    // "어느 게 지금 active인지"를 동적으로 다시 찾지 않고 결정론적으로 안다.
    const include1 = page.locator('[data-testid^="n3-thumb-include-"]').first();
    const firstMovedId = (await include1.getAttribute('data-testid'))!.replace('n3-thumb-include-', '');
    await dragBetweenZones(page, include1, page.getByTestId('n3-exclude-zone'));
    await expect(page.locator('[data-testid^="n3-thumb-exclude-"]')).toHaveCount(1);

    const include2 = page.locator('[data-testid^="n3-thumb-include-"]').first();
    const secondMovedId = (await include2.getAttribute('data-testid'))!.replace('n3-thumb-include-', '');
    await dragBetweenZones(page, include2, page.getByTestId('n3-exclude-zone'));
    await expect(page.locator('[data-testid^="n3-thumb-exclude-"]')).toHaveCount(2);

    const firstExcludeThumb = page.getByTestId(`n3-thumb-exclude-${firstMovedId}`);
    const secondExcludeThumb = page.getByTestId(`n3-thumb-exclude-${secondMovedId}`);
    // 두 번째로 옮긴 섹션이 active다.
    await expect(secondExcludeThumb).toHaveClass(/ring-\[#ff6a38\]/);
    await expect(firstExcludeThumb).not.toHaveClass(/ring-\[#ff6a38\]/);

    // active(두 번째로 옮긴 섹션)를 다시 include로 되돌린다 — active가
    // 빠지는 것이므로 "남은 exclude 후보(첫 번째로 옮긴 섹션)"로 자동
    // 전환되어야 하고, 빈 상태로 떨어지지 않아야 한다.
    await dragBetweenZones(page, secondExcludeThumb, page.getByTestId('n3-include-zone'));
    await expect(page.locator('[data-testid^="n3-thumb-exclude-"]')).toHaveCount(1);
    await expect(page.locator('text=삭제 후보로 남은 섹션이 없습니다')).toHaveCount(0);
    await expect(firstExcludeThumb).toHaveClass(/ring-\[#ff6a38\]/);

    // restore로 방금 include로 돌아간 섹션은 include 목록에서 더 이상
    // active 대상이 아니다(sidebar thumbnail은 애초에 active ring을 쓰지
    // 않는다) — 여기서는 그 섹션이 include 목록에 다시 나타났는지만 확인해
    // "restore가 exclude의 active를 필요 이상으로 뺏지 않는다"를 뒷받침한다.
    await expect(page.getByTestId(`n3-thumb-include-${secondMovedId}`)).toBeVisible();
  });
});
