import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// N5 — product_label TextBlock 편집 불가 (v3.4.1)
//
// 실제 N5 화면(app/jobs/[jobId]/_components/n5/n5-panel.tsx)은 아직 block
// table을 구현하지 않아 TextBlockEditor를 렌더하지 않는다. TextBlockEditor는
// 현재 app/perf/long-page(perf harness)에서만 실제로 마운트되므로, 이 화면을
// 통해 product_label 편집 불가 계약을 검증한다.
//
// needsReview("확인 필요" 배지)는 이 스펙에서 검증하지 않는다 — perf harness의
// synthetic 배정 규칙(role=product_label ⟺ n % 6 === 5, needsReview=true ⟺
// n % 4 === 0)은 6과 4의 관계상 두 조건을 동시에 만족하는 n이 존재하지 않아,
// 이 harness에서는 product_label + needsReview=true 조합이 절대 생성되지
// 않는다. 실제 N5 block table이 구현되면(blk_08처럼 needsReview: true인
// product_label이 실제로 렌더되는 시점) 그 화면을 대상으로 별도 E2E를 추가한다.
// ─────────────────────────────────────────────────────────────────

test.describe('N5 perf harness — product_label 편집 불가', () => {
  test('role 표시=제품 라벨, textarea disabled, 저장 버튼 없음', async ({ page }) => {
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
  });
});
