import { type Page, expect } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// N1 combobox 순서: 국가 → 언어 → 규제 분류 → 카테고리
// 현재 label이 select에 htmlFor/id로 연결돼 있지 않아 getByLabel을 쓸 수 없다.
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

/**
 * N1 진입부터 N5(검수) 화면 도달까지 최단 경로로 이동한다.
 *
 * e2e/basic-flow.spec.ts와 e2e/n5-viewport.spec.ts가 공유하는 setup — N3
 * drag&drop처럼 각 단계 자체를 검증하는 assertion은 포함하지 않는다(그건
 * basic-flow.spec.ts의 몫). 여기서는 오직 "N5까지 도달"만 책임진다.
 */
export async function reachN5(page: Page): Promise<void> {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);

  await selectFirstValidOption(page, 0); // 국가
  await selectFirstValidOption(page, 1); // 언어
  await selectFirstValidOption(page, 2); // 규제 분류
  await selectFirstValidOption(page, 3); // 카테고리

  await page.getByLabel('이미지 추가').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await expect(page.getByText('e2e-test.png')).toBeVisible();

  await page.getByRole('button', { name: '다음 →' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));

  // N3 고유 UI가 나타날 때까지 대기 (고정 sleep 대신 polling 완료를 기다림)
  await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible({ timeout: 8_000 });

  await page.getByRole('button', { name: '번역 시작' }).click();
  await expect(page.getByRole('heading', { name: '번역을 진행하고 있습니다' })).toBeVisible();

  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 8_000 });
}
