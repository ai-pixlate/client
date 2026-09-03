/**
 * 좌표계 변환 - 이 스파이크의 핵심.
 *
 * 이 파일에는 React 도 브라우저 API 도 들어있지 않습니다. 순수한 계산만 있습니다.
 * 그래서 화면 없이도 검증할 수 있고 (scripts/verify-coordinates.mjs),
 * 나중에 S2 실제 구현에서 그대로 재사용할 수 있습니다.
 *
 * 규약 문서: docs/fe-spike-01/COORDINATE_CONVENTION_DRAFT.md
 * 근거: F-CRP-01a, pixate-frontend-data-spec.md 0-1
 */

/* ------------------------------------------------------------------ *
 * 1. 좌표계 타입 - 필드 이름만 봐도 어느 좌표계인지 알 수 있게 한다
 * ------------------------------------------------------------------ */

/**
 * source 좌표 - 업로드한 원본 이미지의 픽셀 좌표.
 * 원점은 원본 이미지의 좌상단. 단위는 원본 픽셀.
 *
 * ★ 이것이 canonical 값이다. 서버에 저장하는 것도, state 에 담는 것도 이것뿐이다.
 */
export type SourceRect = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

/**
 * piece 좌표 - 크롭된 조각 내부 좌표. 원점은 조각의 좌상단.
 *
 * Spike① 에서는 사용하지 않는다. OCR 결과(F-INP-02)가 이 좌표계로 오므로
 * 규약만 미리 고정해 둔다.
 */
export type PieceRect = {
  pieceX: number;
  pieceY: number;
  pieceWidth: number;
  pieceHeight: number;
};

/**
 * module 좌표 - 모듈 캔버스(Amazon Basic A+ 970x300) 기준 좌표.
 * 원점은 모듈의 좌상단.
 *
 * Spike① 에서는 사용하지 않는다. Spike② 캔버스에서 쓴다. (F-INP-02c)
 */
export type ModuleRect = {
  moduleX: number;
  moduleY: number;
  moduleWidth: number;
  moduleHeight: number;
};

/** 화면에 그릴 때만 잠깐 쓰는 값. 절대 저장하지 않는다. */
export type DisplayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** 마우스 위치처럼 화면 기준 한 점. 저장하지 않는다. */
export type DisplayPoint = {
  displayX: number;
  displayY: number;
};

/** 크롭 조각 하나. Spike 범위에서 필요한 최소 필드만 둔다. */
export type Crop = SourceRect & {
  id: string;
  sourceImageId: string;
};

/**
 * 원본 이미지 1건. 실제로는 업로드 응답(F-SRC-01)으로 받는다.
 *
 * previewUrl 은 다운스케일된 표시용 이미지이고,
 * originalWidth/Height 는 원본의 크기다. 이 둘의 비율이 previewScale.
 */
export type SourceImage = {
  sourceImageId: string;
  label: string;
  previewUrl: string;
  originalWidth: number;
  originalHeight: number;
  /** previewWidth / originalWidth. 백엔드가 내려주는 것을 규약으로 한다. */
  previewScale: number;
};

/* ------------------------------------------------------------------ *
 * 2. 배율
 * ------------------------------------------------------------------ */

/**
 * 화면에 실제로 적용되는 배율.
 *
 *   displayScale = previewScale x zoomScale
 *
 * previewScale : 서버가 원본을 줄여둔 비율 (사용자가 못 바꿈)
 * zoomScale    : 사용자가 화면에서 확대/축소한 비율
 *
 * 이 둘을 한 변수에 섞으면, 줌을 바꿀 때 previewScale 까지 오염된다.
 */
export function getDisplayScale(previewScale: number, zoomScale: number): number {
  return previewScale * zoomScale;
}

/**
 * previewScale 이 쓸 수 있는 값인지 검사한다.
 * 0, 음수, NaN, Infinity 는 나눗셈에서 곧바로 좌표를 망가뜨리므로 여기서 막는다.
 */
export function isValidScale(scale: number): boolean {
  return Number.isFinite(scale) && scale > 0;
}

/* ------------------------------------------------------------------ *
 * 3. 변환 - display <-> source
 * ------------------------------------------------------------------ */

/**
 * 화면 좌표 -> 원본 좌표.
 *
 *   sourceX = displayX / displayScale
 *
 * 반올림은 하지 않는다. 반올림은 사각형을 확정하는 마지막 단계에서 한 번만 한다.
 * (중간마다 반올림하면 오차가 쌓인다)
 */
export function displayPointToSource(
  point: DisplayPoint,
  displayScale: number,
): { sourceX: number; sourceY: number } {
  if (!isValidScale(displayScale)) {
    throw new Error(`displayScale 이 올바르지 않습니다: ${displayScale}`);
  }
  return {
    sourceX: point.displayX / displayScale,
    sourceY: point.displayY / displayScale,
  };
}

/**
 * 원본 좌표 -> 화면 좌표. 렌더링할 때마다 새로 계산한다.
 *
 *   displayX = sourceX x displayScale
 *
 * ★ 저장된 source 값은 절대 건드리지 않는다. 읽기만 한다.
 */
export function sourceRectToDisplay(
  rect: SourceRect,
  displayScale: number,
): DisplayRect {
  if (!isValidScale(displayScale)) {
    throw new Error(`displayScale 이 올바르지 않습니다: ${displayScale}`);
  }
  return {
    left: rect.sourceX * displayScale,
    top: rect.sourceY * displayScale,
    width: rect.sourceWidth * displayScale,
    height: rect.sourceHeight * displayScale,
  };
}

/* ------------------------------------------------------------------ *
 * 4. 사각형 확정 - 드래그가 끝났을 때 딱 한 번 호출한다
 * ------------------------------------------------------------------ */

export type BuildCropFailure =
  | { ok: false; reason: 'INVALID_SCALE' }
  | { ok: false; reason: 'ZERO_SIZE' }
  | { ok: false; reason: 'TOO_SMALL' }
  | { ok: false; reason: 'OUT_OF_BOUNDS' };

export type BuildCropSuccess = {
  ok: true;
  rect: SourceRect;
  /** 이미지 경계를 넘어서 잘라냈는지 (사용자에게 알려줄 용도) */
  clamped: boolean;
};

export type BuildCropResult = BuildCropSuccess | BuildCropFailure;

/**
 * 드래그 시작점과 끝점(화면 좌표)으로 source 좌표 사각형을 만든다.
 *
 * 처리 순서가 중요하다.
 *   1) 두 점을 source 좌표(실수)로 변환
 *   2) 역방향 드래그 정규화 (오른쪽아래 -> 왼쪽위로 끌어도 되게)
 *   3) 이미지 경계로 clamp
 *   4) 마지막에 딱 한 번 반올림
 *   5) width/height 는 반올림된 두 모서리의 차이로 구한다
 *
 * 5번이 핵심이다. width 를 따로 반올림하면 left + width 가 right 와 어긋난다.
 */
export function buildCropFromDrag(
  start: DisplayPoint,
  end: DisplayPoint,
  displayScale: number,
  image: Pick<SourceImage, 'originalWidth' | 'originalHeight'>,
  minSourcePx: number,
): BuildCropResult {
  if (!isValidScale(displayScale)) {
    return { ok: false, reason: 'INVALID_SCALE' };
  }

  const a = displayPointToSource(start, displayScale);
  const b = displayPointToSource(end, displayScale);

  // 2) 역방향 드래그 정규화 - 음수 width/height 가 생기지 않게 한다
  const rawLeft = Math.min(a.sourceX, b.sourceX);
  const rawTop = Math.min(a.sourceY, b.sourceY);
  const rawRight = Math.max(a.sourceX, b.sourceX);
  const rawBottom = Math.max(a.sourceY, b.sourceY);

  // 드래그 자체가 이미지 밖에서만 일어난 경우
  if (
    rawRight <= 0 ||
    rawBottom <= 0 ||
    rawLeft >= image.originalWidth ||
    rawTop >= image.originalHeight
  ) {
    return { ok: false, reason: 'OUT_OF_BOUNDS' };
  }

  // 3) 경계 clamp - 음수 좌표와 이미지 초과를 여기서 잘라낸다
  const left = clamp(rawLeft, 0, image.originalWidth);
  const top = clamp(rawTop, 0, image.originalHeight);
  const right = clamp(rawRight, 0, image.originalWidth);
  const bottom = clamp(rawBottom, 0, image.originalHeight);
  const clamped =
    left !== rawLeft || top !== rawTop || right !== rawRight || bottom !== rawBottom;

  // 4) 마지막에 한 번만 반올림
  const rLeft = Math.round(left);
  const rTop = Math.round(top);
  const rRight = Math.round(right);
  const rBottom = Math.round(bottom);

  // 5) width/height 는 모서리의 차이로 구한다
  const sourceWidth = rRight - rLeft;
  const sourceHeight = rBottom - rTop;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { ok: false, reason: 'ZERO_SIZE' };
  }
  if (sourceWidth < minSourcePx || sourceHeight < minSourcePx) {
    return { ok: false, reason: 'TOO_SMALL' };
  }

  return {
    ok: true,
    clamped,
    rect: {
      sourceX: rLeft,
      sourceY: rTop,
      sourceWidth,
      sourceHeight,
    },
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/* ------------------------------------------------------------------ *
 * 5. 자체 검증용 - 왕복 변환 오차 측정
 * ------------------------------------------------------------------ */

/**
 * source -> display -> source 왕복 후 원래 값과 얼마나 차이나는지 잰다.
 * 0 이 나와야 한다. 저장값을 한 번도 덮어쓰지 않기 때문이다.
 *
 * 화면에서 "drift" 표시에 쓰고, scripts/verify-coordinates.mjs 에서도 쓴다.
 */
export function measureRoundTripDrift(
  rect: SourceRect,
  displayScale: number,
): number {
  const d = sourceRectToDisplay(rect, displayScale);
  const back = {
    sourceX: d.left / displayScale,
    sourceY: d.top / displayScale,
    sourceWidth: d.width / displayScale,
    sourceHeight: d.height / displayScale,
  };
  return Math.max(
    Math.abs(back.sourceX - rect.sourceX),
    Math.abs(back.sourceY - rect.sourceY),
    Math.abs(back.sourceWidth - rect.sourceWidth),
    Math.abs(back.sourceHeight - rect.sourceHeight),
  );
}
