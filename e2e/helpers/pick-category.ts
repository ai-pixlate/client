import type { Page } from '@playwright/test';

/**
 * N1 카테고리 선택(Figma 1094:11176) — "선택하기" → 대분류 → 중분류(→ 소분류) → 확인.
 * 기본 경로는 소분류가 없는 중분류 「스킨케어 > 스킨/토너」(가장 짧은 최종 선택).
 */
export async function pickCategory(page: Page, path: string[] = ['스킨케어', '스킨/토너']) {
  await page.getByRole('button', { name: '선택하기' }).click();
  const modal = page.getByRole('dialog', { name: '카테고리 선택' });
  for (const [depth, label] of path.entries()) {
    await modal.getByTestId('n1-category-column').nth(depth).getByRole('button', { name: label, exact: true }).click();
  }
  await modal.getByRole('button', { name: '확인' }).click();
}
