import { type Page, expect } from '@playwright/test';

import { reachN5 } from './reach-n5';

/**
 * N5 검수 확정("저장하러 가기") 클릭까지 포함해 N6(저장 및 내보내기) 화면
 * 도달까지 최단 경로로 이동한다. e2e/n6-happy-path.spec.ts 전용 setup —
 * N5 자체를 검증하는 assertion은 포함하지 않는다(그건 e2e/n5-confirm.spec.ts의 몫).
 *
 * confirm이 성공하면 서버가 N6 진입과 동시에 job 단위 render task를 자동
 * 등록한다(lib/msw/handlers.ts) — 헤딩이 뜨는 시점엔 이미 render task가
 * done으로 polling을 마친 뒤다(2초 polling 2회 안쪽, 10초 타임아웃 안에 끝난다).
 */
export async function reachN6(page: Page): Promise<void> {
  await reachN5(page);

  await page.getByTestId('n5-confirm-button').click();
  await expect(page.getByRole('heading', { name: '번역이 완료됐습니다' })).toBeVisible({ timeout: 10_000 });
}
