/**
 * N5 검수 좌측 뷰어 좌표 계산 — Pix/ate FE↔BE 구현 기준 v3.3.3.
 *
 * React 도 브라우저 API 도 쓰지 않는 순수 함수만 모아둔다. 그래서 Node에서
 * 화면 없이 바로 검증할 수 있고(scripts/verify-n5-coordinates.mjs), block
 * overlay UI·좌↔우 selection 등 이후 구현에서 그대로 재사용할 수 있다.
 *
 * 좌표계 확정 사항 (더 이상 팀에 재확인하지 않는다):
 * - text_block.bbox            : 소속 section 내부 local 좌표
 * - 원본 절대 Y                 : section.top_offset + block.bbox.y (DB 전용, API DTO에는 없음)
 * - N5 표시 Y                  : section.displayTop + block.bbox.y
 * - section.displayTop         : ReviewPreview 응답값 (API 계산값, DB 저장값 아님)
 *                                 include section만 누적하고 exclude section은 건너뛴다
 * - preview scale               : scaleX = previewWidth / originalWidth
 *                                 scaleY = previewHeight / originalHeight
 *
 * top_offset은 N5 표시 위치 계산(displayTop)에는 쓰지 않지만, ReviewSection.topOffset
 * 으로 API가 그대로 내려준다 — Before/After 두 레이어를 section 단위로 잘라 이어붙일 때
 * "이 section이 원본 이미지의 어느 지점을 보여줘야 하는가"는 이 값을 쓴다 (section
 * height를 누적해서 추정하지 않는다 — section이 이미지를 빈틈없이 나눈다는 보장이
 * 계약에 없으므로, 그 추정은 삭제했다. topOffset과 displayTop은 절대 섞어 쓰지 않는다.)
 */

import type { BoundingBox, SectionBucket, TextBlock } from '@/lib/api/types';

/* ------------------------------------------------------------------ *
 * 1. preview scale
 * ------------------------------------------------------------------ */

export interface PreviewScale {
  scaleX: number;
  scaleY: number;
}

export interface ReviewPreviewLike {
  originalWidth: number;
  originalHeight: number;
  previewWidth: number;
  previewHeight: number;
}

/**
 * previewWidth/originalWidth, previewHeight/originalHeight를 각각 구한다.
 * 두 축을 하나의 배율로 합치지 않는다 — 원본이 리사이즈 과정에서 비율이
 * 틀어졌을 수 있으므로(F-CRP-01a와 동일한 이유) 항상 축별로 따로 쓴다.
 */
export function getPreviewScale(preview: ReviewPreviewLike): PreviewScale {
  if (!isValidDimension(preview.originalWidth) || !isValidDimension(preview.originalHeight)) {
    throw new Error(
      `originalWidth/originalHeight가 올바르지 않습니다: ${preview.originalWidth}x${preview.originalHeight}`,
    );
  }
  return {
    scaleX: preview.previewWidth / preview.originalWidth,
    scaleY: preview.previewHeight / preview.originalHeight,
  };
}

function isValidDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/* ------------------------------------------------------------------ *
 * 2. section displayTop 누적
 * ------------------------------------------------------------------ */

export interface SectionHeightLike {
  bucket: SectionBucket;
  height: number;
}

/**
 * 같은 sourceImage에 속한 section 목록(화면에 나타나는 순서)을 받아
 * 각 section의 displayTop을 계산한다.
 *
 * include section만 누적하고, exclude section(N3/N5 어느 단계든 무관)은
 * 누적하지 않는다 — 즉 exclude section의 displayTop은 직전까지 누적된
 * 값 그대로이고, 다음 section은 그 자리에서 이어서 시작한다.
 *
 * 반환 배열의 인덱스는 입력 배열의 인덱스와 1:1로 대응한다.
 */
export function computeSectionDisplayTops<T extends SectionHeightLike>(sections: T[]): number[] {
  let cursor = 0;
  return sections.map((section) => {
    const displayTop = cursor;
    if (section.bucket === 'include') {
      cursor += section.height;
    }
    return displayTop;
  });
}

/* ------------------------------------------------------------------ *
 * 3. block bbox -> 화면 표시 좌표
 * ------------------------------------------------------------------ */

export interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * section-local block bbox를 N5 좌측 뷰어의 표시 좌표로 변환한다.
 *
 *   displayX = bbox.x * scaleX
 *   displayY = (displayTop + bbox.y) * scaleY
 *   displayWidth  = bbox.width  * scaleX
 *   displayHeight = bbox.height * scaleY
 */
export function getBlockDisplayRect(
  bbox: BoundingBox,
  displayTop: number,
  scale: PreviewScale,
): DisplayRect {
  return {
    left: bbox.x * scale.scaleX,
    top: (displayTop + bbox.y) * scale.scaleY,
    width: bbox.width * scale.scaleX,
    height: bbox.height * scale.scaleY,
  };
}

/** TextBlock 전체를 받는 편의 함수. 내부적으로 getBlockDisplayRect를 그대로 쓴다. */
export function getTextBlockDisplayRect(
  block: Pick<TextBlock, 'bbox'>,
  displayTop: number,
  scale: PreviewScale,
): DisplayRect {
  return getBlockDisplayRect(block.bbox, displayTop, scale);
}
