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
 * 계산 함수는 [+][-] 한 번의 배율 변화량(step)과 snap 판정 거리(tolerance)를 인자로 받는다.
 * N5 제품에서 쓸 step 은 아래 N5_FONT_SCALE_STEP 하나로만 관리한다(화면마다 0.05 를 적지 않는다).
 * snap 거리는 PRD에 숫자가 없어 FE 구현값(N5_SNAP_ACQUIRE_SCREEN_PX · N5_SNAP_RELEASE_SCREEN_PX)으로 한 곳에서 관리한다.
 */

import type { BoundingBox } from '../api/types';
import type { Point, Size } from './viewport';

/**
 * [+][-] 한 번의 사용자 글자 배율 변화량 — PM 확정(10/29): 1.00 → 1.05 → 1.10 처럼 0.05 씩 더하고 뺀다.
 * API 계약 값이 아니라 FE 제품 동작 상수다. 박스는 같은 비율(nextScale / currentScale)로 바뀌고
 * 중심을 유지하며, 섹션을 넘으면 크기는 그대로 안쪽으로 민다(scaleBoxAndFont).
 */
export const N5_FONT_SCALE_STEP = 0.05;

/**
 * 가운데선 snap 거리(화면 CSS px). PRD 정책값이 아니라 FE 조작감 구현값이다 — 중심이 ACQUIRE 안에 들어오면 붙고,
 * 붙은 뒤에는 RELEASE를 넘어야 떨어진다. zoom과 무관하게 체감 거리가 같도록 호출부가 원본 px로 환산해 넘긴다.
 * 조정이 필요하면 이 두 값만 바꾼다.
 */
export const N5_SNAP_ACQUIRE_SCREEN_PX = 12;
export const N5_SNAP_RELEASE_SCREEN_PX = 20;

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
 * 특정 단위의 격자로 반올림하지 않는다. 제품에서는 step 에 N5_FONT_SCALE_STEP 을 넘긴다.
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

/** [+][-] 한 번의 결과이자 실행 취소 값. FE 내부 값이며 API DTO 가 아니다 */
export interface N5FontScaleValue {
  bbox: BoundingBox;
  fontScale: number;
}

/**
 * [+][-] 한 번 — 다음 배율과 그에 맞춘 박스를 함께 계산한다. 할 수 없는 조작이면 null.
 * 제품에서 쓰는 step 은 N5_FONT_SCALE_STEP 하나다.
 */
export function stepFontScale(
  { bbox, fontScale }: N5FontScaleValue,
  direction: 'increase' | 'decrease',
  section: Size,
): N5FontScaleValue | null {
  const nextScale = nextUserScale(fontScale, N5_FONT_SCALE_STEP, direction);
  const nextBox = scaleBoxAndFont({ box: bbox, currentScale: fontScale, nextScale, section });
  return nextBox ? { bbox: nextBox, fontScale: nextScale } : null;
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
 * tolerance 는 box·section 과 같은 좌표계 값을 받는다(화면 px → 원본 px 환산은 호출부가 한다).
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

export interface CenterSnapLock {
  snappedX: boolean;
  snappedY: boolean;
  /** false면 이 축은 아직 acquire 구간을 벗어난 적이 없어 붙지 않는다(없으면 true로 본다) */
  armedX?: boolean;
  armedY?: boolean;
}

export const NO_CENTER_SNAP: CenterSnapLock = { snappedX: false, snappedY: false };

/**
 * 끌기 시작 상태. 이미 acquire 구간 안에서 시작한 축은 그 구간을 한 번 벗어난 뒤에야 붙는다 — 그러지 않으면 폭이 넓은 박스는
 * 첫 이동부터 중앙에 묶여 옆으로 움직이지 않고, 붙는 순간의 변화도 보이지 않는다.
 */
export function startCenterSnapLock(box: BoundingBox, section: Size, acquire: number): CenterSnapLock {
  return {
    snappedX: false,
    snappedY: false,
    armedX: Math.abs(box.x + box.width / 2 - section.width / 2) > acquire,
    armedY: Math.abs(box.y + box.height / 2 - section.height / 2) > acquire,
  };
}

/**
 * 끌기 중 가운데선 snap — 축마다 따로 판단한다. 지금 붙어 있지 않은 축은 acquire 거리, 붙어 있는 축은 release 거리로
 * snapBoxToSectionCenter 를 부른다. 한 축이 풀려도 다른 축은 유지된다.
 */
export function applyCenterSnapWithHysteresis(
  box: BoundingBox,
  section: Size,
  distance: { acquire: number; release: number },
  lock: CenterSnapLock,
): { box: BoundingBox; snappedX: boolean; snappedY: boolean } {
  // 음수 거리면 snapBoxToSectionCenter 가 붙이지 않는다
  const axis = (snapped: boolean, armed: boolean | undefined) => (snapped ? distance.release : armed === false ? -1 : distance.acquire);
  const x = snapBoxToSectionCenter(box, section, axis(lock.snappedX, lock.armedX));
  const y = snapBoxToSectionCenter(box, section, axis(lock.snappedY, lock.armedY));
  return { box: { ...box, x: x.box.x, y: y.box.y }, snappedX: x.snappedX, snappedY: y.snappedY };
}

/**
 * 본체 끌어 옮기기 한 번의 결과 — 커서 기준 후보 위치를 섹션 안으로 제한한 뒤 가운데선 snap. 크기는 바꾸지 않는다
 * (F-CFM-15). 후보는 항상 시작 위치+커서 이동량이라, 붙어 있는 동안에도 커서가 멀어지면 release 로 풀린다.
 *
 * 빠르게 끌면 pointermove 사이에 acquire 구간을 통째로 건너뛸 수 있다. 직전 후보(previous)와 지금 후보가 중앙선의 반대쪽이면
 * 선을 지난 것이므로 붙어 있는 축처럼 release 거리로 판단한다.
 */
export function moveBoxWithCenterSnap(
  start: BoundingBox,
  delta: Point,
  section: Size,
  distance: { acquire: number; release: number },
  lock: CenterSnapLock,
  previous: BoundingBox | null = null,
): { box: BoundingBox; candidate: BoundingBox; snappedX: boolean; snappedY: boolean; armedX: boolean; armedY: boolean } {
  const candidate = moveBoxWithinSection(start, { x: start.x + delta.x, y: start.y + delta.y }, section);
  const crossed = (from: number, to: number, line: number) => (from - line) * (to - line) < 0;
  // section 끝에 닿은 축은 유지하지 않는다 — 폭이 넓은 박스는 움직일 수 있는 범위 전체가 release 안이라 빠져나오지 못한다
  const holds = (locked: boolean, from: number | null, to: number, line: number, atEdge: boolean) =>
    !atEdge && (locked || (from != null && crossed(from, to, line)));
  const armedX = lock.armedX !== false || Math.abs(candidate.x + candidate.width / 2 - section.width / 2) > distance.acquire;
  const armedY = lock.armedY !== false || Math.abs(candidate.y + candidate.height / 2 - section.height / 2) > distance.acquire;
  const effectiveLock = {
    armedX,
    armedY,
    snappedX: armedX && holds(
      lock.snappedX,
      previous ? previous.x + previous.width / 2 : null,
      candidate.x + candidate.width / 2,
      section.width / 2,
      candidate.x <= 0 || candidate.x + candidate.width >= section.width,
    ),
    snappedY: armedY && holds(
      lock.snappedY,
      previous ? previous.y + previous.height / 2 : null,
      candidate.y + candidate.height / 2,
      section.height / 2,
      candidate.y <= 0 || candidate.y + candidate.height >= section.height,
    ),
  };
  return { ...applyCenterSnapWithHysteresis(candidate, section, distance, effectiveLock), candidate, armedX, armedY };
}

/**
 * block 별 local 초안에서 더 이상 없는 block 항목을 지운다. 지울 것이 없으면 같은 Map 을 돌려준다 —
 * 재조회만으로는 초안을 지우지 않고, 서버에서 block·section 이 사라졌을 때만 정리한다.
 */
export function pruneBlockDrafts<TValue>(
  drafts: ReadonlyMap<number, TValue>,
  validBlockIds: ReadonlySet<number>,
): ReadonlyMap<number, TValue> {
  const stale = [...drafts.keys()].filter((blockId) => !validBlockIds.has(blockId));
  if (stale.length === 0) return drafts;
  const next = new Map(drafts);
  for (const blockId of stale) next.delete(blockId);
  return next;
}

/** 위치·크기가 같은 박스인지 — 값이 그대로면 실행 취소 단계를 만들지 않는다 */
export function isSameBox(a: BoundingBox, b: BoundingBox): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
