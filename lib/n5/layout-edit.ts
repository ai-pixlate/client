/**
 * N5 배치 영역 편집(F-CFM-15) — 순수 계산. Figma·API와 무관한 FE 내부 계산이다.
 *
 * React 도 브라우저 API 도 쓰지 않는다(scripts/verify-n5-layout-edit.mjs 로 Node 에서 검증).
 *
 * 좌표: 모두 섹션 로컬 원본 px(화면 배율·zoom 이전). 소수는 반올림하지 않는다 —
 * 저장 정밀도는 BE 계약(Q-06)이 정해지면 저장 단계에서 맞춘다.
 *
 * PM 확정(10/29): 섹션 경계만 강제 제한한다. 다른 블록과 겹치는 것은 허용 —
 * 충돌 계산·자동 회피를 하지 않는다. 제품 최소 크기는 없고 0 이하 크기만 막는다.
 * 가운데선 snap 은 섹션 세로·가로 중앙선만 대상이다(다른 블록·가장자리·슬롯 snap 없음).
 *
 * 아직 값이 확정되지 않은 것은 인자로 받는다: [+][-] 한 번의 배율 변화량(step),
 * snap 판정 거리(tolerance). 상수로 박지 않는다.
 */

import type { BoundingBox } from '../api/types';
import type { Point, Size } from './viewport';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 위치만 섹션 안으로 끌어온다(크기는 그대로). 섹션보다 큰 박스(경계를 넘는 기존 데이터)는
 * 왼쪽·위 경계에 붙인다 — 크기를 임의로 줄이지 않는다.
 */
export function clampBoxToSection(box: BoundingBox, section: Size): BoundingBox {
  return {
    ...box,
    x: clamp(box.x, 0, Math.max(0, section.width - box.width)),
    y: clamp(box.y, 0, Math.max(0, section.height - box.height)),
  };
}

/** 끌어 옮기기 — 새 위치를 섹션 안으로 제한한다. 크기는 바꾸지 않는다. */
export function moveBoxWithinSection(box: BoundingBox, next: Point, section: Size): BoundingBox {
  return clampBoxToSection({ ...box, x: next.x, y: next.y }, section);
}

/** 8방향 손잡이. 손잡이가 붙은 변만 움직이고 반대 변은 고정한다. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * 손잡이 끌기 — 끌기 시작 박스(start)와 시작점부터의 누적 이동량(delta)으로 새 박스를 만든다.
 * 움직이는 변은 섹션 경계 안으로 제한한다. 결과 폭·높이가 0 이하가 되면(반대 변을 넘거나 붙음)
 * null — 제품 최소 크기를 만들지 않으므로, 호출부는 직전의 유효한 박스를 유지한다.
 */
export function resizeBoxWithinSection(
  start: BoundingBox,
  handle: ResizeHandle,
  delta: Point,
  section: Size,
): BoundingBox | null {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = clamp(left + delta.x, 0, section.width);
  if (handle.includes('e')) right = clamp(right + delta.x, 0, section.width);
  if (handle.includes('n')) top = clamp(top + delta.y, 0, section.height);
  if (handle.includes('s')) bottom = clamp(bottom + delta.y, 0, section.height);
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0) || !(height > 0)) return null;
  return { x: left, y: top, width, height };
}

/** 적용 글자 크기 = 기준 크기 × 사용자 배율. 현재 크기에 누적해서 곱하지 않는다. */
export function effectiveFontSize(baseFontSize: number, userScale: number): number {
  return baseFontSize * userScale;
}

/**
 * [+][-] 한 번의 다음 배율. step 을 더하거나 빼고, 덧셈 오차(0.1+0.2 류)만 지운다 —
 * 특정 단위(예: 0.05)의 격자로 맞추지 않는다(step 은 아직 PM 확인 전 값이다).
 */
export function nextUserScale(currentScale: number, step: number, direction: 'increase' | 'decrease'): number {
  const raw = direction === 'increase' ? currentScale + step : currentScale - step;
  return Math.round(raw * 1e9) / 1e9;
}

/**
 * [+][-] — 박스와 글자 배율을 같은 비율(nextScale / currentScale)로 바꾼다.
 * 현재 박스 중심을 유지하고, 섹션 경계를 넘으면 크기는 그대로 둔 채 안쪽으로 밀어 넣는다.
 * 새 크기가 섹션보다 크거나(같으면 허용) 0 이하이면 null — 그 조작은 할 수 없다.
 */
export function scaleBoxAndFont({
  box,
  currentScale,
  nextScale,
  section,
}: {
  box: BoundingBox;
  currentScale: number;
  nextScale: number;
  section: Size;
}): BoundingBox | null {
  if (!(currentScale > 0) || !(nextScale > 0)) return null;
  const ratio = nextScale / currentScale;
  const width = box.width * ratio;
  const height = box.height * ratio;
  if (!(width > 0) || !(height > 0)) return null;
  if (width > section.width || height > section.height) return null;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    x: clamp(cx - width / 2, 0, section.width - width),
    y: clamp(cy - height / 2, 0, section.height - height),
    width,
    height,
  };
}

interface ScaleStepInput {
  box: BoundingBox;
  currentScale: number;
  step: number;
  section: Size;
}

/** [+] 가능 여부 — 확대 후보가 섹션 폭·높이를 넘으면 false. 다른 블록과의 겹침은 보지 않는다. */
export function canIncreaseScale({ box, currentScale, step, section }: ScaleStepInput): boolean {
  const nextScale = nextUserScale(currentScale, step, 'increase');
  return scaleBoxAndFont({ box, currentScale, nextScale, section }) !== null;
}

/** [-] 가능 여부 — 기술 조건(배율·폭·높이 > 0)만 본다. 제품 최소 크기는 없다. */
export function canDecreaseScale({ box, currentScale, step, section }: ScaleStepInput): boolean {
  const nextScale = nextUserScale(currentScale, step, 'decrease');
  return scaleBoxAndFont({ box, currentScale, nextScale, section }) !== null;
}

/**
 * 가운데선 snap — 박스 중심이 섹션 세로·가로 중앙선에서 tolerance 이내면 중앙에 맞춘다.
 * tolerance 는 box·section 과 같은 좌표계 값을 받는다(원본 px 인지 화면 px 인지는 호출부가 환산 — 아직 미정).
 * snappedX/snappedY 는 UI 가 중앙선 guide 를 그릴 때 쓴다.
 */
export function snapBoxToSectionCenter(
  box: BoundingBox,
  section: Size,
  tolerance: number,
): { box: BoundingBox; snappedX: boolean; snappedY: boolean } {
  const centerX = section.width / 2;
  const centerY = section.height / 2;
  // 섹션보다 큰 축은 중앙에 맞추면 경계 밖으로 나가므로 맞추지 않는다
  const snappedX =
    tolerance >= 0 && box.width <= section.width && Math.abs(box.x + box.width / 2 - centerX) <= tolerance;
  const snappedY =
    tolerance >= 0 && box.height <= section.height && Math.abs(box.y + box.height / 2 - centerY) <= tolerance;
  return {
    box: {
      ...box,
      x: snappedX ? centerX - box.width / 2 : box.x,
      y: snappedY ? centerY - box.height / 2 : box.y,
    },
    snappedX,
    snappedY,
  };
}
