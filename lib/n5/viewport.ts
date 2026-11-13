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

// 「번역 후」 토글 비활성화 판단(구 hasMissingRenderedPreview, PreviewSourceImage[]
// 기준)은 5단계에서 제거했다 — 호출부가 없었고(3단계부터 죽은 코드), 같은 판단은
// 이제 app/jobs/[jobId]/_components/n5/n5-view.tsx가 PreviewViewModel.sections의
// render.status로 직접 계산한다(lib/n5/adapter.ts의 resolveSectionRenderState 결과).

// ─────────────────────────────────────────────────────────────────
// zoom clamp
// ─────────────────────────────────────────────────────────────────

/**
 * 1% ~ 400%. 예전엔 25%가 하한이었으나, 그러면 초장축(예: preview 500x18868)
 * 이미지의 Fit Height 배율(뷰포트 높이/캔버스 높이, 보통 몇 %대)이 25%로
 * clamp돼 "세로 맞춤"인데도 이미지가 잘려 보이는 문제가 있었다. 사용자 직접
 * 입력 하한도 이 값과 같은 1%를 기준으로 한다 — 별도 입력 전용 하한을 두지
 * 않는다.
 */
export const MIN_ZOOM = 0.01;
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

/**
 * Fit Width/Height 적용 직후 캔버스를 viewport 정중앙에 두는 pan을 구한다.
 * scale된 캔버스 크기(canvas * zoom)가 usable보다 크든 작든 축마다 그냥
 * 가운데(= (usable - scaled) / 2)로 맞춘다 — clampPan처럼 "더 클 때는 범위
 * 안에서만 이동 허용"하지 않는다. Fit은 항상 "정중앙 배치"가 목표이기
 * 때문이다(맞춘 축은 scaled === usable이라 어차피 0이 되고, 맞추지 않은
 * 반대 축만 이 식으로 가운데 정렬된다).
 */
export function computeCenteredPan(canvas: Size, zoom: number, usable: Size): Point {
  return {
    x: (usable.width - canvas.width * zoom) / 2,
    y: (usable.height - canvas.height * zoom) / 2,
  };
}

// ─────────────────────────────────────────────────────────────────
// pan 경계(clamp)
// ─────────────────────────────────────────────────────────────────

/**
 * 한 축(가로 또는 세로)의 pan을 경계 안으로 clamp한다.
 *
 * - scaled(=canvas*zoom)가 usable보다 작거나 같으면(뷰포트보다 작은 이미지)
 *   그 축은 pan을 허용하지 않고 항상 가운데(centerOffset)로 고정한다.
 * - scaled가 usable보다 크면, "이미지 시작(끝)이 viewport 중앙보다
 *   안쪽으로 더 들어올 수 없다"는 규칙에 따라
 *     pan ∈ [usable/2 - scaled, usable/2]
 *   범위로 clamp한다 — pan이 usable/2이면 이미지 시작 지점이 정확히
 *   viewport 중앙(그 이상 오른쪽/아래로 못 감 = 왼쪽/위쪽으로 빈 공간이
 *   절반 이상 보이지 않음), pan이 usable/2 - scaled면 이미지 끝 지점이
 *   정확히 viewport 중앙(그 이상 왼쪽/위로 못 감)이다.
 */
function clampPanAxis(pan: number, scaledSize: number, usableSize: number): number {
  if (scaledSize <= usableSize) {
    return (usableSize - scaledSize) / 2;
  }
  const min = usableSize / 2 - scaledSize;
  const max = usableSize / 2;
  return Math.min(max, Math.max(min, pan));
}

/**
 * pan을 가로/세로 두 축 모두 경계 안으로 clamp한다. wheel(Ctrl/Cmd 포함)·
 * Shift+Wheel·Space+drag·+/-버튼·배율 직접 입력 등 pan/zoom을 바꾸는 모든
 * 입력 경로가 이 함수를 거쳐야 한다 — 입력 방식과 무관하게 같은 경계
 * 규칙을 적용하기 위함이다.
 */
export function clampPan(pan: Point, canvas: Size, zoom: number, usable: Size): Point {
  return {
    x: clampPanAxis(pan.x, canvas.width * zoom, usable.width),
    y: clampPanAxis(pan.y, canvas.height * zoom, usable.height),
  };
}

/**
 * 캔버스가 화면보다 클 때 스크롤 표시 막대의 크기·위치(0~1 비율). 화면 안에 다 들어오면 null.
 * pan 범위는 clampPanAxis와 같다. 표시 전용이라 pan·zoom 계산에는 쓰지 않는다.
 */
export function computeScrollThumb(pan: number, scaledSize: number, usableSize: number): { start: number; size: number } | null {
  if (scaledSize <= usableSize || usableSize <= 0) return null;
  const size = Math.max(usableSize / scaledSize, 0.05);
  const max = usableSize / 2;
  const min = usableSize / 2 - scaledSize;
  const progress = Math.min(1, Math.max(0, (max - pan) / (max - min)));
  return { start: progress * (1 - size), size };
}

// ─────────────────────────────────────────────────────────────────
// 배율 직접 입력
// ─────────────────────────────────────────────────────────────────

/**
 * 사용자가 입력한 배율 문자열(예: "4", "4%", "125")을 유효한 zoom
 * 배수(1 = 100%)로 바꾼다.
 *
 * - 파싱된 값이 양수면 MIN_ZOOM~MAX_ZOOM으로 clamp한다 — 예를 들어
 *   "0.5"(0.5%)처럼 양수지만 MIN_ZOOM(1%) 미만이면 MIN_ZOOM으로 올림
 *   clamp된다.
 * - 0/음수/NaN/빈 문자열처럼 애초에 유효한 양수로 파싱되지 않으면 null을
 *   반환한다 — "입력이 잘못됐다"와 "입력은 유효하지만 범위 밖이다"는 서로
 *   다른 경우이기 때문이다. 호출부는 null을 받으면 zoom을 바꾸지 않고
 *   현재 유효한 zoom을 그대로 유지해야 한다(입력창 표시도 그 값으로
 *   되돌린다) — MIN_ZOOM으로 강제 이동시키지 않는다.
 */
export function parseZoomPercentInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/%\s*$/, '');
  const percent = Number(cleaned);
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return clampZoom(percent / 100);
}

// ─────────────────────────────────────────────────────────────────
// 선택 대상 최소 reveal(scrollIntoView 'nearest'에 가까운 동작)
// ─────────────────────────────────────────────────────────────────

/** reveal 후 대상과 usable 가장자리 사이에 남기는 여백(화면 px). 보이게만 하는 용도라 작게 둔다 */
export const REVEAL_MARGIN = 16;

/**
 * 한 축에서 대상이 이만큼(비율)까지 잘려 있으면 「현재 위치에서 식별·작업 가능」으로 보고 움직이지 않는다.
 * 기준 길이는 min(대상 크기, usable 크기) — viewport 보다 큰 대상은 화면을 얼마나 채우는지로 본다.
 */
export const REVEAL_CLIP_TOLERANCE_RATIO = 0.25;

/** 화면 좌표(usable 영역 기준, pan·zoom 적용 후) 한 축 구간 */
interface AxisSpan {
  start: number;
  end: number;
}

/**
 * 한 축의 최소 이동량. 0 이면 그 축은 움직이지 않는다.
 *
 * 1. 숨은 길이가 기준 길이의 REVEAL_CLIP_TOLERANCE_RATIO 이하 → 0(이미 보이거나 조금만 잘림)
 * 2. 대상이 margin 을 포함해 화면에 들어가는 크기 → 벗어난 쪽 가장자리만 margin 안쪽까지 이동
 * 3. 대상이 화면보다 큼 → 현재 위치에서 가까운 쪽 가장자리를 margin 위치에 맞춘다(전체를 가운데로 보내지 않는다)
 */
function computeRevealDeltaAxis(span: AxisSpan, usableSize: number, margin: number): number {
  const size = span.end - span.start;
  if (usableSize <= 0 || size <= 0) return 0;
  const visible = Math.max(0, Math.min(span.end, usableSize) - Math.max(span.start, 0));
  const reference = Math.min(size, usableSize);
  if (reference - visible <= reference * REVEAL_CLIP_TOLERANCE_RATIO) return 0;

  const lo = margin;
  const hi = usableSize - margin;
  if (size <= hi - lo) {
    if (span.start < lo) return lo - span.start;
    if (span.end > hi) return hi - span.end;
    return 0;
  }
  // 대상이 화면보다 크다 — 화면 안쪽으로 들어온 가장자리(또는 더 가까운 가장자리)를 margin 에 맞춘다
  const startGap = Math.abs(span.start - lo);
  const endGap = Math.abs(span.end - hi);
  return startGap <= endGap ? lo - span.start : hi - span.end;
}

/**
 * 선택 대상(canvas 좌표 rect)이 보이도록 하는 최소 pan. zoom 은 바꾸지 않는다.
 * 충분히 보이면 현재 pan 을 그대로(같은 객체) 돌려준다 — 호출부는 참조 비교로 이동 여부를 알 수 있다.
 * 결과는 호출부가 clampPan 으로 경계 안에 넣는다.
 */
export function computeMinimalRevealPan(
  pan: Point,
  zoom: number,
  target: { left: number; top: number; width: number; height: number },
  usable: Size,
  margin: number = REVEAL_MARGIN,
): Point {
  const left = pan.x + target.left * zoom;
  const top = pan.y + target.top * zoom;
  const dx = computeRevealDeltaAxis({ start: left, end: left + target.width * zoom }, usable.width, margin);
  const dy = computeRevealDeltaAxis({ start: top, end: top + target.height * zoom }, usable.height, margin);
  if (dx === 0 && dy === 0) return pan;
  return { x: pan.x + dx, y: pan.y + dy };
}
