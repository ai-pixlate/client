/**
 * N3 공용 레이아웃 상수 (Figma 1759:11529 「N3 섹션 확인 / 디폴트 수정」, 1920×1080 기준).
 *
 * 구조: [선택 Section 이미지 | 판정 상세]  80  [Section 목록 + 이대로 진행]
 * - 작업 영역 x200 · y112 · 1600×920 (rail 끝 x80 뒤 좌우 120, 아래 48)
 * - 왼쪽 묶음 832×863 = 이미지 404 · gap 24 · 상세 404, 오른쪽 688×920 = 목록 863 · gap 12 · CTA 45
 *
 * 노트북에서도 세 칸 가로 구조를 유지한다. 고정 px 대신 1920 실측을 상한으로 두고
 * 비율(832:688, 1:1)과 vw 기반 clamp 간격으로 함께 줄어든다 — 세로 stack이나 가로 스크롤을 만들지 않는다.
 */

/** 진행단계 rail(끝 x=80) → 제목(x=140) 60px */
export const N3_HEADER_LEFT_INSET = '60px';

/** rail 끝(x=80) → 작업 영역(x=200) 120px, 오른쪽 끝도 120px. 120/1920 = 6.25vw */
export const N3_WORK_AREA_INSET = 'clamp(24px, 6.25vw, 120px)';

/** 작업 영역 최대 폭 1600 */
export const N3_WORK_AREA_MAX_WIDTH = '1600px';

/** 왼쪽 묶음 : 오른쪽 목록 = 832 : 688 */
export const N3_COLUMNS = 'minmax(0, 832fr) minmax(0, 688fr)';

/** 왼쪽 묶음 ↔ 오른쪽 목록 80px @ 1920 (80/1920 ≈ 4.17vw) */
export const N3_OUTER_GAP = 'clamp(32px, 4.17vw, 80px)';

/** 이미지 ↔ 판정 상세 24px @ 1920 (24/1920 = 1.25vw) */
export const N3_INNER_GAP = 'clamp(16px, 1.25vw, 24px)';

/** 목록 패널 ↔ 이대로 진행 12 + CTA 45 — 왼쪽 묶음 높이는 작업 영역에서 이만큼 뺀 목록 높이와 같다(1080에서 863) */
export const N3_CTA_BLOCK_HEIGHT = '57px';
