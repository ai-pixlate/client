/**
 * N3 — SourceImage.fileUrl 전체 원본을 Section.bbox 기준으로 crop해 썸네일을
 * 만드는 순수 계산 함수. 별도 thumbnail API가 없어(3단계 데이터 가정) FE가
 * 직접 crop한다.
 *
 * 결과를 전부 퍼센트(wrapper 자신의 크기 기준)로 반환한다 — 절대 px을 JS에서
 * 미리 계산해 박아 넣지 않는다. 그래야 wrapper의 실제 CSS width가 고정 px든
 * clamp()든(반응형 사이드바 등) 이 컴포넌트가 다시 계산할 필요 없이 브라우저가
 * 알아서 맞춰 그린다.
 *
 * object-cover/stretch로 대충 자르지 않는다 — bbox 비율을 그대로 유지한 채
 * "clip wrapper(overflow:hidden, aspect-ratio=bbox 비율) + 그 안에서 확대·
 * 이동된 원본 이미지(퍼센트 위치)" 방식으로 정확한 영역만 보이게 한다.
 */
import type { ApiBbox } from '@/lib/api/n3-schema';

export interface CropResult {
  /** wrapper에 그대로 넣는 CSS aspect-ratio 값 (`"w / h"`) */
  aspectRatio: string;
  /** wrapper 너비/높이 대비 원본 이미지의 렌더 크기·위치 (%) */
  imgWidthPercent: number;
  imgHeightPercent: number;
  imgLeftPercent: number;
  imgTopPercent: number;
}

/**
 * bbox가 null이거나 x/y/w/h 중 하나라도 없으면(계약상 전부 optional) null을
 * 반환한다 — 임의 aspect ratio를 지어내 채우지 않는다. 호출부가 null을 받아
 * placeholder를 보여줄지 결정한다.
 */
export function computeCrop({
  bbox,
  sourceWidth,
  sourceHeight,
}: {
  bbox: ApiBbox | null | undefined;
  sourceWidth: number | undefined;
  sourceHeight: number | undefined;
}): CropResult | null {
  if (!bbox) return null;
  const { x, y, w, h } = bbox;
  if (x == null || y == null || w == null || h == null) return null;
  if (!sourceWidth || !sourceHeight || w <= 0 || h <= 0) return null;

  return {
    aspectRatio: `${w} / ${h}`,
    imgWidthPercent: (sourceWidth / w) * 100,
    imgHeightPercent: (sourceHeight / h) * 100,
    imgLeftPercent: -(x / w) * 100,
    imgTopPercent: -(y / h) * 100,
  };
}
