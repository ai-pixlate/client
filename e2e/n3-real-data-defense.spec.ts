import { test, expect, type Locator, type Page } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID, mockSectionsResponse } from '@/lib/mock-api/fixtures';

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

/**
 * lib/msw/handlers.ts의 toNumericId와 동일한 규칙(끝자리 숫자 추출)이다 —
 * fixture는 '@/' alias를 쓰지 않고 여기서 그대로 옮겨 적는다. mock 데이터의
 * section 개수/bucket 배정이 바뀌어도 이 테스트 파일이 특정 id를 하드코딩하지
 * 않도록, section id는 항상 이 함수로 fixture에서 파생시킨다.
 */
function toNumericId(id: string): number {
  const digits = id.match(/\d+/)?.[0];
  return digits ? Number(digits) : 0;
}

/** 현재 활성화된(active ring이 있는) exclude thumbnail 하나를 동적으로 찾는다. */
async function getActiveExcludeThumb(page: Page): Promise<Locator> {
  const thumbs = page.locator('[data-testid^="n3-thumb-exclude-"]');
  const count = await thumbs.count();
  for (let i = 0; i < count; i += 1) {
    const cls = await thumbs.nth(i).getAttribute('class');
    if (cls?.includes('ring-[#ff6a38]')) return thumbs.nth(i);
  }
  throw new Error('active(ring) exclude thumbnail을 찾지 못했습니다');
}

/**
 * 썸네일(`섹션 {sectionOrder} 미리보기`)과 중앙 상세보기(`섹션 {sectionOrder}
 * 소속 원본 상세페이지`) img는 둘 다 alt에 sectionOrder를 담는다 — 이 값으로
 * "지금 active로 보이는 thumbnail"과 "지금 상세보기에 뜬 section"이 같은
 * section인지, id를 하드코딩하지 않고 동적으로 대조한다.
 */
async function sectionOrderFromAlt(imgLocator: Locator): Promise<string> {
  const alt = await imgLocator.getAttribute('alt');
  const match = alt?.match(/^섹션 (\S+) /);
  if (!match) throw new Error(`alt에서 섹션 번호를 추출하지 못했습니다: "${alt}"`);
  return match[1];
}

async function detailPanelSectionOrder(page: Page): Promise<string> {
  return sectionOrderFromAlt(page.getByTestId('n3-source-viewport').locator('img'));
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
//
// (verdict/bucket 정본 확인 결과) mock 기본 데이터의 exclude/include 개수와
// "기본 active가 어느 section인지"는 fixture(lib/mock-api/fixtures.ts)의
// verdictType→bucket 배정에 따라 달라진다 — verdictType='regulatory'
// (사용자 표시 "규제 위반")는 기본 bucket이 exclude여야 하는 계약값이라
// (scripts/verify-n3-verdict-contract.mjs), fixture를 그 계약에 맞게
// 고치면서 sec_02/sec_05도 exclude로 바뀌었다. 이 파일은 그 결과로 exclude
// 개수(1→3)나 "어떤 id가 기본 active인지"를 더 이상 하드코딩하지 않고,
// 항상 현재 렌더링된 DOM에서 동적으로 읽는다.
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
    // mock 기본 데이터 중 어떤 section이 기본 active인지는 verdictType→
    // bucket 배정에 따라 달라질 수 있으므로 특정 id를 가정하지 않는다 —
    // 이 테스트는 "exclude 목록의 아무 section이나 렌더돼도(verdicts:[]
    // 포함) crash 없이 뜨는지"를 exclude 전체를 순회해 확인한다.
    // verdicts[0] 같은 암묵적 가정이 있었다면 어느 section에서든 여기서
    // crash한다.
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await reachN3(page);

    await expect(page.getByTestId('n3-exclude-zone')).toBeVisible();
    await expect(page.getByTestId('n3-include-zone')).toBeVisible();

    const excludeThumbs = page.locator('[data-testid^="n3-thumb-exclude-"]');
    const count = await excludeThumbs.count();
    expect(count, '이 검증이 의미 있으려면 exclude 후보가 최소 1개는 있어야 한다').toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      await excludeThumbs.nth(i).click();
      await expect(page.getByTestId('n3-source-viewport')).toBeVisible();
    }

    expect(pageErrors, `pageerror 발생: ${pageErrors.map((e) => e.message).join(', ')}`).toEqual([]);
  });
});

test.describe('N3 — 기본 active section', () => {
  test('exclude thumbnail 중 정확히 하나가 active이고, 상세보기가 그 section과 일치한다', async ({
    page,
  }) => {
    await reachN3(page);

    const excludeThumbs = page.locator('[data-testid^="n3-thumb-exclude-"]');
    const count = await excludeThumbs.count();
    expect(count, '기본 mock 데이터에 exclude 후보가 있어야 한다').toBeGreaterThan(0);

    let activeCount = 0;
    let activeIndex = -1;
    for (let i = 0; i < count; i += 1) {
      const cls = await excludeThumbs.nth(i).getAttribute('class');
      if (cls?.includes('ring-[#ff6a38]')) {
        activeCount += 1;
        activeIndex = i;
      }
    }
    expect(activeCount, 'exclude thumbnail 중 정확히 하나만 active ring을 가져야 한다').toBe(1);

    // "id=N이 기본 active여야 한다"가 아니라, 지금 active로 표시된
    // thumbnail과 중앙 상세보기가 같은 section을 가리키는지만 확인한다.
    const activeThumbOrder = await sectionOrderFromAlt(excludeThumbs.nth(activeIndex).locator('img'));
    const detailOrder = await detailPanelSectionOrder(page);
    expect(detailOrder, '중앙 상세보기의 section이 active thumbnail과 일치해야 한다').toBe(activeThumbOrder);

    // verdict column도 같은 DetailPanel 트리에서 그 section을 그린다 —
    // crash 없이 렌더됐는지만 함께 확인한다(내용은 판정 0건 방어 테스트가 맡는다).
    await expect(page.getByTestId('n3-source-viewport')).toBeVisible();
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

    // 1. 현재 active exclude thumbnail을 동적으로 찾는다(특정 id 가정 없음).
    const originalActive = await getActiveExcludeThumb(page);
    const originalOrder = await sectionOrderFromAlt(originalActive.locator('img'));
    await expect(originalActive).toHaveClass(/ring-\[#ff6a38\]/);

    // 2. 그 section을 include로 drag한다.
    await dragBetweenZones(page, originalActive, page.getByTestId('n3-include-zone'));

    // 3. 남아 있는 exclude 중 "지금(자동 전환됐을 수 있는) active와 다른"
    // thumbnail 하나를 동적으로 고른다 — 우연히 같은 걸 고르면 클릭해도
    // active가 안 바뀌어 회귀를 검증하지 못하므로, 반드시 다른 걸 고른다.
    const remainingExclude = page.locator('[data-testid^="n3-thumb-exclude-"]');
    const remainingCount = await remainingExclude.count();
    expect(remainingCount, '이 시나리오는 옮긴 뒤에도 exclude 후보가 남아 있어야 성립한다').toBeGreaterThan(0);

    let currentActiveOrder: string | null = null;
    try {
      const currentActive = await getActiveExcludeThumb(page);
      currentActiveOrder = await sectionOrderFromAlt(currentActive.locator('img'));
    } catch {
      currentActiveOrder = null;
    }

    let target: Locator | null = null;
    let targetOrder = '';
    for (let i = 0; i < remainingCount; i += 1) {
      const order = await sectionOrderFromAlt(remainingExclude.nth(i).locator('img'));
      if (order !== currentActiveOrder) {
        target = remainingExclude.nth(i);
        targetOrder = order;
        break;
      }
    }
    expect(target, '현재 active와 다른 exclude thumbnail이 최소 하나 있어야 이 시나리오가 성립한다').not.toBeNull();

    // 4. drop 직후 지연 없이 target을 바로 클릭한다.
    await target!.click();

    // 5. active ring이 클릭한 thumbnail로 이동한다.
    await expect(target!).toHaveClass(/ring-\[#ff6a38\]/);

    // 6. 중앙 상세보기/판정 내용도 target section으로 바뀐다.
    const detailOrder = await detailPanelSectionOrder(page);
    expect(detailOrder).toBe(targetOrder);
    expect(detailOrder).not.toBe(originalOrder);

    expect(pageErrors, `pageerror 발생: ${pageErrors.map((e) => e.message).join(', ')}`).toEqual([]);
  });

  test('drag 없이 일반 click만으로도 active section이 정상 전환된다', async ({ page }) => {
    // 회귀 수정이 "drag를 거친 뒤"만 고치고 평범한 클릭 경로를 깨지
    // 않았는지 확인한다. mock 기본 데이터가 이미 exclude 2개 이상을
    // 갖고 있다는 전제만 확인하고(드래그로 개수를 인위적으로 만들지
    // 않는다), 그 중 첫 번째/두 번째 thumbnail을 동적으로 골라 클릭
    // 왕복이 정상 전환되는지 본다.
    await reachN3(page);

    const excludeThumbs = page.locator('[data-testid^="n3-thumb-exclude-"]');
    const count = await excludeThumbs.count();
    expect(count, '이 시나리오는 exclude 후보가 2개 이상이어야 한다').toBeGreaterThanOrEqual(2);

    const thumbA = excludeThumbs.nth(0);
    const thumbB = excludeThumbs.nth(1);

    await thumbA.click();
    await expect(thumbA).toHaveClass(/ring-\[#ff6a38\]/);
    await expect(thumbB).not.toHaveClass(/ring-\[#ff6a38\]/);

    await thumbB.click();
    await expect(thumbB).toHaveClass(/ring-\[#ff6a38\]/);
    await expect(thumbA).not.toHaveClass(/ring-\[#ff6a38\]/);

    await thumbA.click();
    await expect(thumbA).toHaveClass(/ring-\[#ff6a38\]/);
    await expect(thumbB).not.toHaveClass(/ring-\[#ff6a38\]/);
  });
});

test.describe('N3 — active section 자동 보정', () => {
  test('exclude를 하나씩 include로 옮길 때마다 active가 안전하게 다음 후보로 넘어가고, 0개가 되면 empty state로 간다', async ({
    page,
  }) => {
    // "한 번/두 번 옮기면 0개"처럼 초기 개수를 가정하지 않는다 — 지금
    // 렌더된 exclude 개수를 읽어서 그만큼 반복하고, 매 반복마다 "남은
    // 후보가 있으면 다른 section이 active가 되는지", "0개가 되면 empty
    // state가 뜨는지"만 검증한다.
    await reachN3(page);

    const excludeThumbs = page.locator('[data-testid^="n3-thumb-exclude-"]');
    let remaining = await excludeThumbs.count();
    expect(remaining, '이 시나리오는 exclude 후보가 최소 1개는 있어야 성립한다').toBeGreaterThan(0);

    while (remaining > 0) {
      const active = await getActiveExcludeThumb(page);
      const activeOrder = await sectionOrderFromAlt(active.locator('img'));

      await dragBetweenZones(page, active, page.getByTestId('n3-include-zone'));

      const nextCount = await excludeThumbs.count();
      expect(nextCount, '방금 옮긴 만큼 exclude 개수가 정확히 하나 줄어야 한다').toBe(remaining - 1);

      if (nextCount > 0) {
        // 다른 section이 자동으로 active가 된다 — 방금 옮긴 section과
        // 같은 section이 다시 active로 남아있으면 안 된다.
        const nextActive = await getActiveExcludeThumb(page);
        const nextActiveOrder = await sectionOrderFromAlt(nextActive.locator('img'));
        expect(nextActiveOrder, '방금 옮긴 section이 아니라 남은 다른 후보로 active가 넘어가야 한다').not.toBe(
          activeOrder,
        );
        await expect(page.locator('text=삭제 후보로 남은 섹션이 없습니다')).toHaveCount(0);
      } else {
        await expect(page.locator('text=삭제 후보로 남은 섹션이 없습니다')).toBeVisible();
      }

      remaining = nextCount;
    }
  });
});

test.describe('N3 — 규제 위반(regulatory) verdict bucket 회귀 방지', () => {
  test('regulatory verdict section은 기본적으로 exclude rail에 표시된다', async ({ page }) => {
    // 이번에 실제로 발견·수정한 버그: verdictType='regulatory'(사용자 표시
    // "규제 위반")를 가진 section(sec_02/sec_05)이 fixture에 bucket:'include'로
    // 잘못 박혀 있어 "번역할 섹션" rail에 노출되고 있었다. 재발 방지를 위해
    // "regulatory → exclude"라는 계약(scripts/verify-n3-verdict-contract.mjs)을
    // 화면 레벨에서 직접 검증한다 — 특정 id를 하드코딩하지 않고, fixture
    // 데이터 자체에서 regulatory verdict를 가진 section id를 동적으로
    // 구해서 그 id들이 전부 exclude rail에만 있는지 확인한다.
    const regulatorySectionIds = mockSectionsResponse.sections
      .filter((s) => s.verdicts.some((v) => v.verdictType === 'regulatory'))
      .map((s) => toNumericId(s.sectionId));

    expect(
      regulatorySectionIds.length,
      'mock fixture에 verdictType=regulatory section이 하나도 없어 이 회귀 테스트가 무의미합니다 — fixture 구성을 확인하세요',
    ).toBeGreaterThan(0);

    await reachN3(page);

    for (const id of regulatorySectionIds) {
      await expect(
        page.getByTestId(`n3-thumb-exclude-${id}`),
        `regulatory(규제 위반) verdict를 가진 section(id=${id})이 삭제할 섹션(exclude) rail에 없습니다 — 기본 bucket은 exclude여야 합니다`,
      ).toBeVisible();
      await expect(
        page.getByTestId(`n3-thumb-include-${id}`),
        `regulatory(규제 위반) verdict를 가진 section(id=${id})이 번역할 섹션(include) rail에도 표시되고 있습니다 — regulatory는 include에 있으면 안 됩니다`,
      ).toHaveCount(0);
    }
  });
});
