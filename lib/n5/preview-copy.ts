/**
 * N5 「번역 후」 미리보기 의미 상태 → 임시 화면 문구. 판정(preview-state.ts)과 분리해 문구만 바꿀 수 있게 둔다.
 * 아래 문구는 기능 확인용 임시값이며 최종 디자인 정본이 아니다.
 *
 * TODO(DESIGN): N5 번역 후 뷰어의
 * - 미리보기 갱신 중
 * - 재렌더 실패
 * - 결과 없음
 * - 입력 오류
 * 상태의 최종 문구·아이콘·위치
 */

/** 진행 문구 — 이전 결과 없이 대기·진행, 이전 결과 위 갱신 중(updating 은 시도 단계에 따라 waiting/running), 입력 준비 중 */
export const N5_PREVIEW_PROGRESS_COPY = {
  waiting: '렌더 대기 중',
  running: '렌더링 중',
  preparing: '렌더 대기 중',
} as const;

/** 안내 문구 — previous-result 는 stale·updating·update-failed 공통 */
export const N5_PREVIEW_NOTICE_COPY = {
  'input-error': '미리보기 입력 오류',
  syncing: '최신 내용을 불러오는 중',
  'previous-result': '최신 미리보기 아님',
  missing: '미리보기 없음',
} as const;
