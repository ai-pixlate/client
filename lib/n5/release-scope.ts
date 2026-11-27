import { isApiMockingEnabled } from '../api/session.ts';

/**
 * N5 릴리스 범위(PM 11-26 결정).
 *
 * 일반 실행 취소 · 다시 실행(F-CFM-03 — 번역문 · 섹션 · 박스 · 글자 배율 이력)은 12월 범위에서 빠지고 이후 일정으로 옮겼다.
 * - 12월 화면: 캔버스 Undo/Redo 버튼을 그리지 않고 캔버스 단축키(Ctrl/⌘+Z · Shift+Ctrl/⌘+Z)도 듣지 않는다.
 * - 이력 관리 · 저장 구현(lib/n5/history.ts · use-n5-edit-session.ts)은 지우지 않는다 — 다시 켤 때 이 상수만 바꾼다.
 * - 이 결정과 무관하게 유지: 번역문 입력칸의 기본 글자 실행 취소(브라우저 기본 동작) · 섹션 제외 뒤 [되돌리기](F-CFM-14, 섹션 PATCH restore).
 */
export const N5_GENERAL_HISTORY_RELEASED = false;

/** Mock 검증 전용 스위치 — 보존한 이력 기능의 기존 E2E 를 계속 돌리기 위한 것이다. 실서버 모드(NEXT_PUBLIC_API_MOCKING ≠ enabled)에서는 읽지 않는다 */
export const N5_GENERAL_HISTORY_MOCK_FLAG_KEY = 'pixlate:test:n5-general-history';

export function isN5GeneralHistoryEnabled(): boolean {
  if (N5_GENERAL_HISTORY_RELEASED) return true;
  if (!isApiMockingEnabled() || typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(N5_GENERAL_HISTORY_MOCK_FLAG_KEY) === 'enabled';
  } catch {
    return false;
  }
}
