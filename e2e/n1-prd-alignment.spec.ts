import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N1 — PRD v3.5.10 · Figma 525:3023 정합
// 카테고리 트리 창([확인]으로 확정 · 검색 12월), OTC 종류(OTC 의약품·복합만 · 단일 선택 ·
// 국가 변경 시 다시 고름 · 저장 계약 없음), 책임 동의(F-ACC-04), 인증 마크 업로드(12월 · 비활성),
// mock 모드의 로그인 미호출을 확인한다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const CONSENT = /외부 AI 서비스로 전송됨을 확인했습니다/;

interface ApiCall {
  method: string;
  path: string;
  body: string | null;
}

/** 앱의 API 호출(프록시 식별 헤더가 붙은 요청)과 /auth/ 호출을 window.fetch에서 기록한다 */
async function recordApiCalls(page: Page): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  await page.exposeFunction('__n1PrdRecord', (call: ApiCall) => {
    calls.push(call);
  });
  await page.addInitScript(() => {
    const record = (window as unknown as { __n1PrdRecord: (call: unknown) => Promise<void> }).__n1PrdRecord;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, location.href).pathname;
      if (new Headers(init?.headers).has('x-pixlate-api-proxy') || path.includes('/auth/')) {
        await record({
          method: (init?.method ?? 'GET').toUpperCase(),
          path,
          body: typeof init?.body === 'string' ? init.body : null,
        });
      }
      return originalFetch(input, init);
    };
  });
  return calls;
}

const categoryModal = (page: Page) => page.getByRole('dialog', { name: '카테고리 선택' });
const nextButton = (page: Page) => page.getByRole('button', { name: '다음', exact: true });
const regulatorySelect = (page: Page) => page.getByRole('combobox', { name: '규제 분류' });

async function pickCategory(page: Page, labels: string[]) {
  await page.getByRole('button', { name: '선택하기' }).click();
  for (const label of labels) await categoryModal(page).getByRole('button', { name: label, exact: true }).click();
  await categoryModal(page).getByRole('button', { name: '확인' }).click();
}

/** 카테고리·동의·OTC를 뺀 나머지 필수값 */
async function fillBase(page: Page, regulatoryClass = 'cosmetic') {
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('N1 정합 상품');
  await page.getByRole('combobox').nth(0).selectOption('US');
  await page.getByRole('combobox').nth(1).selectOption('en');
  await regulatorySelect(page).selectOption(regulatoryClass);
  await page.locator('#image-upload').setInputFiles({ name: 'n1.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.locator('img[alt="n1.png"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
});

test.describe('카테고리 — 엑셀 3단 트리 창 + [확인]', () => {
  const MAJORS = ['스킨케어', '마스크팩', '클렌징', '선케어', '메이크업', '뷰티소품', '더모코스메틱', '네일', '헤어케어', '바디케어', '향수/디퓨저'];

  test('「검색하기」 필드와 「선택하기」가 같은 3단 트리 창을 열고, 대분류 11종이 보이며 텍스트 검색은 없다', async ({ page }) => {
    const field = page.getByTestId('n1-category-field');
    await expect(field).toHaveText('검색하기');
    expect(await field.evaluate((el) => el.tagName)).toBe('BUTTON');

    await field.click();
    const modal = categoryModal(page);
    await expect(modal).toBeVisible();
    // 12월 검색칸은 노출하지 않는다
    await expect(modal.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByPlaceholder('카테고리명 검색')).toHaveCount(0);
    // 대분류 · 중분류 · 소분류 3단(세분류 없음)
    for (const heading of ['대분류', '중분류', '소분류']) await expect(modal.getByText(heading, { exact: true })).toBeVisible();
    await expect(modal.getByText('세분류', { exact: true })).toHaveCount(0);
    // 대분류 열은 엑셀 B열 11종 그대로(예전 임시 샘플 없음)
    const majorColumn = modal.getByText('대분류', { exact: true }).locator('xpath=../..');
    await expect(majorColumn.getByRole('button')).toHaveText(MAJORS);
    await expect(modal.getByRole('button', { name: '화장품/향수' })).toHaveCount(0);
    await modal.getByRole('button', { name: '취소' }).click();
    await expect(modal).toHaveCount(0);

    await page.getByRole('button', { name: '선택하기' }).click();
    await expect(modal).toBeVisible();
    await expect(majorColumn.getByRole('button')).toHaveCount(11);
  });

  test('소분류가 있으면 소분류까지 골라야 [확인]이 열리고, [확인] 전에는 값이 그대로다', async ({ page }) => {
    const field = page.getByTestId('n1-category-field');
    await field.click();
    const modal = categoryModal(page);
    const confirm = modal.getByRole('button', { name: '확인' });
    await expect(confirm).toBeDisabled();

    await modal.getByRole('button', { name: '스킨케어', exact: true }).click();
    await expect(confirm).toBeDisabled();
    await modal.getByText('중분류', { exact: true }).locator('xpath=../..').getByRole('button', { name: '크림', exact: true }).click();
    // 소분류(크림 · 아이크림)가 있는 중분류만으로는 [확인]이 눌리지 않는다(F-SRC-04 ②)
    await expect(confirm).toBeDisabled();
    await modal.getByRole('button', { name: '아이크림', exact: true }).click();
    // 선택 중 경로는 orange 강조
    // 엑셀에 「크림 > 크림」처럼 같은 이름이 단마다 있어 열 단위로 찾는다
    for (const [heading, label] of [['대분류', '스킨케어'], ['중분류', '크림'], ['소분류', '아이크림']]) {
      const column = modal.getByText(heading, { exact: true }).locator('xpath=../..');
      const item = column.getByRole('button', { name: label, exact: true });
      await expect(item).toHaveAttribute('aria-pressed', 'true');
      await expect(item).toHaveCSS('color', 'rgb(255, 106, 56)');
    }
    await expect(confirm).toBeEnabled();
    // 항목 클릭만으로 닫히지 않고 N1 값도 그대로다
    await expect(modal).toBeVisible();
    await expect(field).toHaveText('검색하기');

    await confirm.click();
    await expect(modal).toHaveCount(0);
    await expect(field).toHaveText('스킨케어 > 크림 > 아이크림');

    // 다시 열면 확정한 경로가 펼쳐져 있다
    await page.getByRole('button', { name: '선택하기' }).click();
    await expect(modal.getByRole('button', { name: '아이크림', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('소분류가 없는 중분류는 그 자체로 [확인]할 수 있다', async ({ page }) => {
    await page.getByRole('button', { name: '선택하기' }).click();
    const modal = categoryModal(page);
    await modal.getByRole('button', { name: '선케어', exact: true }).click();
    await modal.getByRole('button', { name: '선크림', exact: true }).click();
    // 소분류 열이 비어 있다
    await expect(modal.getByText('소분류', { exact: true }).locator('xpath=../..').getByRole('button')).toHaveCount(0);
    await expect(modal.getByRole('button', { name: '확인' })).toBeEnabled();
    await modal.getByRole('button', { name: '확인' }).click();
    await expect(page.getByTestId('n1-category-field')).toHaveText('선케어 > 선크림');
  });

  test('취소·바깥 클릭·Esc는 선택 전 값을 유지한다', async ({ page }) => {
    const field = page.getByTestId('n1-category-field');
    await pickCategory(page, ['선케어', '선크림']);
    await expect(field).toHaveText('선케어 > 선크림');

    for (const close of ['cancel', 'outside', 'escape'] as const) {
      await page.getByRole('button', { name: '선택하기' }).click();
      await categoryModal(page).getByRole('button', { name: '스킨케어', exact: true }).click();
      await categoryModal(page).getByRole('button', { name: '스킨/토너', exact: true }).click();
      await expect(categoryModal(page).getByRole('button', { name: '확인' })).toBeEnabled();
      if (close === 'cancel') await categoryModal(page).getByRole('button', { name: '취소' }).click();
      if (close === 'outside') await page.mouse.click(10, 10);
      if (close === 'escape') await page.keyboard.press('Escape');
      await expect(categoryModal(page)).toHaveCount(0);
      await expect(field).toHaveText('선케어 > 선크림');
    }
  });
});

test.describe('규제 분류 · OTC 종류', () => {
  const otcGroup = (page: Page) => page.getByRole('radiogroup', { name: 'OTC 종류' });

  test('화장품·잘 모름은 OTC 종류가 없고, OTC 의약품·복합은 4종이 보인다', async ({ page }) => {
    await page.getByRole('combobox').nth(0).selectOption('US');
    for (const value of ['cosmetic', 'unknown']) {
      await regulatorySelect(page).selectOption(value);
      await expect(otcGroup(page)).toHaveCount(0);
    }
    for (const value of ['otc', 'combination']) {
      await regulatorySelect(page).selectOption(value);
      await expect(otcGroup(page).getByRole('radio')).toHaveText([
        '선크림 (Sunscreen)',
        '여드름 (Acne)',
        '비듬·지루성 피부염·건선 (Dandruff · Seborrheic Dermatitis · Psoriasis)',
        '피부보호제 (Skin Protectant)',
      ]);
    }
    // 복합만 PRD 한계 고지, OTC 의약품에는 없다
    const helper = page.getByTestId('n1-regulatory-helper');
    await expect(helper).toContainText('복합 제품은 고른 OTC 종류와 같은 기준으로 검사합니다(화장품 규칙 포함).');
    await expect(helper).toContainText('제품이 그 OTC 기준(성분 · 함량 · 시험)을 실제로 충족하는지는 확인하지 않습니다.');
    await regulatorySelect(page).selectOption('otc');
    await expect(helper).toHaveCount(0);
  });

  test('태그는 하나만 선택되고, 국가를 바꾸면 규제 분류와 OTC 종류를 다시 고른다', async ({ page }) => {
    await page.getByRole('combobox').nth(0).selectOption('US');
    await regulatorySelect(page).selectOption('otc');
    const sunscreen = otcGroup(page).getByRole('radio', { name: '선크림 (Sunscreen)' });
    const acne = otcGroup(page).getByRole('radio', { name: '여드름 (Acne)' });
    await sunscreen.click();
    await expect(sunscreen).toHaveAttribute('aria-checked', 'true');
    await acne.click();
    await expect(acne).toHaveAttribute('aria-checked', 'true');
    await expect(sunscreen).toHaveAttribute('aria-checked', 'false');
    await expect(otcGroup(page).locator('[aria-checked="true"]')).toHaveCount(1);
    // 선택 상태는 orange accent
    await expect(acne).toHaveCSS('border-color', 'rgb(255, 106, 56)');

    await page.getByRole('combobox').nth(0).selectOption('JP');
    await expect(regulatorySelect(page)).toHaveValue('');
    await page.getByRole('combobox').nth(0).selectOption('US');
    await regulatorySelect(page).selectOption('otc');
    await expect(otcGroup(page).locator('[aria-checked="true"]')).toHaveCount(0);
  });

  test('OTC 의약품은 OTC 종류를 골라야 [다음]이 열리고, 요청에는 OTC 종류 필드를 넣지 않는다', async ({ page }) => {
    const calls = await recordApiCalls(page);
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    await fillBase(page, 'otc');
    await pickCategory(page, ['선케어', '선크림']);
    await page.getByRole('checkbox', { name: CONSENT }).check();
    await expect(nextButton(page)).toBeDisabled();
    await expect(page.getByTestId('n1-otc-type-notice')).toHaveText(
      'OTC 종류는 아직 작업에 저장되지 않습니다. 저장 기능이 준비되면 반영됩니다.',
    );

    await otcGroup(page).getByRole('radio', { name: '선크림 (Sunscreen)' }).click();
    await expect(nextButton(page)).toBeEnabled();
    await nextButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));

    const patch = calls.find((c) => c.method === 'PATCH' && c.path === `/jobs/${MOCK_JOB_ID}`);
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch!.body!)).toEqual({
      productName: 'N1 정합 상품',
      productCode: null,
      targetCountry: 'US',
      targetLanguage: 'en',
      regulatoryClass: 'otc',
      specType: 'original',
      imageType: 'multi_section',
      keywords: [],
    });
    expect(patch!.body).not.toMatch(/otc_?type|monograph|M020/i);
    // mock 모드에서는 로그인하지 않는다
    expect(calls.filter((c) => c.path.includes('/auth/'))).toEqual([]);
  });
});

test.describe('책임 동의 (F-ACC-04)', () => {
  test('PRD 문구 그대로 보이고, 체크해야 [다음]이 열린다', async ({ page }) => {
    const checkbox = page.getByRole('checkbox', { name: CONSENT });
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByTestId('n1-consent')).toHaveText(
      '결과물에 쓰는 인증·시험 결과, 광고 문구, 인증 로고의 사용 권한과 그 책임이 사용자에게 있으며,' +
        '규제·현지 검사 결과는 참고용 권고이며, 올린 이미지와 문구가 외부 AI 서비스로 전송됨을 확인했습니다.',
    );
    // 업로드 영역에는 같은 책임 문장을 따로 두지 않는다
    await expect(page.getByText('문제 발생 시 플랫폼이 책임지지 않습니다', { exact: false })).toHaveCount(0);
    await expect(page.getByText('최대 1GB · 여러 파일을 한 번에 업로드할 수 있습니다.')).toBeVisible();

    await fillBase(page);
    await pickCategory(page, ['선케어', '선크림']);
    await expect(nextButton(page)).toBeDisabled();
    await checkbox.check();
    await expect(nextButton(page)).toBeEnabled();
    await checkbox.uncheck();
    await expect(nextButton(page)).toBeDisabled();
  });

  test('카테고리를 고르지 않으면 [다음]이 닫혀 있다(F-SRC-04 ①)', async ({ page }) => {
    await fillBase(page);
    await page.getByRole('checkbox', { name: CONSENT }).check();
    await expect(nextButton(page)).toBeDisabled();
    await pickCategory(page, ['선케어', '선크림']);
    await expect(nextButton(page)).toBeEnabled();
  });
});

test.describe('인증 마크 업로드 (F-SRC-08 · 12월)', () => {
  test('보이지만 비활성이고, hover·focus에 두 줄 툴팁을 띄우며 업로드는 열리지 않는다', async ({ page }) => {
    const button = page.getByTestId('n1-certification-upload');
    const tooltip = page.getByRole('tooltip');
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(tooltip).toBeHidden();

    await button.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('p')).toHaveText([
      '- 사이즈 변경을 고르면 인증 마크를 올릴 수 있어요.',
      '- 인증 및 시험 정보의 적용 가능 여부는 사용자가 최종 확인해야 합니다.',
    ]);

    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
    await button.focus();
    await expect(tooltip).toBeVisible();

    await button.click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(1); // 원본 업로드 input 하나뿐
  });
});

test('1920×1080에서 동의 체크·인증 마크·다음이 한 화면에 보인다', async ({ page }) => {
  await page.getByRole('combobox').nth(0).selectOption('US');
  await regulatorySelect(page).selectOption('combination');
  for (const locator of [
    page.getByTestId('n1-consent'),
    page.getByTestId('n1-certification-upload'),
    nextButton(page),
    page.getByTestId('n1-category-field'),
  ]) {
    await expect(locator).toBeInViewport({ ratio: 1 });
  }
  const consent = (await page.getByTestId('n1-consent').boundingBox())!;
  const next = (await nextButton(page).boundingBox())!;
  const cert = (await page.getByTestId('n1-certification-upload').boundingBox())!;
  test.info().annotations.push({
    type: 'measure',
    description: `consent x=${consent.x} y=${consent.y} w=${consent.width} h=${consent.height} · cert x=${cert.x} y=${cert.y} w=${cert.width} · next x=${next.x} y=${next.y} w=${next.width} h=${next.height}`,
  });
  // 동의 문구는 잘리지 않는다(두 줄 모두 상자 안)
  expect(await page.getByTestId('n1-consent').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('n1-1920x1080-combination.png') });
  await page.getByTestId('n1-certification-upload').hover();
  await page.screenshot({ path: test.info().outputPath('n1-1920x1080-tooltip.png') });
});

test('작은 viewport(1440×800)에서도 패널은 스크롤되고 동의·다음은 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.getByRole('combobox').nth(0).selectOption('US');
  await regulatorySelect(page).selectOption('combination');
  await expect(page.getByTestId('n1-consent')).toBeInViewport({ ratio: 1 });
  await expect(nextButton(page)).toBeInViewport({ ratio: 1 });
  const keyword = page.getByPlaceholder('키워드를 입력해주세요.');
  await keyword.scrollIntoViewIfNeeded();
  await expect(keyword).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('n1-1440x800.png') });
});
