import { expect, test } from '@playwright/test';

import { MOCK_BRAND_ID } from '@/lib/mock-api/fixtures';

test.describe('규제 분류 — OpenAPI RegulatoryClass 4종', () => {
  test('선택지 값·라벨과 unknown/combination 안내', async ({ page }) => {
    await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
    const select = page.getByRole('combobox').nth(2);
    await expect(select.locator('option')).toHaveCount(5);
    const options = await select.locator('option').evaluateAll((els) =>
      els.map((el) => ({ value: (el as HTMLOptionElement).value, label: el.textContent })),
    );
    expect(options).toEqual([
      { value: '', label: '선택' },
      { value: 'cosmetic', label: '화장품' },
      { value: 'otc', label: 'OTC 의약품' },
      { value: 'combination', label: '화장품+OTC 복합' },
      { value: 'unknown', label: '잘 모름' },
    ]);

    const unknownHelper = page.getByText('잘 모름을 선택하면 화장품 기준으로 검사됩니다.');
    const combinationHelper = page.getByText('복합 제품은 현재 OTC 기준으로 검사됩니다.');
    await select.selectOption('cosmetic');
    await expect(unknownHelper).toHaveCount(0);
    await expect(combinationHelper).toHaveCount(0);
    await select.selectOption('unknown');
    await expect(unknownHelper).toBeVisible();
    await select.selectOption('combination');
    await expect(combinationHelper).toBeVisible();
    await expect(unknownHelper).toHaveCount(0);
  });
});
