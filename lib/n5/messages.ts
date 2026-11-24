/**
 * N5 저장 결과 안내 문구 — PM 최종 확정(10/29). 화면마다 복제하지 않고 여기서만 관리한다.
 *
 * 이력 엔진(lib/n5/history.ts)과 N5 화면이 같이 쓰므로 어느 한쪽에 두지 않는다.
 * 'edit-failed' 는 박스 조정·섹션 제외·섹션 되돌리기 저장 실패(마지막 저장 상태로 되돌림) 전용이다.
 * 번역문 저장 실패는 입력을 유지하므로 이 문구를 쓰지 않는다 — 번역문 실패 문구는 PM 승인 전이라 아직 없다.
 */

export type N5SaveNotice = 'edit-failed' | 'undo-failed' | 'redo-failed';

export const N5_SAVE_NOTICE_MESSAGES: Record<N5SaveNotice, string> = {
  'undo-failed': '실행 취소를 하지 못했습니다. 현재 상태를 유지합니다.',
  'redo-failed': '재실행하지 못했습니다. 현재 상태를 유지합니다.',
  'edit-failed': '변경 사항을 저장하지 못했습니다. 마지막으로 저장된 상태로 돌아갑니다.',
};
