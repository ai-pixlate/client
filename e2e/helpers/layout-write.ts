import type { Page } from '@playwright/test';

import { MOCK_LAYOUT_ADJUST_WRITE_KEY } from '@/lib/n5/layout-adjust-capability';

/**
 * Mock 에서도 layoutAdjust 쓰기를 끈다 — 실서버(서버 구현 전)와 같은 "세션 local 편집, 서버 요청 없음" 동작.
 * 박스·배율 local 편집을 검증하는 spec 이 쓴다. 저장 흐름은 e2e/n5-layout-adjust.spec.ts 가 본다.
 */
export async function useLocalLayoutEditing(page: Page): Promise<void> {
  await page.addInitScript((key) => window.sessionStorage.setItem(key, 'off'), MOCK_LAYOUT_ADJUST_WRITE_KEY);
}
