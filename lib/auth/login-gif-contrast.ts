/**
 * G1 왼쪽 보조 문구의 GIF 대비 계산 — 순수 계산(scripts/verify-login-form.mjs 로 Node 에서 검증).
 * 기준값은 pixlate_login.gif 100프레임 실측값이다. 다른 GIF 로 바뀌면 다시 재야 한다.
 */

/** 글자별 주황 판별 샘플을 읽는 축소 canvas 배율. 글자 하나가 약 3.5px 로 남아 3×3 샘플이 구분된다 */
export const LOGIN_GIF_SAMPLE_SCALE = 0.25;

/** 글자 색 판정 주기(ms). 약 10fps — GIF 는 25fps 지만 글자 색까지 매 프레임 계산할 필요는 없다 */
export const LOGIN_GIF_SAMPLE_INTERVAL_MS = 100;

/**
 * 주황 판별. GIF 는 검정 + #FF6B3A 계열뿐이고 번진 가장자리도 G/R≈0.41, B/R≈0.21 로 일정하다.
 * minRed 148: 배경이 이 밝기(휘도 0.097)일 때 #999999 와 #171717 의 대비가 같아진다. 이보다 밝으면 어두운 글자가 더 잘 보인다.
 * maxGreenRatio 0.6: 흰색·회색·노란색을 제외한다.
 */
export const LOGIN_GIF_ORANGE_THRESHOLD = { minRed: 148, maxGreenRatio: 0.6 } as const;

/**
 * 글자를 어둡게 바꾸는 주황 샘플 비율. 전 프레임 시뮬레이션에서 대비 3:1 이상 지점 비율이 5/9 일 때 가장 높았다
 * (3/9 99.62% · 5/9 99.65% · 9/9 99.43%, 항상 #999 는 77.92%). 글자 절반 이상이 주황 위에 있을 때 바꾼다.
 */
export const LOGIN_GIF_GRAPHEME_ORANGE_RATIO = 0.5;

export function isLoginGifOrangePixel(r: number, g: number, b: number): boolean {
  return r >= LOGIN_GIF_ORANGE_THRESHOLD.minRed && g > b && r > g && g / r <= LOGIN_GIF_ORANGE_THRESHOLD.maxGreenRatio;
}

export function shouldDarkenGrapheme(orangeSamples: number, totalSamples: number): boolean {
  return totalSamples > 0 && orangeSamples / totalSamples >= LOGIN_GIF_GRAPHEME_ORANGE_RATIO;
}

/** 줄 문장을 눈에 보이는 글자 단위로 나눈다. Segmenter 가 없으면 코드포인트 단위로 나눈다 */
export function splitGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

export interface Size {
  width: number;
  height: number;
}

export interface CoverMapping {
  /** 원본 1px 이 화면에서 차지하는 px */
  scale: number;
  /** 화면 왼쪽 위에 해당하는 원본 좌표(가운데 정렬 crop) */
  sourceX: number;
  sourceY: number;
}

/** object-fit: cover, object-position: center 의 화면 ↔ 원본 대응 */
export function computeCoverMapping(panel: Size, source: Size): CoverMapping {
  const scale = Math.max(panel.width / source.width, panel.height / source.height);
  return {
    scale,
    sourceX: (source.width - panel.width / scale) / 2,
    sourceY: (source.height - panel.height / scale) / 2,
  };
}

export interface PanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 글자 상자 안 3×3 샘플 지점(패널 좌표). 가장자리를 피해 각 칸의 가운데를 쓴다 */
export function graphemeSamplePoints(rect: PanelRect): { x: number; y: number }[] {
  const ratios = [1 / 6, 1 / 2, 5 / 6];
  return ratios.flatMap((ry) => ratios.map((rx) => ({ x: rect.left + rect.width * rx, y: rect.top + rect.height * ry })));
}

/** readPixel 은 원본 좌표를 받아 [r, g, b] 를 돌려준다 */
export function isGraphemeOnOrange(
  rect: PanelRect,
  cover: CoverMapping,
  readPixel: (sourceX: number, sourceY: number) => readonly [number, number, number],
): boolean {
  const points = graphemeSamplePoints(rect);
  const orange = points.filter(({ x, y }) => {
    const [r, g, b] = readPixel(cover.sourceX + x / cover.scale, cover.sourceY + y / cover.scale);
    return isLoginGifOrangePixel(r, g, b);
  }).length;
  return shouldDarkenGrapheme(orange, points.length);
}
