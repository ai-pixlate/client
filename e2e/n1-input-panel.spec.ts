import { test, expect, type Locator, type Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// N1 이미지 정보 입력 — Figma 525:3023(우측 패널·SizeSelector·하단 action·tooltip),
// 1094:11283(인증 마크 업로드 모달). MSW mock 기준.
//
// 사이즈 선택과 인증 마크 파일은 계약(specType 9월 original 고정, 커스텀 W/H·인증 업로드 필드 없음)이
// 없어 FE 화면 상태까지만 검증한다 — 제출 payload나 서버 업로드는 검증 대상이 아니다.
// ─────────────────────────────────────────────────────────────────

const MOCK_BRAND_ID = 'brand_mock_001';
const ORANGE = 'rgb(255, 106, 56)';

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator): Promise<Box> => (await locator.boundingBox())!;

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

    // 사이즈 변경(커스텀)으로 내용이 길어진 상태에서도 키워드까지 스크롤로 접근 가능
    await page.getByTestId('n1-size-tab-resize').click();
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
    await page.getByTestId('n1-size-tab-resize').click(); // 내용을 길게 만든다

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

    // 맨 위로 돌린 뒤 keyboard(Tab)로 핵심 키워드까지 이동하면 패널이 따라 스크롤된다
    await panel.evaluate((el) => el.scrollTo(0, 0));
    const keyword = page.getByPlaceholder('키워드를 입력해주세요.');
    await page.getByTestId('n1-size-height').focus();
    await page.keyboard.press('Tab');
    await expect(keyword).toBeFocused();
    await expect(keyword).toBeInViewport();
    expect(await panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // 끝까지 내려도 키워드 접근 가능, action과 패널 크기는 그대로
    await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(keyword).toBeInViewport();
    expect(await box(page.getByTestId('n1-certification-button'))).toEqual(certBefore);
    expect(await box(page.getByRole('button', { name: '다음' }))).toEqual(nextBefore);
    expect(await box(panel)).toEqual({ x: 1344, y: 162, width: 516, height: 721 });
  });

  test('section 간격 — 상품정보 field 16, 큰 section 60, 사이즈 라벨 → selector 20', async ({ page }) => {
    const top = async (l: Locator) => (await box(l)).y;
    // Figma: 상품명 라벨 y191, 상품코드 269, 카테고리 347(16 간격 + label 19 + 4 + input 39), 토글 547, 사이즈 라벨 649, selector 690
    expect(await top(page.locator('p').filter({ hasText: /^상품명\*?$/ }))).toBe(191);
    expect(await top(page.getByText('상품코드', { exact: true }))).toBe(269);
    expect(await top(page.getByText('카테고리', { exact: true }))).toBe(347);
    expect(await top(page.getByText('이미지 안에 여러 내용이 이어져 있나요?'))).toBeGreaterThanOrEqual(547);
    expect(await top(page.getByText('사이즈 선택', { exact: true }))).toBe(649);
    expect(await top(page.getByTestId('n1-size-selector'))).toBe(690);
  });
});

test.describe('SizeSelector — Figma component set 사이즈선택(원본유지/커스텀/판매처 맞춤)', () => {
  const selector = (page: Page) => page.getByTestId('n1-size-selector');

  test('원본 유지 ↔ 사이즈 변경, 커스텀 ↔ 판매처 맞춤 — 선택된 variant만 렌더되고 높이가 Figma와 같다', async ({ page }) => {
    // 원본유지(472×32) — 탭만
    await expect(selector(page)).toHaveAttribute('data-variant', 'original');
    expect((await box(selector(page))).height).toBe(32);
    await expect(page.getByTestId('n1-size-tab-original')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('n1-size-tab-original')).toHaveCSS('color', 'rgb(23, 23, 23)');
    await expect(page.getByTestId('n1-size-tab-resize')).toHaveCSS('color', 'rgb(112, 112, 112)');
    const underline = page.getByTestId('n1-size-tab-original-underline');
    await expect(underline).toHaveCSS('background-color', ORANGE);
    expect([(await box(underline)).width, (await box(underline)).height]).toEqual([56, 2]);
    await expect(page.getByTestId('n1-resize-custom')).toHaveCount(0);

    // 사이즈 변경 → 커스텀(472×140)
    await page.getByTestId('n1-size-tab-resize').click();
    await expect(selector(page)).toHaveAttribute('data-variant', 'custom');
    expect((await box(selector(page))).height).toBe(140);
    await expect(page.getByTestId('n1-size-tab-original-underline')).toHaveCount(0);
    await expect(page.getByTestId('n1-size-tab-resize-underline')).toBeVisible();
    await expect(page.getByTestId('n1-resize-custom')).toBeChecked();
    await expect(page.getByTestId('n1-size-width')).toBeVisible();
    expect((await box(page.getByTestId('n1-size-width').locator('xpath=..'))).height).toBe(48);
    await expect(page.getByTestId('n1-size-channel')).toHaveCount(0);

    await page.getByTestId('n1-size-width').fill('800');
    await page.getByTestId('n1-size-height').fill('1200');

    // 판매처 맞춤(472×189) — dropdown · helper · tag, 커스텀 W/H UI는 사라진다
    await page.getByTestId('n1-resize-channel').check();
    await expect(selector(page)).toHaveAttribute('data-variant', 'channel');
    expect((await box(selector(page))).height).toBe(189);
    await expect(page.getByTestId('n1-size-width')).toHaveCount(0);
    await expect(page.getByTestId('n1-size-channel')).toHaveValue('amazon');
    await expect(selector(page).getByText('베이직(기본 등록) : 최소 500px(짧은 변 기준) ~ 최대 10,000px(긴 변 기준)')).toBeVisible();
    await expect(page.getByTestId('n1-size-tier-basic-a-plus')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n1-size-tier-basic-a-plus')).toHaveCSS('border-top-color', ORANGE);
    await page.getByTestId('n1-size-tier-premium-a-plus').click();
    await expect(page.getByTestId('n1-size-tier-premium-a-plus')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('n1-size-tier-basic-a-plus')).toHaveAttribute('aria-pressed', 'false');

    // 커스텀으로 돌아가면 입력했던 W/H가 그대로(판매처 값과 서로 덮어쓰지 않는다)
    await page.getByTestId('n1-resize-custom').check();
    await expect(page.getByTestId('n1-size-width')).toHaveValue('800');
    await expect(page.getByTestId('n1-size-height')).toHaveValue('1200');
    await page.getByTestId('n1-resize-channel').check();
    await expect(page.getByTestId('n1-size-tier-premium-a-plus')).toHaveAttribute('aria-pressed', 'true');

    // 원본 유지로 돌아가면 탭만 남는다
    await page.getByTestId('n1-size-tab-original').click();
    await expect(selector(page)).toHaveAttribute('data-variant', 'original');
    expect((await box(selector(page))).height).toBe(32);
    await expect(page.getByTestId('n1-size-channel')).toHaveCount(0);
  });
});

test.describe('인증 마크 업로드 tooltip — Figma 1090:10048', () => {
  const TEXT = /인증 및 시험 정보의 적용 가능 여부는\s*사용자가 최종 확인해야 합니다\./;

  test('Info hover 시 정확한 문구, 위치 (1577,915) 186×50 — hover 해제 시 닫힘', async ({ page }) => {
    const tooltip = page.getByTestId('n1-certification-tooltip');
    await expect(tooltip).toBeHidden();
    await page.getByTestId('n1-certification-info').hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(TEXT);
    expect(await box(tooltip)).toEqual({ x: 1577, y: 915, width: 186, height: 50 });
    await page.mouse.move(10, 10);
    await expect(tooltip).toBeHidden();
  });

  test('키보드 포커스로도 열리고 blur 시 닫힘, 버튼에 aria-describedby로 연결', async ({ page }) => {
    const button = page.getByTestId('n1-certification-button');
    await expect(button).toHaveAccessibleDescription(TEXT);
    await page.getByPlaceholder('키워드를 입력해주세요.').focus();
    // 키워드 입력 → 추가 → 인증 마크 업로드 버튼 순으로 Tab
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expect(page.getByTestId('n1-certification-tooltip')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('n1-certification-tooltip')).toBeHidden();
  });
});

test.describe('인증 마크 업로드 모달 — Figma 1084:4119', () => {
  test('열기, dim, 크기·위치, 문구, uploader, 버튼, 닫기 버튼 / Escape / 취소, focus trap·복귀, scroll lock, dim 클릭 무시', async ({ page }) => {
    const button = page.getByTestId('n1-certification-button');
    await button.click();
    const dialog = page.getByRole('dialog', { name: '인증 마크 업로드' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAccessibleDescription('선택 사항입니다. 올리지 않아도 다음 단계로 진행할 수 있습니다.');
    await expect(page.getByTestId('n1-certification-dim')).toHaveCSS('background-color', 'rgba(23, 23, 23, 0.4)');

    const m = await box(dialog);
    expect([m.width, m.height]).toEqual([720, 697]);
    expect(Math.abs(m.x - 600)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.y - 191)).toBeLessThanOrEqual(1);
    const drop = await box(page.getByTestId('n1-certification-dropzone'));
    expect([drop.width, drop.height]).toEqual([640, 350]);
    await expect(dialog.getByText('파일을 이곳에 놓아주세요.')).toBeVisible();
    await expect(dialog.getByText('또는 클릭해서 선택 SVG·PNG·JPG')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '파일 선택' })).toBeVisible();
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
    const close = await box(page.getByRole('button', { name: '닫기' }));
    expect([close.width, close.height]).toEqual([32, 32]);

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
    await button.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    // 취소 → 닫힘, 포커스 복귀
    await button.click();
    await page.getByTestId('n1-certification-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('파일 선택 → 등록하기 → 완료 상태(Figma 925:2529 Tag/Selectable Selected), 취소·닫기·Escape는 완료로 바꾸지 않음', async ({ page }) => {
    const button = page.getByTestId('n1-certification-button');
    const info = page.getByTestId('n1-certification-info');
    const tooltip = page.getByTestId('n1-certification-tooltip');

    // 업로드 전: Secondary 버튼 + Info + tooltip
    await expect(button).toHaveText('인증 마크 업로드 하기');
    await expect(button).toHaveAttribute('data-state', 'default');
    await expect(button).toHaveCSS('border-top-color', 'rgb(234, 234, 234)');
    await expect(info).toBeVisible();
    await info.hover();
    await expect(tooltip).toBeVisible();
    await page.mouse.move(10, 10);
    await expect(tooltip).toBeHidden();

    // 파일을 고르기 전에는 등록 불가
    await button.click();
    await expect(page.getByTestId('n1-certification-register')).toBeDisabled();

    // 파일을 골라도 취소하면 완료가 아니다
    await page.getByTestId('n1-certification-input').setInputFiles(pngFile('mark-a.png'));
    await expect(page.getByTestId('n1-certification-file-name')).toHaveText('mark-a.png');
    await page.getByTestId('n1-certification-cancel').click();
    await expect(button).toHaveAttribute('data-state', 'default');

    // 닫기 X와 Escape도 완료가 아니다
    await button.click();
    await page.getByTestId('n1-certification-input').setInputFiles(pngFile('mark-a.png'));
    await page.getByRole('button', { name: '닫기' }).click();
    await expect(button).toHaveAttribute('data-state', 'default');
    await button.click();
    await page.getByTestId('n1-certification-input').setInputFiles(pngFile('mark-a.png'));
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('data-state', 'default');

    // 허용 형식이 아니면 선택되지 않는다
    await button.click();
    await page.getByTestId('n1-certification-input').setInputFiles({ name: 'mark.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(page.getByTestId('n1-certification-file-name')).toHaveCount(0);
    await expect(page.getByTestId('n1-certification-register')).toBeDisabled();

    // 등록하기 → 모달 닫힘 → 완료 상태
    await page.getByTestId('n1-certification-input').setInputFiles(pngFile('mark-b.png'));
    await page.getByTestId('n1-certification-register').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(button).toHaveAttribute('data-state', 'registered');
    await expect(button).toHaveText('인증 마크 업로드 완료');
    const done = await box(button);
    expect([done.width, done.height]).toEqual([170, 45]);
    await expect(button).toHaveCSS('border-top-color', ORANGE);
    await expect(button.locator('span')).toHaveCSS('color', ORANGE);
    await expect(button).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(button).toHaveCSS('border-top-left-radius', '6px');
    await expect(info).toHaveCount(0);
    await expect(tooltip).toHaveCount(0);

    // action row: 완료 170 + gap 8 + 다음 148 = 326, 오른쪽 끝 1860(Figma 1094:10967 x1534)
    const next = await box(page.getByRole('button', { name: '다음' }));
    expect([next.width, next.height]).toEqual([148, 45]);
    expect(next.x - (done.x + done.width)).toBe(8);
    expect(done.x).toBe(1534);
    expect(next.x + next.width - done.x).toBe(326);
    expect(done.y).toBe(965);

    // 완료 상태를 다시 누르면 모달이 열리고 등록한 파일이 보인다. 취소·Escape로 닫아도 완료 유지
    await button.click();
    await expect(page.getByRole('dialog', { name: '인증 마크 업로드' })).toBeVisible();
    await expect(page.getByTestId('n1-certification-file-name')).toHaveText('mark-b.png');
    await page.getByTestId('n1-certification-cancel').click();
    await expect(button).toHaveAttribute('data-state', 'registered');
    await expect(button).toBeFocused();
    await button.click();
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('data-state', 'registered');
    await expect(button).toBeFocused();

    // 키보드로도 완료 상태 버튼을 열 수 있다
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '인증 마크 업로드' })).toBeVisible();
    await page.keyboard.press('Escape');

    // 다른 입력으로 재렌더돼도 같은 N1 session 안에서 유지
    await page.getByPlaceholder('상품 이름을 입력해주세요').fill('재렌더 확인');
    await page.getByTestId('n1-size-tab-resize').click();
    await expect(button).toHaveAttribute('data-state', 'registered');
  });
});

test('1920×1080 가로 넘침 없음', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1920);
});
