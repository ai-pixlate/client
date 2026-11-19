/**
 * 선택 block과 겹치는 block 계산(진단 전용) — 순수 함수(scripts/verify-n5-review-issues.mjs).
 * 좌표는 모두 section-local 원본 px다. 실제 선택·hit testing에는 쓰지 않는다.
 */

import type { BoundingBox } from '../api/types';

export interface BlockOverlap {
  blockId: number;
  box: BoundingBox;
  intersection: BoundingBox;
}

export function getBoxIntersection(a: BoundingBox, b: BoundingBox): BoundingBox | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (!(right > left) || !(bottom > top)) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function computeBlockOverlaps(
  selected: { id: number; bbox: BoundingBox },
  others: readonly { id: number; bbox: BoundingBox | null }[],
): BlockOverlap[] {
  return others.flatMap((other) => {
    if (other.id === selected.id || !other.bbox) return [];
    const intersection = getBoxIntersection(selected.bbox, other.bbox);
    return intersection ? [{ blockId: other.id, box: other.bbox, intersection }] : [];
  });
}
