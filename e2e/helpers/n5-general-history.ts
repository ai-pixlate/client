import type { Page } from '@playwright/test';

/**
 * 일반 실행 취소·다시 실행은 12월 화면에서 숨겼다(lib/n5/release-scope.ts). 이력 · 저장 구현은 보존했으므로
 * 그 기능을 검증하던 기존 spec 은 Mock 전용 스위치를 켜고 그대로 돌린다(실서버 모드에서는 이 스위치를 읽지 않는다).
 * 12월 화면의 비노출 자체는 e2e/n5-release-scope.spec.ts 가 본다.
 */
export const N5_GENERAL_HISTORY_MOCK_FLAG_KEY = 'pixlate:test:n5-general-history';

export async function enableN5GeneralHistoryForTest(page: Page) {
  await page.addInitScript((key) => window.sessionStorage.setItem(key, 'enabled'), N5_GENERAL_HISTORY_MOCK_FLAG_KEY);
}
