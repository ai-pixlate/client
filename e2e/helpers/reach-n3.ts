import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { pickRegulatoryClass } from './n1-regulatory-class';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function selectFirstValidOption(page: Page, index: number) {
  const select = page.getByRole('combobox').nth(index);
  const value = await select.locator('option').nth(1).getAttribute('value');
  if (!value) throw new Error(`combobox[${index}]에 선택 가능한 option이 없습니다`);
  await select.selectOption(value);
}

/** N1 → N3까지 이동한다. mockScenario는 화면 주소로 켠다(MSW가 request.referrer로 읽는다) */
export async function reachN3(page: Page, options: { mockScenario?: string } = {}): Promise<void> {
  test.info().setTimeout(test.info().timeout + 30_000);
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
  await page.getByPlaceholder('상품 이름을 입력해주세요').fill('E2E 테스트 상품');
  await selectFirstValidOption(page, 0);
  await selectFirstValidOption(page, 1);
  await page.getByRole('button', { name: '선택하기' }).click();
  const modal = page.getByRole('dialog', { name: '카테고리 선택' });
  await modal.getByRole('button', { name: '선케어' }).click();
  await modal.getByRole('button', { name: '선크림' }).click();
  await modal.getByRole('button', { name: '확인' }).click();
  await page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ }).check();
  await pickRegulatoryClass(page, '화장품');
  await page.getByLabel('파일 선택').setInputFiles({
    name: 'e2e-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
  });
  await expect(page.locator('img[alt="e2e-test.png"]')).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));
  if (options.mockScenario) {
    await page.evaluate((scenario) => history.replaceState(history.state, '', `?mockScenario=${scenario}`), options.mockScenario);
  }
  await expect(page.getByRole('button', { name: '이대로 진행' })).toBeVisible({ timeout: 30_000 });
}
