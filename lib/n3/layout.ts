/**
 * N3 공용 레이아웃 상수 (Figma 1422:10176 「N3 섹션 확인 / 디폴트」, 1920×1080 기준).
 *
 * 세 칼럼(섹션 목록 · 판정 상세 · 섹션 이미지)과 그 사이 간격을 1920 실측값을 상한으로 두고
 * vw 비율로 줄어들게 한다 — 각 파일에 668px·405px 같은 값을 따로 하드코딩하지 않는다.
 */

/** 진행단계 rail(끝 x=80) → 섹션 목록 시작(x=140) 사이 60px */
export const N3_CONTENT_LEFT_INSET = '60px';

/** 섹션 목록 패널 668px @ 1920 (668/1920 ≈ 34.8vw). 하단 CTA도 같은 폭 */
export const N3_LIST_WIDTH = 'clamp(480px, 34.8vw, 668px)';

/** 목록(끝 x=808) → 판정 상세(x=888) 80px */
export const N3_LIST_DETAIL_GAP = 'clamp(32px, 4.17vw, 80px)';

/** 판정 상세 405px @ 1920 (405/1920 ≈ 21.1vw) */
export const N3_DETAIL_WIDTH = 'clamp(300px, 21.1vw, 405px)';

/** 판정 상세(끝 x=1293) → 섹션 이미지(x=1395) 102px */
export const N3_DETAIL_IMAGE_GAP = 'clamp(32px, 5.31vw, 102px)';

/** 섹션 이미지 405px @ 1920 */
export const N3_IMAGE_WIDTH = 'clamp(260px, 21.1vw, 405px)';
