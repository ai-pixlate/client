/**
 * FE Spike ① 에서 쓰는 조정 가능한 값들.
 *
 * 요구사항이 계속 바뀌므로 숫자를 코드 곳곳에 흩어놓지 않고 여기 한 곳에 모읍니다.
 * 값이 확정되면 여기만 고치면 됩니다.
 */

/** 줌 배율 하한·상한·기본값 (UI 제약이며 요구사항 아님) */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_DEFAULT = 1;
export const ZOOM_STEP = 0.25;

/**
 * 이보다 작은 크롭은 "드래그가 아니라 클릭"으로 보고 만들지 않습니다.
 * 원본 픽셀 기준. 요구사항이 아니라 오조작 방지용 값입니다.
 */
export const MIN_CROP_SOURCE_PX = 4;

/**
 * F-CH-02a / F-CH-07 — Amazon Basic A+ 상세페이지 모듈 규격.
 *
 * 확정 근거: 요구사항정의서 v2.3 · OI-01 / 구 미결3 종결 (Amazon 공식 자료).
 * MVP 결과물이 1종이라 지금은 상수지만, 12월 다규격 확장 때는
 * 서버의 channel_specs.module_spec 에서 내려받아야 합니다. (NFR-22)
 */
export const MODULE_SPEC = {
  width: 970,
  height: 300,
} as const;

/**
 * F-CRP-01 예외 처리 — "모듈 최소 해상도에 못 미치는 크기로 크롭하면 경고한다".
 *
 * 경고 기준 수치는 아직 확정되지 않았습니다.
 *   - F-CH-05a 의 "짧은 변 500px" 은 scope=thumbnail 이라 A+ detail(970x300)에는
 *     적용되지 않습니다. (v2.2 에서 정정된 사항)
 *   - 따라서 임의로 500 을 쓰지 않고, 모듈 규격 자체를 잠정 기준으로 둡니다.
 *
 * 차단이 아니라 경고입니다. 값이 확정되면 이 상수만 교체하십시오.
 */
export const CROP_WARN_MIN_WIDTH = MODULE_SPEC.width;
export const CROP_WARN_MIN_HEIGHT = MODULE_SPEC.height;

/**
 * NFR-13 / OI-27 — 좌표 허용 오차.
 *
 * 수치 미확정 (OI-27, 담당 AI + 백엔드, G1 판정 항목).
 * 스파이크에서는 "0 이어야 한다"를 자체 검증 기준으로만 씁니다.
 * 실제 비즈니스 허용치를 여기서 확정하지 마십시오.
 */
export const COORD_SELF_CHECK_TOLERANCE_PX = 0;
