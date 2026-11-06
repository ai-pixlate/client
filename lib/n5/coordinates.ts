/**
 * N5 검수 좌측 뷰어 좌표 계산 — pix/ate FE↔BE 구현 기준 v3.3.3.
 *
 * React 도 브라우저 API 도 쓰지 않는 순수 함수만 모아둔다. 그래서 Node에서
 * 화면 없이 바로 검증할 수 있고(scripts/verify-n5-coordinates.mjs), block
 * overlay UI·좌↔우 selection 등 이후 구현에서 그대로 재사용할 수 있다.
 *
 * 좌표계 확정 사항 (더 이상 팀에 재확인하지 않는다):
 * - text_block.bbox            : 소속 section 내부 local 좌표
 * - 원본 절대 Y                 : section.top_offset + block.bbox.y (DB 전용, API DTO에는 없음)
 * - N5 표시 Y                  : section.displayTop + block.bbox.y
 * - section.displayTop         : /preview 응답값 (API 계산값, DB 저장값 아님)
 *                                 include section만 누적하고 exclude section은 건너뛴다
 *
 * scale은 두 갈래로 쓰인다 — 혼동하지 않는다:
 * - getPreviewScale/PreviewScale : /review의 ReviewPreview(originalWidth/Height,
 *   previewWidth/Height) 원시 크기 쌍으로부터 축별 비율(scaleX/scaleY)을 구하는
 *   범용 유틸이다. FE 런타임이 아니라 mock 서버 응답 생성(lib/mock-api/fixtures.ts)에서만
 *   쓰인다.
 * - getBlockDisplayRect의 scale : /preview(API-CFM-03) 계약의 단일 숫자 scale이다
 *   (v3.4.1 백엔드 최종 확정 — scaleX/scaleY 두 축이 아니다). PreviewSourceImage.scale을
 *   그대로 받아 쓴다.
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
 * section-local block bbox를 N5 좌측 뷰어(/preview, API-CFM-03)의 표시
 * 좌표로 변환한다. v3.4.1 백엔드 최종 확정 — scaleX/scaleY 두 축이 아니라
 * 가로/세로에 동일하게 적용되는 단일 scale 하나를 쓴다.
 *
 * displayTop은 원본 해상도 좌표이므로, bbox.y와 먼저 더한 뒤에 scale을
 * 적용한다(스케일을 먼저 걸고 더하지 않는다) — top만 이 순서이고 나머지
 * (left/width/height)는 원본 값에 scale만 곱하면 된다.
 *
 *   previewX = bbox.x * scale
 *   previewY = (displayTop + bbox.y) * scale
 *   previewW = bbox.width  * scale
 *   previewH = bbox.height * scale
 */
export function getBlockDisplayRect(
  bbox: BoundingBox,
  displayTop: number,
  scale: number,
): DisplayRect {
  return {
    left: bbox.x * scale,
    top: (displayTop + bbox.y) * scale,
    width: bbox.width * scale,
    height: bbox.height * scale,
  };
}

/** TextBlock 전체를 받는 편의 함수. 내부적으로 getBlockDisplayRect를 그대로 쓴다. */
export function getTextBlockDisplayRect(
  block: Pick<TextBlock, 'bbox'>,
  displayTop: number,
  scale: number,
): DisplayRect {
  return getBlockDisplayRect(block.bbox, displayTop, scale);
}

/* ------------------------------------------------------------------ *
 * 4. block 클릭 영역(hit rect)
 * ------------------------------------------------------------------ */

/**
 * 화면에 보이는 block 영역(visual rect = getBlockDisplayRect 결과)은 그대로 두고, 클릭을
 * 받는 영역만 넓힌다. bbox 데이터와 선택 테두리 크기는 바꾸지 않는다.
 *
 * paddingPx/minSizePx 는 화면 px 기준이다. canvas 는 CSS transform scale(zoom)로 그려지므로
 * canvas 좌표로 바꿀 때 zoom 으로 나눈다 — 축소해서 봐도 손으로 누르는 크기는 같다.
 * 결과는 소속 section(bounds) 안으로 자른다. 옆 section 의 클릭을 가로채지 않게 하기 위해서다.
 */
export interface BlockHitRectOptions {
  paddingPx: number;
  minSizePx: number;
  zoom: number;
  bounds: { width: number; height: number };
}

export function getBlockHitRect(visual: DisplayRect, options: BlockHitRectOptions): DisplayRect {
  const zoom = Number.isFinite(options.zoom) && options.zoom > 0 ? options.zoom : 1;
  const padding = options.paddingPx / zoom;
  const minSize = options.minSizePx / zoom;

  const width = Math.max(visual.width + padding * 2, minSize);
  const height = Math.max(visual.height + padding * 2, minSize);
  const centerX = visual.left + visual.width / 2;
  const centerY = visual.top + visual.height / 2;

  const left = Math.max(0, centerX - width / 2);
  const top = Math.max(0, centerY - height / 2);
  const right = Math.min(options.bounds.width, centerX + width / 2);
  const bottom = Math.min(options.bounds.height, centerY + height / 2);

  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * 화면 px 이동량 → section-local 원본 px 이동량(getBlockDisplayRect의 역방향). pan·section 위치는
 * 이동량에 영향을 주지 않아 배율(preview scale × 사용자 zoom)만 나눈다.
 */
export function screenDeltaToBboxDelta(
  delta: { x: number; y: number },
  scale: number,
  zoom: number,
): { x: number; y: number } {
  return { x: delta.x / (scale * zoom), y: delta.y / (scale * zoom) };
}

/* ------------------------------------------------------------------ *
 * 선택 block 글자크기 툴바 위치 (Figma 1512:23496)
 * ------------------------------------------------------------------ */

/**
 * 글자크기 툴바의 가로 위치. 항상 block 오른쪽에 붙이고 section 경계는 보지 않는다(툴바는 이미지가 아닌 편집 UI다).
 * workspace 오른쪽 끝을 넘을 때만 왼쪽으로 필요한 만큼 민다. 위치를 뒤집지 않는다.
 * block이 workspace 밖으로 완전히 나가면 민 위치에 남지 않고 block과 함께 움직인다.
 * 모든 값은 같은 화면 px 좌표계다.
 */
export function getFontScaleToolbarLeft(options: {
  blockLeft: number;
  blockRight: number;
  toolbarWidth: number;
  /** block 오른쪽 변에서 툴바까지의 거리 */
  gap: number;
  /** 툴바 오른쪽 끝이 넘지 않아야 할 위치 */
  maxRight: number;
}): number {
  const { blockLeft, blockRight, toolbarWidth, gap, maxRight } = options;
  return Math.min(blockRight + gap, Math.max(maxRight, blockLeft) - toolbarWidth);
}

/** 글자크기 action handle 중심 — block 오른쪽 변, 위에서 18(화면 px, Figma 1512:23496). block 높이와 무관하다 */
export const FONT_HANDLE_CENTER_TOP_PX = 18;
/** 평소 누르는 영역 절반: 손잡이 약 7(테두리 안쪽 기준 inset 4), action handle 8 */
const RESIZE_HANDLE_HIT_HALF_PX = 7;
const FONT_HANDLE_HIT_HALF_PX = 8;

/**
 * 오른쪽 변 손잡이(e·se)의 누르는 영역이 action handle과 겹치는지. 겹치면 위치는 그대로 두고 누르는 영역만 나눈다 —
 * action handle은 보이는 12px만 받고, 손잡이는 영역을 좌우로 넓혀 action handle 양옆에서 잡히게 한다.
 * @param handleCenterTop block 위에서 손잡이 중심까지(화면 px)
 */
export function overlapsFontHandleHitArea(handleCenterTop: number): boolean {
  return Math.abs(handleCenterTop - FONT_HANDLE_CENTER_TOP_PX) < RESIZE_HANDLE_HIT_HALF_PX + FONT_HANDLE_HIT_HALF_PX;
}

/**
 * 이보다 낮게 보이는(화면 px = preview scale × zoom 적용 후) Auto Height block은 compact resize를 쓴다. 오른쪽 손잡이(ne·e·se)와
 * 글자크기 손잡이가 몰려 정확한 점을 찾아 눌러야 하는 높이다. 위치는 Figma 그대로 두고 누르는 방식만 바꾼다 —
 * 오른쪽 변 전체가 가로 resize 하나를 받고, 글자크기 손잡이는 보이는 12px만 받는다. Figma에 낮은 block 표본이 없어 정한 UX 값이다.
 */
export const COMPACT_RESIZE_HEIGHT_PX = 48;
/** 48로 계산된 값이 부동소수 오차로 47.9999…가 되어 경계에서 모드가 흔들리지 않게 하는 여유 */
const COMPACT_RESIZE_EPSILON_PX = 0.001;

/** @param displayHeight 사용자가 보는 block 높이(화면 px) */
export function isCompactResizeHeight(displayHeight: number): boolean {
  return displayHeight < COMPACT_RESIZE_HEIGHT_PX - COMPACT_RESIZE_EPSILON_PX;
}

/**
 * compact 오른쪽 resize 영역의 절반 폭(화면 px). 보이지 않는 영역이며 block 테두리가 시각 기준이다. 위·아래로도 같은 만큼 넓혀
 * 평소 ne·se 손잡이가 받던 자리까지 덮는다.
 */
export const COMPACT_RIGHT_RESIZE_HALF_PX = 8;

/** compact 오른쪽 resize 영역 — canvas 좌표(zoom 전). 화면 크기는 zoom과 무관하게 같다 */
export function getCompactRightResizeZone(rect: DisplayRect, zoom: number): DisplayRect {
  const half = COMPACT_RIGHT_RESIZE_HALF_PX / zoom;
  return { left: rect.left + rect.width - half, top: rect.top - half, width: half * 2, height: rect.height + half * 2 };
}
