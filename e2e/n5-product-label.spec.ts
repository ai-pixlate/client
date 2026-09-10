import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// N5 — product_label TextBlock 편집 불가 (v3.4.1)
//
// 실제 N5 화면(app/jobs/[jobId]/_components/n5/n5-panel.tsx)은 아직 block
// table을 구현하지 않아 TextBlockEditor를 렌더하지 않는다. TextBlockEditor는
// 현재 app/perf/long-page(perf harness)에서만 실제로 마운트되므로, 이 화면을
// 통해 product_label 편집 불가 계약을 검증한다.
// ─────────────────────────────────────────────────────────────────

test.describe('N5 perf harness — product_label 편집 불가', () => {
  test('role 표시=제품 라벨, textarea disabled, 저장 조작 불가, needsReview 표시 유지', async ({ page }) => {
    await page.goto('/perf/long-page');
    await page.getByRole('button', { name: 'N5-A' }).click();

    const productLabelBlock = page
      .locator('[data-testid="text-block-editor"][data-role="product_label"]')
      .first();
    await expect(productLabelBlock).toBeVisible();

    // role 표시 = "제품 라벨" (raw role 코드값 'product_label' 노출 아님)
    await expect(productLabelBlock.getByTestId('text-block-role-label')).toHaveText('제품 라벨');

    // 번역문 textarea는 disabled — product_label은 편집 대상이 아니다
    const textarea = productLabelBlock.locator('textarea');
    await expect(textarea).toBeDisabled();

    // disabled textarea이므로 편집 자체가 불가능해 dirty 상태를 만들 수 없고,
    // 그 결과 저장 버튼도 렌더되지 않는다.
    await expect(productLabelBlock.getByRole('button', { name: '저장' })).toHaveCount(0);

    // needsReview 표시는 role과 무관하게 유지된다 — product_label이라고 해서
    // "확인 필요" 배지 렌더링 자체가 꺼지지 않는지 일반화해서 확인한다.
    // (perf harness의 synthetic role/needsReview 배정 규칙상 이 시나리오에서
    // product_label + needsReview=true 조합이 나오지 않을 수 있으므로, 실제
    // needsReview 값에 맞춰 배지 유무를 검증한다.)
    const needsReview = (await productLabelBlock.getAttribute('data-needs-review')) === 'true';
    const reviewBadge = productLabelBlock.getByText('확인 필요', { exact: true });
    if (needsReview) {
      await expect(reviewBadge).toBeVisible();
    } else {
      await expect(reviewBadge).toHaveCount(0);
    }
  });
});
