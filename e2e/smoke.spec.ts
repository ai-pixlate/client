import { test, expect } from '@playwright/test';

test('앱 root route가 정상 렌더링된다', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Pix_ate');
  await expect(page.getByRole('heading', { name: 'Pix_ate' })).toBeVisible();
});
