import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// M·H 공통 헤더(Figma header 1809:42006 M 변형 — M1 1806:32280) — 계정 메뉴 · 로그아웃 · 이동 링크.
// N1~N6 작업용 헤더(job-header)는 e2e/job-header-figma.spec.ts · e2e/job-exit.spec.ts 가 본다(이번 작업에서 바꾸지 않았다).
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

test('M1 헤더 — Figma 좌표(로고 124/12 102×48 · 우측 1539/24 257×24)와 이동 링크', async ({ page }) => {
  await page.goto('/');
  const home = (await page.getByTestId('app-header-home').boundingBox())!;
  expect([home.x, home.y, home.width, home.height]).toEqual([124, 12, 102, 48]);
  const actions = (await page.getByTestId('app-header-actions').boundingBox())!;
  expect([actions.x, actions.y, actions.width, actions.height]).toEqual([1539, 24, 257, 24]);
  await expect(page.getByTestId('app-header-title')).toHaveText('보관함');
  await expect(page.getByTestId('app-header-home')).toHaveAttribute('href', '/home');
  await page.getByTestId('app-header-brand').click();
  await expect(page).toHaveURL(/\/brand\/select$/);
});

test('[내 계정] 드롭다운은 작업용 헤더와 같은 컴포넌트다 — 열고 Escape 로 닫으면 버튼으로 포커스가 돌아간다', async ({ page }) => {
  await page.goto('/');
  const account = page.getByTestId('job-header-account');
  await account.click();
  await expect(account).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('job-header-account-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(account).toHaveAttribute('aria-expanded', 'false');
  await expect(account).toBeFocused();
});

for (const path of ['/', '/brand/select', '/brand', '/home']) {
  test(`${path} 헤더 [로그아웃] → G1(/login)`, async ({ page }) => {
    await page.goto(path);
    await page.getByTestId('account-logout').click();
    await expect(page).toHaveURL(/\/login$/);
  });
}
