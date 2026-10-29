import { type Page, expect } from '@playwright/test';

/**
 * N1 규제 분류 드롭다운(Figma 525:3023 dropdown open) — native select가 아니라 select-only combobox라
 * selectOption 대신 트리거를 열고 항목을 누른다. label은 화면 표기(화장품 · OTC 화장품 · 화장품+OTC 복합 · 잘모름).
 */
export const regulatoryClassTrigger = (page: Page) => page.getByRole('combobox', { name: '규제 분류' });
export const regulatoryClassListbox = (page: Page) => page.getByRole('listbox', { name: '규제 분류' });

export async function pickRegulatoryClass(page: Page, label: string) {
  await regulatoryClassTrigger(page).click();
  await regulatoryClassListbox(page).getByRole('option', { name: label, exact: true }).click();
  await expect(regulatoryClassListbox(page)).toHaveCount(0);
  await expect(regulatoryClassTrigger(page)).toHaveText(label);
}
