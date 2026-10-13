import { test, expect, type Locator, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// N1 이미지 정보 입력 — Figma 525:3023(우측 패널·SizeSelector·하단 action·tooltip),
// 1170:8460(인증 마크 복수 업로드 모달). MSW mock 기준.
//
// 사이즈 선택과 인증 마크 파일은 계약(specType 9월 original 고정, 커스텀 W/H·인증 업로드 필드 없음)이
// 없어 FE 화면 상태까지만 검증한다. 계약이 없는 동안 「사이즈 변경」은 잠겨 있고(PR 리뷰), 그래서 인증 마크
// 버튼(PRD F-SRC-08: 사이즈 변경일 때만 활성)도 항상 disabled다.
// ─────────────────────────────────────────────────────────────────

const MOCK_BRAND_ID = 'brand_mock_001';
const ORANGE = 'rgb(255, 106, 56)';

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator): Promise<Box> => (await locator.boundingBox())!;
/** optical glyph처럼 소수 px geometry는 layout 단위(1/64px) 반올림 오차 안에서 비교한다. */
const expectNear = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.05);

test.use({ viewport: { width: 1920, height: 1080 } });

test.beforeEach(async ({ page }) => {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  await expect(page.getByTestId('n1-field-panel')).toBeVisible();
});

const pngFile = (name: string) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ),
});

test.describe('우측 입력 패널 — Figma 643:5942 위치·크기와 세로 스크롤', () => {
  test('1920×1080에서 패널 (1344,162) 516×721, 내용은 패널 안에서만 스크롤되고 하단 action은 고정', async ({ page }) => {
    const panel = page.getByTestId('n1-field-panel');
    expect(await box(panel)).toEqual({ x: 1344, y: 162, width: 516, height: 721 });
    await expect(panel).toHaveCSS('overflow-y', 'auto');
    await expect(panel).toHaveCSS('border-top-left-radius', '8px');

    // 원본 유지 상태에서도 내용이 패널보다 길어 키워드까지 스크롤로 접근한다
    const { scrollHeight, clientHeight } = await panel.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    const certBefore = await box(page.getByTestId('n1-certification-button'));
    const nextBefore = await box(page.getByRole('button', { name: '다음' }));
    expect([certBefore.y, certBefore.height]).toEqual([965, 45]);
    expect([nextBefore.x, nextBefore.y, nextBefore.width, nextBefore.height]).toEqual([1712, 965, 148, 45]);

    await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const keyword = page.getByPlaceholder('키워드를 입력해주세요.');
    await expect(keyword).toBeInViewport();
    const kw = await box(keyword);
    expect(kw.y + kw.height).toBeLessThanOrEqual(162 + 721);

    // 스크롤해도 action은 패널과 별개로 같은 자리
    expect(await box(page.getByTestId('n1-certification-button'))).toEqual(certBefore);
    expect(await box(page.getByRole('button', { name: '다음' }))).toEqual(nextBefore);
  });

  test('scrollbar는 보이지 않지만 wheel·keyboard 스크롤은 그대로 — 폭 516·action 위치 유지', async ({ page }) => {
    const panel = page.getByTestId('n1-field-panel');

    // scrollbar 모양만 숨김: overflow는 auto 그대로, scrollbar가 폭을 차지하지 않는다(좌우 border 1px씩만)
    await expect(panel).toHaveCSS('overflow-y', 'auto');
    await expect(panel).toHaveCSS('scrollbar-width', 'none');
    const widths = await panel.evaluate((el) => ({ offset: (el as HTMLElement).offsetWidth, client: el.clientWidth }));
    expect(widths.offset).toBe(516);
    expect(widths.offset - widths.client).toBe(2);

    const certBefore = await box(page.getByTestId('n1-certification-button'));
    const nextBefore = await box(page.getByRole('button', { name: '다음' }));

    // mouse wheel
    const p = await box(panel);
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // 맨 위로 돌린 뒤 패널 빈 곳을 누르고 keyboard(PageDown)로 스크롤된다
    await panel.evaluate((el) => el.scrollTo(0, 0));
    const keyword = page.getByPlaceholder('키워드를 입력해주세요.');
    await page.mouse.click(p.x + p.width - 12, p.y + 120);
    await page.keyboard.press('PageDown');
    await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // 원본 유지 탭 → (잠긴 사이즈 변경 탭은 Tab 순서에서 빠진다) → 키워드 입력
    await page.getByTestId('n1-size-tab-original').focus();
    await page.keyboard.press('Tab');
    await expect(keyword).toBeFocused();
    await expect(keyword).toBeInViewport();

    // 끝까지 내려도 키워드 접근 가능, action과 패널 크기는 그대로
    await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(keyword).toBeInViewport();
    expect(await box(page.getByTestId('n1-certification-button'))).toEqual(certBefore);
    expect(await box(page.getByRole('button', { name: '다음' }))).toEqual(nextBefore);
    expect(await box(panel)).toEqual({ x: 1344, y: 162, width: 516, height: 721 });
  });

  test('section 간격 — 상품정보 field 16, 큰 section 52, 사이즈 라벨 → selector 4 (초기 scrollTop 0)', async ({ page }) => {
    const top = async (l: Locator) => (await box(l)).y;
    expect(await page.getByTestId('n1-field-panel').evaluate((el) => el.scrollTop)).toBe(0);
    // Figma(1170:7876): 상품명 라벨 y191, 상품코드 269, 카테고리 347, 규제 분류 425 → select 끝 487,
    // gap 52 → 토글 행 539(문구는 h28 행 안 py4 → 542.5, track 543), 사이즈 라벨 633, selector 658
    expect(await top(page.locator('p').filter({ hasText: /^상품명\*?$/ }))).toBe(191);
    expect(await top(page.getByText('상품코드', { exact: true }))).toBe(269);
    expect(await top(page.locator('p').filter({ hasText: /^카테고리\*?$/ }))).toBe(347);
    expect(await top(page.locator('p').filter({ hasText: /^규제 분류\*?$/ }))).toBe(425);
    expect(await top(page.getByText('이미지 안에 여러 내용이 이어져 있나요?'))).toBe(542.5);
    expect(await top(page.getByTestId('n1-image-continuity-switch'))).toBe(543);
    expect(await top(page.getByText('사이즈 선택', { exact: true }))).toBe(633);
    expect(await top(page.getByTestId('n1-size-selector'))).toBe(658);
    // 카테고리 표시 필드 placeholder — Figma 문구 "검색하기"
    await expect(page.getByText('검색하기', { exact: true })).toBeVisible();
  });

  test('이미지 연속 토글 — Toggle/Switch Off·Disabled(223:1172) track, 문구 → track gap 10', async ({ page }) => {
    const sw = page.getByTestId('n1-image-continuity-switch');
    await expect(sw).toHaveAttribute('aria-disabled', 'true');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(sw).toHaveCSS('background-color', 'rgb(243, 243, 243)');
    await expect(sw).toHaveCSS('opacity', '1');
    await expect(sw.locator('div')).toHaveCSS('background-color', 'rgb(209, 209, 209)');
    const s = await box(sw);
    expect([s.width, s.height]).toEqual([36, 20]);
    const q = await box(page.getByText('이미지 안에 여러 내용이 이어져 있나요?'));
    expect(s.x - (q.x + q.width)).toBe(10);
  });
});

test.describe('1920×1080 초기 화면 geometry — Figma 525:3023', () => {
  test('진행 rail · uploader · 책임 동의 · action', async ({ page }) => {
    // 진행단계(608:1440) (36,150) 44×860
    expect(await box(page.getByRole('navigation', { name: '작업 진행 단계' }))).toEqual({ x: 36, y: 150, width: 44, height: 860 });

    // FileUploader(536:4281) (140,162) 1184×838 — 72 원형 icon(Plus 24) · gap 20 · 문구 · gap 20 · 파일 선택 45 · gap 20 · helper
    const drop = page.getByTestId('n1-image-dropzone');
    expect(await box(drop)).toEqual({ x: 140, y: 162, width: 1184, height: 838 });
    const circle = await box(drop.locator('.rounded-full').first());
    expect([circle.y, circle.width, circle.height]).toEqual([462.5, 72, 72]);
    const plus = await box(drop.locator('img[src="/n1/icons/plus-24.svg"]'));
    expectNear(plus.width, 16.15);
    expectNear(plus.height, 16.15);
    const title = await box(drop.getByText('파일을 이곳에 놓아주세요.'));
    expect(title.y - (circle.y + circle.height)).toBe(20);
    const pick = await box(drop.locator('label[for="image-upload"]'));
    expect(pick.height).toBe(45);
    const helper = drop.getByText('여러 파일을 한 번에 업로드할 수 있습니다.', { exact: true });
    await expect(helper).toHaveCSS('color', 'rgb(153, 153, 153)');
    expect((await box(helper)).y - (pick.y + pick.height)).toBe(20);

    // 책임 동의(1170:6002) (1344,913) 480×28 — 패널 아래 30, action 위 24
    const consent = await box(page.getByTestId('n1-consent'));
    expect([consent.x, consent.y, consent.height]).toEqual([1344, 913, 28]);
    expect(Math.abs(consent.width - 480)).toBeLessThanOrEqual(1);
    expect((await box(page.getByRole('button', { name: '다음' }))).y - (consent.y + consent.height)).toBe(24);
  });
});

test.describe('책임 한계 동의 — Figma 1170:6002, PRD F-ACC-04 필수', () => {
  const LINE_1 = '결과물에 쓰는 인증·시험 결과, 광고 문구, 인증 로고의 사용 권한과 그 책임이 사용자에게 있으며,';
  const LINE_2 = '규제·현지 검사 결과는 참고용 권고이며, 올린 이미지와 문구가 외부 AI 서비스로 전송됨을 확인했습니다.';

  test('정확한 두 줄 문구, 초기 미동의, Checkbox/Compact Unchecked·Checked 표현', async ({ page }) => {
    const consent = page.getByTestId('n1-consent');
    const checkbox = page.getByRole('checkbox', { name: `${LINE_1} ${LINE_2}` });
    await expect(checkbox).toBeVisible();
    await expect(consent.getByText(LINE_1, { exact: true })).toBeVisible();
    await expect(consent.getByText(LINE_2, { exact: true })).toBeVisible();
    const l1 = await box(consent.getByText(LINE_1, { exact: true }));
    const l2 = await box(consent.getByText(LINE_2, { exact: true }));
    expect(l2.y - l1.y).toBe(14);
    await expect(consent.getByText(LINE_1, { exact: true })).toHaveCSS('font-size', '12px');
    await expect(consent.getByText(LINE_1, { exact: true })).toHaveCSS('font-weight', '300');
    await expect(consent.getByText(LINE_1, { exact: true })).toHaveCSS('color', 'rgb(112, 112, 112)');

    await expect(checkbox).not.toBeChecked();
    const visual = checkbox.locator('xpath=following-sibling::span[1]');
    expect([(await box(visual)).width, (await box(visual)).height]).toEqual([18, 18]);
    await expect(visual).toHaveCSS('border-top-color', 'rgb(234, 234, 234)');
    await expect(visual).toHaveCSS('border-top-left-radius', '4px');
    await expect(visual.locator('img')).toHaveCount(0);

    // 문구를 눌러도 토글 — 체크되면 orange border + Check 16
    await consent.getByText(LINE_2, { exact: true }).click();
    await expect(checkbox).toBeChecked();
    await expect(visual).toHaveCSS('border-top-color', ORANGE);
    await expect(visual.locator('img')).toHaveAttribute('src', '/n1/icons/check-16.svg');
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
  });

  test('미동의면 다른 필수값을 모두 채워도 다음 비활성, 동의하면 활성, 동의 해제 시 다시 비활성', async ({ page }) => {
    const next = page.getByRole('button', { name: '다음' });
    const checkbox = page.getByTestId('n1-consent-checkbox');
    await expect(next).toBeDisabled();

    // 동의만으로는 활성되지 않는다 — 다른 필수값 validation 유지
    await checkbox.check();
    await expect(next).toBeDisabled();
    await checkbox.uncheck();

    await page.getByPlaceholder('상품 이름을 입력해주세요').fill('동의 확인');
    await fillRequiredExceptCategory(page, { consent: false });
    await pickCategory(page);
    await expect(next).toBeDisabled();

    await checkbox.check();
    await expect(next).toBeEnabled();

    await checkbox.uncheck();
    await expect(next).toBeDisabled();
  });
});

test.describe('SizeSelector — 「사이즈 변경」 잠금(계약 전까지 원본 유지 고정)', () => {
  const selector = (page: Page) => page.getByTestId('n1-size-selector');

  test('초기 원본 유지, 사이즈 변경 탭은 노출되지만 disabled — 클릭·키보드로 진입 불가', async ({ page }) => {
    const original = page.getByTestId('n1-size-tab-original');
    const resize = page.getByTestId('n1-size-tab-resize');

    // 원본유지(1093:10279) — 탭(32) + gap 8 + 설명(14)
    const ORIGINAL_DESCRIPTION = '원본 크기와 배치를 유지하고 글자만 번역해요. 규격을 바꿀 필요가 없을 때 선택하세요.';
    await expect(selector(page)).toHaveAttribute('data-variant', 'original');
    expect((await box(selector(page))).height).toBe(54);
    const description = page.getByTestId('n1-size-description');
    await expect(description).toHaveText(ORIGINAL_DESCRIPTION);
    await expect(description).toHaveCSS('font-size', '12px');
    await expect(description).toHaveCSS('font-weight', '300');
    await expect(description).toHaveCSS('color', 'rgb(112, 112, 112)');
    expect((await box(description)).y - ((await box(original)).y + 32)).toBe(8);
    await expect(original).toHaveAttribute('aria-selected', 'true');
    await expect(original).toHaveCSS('color', 'rgb(23, 23, 23)');
    const underline = page.getByTestId('n1-size-tab-original-underline');
    await expect(underline).toHaveCSS('background-color', ORANGE);
    expect([(await box(underline)).width, (await box(underline)).height]).toEqual([56, 2]);

    // 사이즈 변경 탭은 그대로 보이지만 잠겨 있다
    await expect(resize).toBeVisible();
    await expect(resize).toHaveText('사이즈 변경');
    await expect(resize).toBeDisabled();
    await expect(resize).toHaveAttribute('aria-selected', 'false');
    // Tabs에는 Disabled variant가 없다 — Inactive(#707070) 그대로, opacity 감소 없이 cursor만 바뀐다
    await expect(resize).toHaveCSS('color', 'rgb(112, 112, 112)');
    await expect(resize).toHaveCSS('opacity', '1');
    await expect(resize).toHaveCSS('cursor', 'not-allowed');

    // 클릭(강제 포함)해도 진입하지 않는다
    await resize.click({ force: true });
    await expect(selector(page)).toHaveAttribute('data-variant', 'original');
    await expect(original).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('n1-resize-custom')).toHaveCount(0);
    await expect(page.getByTestId('n1-size-channel')).toHaveCount(0);

    // 키보드: 원본 유지 탭에서 Tab하면 잠긴 탭을 건너뛴다, Enter·Space·방향키로도 바뀌지 않는다
    await original.focus();
    for (const key of ['ArrowRight', 'Enter', 'Space']) {
      await page.keyboard.press(key);
      await expect(selector(page)).toHaveAttribute('data-variant', 'original');
    }
    await page.keyboard.press('Tab');
    await expect(resize).not.toBeFocused();
    await expect(page.getByPlaceholder('키워드를 입력해주세요.')).toBeFocused();
    expect((await box(selector(page))).height).toBe(54);
    await expect(page.getByTestId('n1-size-description')).toHaveText(ORIGINAL_DESCRIPTION);
  });

  test('제출 spec은 여전히 spec_original', async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/jobs$/.test(new URL(req.url()).pathname)) body = req.postDataJSON();
    });
    await page.getByPlaceholder('상품 이름을 입력해주세요').fill('사이즈 확인');
    await fillRequiredExceptCategory(page);
    await pickCategory(page);
    await page.getByRole('button', { name: '다음' }).click();
    await expect.poll(() => body).not.toBeNull();
    expect(body!.specId).toBe('spec_original');
  });
});

test.describe('인증 마크 업로드 버튼·tooltip — 원본 유지에서는 disabled, 같은 두 줄 tooltip', () => {
  const LINES = ['- 사이즈 변경을 고르면 인증 마크를 올릴 수 있어요.', '- 인증 및 시험 정보의 적용 가능 여부는 사용자가 최종 확인해야 합니다.'];

  const expectTooltipText = async (tooltip: Locator) => {
    await expect(tooltip.locator('p')).toHaveText(LINES);
  };

  test('원본 유지 → disabled, 버튼 위 어디를 hover해도 tooltip, 해제 시 닫힘, 클릭해도 모달 없음', async ({ page }) => {
    const button = page.getByTestId('n1-certification-button');
    const tooltip = page.getByTestId('n1-certification-tooltip');
    await expect(button).toBeDisabled();
    await expect(button).toHaveText('인증 마크 업로드 하기');
    // Button Secondary/LG Disabled — bg #F5F5F5, text #171717, opacity 1
    await expect(button).toHaveCSS('background-color', 'rgb(245, 245, 245)');
    await expect(button).toHaveCSS('opacity', '1');
    await expect(button.locator('span').first()).toHaveCSS('color', 'rgb(23, 23, 23)');
    await expect(page.getByTestId('n1-certification-info')).toBeVisible();
    await expect(tooltip).toBeHidden();

    // disabled 버튼의 왼쪽 끝·가운데·오른쪽 끝(Info) 어디든
    const b = await box(button);
    for (const x of [b.x + 4, b.x + b.width / 2, b.x + b.width - 34]) {
      await page.mouse.move(x, b.y + b.height / 2);
      await expect(tooltip).toBeVisible();
      await expectTooltipText(tooltip);
      await page.mouse.move(10, 10);
      await expect(tooltip).toBeHidden();
    }

    // Info hover — 같은 tooltip
    await page.getByTestId('n1-certification-info').hover({ force: true });
    await expect(tooltip).toBeVisible();
    await expectTooltipText(tooltip);
    // Tooltip(1090:10048) (1568,891) 193×82 — 버튼 기준 오른쪽 끝 +57, 아래 끝은 버튼 위 끝 +8. 두 문구 모두 2행(28).
    const t = await box(tooltip);
    expect([t.width, t.height]).toEqual([193, 82]);
    expect(t.x + t.width - (b.x + b.width)).toBe(57);
    expect(t.y + t.height - b.y).toBe(8);
    for (const height of await tooltip.locator('p').evaluateAll((ps) => ps.map((p) => p.getBoundingClientRect().height))) {
      expect(height).toBe(28);
    }
    // 꼬리 Group 11 — tooltip 안 (96,81)(border 포함 좌표)에서 bleed만큼 바깥
    const tail = await box(tooltip.locator('img[src="/n1/icons/tooltip-tail.svg"]'));
    expect([Math.round((tail.x - t.x) * 10) / 10, tail.y - t.y]).toEqual([95.5, 81]);
    await page.mouse.move(10, 10);

    // 클릭해도 모달이 열리지 않는다
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('키보드 focus로도 같은 tooltip, blur 시 닫힘 — aria-describedby 연결', async ({ page }) => {
    const button = page.getByTestId('n1-certification-button');
    const trigger = page.getByTestId('n1-certification-trigger');
    const tooltip = page.getByTestId('n1-certification-tooltip');
    await expect(button).toHaveAccessibleDescription(LINES.join(' '));
    await expect(trigger).toHaveAttribute('aria-describedby', 'n1-certification-tooltip');

    await page.getByPlaceholder('키워드를 입력해주세요.').focus();
    await page.keyboard.press('Tab'); // 추가
    await page.keyboard.press('Tab'); // 책임 동의 checkbox
    await expect(page.getByTestId('n1-consent-checkbox')).toBeFocused();
    await page.keyboard.press('Tab'); // 인증 trigger(disabled 버튼 대신 wrapper가 포커스를 받는다)
    await expect(trigger).toBeFocused();
    await expect(tooltip).toBeVisible();
    await expectTooltipText(tooltip);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(tooltip).toBeHidden();
  });
});

/**
 * 「사이즈 변경」 잠금 때문에 인증 버튼은 지금 항상 disabled라 화면에서 모달을 열 수 없다. 모달 기능 자체는
 * 계약이 생겨 잠금이 풀린 상태를 가정하고 검증한다 — production 코드에 테스트용 경로를 두지 않고, 버튼의 DOM
 * disabled 속성을 떼고(포커스 복귀 확인용) React가 그 버튼에 붙인 onClick을 직접 호출한다.
 */
async function openCertificationModalAsUnlocked(page: Page) {
  await page.getByTestId('n1-certification-button').evaluate((el) => {
    el.removeAttribute('disabled');
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    if (!key) throw new Error('React props not found on certification button');
    (el as unknown as Record<string, { onClick: () => void }>)[key].onClick();
  });
  await expect(page.getByRole('dialog', { name: '인증 마크 업로드' })).toBeVisible();
}

const svgFile = (name: string) => ({ name, mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#f00"/></svg>') });
const jpgFile = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });

test.describe('인증 마크 업로드 모달 — Figma 1170:8460 복수 업로드', () => {
  test('크기·위치, compact uploader, 등록 목록 영역, 문구, 버튼, 닫기 / Escape / 취소, focus trap·복귀, scroll lock, dim 클릭 무시', async ({ page }) => {
    const button = page.getByTestId('n1-certification-button');
    await openCertificationModalAsUnlocked(page);
    const dialog = page.getByRole('dialog', { name: '인증 마크 업로드' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAccessibleDescription('선택 사항입니다. 올리지 않아도 다음 단계로 진행할 수 있습니다.');
    await expect(page.getByTestId('n1-certification-dim')).toHaveCSS('background-color', 'rgba(23, 23, 23, 0.4)');

    const m = await box(dialog);
    expect([m.width, m.height]).toEqual([720, 696]);
    expect(Math.abs(m.x - 600)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.y - 191.5)).toBeLessThanOrEqual(1);
    const drop = await box(page.getByTestId('n1-certification-dropzone'));
    expect([drop.x - m.x, drop.y - m.y, drop.width, drop.height]).toEqual([40, 119, 640, 112]);
    await expect(dialog.getByText('파일을 이곳에 놓아주세요.')).toBeVisible();
    await expect(dialog.getByText('또는 클릭해서 선택 SVG·PNG·JPG')).toBeVisible();
    // compact uploader 내부 — padding 24/32, [40×40 원형 icon · gap 12 · 문구(gap 8)] … [파일 선택 107×37]
    const dropzone = page.getByTestId('n1-certification-dropzone');
    for (const [prop, value] of [
      ['padding-left', '24px'],
      ['padding-right', '24px'],
      ['padding-top', '32px'],
      ['padding-bottom', '32px'],
      ['border-top-color', 'rgb(234, 234, 234)'],
      ['border-top-left-radius', '8px'],
      ['justify-content', 'space-between'],
    ]) {
      await expect(dropzone).toHaveCSS(prop, value);
    }
    const pick = dialog.getByRole('button', { name: '파일 선택' });
    const pb = await box(pick);
    expect([pb.width, pb.height]).toEqual([107, 37]);
    expect(pb.x + pb.width).toBe(drop.x + drop.width - 1 - 24);
    await expect(pick).toHaveCSS('background-color', 'rgb(23, 23, 23)');
    await expect(pick).toHaveCSS('border-top-left-radius', '6px');
    const circle = dropzone.locator('span.rounded-full');
    const cb = await box(circle);
    expect([cb.x - drop.x, cb.width, cb.height]).toEqual([1 + 24, 40, 40]);
    // Card/Action/Plus Size=16 optical glyph — 16 박스(원 안 가운데) 안 inset 20% − bleed 6.51% → 10.85×10.85
    const plus = await box(circle.locator('img[src="/n1/icons/plus-16.svg"]'));
    expectNear(plus.width, 10.85);
    expectNear(plus.height, 10.85);
    expectNear(plus.x - cb.x, 12 + 2.575);
    const dropTitle = dialog.getByText('파일을 이곳에 놓아주세요.');
    const dt = await box(dropTitle);
    expect(dt.x - (cb.x + cb.width)).toBe(12);
    await expect(dropTitle).toHaveCSS('font-size', '18px');
    await expect(dropTitle).toHaveCSS('font-weight', '500');
    await expect(dropTitle).toHaveCSS('color', 'rgb(23, 23, 23)');
    const dropSub = dialog.getByText('또는 클릭해서 선택 SVG·PNG·JPG');
    expect((await box(dropSub)).y - (dt.y + dt.height)).toBe(8);
    await expect(dropSub).toHaveCSS('font-size', '14px');
    await expect(dropSub).toHaveCSS('font-weight', '400');
    await expect(dropSub).toHaveCSS('color', 'rgb(112, 112, 112)');
    const listSection = dialog.getByRole('region', { name: '등록된 인증 마크' });
    const ls = await box(listSection);
    expect([ls.x - m.x, ls.y - m.y, ls.width, ls.height]).toEqual([40, 263, 640, 193]);
    // 제목(1170:13156) 18 Medium −0.54, 제목 → 목록 gap 12(카드는 영역 위에서 33)
    const listTitle = listSection.getByRole('heading', { name: '등록된 인증 마크' });
    await expect(listTitle).toHaveCSS('font-size', '18px');
    await expect(listTitle).toHaveCSS('font-weight', '500');
    await expect(listTitle).toHaveCSS('letter-spacing', '-0.54px');
    expect((await box(page.getByTestId('n1-certification-list'))).y - ls.y).toBe(33);
    // Footer(1170:8500) — 취소 · 완료
    await expect(page.getByTestId('n1-certification-cancel')).toHaveText('취소');
    await expect(page.getByTestId('n1-certification-register')).toHaveText('완료');
    await expect(dialog.getByText('업로드 전에 확인해 주세요')).toBeVisible();
    for (const line of [
      '사용 권한이 있는 인증 마크만 올려 주세요.',
      '이 제품이 실제로 받은 인증인지, 판매 국가에서 표시해도 되는지 확인해 주세요.',
      'pix/ate는 인증 마크의 진위와 유효성을 검증하지 않습니다.',
    ]) {
      await expect(dialog.getByText(line, { exact: true })).toBeVisible();
    }
    const cancel = await box(page.getByTestId('n1-certification-cancel'));
    const register = await box(page.getByTestId('n1-certification-register'));
    expect(cancel.height).toBe(56);
    expect(register.height).toBe(56);
    expect(Math.round(register.x - (cancel.x + cancel.width))).toBe(13);
    expect(Math.round(register.x + register.width - cancel.x)).toBe(640);
    expect(Math.round(m.y + m.height - (cancel.y + cancel.height))).toBe(40);
    const close = await box(page.getByRole('button', { name: '닫기' }));
    expect([close.x - m.x, close.y - m.y, close.width, close.height]).toEqual([648, 40, 32, 32]);
    // 안내 영역 (40,488) 640×80 · Footer (40,600) 640×56
    const notice = await box(dialog.getByText('업로드 전에 확인해 주세요').locator('xpath=..'));
    expect([notice.x - m.x, notice.y - m.y, notice.width, notice.height]).toEqual([40, 488, 640, 80]);
    const footer = await box(page.getByTestId('n1-certification-cancel').locator('xpath=..'));
    expect([footer.x - m.x, footer.y - m.y, footer.width, footer.height]).toEqual([40, 600, 640, 56]);

    // 열릴 때 포커스는 모달 안, Tab/Shift+Tab이 밖으로 새지 않는다
    const inside = () => page.evaluate(() => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement));
    expect(await inside()).toBe(true);
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await inside()).toBe(true);
    }
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await inside()).toBe(true);
    }

    // 배경 스크롤 잠금 + dim 클릭으로는 닫히지 않음
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.mouse.click(30, 540);
    await expect(dialog).toBeVisible();

    // 닫기 버튼 → 닫힘, 포커스 복귀, overflow 복구
    await page.getByRole('button', { name: '닫기' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');

    // Escape → 닫힘, 포커스 복귀
    await openCertificationModalAsUnlocked(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    // 취소 → 닫힘, 포커스 복귀
    await openCertificationModalAsUnlocked(page);
    await page.getByTestId('n1-certification-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('SVG·PNG·JPG·JPEG 복수 선택 → 목록 뒤에 추가(교체 아님), 파일 카드, 개별 삭제, 미지원 형식 차단', async ({ page }) => {
    await openCertificationModalAsUnlocked(page);
    const input = page.getByTestId('n1-certification-input');
    const names = page.getByTestId('n1-certification-file-name');
    const register = page.getByTestId('n1-certification-register');
    await expect(input).toHaveAttribute('multiple', '');
    await expect(names).toHaveCount(0);
    await expect(register).toBeDisabled();

    // 한 번에 여러 개
    await input.setInputFiles([svgFile('mark-a.svg'), pngFile('mark-b.png')]);
    await expect(names).toHaveText(['mark-a.svg', 'mark-b.png']);

    // 새로 고르면 뒤에 붙는다 — 기존 파일은 그대로
    await input.setInputFiles([jpgFile('mark-c.jpg'), jpgFile('mark-d.jpeg')]);
    await expect(names).toHaveText(['mark-a.svg', 'mark-b.png', 'mark-c.jpg', 'mark-d.jpeg']);
    await expect(register).toBeEnabled();

    // 미지원 형식은 목록에 들어가지 않는다(섞여 있어도 허용 형식만)
    await input.setInputFiles([{ name: 'mark.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }, pngFile('mark-e.png')]);
    await expect(names).toHaveText(['mark-a.svg', 'mark-b.png', 'mark-c.jpg', 'mark-d.jpeg', 'mark-e.png']);
    await input.setInputFiles({ name: 'mark.webp', mimeType: 'image/webp', buffer: Buffer.from('RIFF') });
    await expect(names).toHaveCount(5);

    // 파일 카드(1170:13142) — 310×80, border #EAEAEA, radius 8, 썸네일 60×60(bg #F5F5F5, radius 0),
    // 파일명 12 Light #707070, 검정 삭제 버튼
    const item = page.getByTestId('n1-certification-item').first();
    const ib = await box(item);
    expect([ib.width, ib.height]).toEqual([310, 80]);
    await expect(item).toHaveCSS('border-top-color', 'rgb(234, 234, 234)');
    await expect(item).toHaveCSS('border-top-left-radius', '8px');
    await expect(item).toHaveCSS('padding-left', '12px');
    await expect(item).toHaveCSS('padding-right', '12px');
    const thumb = item.getByTestId('n1-certification-thumbnail');
    const tb = await box(thumb);
    expect([tb.x - ib.x, tb.width, tb.height]).toEqual([13, 60, 60]); // border 1 + padding 12
    expect((await box(names.first())).x - (tb.x + tb.width)).toBe(12);
    await expect(thumb).toHaveAttribute('src', /^blob:/);
    await expect(thumb).toHaveCSS('background-color', 'rgb(245, 245, 245)');
    await expect(thumb).toHaveCSS('border-top-left-radius', '0px');
    await expect(names.first()).toHaveCSS('font-size', '12px');
    await expect(names.first()).toHaveCSS('font-weight', '300');
    await expect(names.first()).toHaveCSS('color', 'rgb(112, 112, 112)');
    const remove = item.getByRole('button', { name: 'mark-a.svg 삭제' });
    await expect(remove).toHaveText('삭제');
    await expect(remove).toHaveCSS('background-color', 'rgb(23, 23, 23)');
    for (const [prop, value] of [
      ['padding-left', '12px'],
      ['padding-right', '12px'],
      ['padding-top', '8px'],
      ['padding-bottom', '8px'],
      ['border-top-left-radius', '4px'],
    ]) {
      await expect(remove).toHaveCSS(prop, value);
    }
    const removeLabel = remove.getByText('삭제', { exact: true });
    await expect(removeLabel).toHaveCSS('font-size', '12px');
    await expect(removeLabel).toHaveCSS('font-weight', '400');
    // Card/Action/Trash Size=14(53:1200) — 14 전용 optical geometry. Group inset 17.5% 22.5% 20% 22.5%,
    // bleed −4.29% −4.87% → 8.45×9.5 SVG가 14 박스의 (2.775, 2.075)에 놓인다(20px path 축소가 아님).
    const glyph = remove.getByTestId('n1-trash-glyph');
    const icon = await box(glyph);
    expect([icon.width, icon.height]).toEqual([14, 14]);
    const trash = remove.locator('img[src="/n1/icons/trash-14.svg"]');
    const tr = await box(trash);
    expectNear(tr.width, 8.45);
    expectNear(tr.height, 9.5);
    expectNear(tr.x - icon.x, 2.775);
    expectNear(tr.y - icon.y, 2.075);
    expect((await box(removeLabel)).x - (icon.x + icon.width)).toBe(4);

    // 목록이 많아도 영역(193) 안에서만 스크롤 — 모달 높이는 그대로
    const list = page.getByTestId('n1-certification-list');
    const { scrollHeight, clientHeight } = await list.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);
    await expect(list).toHaveCSS('overflow-y', 'auto');
    expect((await box(page.getByRole('dialog'))).height).toBe(696);

    // 개별 삭제 — 해당 파일만 사라지고 나머지는 순서대로 남는다, 포커스는 모달 안
    await page.getByRole('button', { name: 'mark-c.jpg 삭제' }).click();
    await expect(names).toHaveText(['mark-a.svg', 'mark-b.png', 'mark-d.jpeg', 'mark-e.png']);
    expect(await page.evaluate(() => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true);
    await page.getByRole('button', { name: 'mark-a.svg 삭제' }).click();
    await expect(names).toHaveText(['mark-b.png', 'mark-d.jpeg', 'mark-e.png']);
  });

  test('모달 완료 → 완료 상태, 취소·닫기·Escape는 등록 목록을 지우지 않고 다시 열면 전체 목록 유지', async ({ page }) => {
    const button = page.getByTestId('n1-certification-button');
    const names = page.getByTestId('n1-certification-file-name');
    const input = page.getByTestId('n1-certification-input');

    // 파일을 골라도 취소하면 등록되지 않는다
    await openCertificationModalAsUnlocked(page);
    await input.setInputFiles(pngFile('mark-a.png'));
    await page.getByTestId('n1-certification-cancel').click();
    await expect(button).toHaveAttribute('data-state', 'default');

    // 두 개 등록
    await openCertificationModalAsUnlocked(page);
    await expect(names).toHaveCount(0);
    await input.setInputFiles([pngFile('mark-a.png'), svgFile('mark-b.svg')]);
    await page.getByTestId('n1-certification-register').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(button).toHaveAttribute('data-state', 'registered');
    await expect(button).toHaveText('인증 마크 업로드 완료');
    const done = await box(button);
    expect([done.width, done.height]).toEqual([170, 45]);
    await expect(page.getByTestId('n1-certification-info')).toHaveCount(0);
    // 원본 유지 상태라 완료 Tag도 disabled — 목록은 지우지 않는다. Tag/Selectable Disabled 표현
    await expect(button).toBeDisabled();
    await expect(button).toHaveCSS('background-color', 'rgb(245, 245, 245)');
    await expect(button).toHaveCSS('border-top-color', 'rgb(234, 234, 234)');
    await expect(button).toHaveCSS('border-top-left-radius', '6px');
    await expect(button).toHaveCSS('opacity', '1');
    await expect(button.locator('span')).toHaveCSS('color', 'rgb(153, 153, 153)');
    await expect(button.locator('span')).toHaveCSS('font-size', '14px');
    await expect(button.locator('span')).toHaveCSS('font-weight', '500');

    // action row: 완료 170 + gap 8 + 다음 148 = 326, 오른쪽 끝 1860(Figma 1094:10967 x1534)
    const next = await box(page.getByRole('button', { name: '다음' }));
    expect(next.x - (done.x + done.width)).toBe(8);
    expect(done.x).toBe(1534);
    expect(done.y).toBe(965);

    // 다시 열면 전체 목록. 추가 후 취소 → 추가분만 버려진다
    await openCertificationModalAsUnlocked(page);
    await expect(names).toHaveText(['mark-a.png', 'mark-b.svg']);
    await input.setInputFiles(jpgFile('mark-c.jpg'));
    await expect(names).toHaveText(['mark-a.png', 'mark-b.svg', 'mark-c.jpg']);
    await page.getByTestId('n1-certification-cancel').click();
    await expect(button).toHaveAttribute('data-state', 'registered');
    await expect(button).toBeFocused();

    // 삭제 후 닫기 X → 삭제도 반영되지 않는다
    await openCertificationModalAsUnlocked(page);
    await expect(names).toHaveText(['mark-a.png', 'mark-b.svg']);
    await page.getByRole('button', { name: 'mark-a.png 삭제' }).click();
    await page.getByRole('button', { name: '닫기' }).click();
    await expect(button).toBeFocused();

    // Escape도 마찬가지
    await openCertificationModalAsUnlocked(page);
    await expect(names).toHaveText(['mark-a.png', 'mark-b.svg']);
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('data-state', 'registered');
    await expect(button).toBeFocused();

    // 추가 후 완료 → 세 개 모두 유지
    await openCertificationModalAsUnlocked(page);
    await input.setInputFiles(jpgFile('mark-c.jpeg'));
    await page.getByTestId('n1-certification-register').click();
    await openCertificationModalAsUnlocked(page);
    await expect(names).toHaveText(['mark-a.png', 'mark-b.svg', 'mark-c.jpeg']);
    await page.keyboard.press('Escape');

    // 다른 입력으로 재렌더돼도 같은 N1 session 안에서 유지
    await page.getByPlaceholder('상품 이름을 입력해주세요').fill('재렌더 확인');
    await expect(button).toHaveAttribute('data-state', 'registered');
  });
});

test.describe('카테고리 필수 — PRD F-SRC-04 ① 미선택 시 진행 불가', () => {
  test('라벨 *(orange), 다른 필수값을 다 채워도 카테고리가 없으면 다음 비활성, 선택하면 활성', async ({ page }) => {
    const label = page.locator('p').filter({ hasText: /^카테고리\*$/ });
    await expect(label).toBeVisible();
    await expect(label.locator('span')).toHaveText('*');
    await expect(label.locator('span')).toHaveCSS('color', ORANGE);

    const next = page.getByRole('button', { name: '다음' });
    await expect(next).toBeDisabled();
    await page.getByPlaceholder('상품 이름을 입력해주세요').fill('카테고리 확인');
    await fillRequiredExceptCategory(page);
    await expect(next).toBeDisabled();

    await pickCategory(page);
    await expect(page.getByText('바디/헤어', { exact: true })).toBeVisible();
    await expect(next).toBeEnabled();

    // 다른 필수값이 빠지면 카테고리가 있어도 다시 비활성 — 기존 validation 유지
    await page.getByPlaceholder('상품 이름을 입력해주세요').fill('');
    await expect(next).toBeDisabled();
  });
});

/** 상품명·카테고리를 뺀 필수값 — 국가·언어·규제 분류·이미지 1장·책임 동의(consent: false면 동의는 건너뛴다). */
async function fillRequiredExceptCategory(page: Page, { consent = true }: { consent?: boolean } = {}) {
  await page.locator('select').nth(0).selectOption('US');
  await page.locator('select').nth(1).selectOption('en');
  await page.locator('select').nth(2).selectOption('cosmetics');
  await page.locator('#image-upload').setInputFiles(pngFile('source.png'));
  if (consent) await page.getByTestId('n1-consent-checkbox').check();
}

async function pickCategory(page: Page) {
  await page.getByRole('button', { name: '선택하기' }).click();
  await page.getByRole('dialog', { name: '카테고리 선택' }).getByRole('button', { name: '바디/헤어' }).click();
}

test('1920×1080 가로 넘침 없음', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1920);
});
