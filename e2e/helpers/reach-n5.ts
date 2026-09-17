import { type Page, expect } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';

// N1 combobox 순서(Figma 525:3023 재정합 후): 국가 → 언어 → 규제 분류
// (카테고리는 더 이상 combobox가 아니다 — 검색 표시 필드 + "선택하기" 버튼
// →카테고리 선택 모달(381:6293)로 바뀌었다. 아래 openCategoryModalAndPick이
// 그 흐름을 대신한다). 어느 select든 첫 번째 유효한 option을 고르는
// 동작이라 순서 자체는 영향 없다.
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

  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('E2E 테스트 상품');
  await selectFirstValidOption(page, 0); // 국가
  await selectFirstValidOption(page, 1); // 언어

  // 카테고리 — "선택하기" 클릭 → 모달(381:6293)에서 하위 데이터가 없는
  // 최상위 항목("바디/헤어")을 눌러 즉시 선택·닫힘 처리한다(가장 짧은 경로).
  await page.getByRole('button', { name: '선택하기' }).click();
  const categoryModal = page.getByRole('dialog', { name: '카테고리 선택' });
  await categoryModal.getByRole('button', { name: '바디/헤어' }).click();

  await selectFirstValidOption(page, 2); // 규제 분류 (카테고리가 combobox에서 빠지며 인덱스가 3→2로 당겨졌다)

  await page.getByLabel('파일 선택').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await expect(page.getByText('e2e-test.png')).toBeVisible();

  await page.getByRole('button', { name: '다음' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));

  // N3 고유 UI가 나타날 때까지 대기 (고정 sleep 대신 polling 완료를 기다림)
  await expect(page.getByRole('button', { name: '번역 시작' })).toBeVisible({ timeout: 8_000 });

  await page.getByRole('button', { name: '번역 시작' }).click();
  await expect(page.getByRole('heading', { name: '번역을 진행하고 있습니다' })).toBeVisible();

  await expect(page.locator('[data-testid="n5-panel"]')).toBeVisible({ timeout: 8_000 });
}
