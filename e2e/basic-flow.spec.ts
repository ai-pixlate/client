import { test, expect, type Page, type Locator } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// N1 combobox 순서: 국가 → 언어 → 규제 분류 → 카테고리
// 현재 label이 select에 htmlFor/id로 연결돼 있지 않아 getByLabel을 쓸 수 없다.
// 각 select의 첫 번째 유효한(placeholder 다음) option을 선택한다.
async function selectFirstValidOption(page: Page, index: number) {
  const select = page.getByRole('combobox').nth(index);
  const firstRealOption = select.locator('option').nth(1);
  const value = await firstRealOption.getAttribute('value');
  if (!value) throw new Error(`combobox[${index}]에 선택 가능한 option이 없습니다`);
  await select.selectOption(value);
}

// 1x1 투명 PNG — repository에 binary fixture를 추가하지 않기 위해 메모리에서 생성한다.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function excludeAndRestoreSection(section: Locator) {
  await section.getByRole('button', { name: '제외' }).click();
  await expect(section.getByText('제외됨')).toBeVisible();
  await expect(section.getByRole('button', { name: '되살리기' })).toBeVisible();

  await section.getByRole('button', { name: '되살리기' }).click();
  await expect(section.getByText('포함')).toBeVisible();
  await expect(section.getByRole('button', { name: '제외' })).toBeVisible();
}

test('N1에서 N5 검수 화면까지 기본 작업 흐름을 완료한다', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  // ── N1: 진입 ──────────────────────────────────────────────
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);

  await expect(page.getByText('신규 작업')).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(4);
  await expect(page.getByLabel('이미지 추가')).toBeAttached();
  await expect(page.getByRole('button', { name: '다음 →' })).toBeVisible();

  // ── N1: 필수값 입력 (실제 사용자 순서: 국가 → 언어 → 규제 분류 → 카테고리) ──
  await selectFirstValidOption(page, 0); // 국가
  await selectFirstValidOption(page, 1); // 언어
  await selectFirstValidOption(page, 2); // 규제 분류
  await selectFirstValidOption(page, 3); // 카테고리

  // ── N1: 이미지 업로드 ─────────────────────────────────────
  await page.getByLabel('이미지 추가').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await expect(page.getByText('e2e-test.png')).toBeVisible();

  // ── N1: 제출 ──────────────────────────────────────────────
  await page.getByRole('button', { name: '다음 →' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));

  // ── N2: 분석 진행 화면 ────────────────────────────────────
  await expect(page.getByRole('progressbar')).toBeVisible();

  // N3 고유 UI가 나타날 때까지 대기 (고정 sleep 대신 polling 완료를 기다림)
  await expect(page.getByRole('button', { name: '번역 시작 →' })).toBeVisible({
    timeout: 8_000,
  });

  // ── N3: 섹션 확인 ─────────────────────────────────────────
  const sectionArticles = page.getByRole('article');
  await expect(sectionArticles).toHaveCount(5);
  await expect(page.getByRole('button', { name: '되살리기' })).toHaveCount(1);

  // ── N3: interaction — 포함 섹션 하나를 제외했다가 복원 ──────
  const section1 = page.getByRole('article').filter({ hasText: '섹션 1' });
  await excludeAndRestoreSection(section1);

  // ── N3 → N4 ───────────────────────────────────────────────
  await page.getByRole('button', { name: '번역 시작 →' }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('heading', { name: '번역을 진행하고 있습니다' })).toBeVisible();

  // ── N4 → N5 ───────────────────────────────────────────────
  await expect(page.getByRole('button', { name: '원문' })).toBeVisible({ timeout: 8_000 });

  // ── N5: 기본 검증 ────────────────────────────────────────
  await expect(page.getByRole('button', { name: '원문' })).toBeVisible();
  await expect(page.getByRole('button', { name: '번역문' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(6);
  await expect(page.getByRole('button', { name: /다른 번역 보기/ })).toBeVisible();

  const finishButton = page.getByRole('button', { name: '저장 및 완료 →' });
  await expect(finishButton).toBeVisible();

  // ── N5: 원문/번역문 toggle ───────────────────────────────
  await page.getByRole('button', { name: '번역문' }).click();
  await page.getByRole('button', { name: '원문' }).click();

  // ── 현재 flow 종료 조건: N5 → N6 미구현 확인 ────────────────
  await expect(finishButton).toBeDisabled();
  await expect(finishButton).toHaveAttribute('title', 'N6 저장 화면은 아직 구현되지 않았습니다.');

  expect(pageErrors).toEqual([]);
});
