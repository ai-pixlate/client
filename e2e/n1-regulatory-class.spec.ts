import { type Page, expect, test } from '@playwright/test';

import { MOCK_BRAND_ID, MOCK_JOB_ID } from '@/lib/mock-api/fixtures';
import { pickRegulatoryClass, regulatoryClassListbox, regulatoryClassTrigger } from './helpers/n1-regulatory-class';

// ─────────────────────────────────────────────────────────────────
// N1 규제 분류 — Figma 525:3023 dropdown open(1502:21358) · OpenAPI RegulatoryClass 4종.
// 화면 표기는 Figma, API 값은 enum(cosmetic · otc · combination · unknown)이다.
// ─────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1920, height: 1080 } });

const LABELS = ['화장품', 'OTC 화장품', '화장품+OTC 복합', '잘모름'];
const ENUM_BY_LABEL: Record<string, string> = {
  화장품: 'cosmetic',
  'OTC 화장품': 'otc',
  '화장품+OTC 복합': 'combination',
  잘모름: 'unknown',
};

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test.beforeEach(async ({ page }) => {
  await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
});

test.describe('규제 분류 드롭다운', () => {
  test('닫힘은 「선택」, 열면 4종이 Figma 순서로 보이고 474×39 폭을 유지한다', async ({ page }) => {
    const trigger = regulatoryClassTrigger(page);
    await expect(trigger).toHaveText('선택');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const box = (await trigger.boundingBox())!;
    expect(Math.round(box.width)).toBe(474);
    expect(Math.round(box.height)).toBe(39);
    await page.screenshot({ path: test.info().outputPath('n1-regulatory-closed.png') });

    // 목록은 겹쳐 뜬다 — 아래 블록(이미지 유형 질문)을 밀어내지 않는다
    const below = page.getByText('이미지 안에 여러 내용이 이어져 있나요?');
    const beforeY = (await below.boundingBox())!.y;
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const options = regulatoryClassListbox(page).getByRole('option');
    await expect(options).toHaveText(LABELS);
    // 목록 외곽(좌우 border 포함)은 트리거와 같은 474, 항목은 39 높이
    expect(Math.round((await regulatoryClassListbox(page).boundingBox())!.width)).toBe(474);
    for (const option of await options.all()) {
      expect(Math.round((await option.boundingBox())!.height)).toBe(39);
    }
    expect((await below.boundingBox())!.y).toBe(beforeY);
    await page.screenshot({ path: test.info().outputPath('n1-regulatory-open.png') });
  });

  test('각 항목을 고르면 닫히고 표시값이 바뀌며, 다시 열어 다른 값으로 바꿀 수 있다', async ({ page }) => {
    for (const label of LABELS) {
      await pickRegulatoryClass(page, label);
      await regulatoryClassTrigger(page).click();
      await expect(regulatoryClassListbox(page).getByRole('option', { name: label, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.keyboard.press('Escape');
    }
  });

  test('바깥 클릭·Esc로 닫히고 값은 그대로다', async ({ page }) => {
    await pickRegulatoryClass(page, '화장품');
    await regulatoryClassTrigger(page).click();
    await page.mouse.click(10, 1000);
    await expect(regulatoryClassListbox(page)).toHaveCount(0);
    await regulatoryClassTrigger(page).click();
    await page.keyboard.press('Escape');
    await expect(regulatoryClassListbox(page)).toHaveCount(0);
    await expect(regulatoryClassTrigger(page)).toHaveText('화장품');
    await expect(regulatoryClassTrigger(page)).toBeFocused();
  });

  test('키보드 — Tab으로 포커스, Enter·Space로 열고 ↓·Enter로 고른다', async ({ page }) => {
    const trigger = regulatoryClassTrigger(page);
    await page.getByRole('button', { name: '선택하기' }).focus();
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(regulatoryClassListbox(page)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(regulatoryClassListbox(page)).toHaveCount(0);
    await expect(trigger).toHaveText('OTC 화장품');

    await page.keyboard.press(' ');
    await expect(regulatoryClassListbox(page)).toBeVisible();
    await page.keyboard.press('End');
    await page.keyboard.press(' ');
    await expect(trigger).toHaveText('잘모름');
  });

  test('고르지 않고 닫으면 「규제 분류를 선택해 주세요.」가 보이고, 처음에는 오류가 없다', async ({ page }) => {
    const error = page.getByText('규제 분류를 선택해 주세요.');
    await expect(error).toHaveCount(0);
    await regulatoryClassTrigger(page).click();
    await page.keyboard.press('Escape');
    await expect(error).toBeVisible();
    await expect(regulatoryClassTrigger(page)).toHaveAttribute('aria-invalid', 'true');
    await pickRegulatoryClass(page, '잘모름');
    await expect(error).toHaveCount(0);
  });

  test('잘모름·복합 안내 문구', async ({ page }) => {
    const unknownHelper = page.getByText('잘 모름을 선택하면 화장품 기준으로 검사됩니다.');
    const combinationHelper = page.getByText('복합 제품은 고른 OTC 종류와 같은 기준으로 검사합니다(화장품 규칙 포함).', { exact: false });
    await pickRegulatoryClass(page, '화장품');
    await expect(unknownHelper).toHaveCount(0);
    await expect(combinationHelper).toHaveCount(0);
    await pickRegulatoryClass(page, '잘모름');
    await expect(unknownHelper).toBeVisible();
    await pickRegulatoryClass(page, '화장품+OTC 복합');
    await expect(combinationHelper).toBeVisible();
    await expect(unknownHelper).toHaveCount(0);
  });

  test('국가를 바꾸면 규제 분류가 「선택」으로 돌아간다', async ({ page }) => {
    await page.getByRole('combobox').nth(0).selectOption('US');
    await pickRegulatoryClass(page, '화장품');
    await page.getByRole('combobox').nth(0).selectOption('JP');
    await expect(regulatoryClassTrigger(page)).toHaveText('선택');
  });
});

test.describe('규제 분류 → API enum', () => {
  /** PATCH /jobs/{jobId} 본문을 window.fetch에서 기록한다(MSW service worker 응답도 같은 fetch를 지난다) */
  async function recordPatchBodies(page: Page): Promise<string[]> {
    const bodies: string[] = [];
    await page.exposeFunction('__n1RcRecord', (body: string) => {
      bodies.push(body);
    });
    await page.addInitScript((jobPath) => {
      const record = (window as unknown as { __n1RcRecord: (body: string) => Promise<void> }).__n1RcRecord;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (init?.method === 'PATCH' && new URL(url, location.href).pathname === jobPath && typeof init.body === 'string') {
          await record(init.body);
        }
        return originalFetch(input, init);
      };
    }, `/jobs/${MOCK_JOB_ID}`);
    return bodies;
  }

  for (const label of LABELS) {
    test(`「${label}」은 regulatoryClass=${ENUM_BY_LABEL[label]}로 보낸다`, async ({ page }) => {
      const bodies = await recordPatchBodies(page);
      await page.goto(`/jobs/new?brandId=${MOCK_BRAND_ID}`);
      await page.getByPlaceholder('상품 이름을 입력해주세요').fill('규제 분류 상품');
      await page.getByRole('combobox').nth(0).selectOption('US');
      await page.getByRole('combobox').nth(1).selectOption('en');
      await pickRegulatoryClass(page, label);
      if (ENUM_BY_LABEL[label] === 'otc' || ENUM_BY_LABEL[label] === 'combination') {
        await page.getByRole('radio', { name: '선크림 (Sunscreen)' }).click();
      }
      await page.getByRole('button', { name: '선택하기' }).click();
      const modal = page.getByRole('dialog', { name: '카테고리 선택' });
      await modal.getByRole('button', { name: '선케어', exact: true }).click();
      await modal.getByRole('button', { name: '선크림', exact: true }).click();
      await modal.getByRole('button', { name: '확인' }).click();
      await page.getByRole('checkbox', { name: /외부 AI 서비스로 전송됨을 확인했습니다/ }).check();
      await page.locator('#image-upload').setInputFiles({ name: 'rc.png', mimeType: 'image/png', buffer: TINY_PNG });
      // 잘모름도 유효한 선택이라 진행을 막지 않는다
      const next = page.getByRole('button', { name: '다음', exact: true });
      await expect(next).toBeEnabled();
      await next.click();
      await expect(page).toHaveURL(new RegExp(`/jobs/${MOCK_JOB_ID}$`));

      const body = bodies.map((b) => JSON.parse(b)).find((b) => 'regulatoryClass' in b);
      expect(body?.regulatoryClass).toBe(ENUM_BY_LABEL[label]);
      expect(JSON.stringify(body)).not.toContain(label);
    });
  }
});
