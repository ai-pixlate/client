import { isApiMockingEnabled } from '../api/session.ts';

/**
 * Mock 전용 끄기 스위치(sessionStorage). 'off' 면 Mock 에서도 실서버처럼 배치 쓰기를 하지 않는다 —
 * 세션 local 편집만 검증하는 e2e 가 실서버(쓰기 차단) 동작을 그대로 확인하는 데 쓴다(e2e/helpers/layout-write.ts).
 */
export const MOCK_LAYOUT_ADJUST_WRITE_KEY = 'pixlate:mock-layout-adjust-write';

/**
 * layoutAdjust 저장(BlockPatch.layoutAdjust) 쓰기 허용 여부 — 계약 확정·서버 구현 대기(OpenAPI 3.5.10).
 * 서버 구현 전에는 layoutAdjust 가 정의되지 않은 키라 422 이므로, 실서버(API 모드)에서는 보내지 않는다(편집은 세션 local).
 * Mock(MSW)에서만 실제 저장 흐름을 탄다. 기능 여부를 알아내려고 endpoint 를 시험 호출하지 않는다.
 *
 * TODO(SERVER-LAYOUT-ADJUST): 서버 구현이 배포되면 이 함수를 true 로 바꾸거나 계약 버전 확인으로 교체한다 — 판단은 여기 한 곳이다.
 */
export function isLayoutAdjustWriteEnabled(): boolean {
  if (!isApiMockingEnabled()) return false;
  if (typeof window === 'undefined') return true;
  try {
    return window.sessionStorage.getItem(MOCK_LAYOUT_ADJUST_WRITE_KEY) !== 'off';
  } catch {
    return true;
  }
}
