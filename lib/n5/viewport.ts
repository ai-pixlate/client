/**
 * N5 좌측 뷰어 — 캔버스형 viewport(zoom/pan/fit) 순수 계산 — Figma node 544:3168 기준.
 *
 * React 도 브라우저 API 도 쓰지 않는 순수 함수만 모아둔다. 그래서 Node에서
 * 화면 없이 바로 검증할 수 있다(scripts/verify-n5-viewport.mjs).
 *
 * 모델:
 * - canvas: 원문/번역문 stack의 "원본(un-zoomed)" 크기. zoom과 무관한 고정값이며
 *   section.height * scaleY(누적), sourceImage.preview.previewWidth의 최대값으로
 *   결정된다 (lib/n5/coordinates.ts의 preview scale을 그대로 쓴다).
 * - viewport: canvas를 담는 overflow-hidden 컨테이너의 화면상 크기(usable area,
 *   padding 제외).
 * - transform: `translate(pan.x, pan.y) scale(zoom)`, transform-origin 0 0.
 *   즉 pan은 "화면 px" 단위(스케일 적용 후 좌표), zoom을 걸기 전 canvas 좌표가
 *   아니다.
 *
 * fit 계산은 CSS transform 결과(getBoundingClientRect 등)를 다시 측정해
 * 누적하지 않는다 — 원본 canvas size와 viewport size(둘 다 zoom과 무관한 값)
 * 로만 계산해야 계속 다시 측정해도 오차가 쌓이지 않는다.
 */

export type N5ViewMode = 'translated' | 'original';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────────────
// zoom clamp
// ─────────────────────────────────────────────────────────────────

/** 25% ~ 400% */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** +/- 버튼 1클릭당 zoom 변화량 (10%p) */
export const ZOOM_BUTTON_STEP = 0.1;

/** Ctrl/Cmd+Wheel deltaY -> zoom 배율 변환 민감도. 값이 클수록 더 빠르게 확대/축소된다 */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** deltaY(휠 이벤트값, 위로 굴리면 음수)를 곱셈 배율로 변환한다. deltaY<0(위로) -> 배율>1(확대) */
export function computeWheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
}

// ─────────────────────────────────────────────────────────────────
// pointer-centered zoom
// ─────────────────────────────────────────────────────────────────

export interface ZoomAroundPointResult {
  zoom: number;
  pan: Point;
}

/**
 * pointer(뷰포트 기준 px)를 화면상 같은 위치에 고정한 채 zoom만 바꾼다.
 *
 * transform이 `translate(pan) scale(zoom)`이므로, 화면 px pointer 아래
 * 놓인 canvas-space 좌표는 (pointer - pan) / zoom 이다. zoom을 바꾼 뒤에도
 * 같은 canvas-space 좌표가 같은 화면 위치(pointer)에 오도록 pan을 역산한다.
 * 그러지 않으면 확대할 때마다 이미지가 좌상단 기준으로 튀어 보인다.
 */
export function computeZoomAroundPoint(
  currentZoom: number,
  currentPan: Point,
  pointer: Point,
  nextZoomRaw: number,
): ZoomAroundPointResult {
  const nextZoom = clampZoom(nextZoomRaw);
  if (nextZoom === currentZoom) {
    return { zoom: currentZoom, pan: currentPan };
  }

  const contentX = (pointer.x - currentPan.x) / currentZoom;
  const contentY = (pointer.y - currentPan.y) / currentZoom;

  return {
    zoom: nextZoom,
    pan: {
      x: pointer.x - contentX * nextZoom,
      y: pointer.y - contentY * nextZoom,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// fit width / fit height
// ─────────────────────────────────────────────────────────────────

/**
 * viewport의 실제 사용 가능한 크기 = clientWidth/Height(padding 포함) - padding.
 * getBoundingClientRect가 아니라 clientWidth/Height를 넘긴다 — border는 어차피
 * usable area가 아니므로 제외해야 하고, transform이 걸린 조상 요소가 있어도
 * clientWidth/Height 자체는 transform의 영향을 받지 않는다.
 */
export function computeUsableViewportSize(
  clientWidth: number,
  clientHeight: number,
  padding: { left: number; right: number; top: number; bottom: number },
): Size {
  return {
    width: Math.max(0, clientWidth - padding.left - padding.right),
    height: Math.max(0, clientHeight - padding.top - padding.bottom),
  };
}

/** fitWidthScale = viewport 가용 폭 / canvas 원본 폭 (zoom과 무관한 원본 크기끼리 비교) */
export function computeFitWidthScale(viewport: Size, canvas: Size): number {
  if (canvas.width <= 0) return 1;
  return clampZoom(viewport.width / canvas.width);
}

/** fitHeightScale = viewport 가용 높이 / canvas 원본 높이 */
export function computeFitHeightScale(viewport: Size, canvas: Size): number {
  if (canvas.height <= 0) return 1;
  return clampZoom(viewport.height / canvas.height);
}
