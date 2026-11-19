/**
 * 최종 출력 이미지 좌표와 조판 평가 — 순수 계산(scripts/verify-n5-typeset-final-output.mjs 로 Node 에서 검증).
 *
 * 최종 출력은 include 섹션만 sectionOrder 순서로 이어 붙인 이미지다. N5 화면 스택과 다르므로
 * /preview 의 displayTop 을 여기 쓰지 않는다. FinalOutputOffset 을 별도 타입으로 둔 이유도 그것이다 —
 * 일반 number 인 displayTop·topOffset 을 그대로 넘기면 타입 오류가 난다.
 *
 * 최종 블록 Y = 섹션 로컬 Y + finalOutputOffset. 원본 topOffset 은 더하지 않는다.
 * 감지만 한다 — N5 확정 차단·N6 오류·자동 축소와 연결하지 않는다.
 */

import type { SectionBucket } from '../api/types';
import {
  type InkBounds,
  type OverflowSides,
  NO_OVERFLOW_SIDES,
  imageBoundaryViolation,
} from './typeset-rules.ts';

/** 섹션 원점이 최종 출력 이미지에서 놓이는 세로 위치(원본 px). displayTop·topOffset 과 다른 값이다 */
export type FinalOutputOffset = number & { readonly __brand: 'FinalOutputOffset' };

export interface FinalOutputSection {
  id: number;
  sectionOrder: number;
  /** 원본 px. 소수를 유지한다 */
  height: number;
  bucket: SectionBucket;
}

export interface FinalOutputLayout {
  /** include 섹션만 들어 있다. 제외 섹션은 최종 출력에 없으므로 key 가 없다 */
  offsets: ReadonlyMap<number, FinalOutputOffset>;
  /** include 섹션 높이 합 */
  totalHeight: number;
}

/**
 * sectionOrder 순서로 include 섹션 높이만 누적한다. 입력 배열 순서는 결과에 영향을 주지 않는다.
 * 잘못된 높이나 중복 id·sectionOrder 가 있으면 좌표를 추측하지 않고 던진다.
 */
export function buildFinalSectionOffsets(sections: readonly FinalOutputSection[]): FinalOutputLayout {
  const ids = new Set<number>();
  const orders = new Set<number>();
  for (const section of sections) {
    if (!Number.isFinite(section.height) || section.height < 0) {
      throw new RangeError(`최종 출력 계산: section ${section.id}의 height가 잘못됐습니다 (${section.height})`);
    }
    if (ids.has(section.id)) throw new RangeError(`최종 출력 계산: section id ${section.id}가 중복됩니다`);
    if (orders.has(section.sectionOrder)) throw new RangeError(`최종 출력 계산: sectionOrder ${section.sectionOrder}가 중복됩니다`);
    ids.add(section.id);
    orders.add(section.sectionOrder);
  }

  const offsets = new Map<number, FinalOutputOffset>();
  let cursor = 0;
  for (const section of [...sections].sort((a, b) => a.sectionOrder - b.sectionOrder)) {
    if (section.bucket !== 'include') continue;
    offsets.set(section.id, cursor as FinalOutputOffset);
    cursor += section.height;
  }
  return { offsets, totalHeight: cursor };
}

/** 최종 블록 Y = 섹션 로컬 Y + finalOutputOffset */
export function toFinalOutputY(sectionLocalY: number, offset: FinalOutputOffset): number {
  return sectionLocalY + offset;
}

export interface FinalOutputImageSize {
  width: number;
  height: number;
}

/** 섹션 로컬 ink 를 최종 이미지 좌표로 옮겨 기존 imageBoundaryViolation 으로 판정한다. 가로 위치는 좌측 정렬(0)이다 */
export function evaluateFinalImageBoundary(
  ink: InkBounds | null,
  offset: FinalOutputOffset,
  image: FinalOutputImageSize,
): OverflowSides & { inkInImage: InkBounds | null } {
  if (!ink) return { ...NO_OVERFLOW_SIDES, inkInImage: null };
  return imageBoundaryViolation(ink, { x: 0, y: offset }, image);
}

/** in-output: 최종 이미지에 그려짐 / section-excluded: 섹션 bucket 제외 / block-excluded: 블록 제외 */
export type FinalOutputState = 'in-output' | 'section-excluded' | 'block-excluded';

/** 블록 박스 넘침과 최종 이미지 이탈은 서로 독립인 판정이라 합치지 않는다 */
export interface TypesetEvaluation {
  blockOverflow: OverflowSides;
  imageBoundaryViolation: OverflowSides;
  finalOutputState: FinalOutputState;
  /** 최종 출력에 없으면 null */
  finalBlockY: number | null;
  inkInImage: InkBounds | null;
}

/** 측정 성공 결과와 최종 출력 배치를 묶어 평가한다. 최종 출력에 없는 블록은 이미지 이탈을 판정하지 않는다 */
export function evaluateTypesetBlock(
  measured: { bbox: { y: number }; ink: InkBounds | null; overflow: OverflowSides },
  block: { sectionId: number; excluded: boolean },
  layout: FinalOutputLayout,
  image: FinalOutputImageSize,
): TypesetEvaluation {
  const offset = layout.offsets.get(block.sectionId);
  const finalOutputState: FinalOutputState = offset === undefined ? 'section-excluded' : block.excluded ? 'block-excluded' : 'in-output';
  if (offset === undefined || finalOutputState !== 'in-output') {
    return { blockOverflow: measured.overflow, imageBoundaryViolation: NO_OVERFLOW_SIDES, finalOutputState, finalBlockY: null, inkInImage: null };
  }
  const { inkInImage, ...sides } = evaluateFinalImageBoundary(measured.ink, offset, image);
  return {
    blockOverflow: measured.overflow,
    imageBoundaryViolation: sides,
    finalOutputState,
    finalBlockY: toFinalOutputY(measured.bbox.y, offset),
    inkInImage,
  };
}
