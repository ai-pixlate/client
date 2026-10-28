import { type Page, test, expect } from '@playwright/test';

import { reachN5 } from './helpers/reach-n5';
import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// ─────────────────────────────────────────────────────────────────
// N3/N5 표시 정렬 회귀 — Figma N3 1422:10176 · N5 544:3168, PRD v3.5.10.
//
// 문구·라벨·근거 링크만 본다. N3 레이아웃/bucket 조작과 N5 viewMode 동작은
// 바꾸지 않았으므로 기존 spec(n3-real-data-defense, n5-viewport)이 그대로 맡는다.
// 현지 판정 배지 라벨은 scripts/verify-n3-verdict-contract.mjs가 단위로 본다
// (mock N3에 현지 판정 행이 없다).
// ─────────────────────────────────────────────────────────────────

async function selectFirstValidOption(page: Page, index: number) {
  const select = page.getByRole('combobox').nth(index);
  const value = await select.locator('option').nth(1).getAttribute('value');
  if (!value) throw new Error(`combobox[${index}]에 선택 가능한 option이 없습니다`);
  await select.selectOption(value);
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** N1 → N3(섹션 확인)까지만 이동한다(e2e/n3-real-data-defense.spec.ts의 reachN3와 같은 경로). */
async function reachN3(page: Page) {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('E2E 테스트 상품');
  await selectFirstValidOption(page, 0);
  await selectFirstValidOption(page, 1);
  await page.getByRole('button', { name: '선택하기' }).click();
  await page.getByRole('dialog', { name: '카테고리 선택' }).getByRole('button', { name: '바디/헤어' }).click();
  await selectFirstValidOption(page, 2);
  await page.getByLabel('파일 선택').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await expect(page.locator('img[alt="e2e-test.png"]')).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  await expect(page.getByRole('button', { name: '이대로 진행' })).toBeVisible({ timeout: 30_000 });
}

test('N3 헤더는 「섹션 확인」과 Figma 부제를 쓴다', async ({ page }) => {
  await reachN3(page);
  await expect(page.getByRole('heading', { level: 1, name: '섹션 확인' })).toBeVisible();
  await expect(page.getByText('전체 섹션에서 제외 판정을 확인하고, 필요한 경우 번역에 포함하세요.')).toBeVisible();
  await expect(page.getByText('삭제할 섹션과 번역할 섹션을 확인할 수 있습니다.', { exact: false })).toHaveCount(0);
});

test('N3 판정 근거 [보기]는 evidenceUrl이 있을 때만 새 창 링크로 나온다', async ({ page }) => {
  await reachN3(page);

  // mock sec_02(id 2): regulatory + evidenceUrl 있음
  await page.getByTestId('n3-section-card-2').click({ position: { x: 150, y: 20 } });
  const link = page.getByTestId('n3-verdict-evidence-link');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('[보기]');
  await expect(link).toHaveAttribute('href', '/mock/evidence/ftc-superlative-claims.pdf');
  await expect(link).toHaveAttribute('target', '_blank');

  // mock sec_05(id 5): regulatory + evidenceUrl 없음 → 링크를 만들지 않는다
  await page.getByTestId('n3-section-card-5').click({ position: { x: 150, y: 20 } });
  await expect(page.getByTestId('n3-verdict-evidence-link')).toHaveCount(0);
});

test('N5 토글은 「번역 후 / 번역 전」이고 전환 동작은 그대로다', async ({ page }) => {
  await reachN5(page);
  const after = page.getByTestId('n5-view-mode-translated');
  const before = page.getByTestId('n5-view-mode-original');
  await expect(after).toHaveText('번역 후');
  await expect(before).toHaveText('번역 전');
  await expect(after).toHaveAttribute('aria-pressed', 'true');

  await before.click();
  await expect(before).toHaveAttribute('aria-pressed', 'true');
  await expect(after).toHaveAttribute('aria-pressed', 'false');
});
