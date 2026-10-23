import { test, expect } from '@playwright/test';

test('앱 root route가 정상 렌더링된다', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('pix/ate');
  await expect(page.getByRole('heading', { name: 'pix/ate' })).toBeVisible();
});
