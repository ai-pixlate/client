/**
 * N5 HTML/CSS 조판 브라우저 측정 엔진 — DOM 줄바꿈 + DOM baseline + Canvas TextMetrics ink.
 *
 * 규칙(글자 크기·style·overflow 비교)은 typeset-rules.ts 가 정본이고, 이 파일은 브라우저에서 그 규칙대로 그린 결과를 잰다.
 * 측정만 한다 — N5 화면·API·자동 축소·영역 확장·줄바꿈 재탐색과 연결하지 않는다.
 *
 * 좌표계: 모든 결과는 섹션 로컬 원본 px 이다. 측정 host 가 섹션 원점 역할을 하며, host 의 화면 배율이 1 이 아니면
 * (CSS zoom·transform scale·미리보기 축소 안) 측정하지 않고 실패를 돌려준다 — screen px 를 bbox px 와 섞지 않는다.
 *
 * 흐름: 블록을 HTML/CSS 로 렌더 → 브라우저가 줄바꿈 확정 → 글자(grapheme) 단위 Range rect 로 실제 줄 조각 수집
 *   → 각 줄 첫 글자 앞 0×0 inline-block 의 아래 경계로 실제 baseline 확인
 *   → 줄 텍스트를 Canvas measureText 로 재 actualBoundingBox* 를 DOM 줄 시작점·baseline 에 합성 → bbox 와 비교.
 * 글자가 Pretendard 에 없어 대체 폰트로 그려지면(예: 일본어 한자) 측정하지 않고 실패를 돌려준다 — 대체 폰트는 문서 lang 등에 따라
 * DOM 과 Canvas 가 서로 다르게 고를 수 있어 ink 를 믿을 수 없다.
 * Canvas 는 줄바꿈을 정하지 않는다. 문자열 전체를 한 번에 재지 않고 브라우저가 만든 줄마다 잰다.
 *
 * 비용 구조: openTypesetMeasurer() 한 번에 폰트 확인·host·블록 요소·canvas 를 한 번만 만든다.
 * measure() 는 같은 블록 요소의 style/text 만 바꿔 재므로 블록마다 DOM·Canvas 생성/삭제나 폰트 확인을 반복하지 않는다.
 * 블록당 비용은 글자 수만큼의 Range 조회 + 줄 수만큼의 measureText 다. 글리프 대체 확인은 weight·글자별로 캐시한다.
 */

import type { BoundingBox } from '../api/types';
import {
  type InkBounds,
  type OverflowSides,
  type TypesetRole,
  TYPESET_COMMON,
  inkOverflowSides,
  isTypesetRole,
  typesetTextStyle,
} from './typeset-rules.ts';

/** FE 내부 측정 입력 — API DTO 가 아니다 */
export interface TypesetMeasureInput {
  text: string;
  role: TypesetRole;
  sourceImageWidth: number;
  userFontScale?: number;
  /** 섹션 로컬 원본 px. 조정 박스/원본 선택은 호출자가 resolveActiveBBox 로 한다 */
  bbox: BoundingBox;
  /** 정렬 기준 저장·전달은 미정 — 없으면 TYPESET_COMMON.textAlignFallback */
  textAlign?: 'left' | 'center' | 'right';
}

/** 섹션 로컬 원본 px 사각형 */
export interface LocalRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TypesetLineMeasure {
  /** 브라우저가 이 줄에 그린 글자(접힌 공백·개행 제외) */
  text: string;
  /** DOM 줄 조각(글자 Range rect 합집합, 글꼴 content area 기준) */
  rect: LocalRect;
  /** 줄 첫 글자 앞 0×0 inline-block 의 아래 경계 = 실제 baseline */
  baselineY: number;
  /** Canvas actualBoundingBox* 를 줄 시작점·baseline 에 합성한 글자 경계 */
  ink: InkBounds;
  /** 같은 줄의 Canvas advance width — DOM 줄 폭과의 일관성 확인용(overflow 판정에는 쓰지 않는다) */
  canvasAdvanceWidth: number;
}

export interface TypesetMeasureSuccess {
  ok: true;
  coordinateSpace: 'section-local-original-px';
  /** 비교 대상 박스(입력 그대로) */
  bbox: BoundingBox;
  fontPx: number;
  fontWeight: number;
  letterSpacingPx: number;
  /** 블록 요소 rect(배치 확인용) */
  blockRect: LocalRect;
  /** DOM 이 그린 줄 조각 전체의 합집합. 빈 텍스트면 null */
  domBounds: LocalRect | null;
  lines: TypesetLineMeasure[];
  /** 모든 줄 ink 합집합. 그린 글자가 없으면 null(overflow 없음) */
  ink: InkBounds | null;
  overflow: OverflowSides;
}

export type TypesetMeasureFailureReason =
  | 'invalid-input'
  | 'non-unit-scale'
  | 'canvas-unavailable'
  | 'canvas-letter-spacing-unsupported'
  | 'baseline-probe-changed-layout'
  | 'glyph-fallback'
  | 'measurer-disposed';

export interface TypesetMeasureFailure {
  ok: false;
  reason: TypesetMeasureFailureReason;
  detail: string;
  /** reason=glyph-fallback 일 때 지정 폰트에 없어 대체 폰트로 그려진 글자 */
  fallbackGraphemes?: string[];
}

export type TypesetMeasureResult = TypesetMeasureSuccess | TypesetMeasureFailure;

export interface FontWeightProblem {
  weight: number;
  /** no-font-face: 해당 family·weight FontFace 가 문서에 없음 / not-loaded: 있으나 로드 실패·미완료 / check-failed: fonts.check false */
  problem: 'no-font-face' | 'not-loaded' | 'check-failed';
}

export type TypesetFontReadiness =
  | { ok: true; family: string; weights: number[] }
  | { ok: false; family: string; missing: FontWeightProblem[] };

/** 조판에 쓰는 weight — ROLE_STYLE_DEFAULTS 의 400/600 */
export const TYPESET_FONT_WEIGHTS = [400, 600] as const;

const NO_OVERFLOW: OverflowSides = { left: false, right: false, top: false, bottom: false, any: false };

function union(items: LocalRect[]): LocalRect | null {
  if (items.length === 0) return null;
  return items.reduce<LocalRect>(
    (acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
    }),
    { ...items[0] },
  );
}

function unquoteFamily(family: string): string {
  return family.trim().replace(/^(['"])(.*)\1$/, '$2');
}

function faceCoversWeight(face: FontFace, weight: number): boolean {
  const [min, max = min] = face.weight.split(/\s+/).map(Number);
  return weight >= min && weight <= max;
}

/**
 * Pretendard 400/600 이 실제로 준비됐는지 확인한다.
 * document.fonts.ready 와 fonts.check() 만으로는 성공 처리하지 않는다 — check() 는 일치하는 FontFace 가 없거나
 * 시스템 폰트만 있을 때도 true 를 돌려주므로, 문서에 해당 family·weight FontFace 가 있고 status 가 loaded 인지 함께 본다.
 * FontFace 의 src 가 local() 인지 url() 인지는 API 로 구분할 수 없다(파일 동일성 보장은 이 확인의 범위 밖).
 */
export async function checkTypesetFontReady(
  doc: Document = document,
  family: string = TYPESET_COMMON.fontFamily,
  weights: readonly number[] = TYPESET_FONT_WEIGHTS,
): Promise<TypesetFontReadiness> {
  await doc.fonts.ready;
  const missing: FontWeightProblem[] = [];
  for (const weight of weights) {
    const descriptor = `${weight} 16px "${family}"`;
    try {
      await doc.fonts.load(descriptor);
    } catch {
      // 로드 실패는 아래 status 확인에서 not-loaded 로 드러난다
    }
    const faces = Array.from(doc.fonts).filter(
      (face) => unquoteFamily(face.family) === family && faceCoversWeight(face, weight),
    );
    if (faces.length === 0) missing.push({ weight, problem: 'no-font-face' });
    else if (!faces.some((face) => face.status === 'loaded')) missing.push({ weight, problem: 'not-loaded' });
    else if (!doc.fonts.check(descriptor)) missing.push({ weight, problem: 'check-failed' });
  }
  return missing.length === 0 ? { ok: true, family, weights: [...weights] } : { ok: false, family, missing };
}

export interface TypesetMeasurer {
  measure(input: TypesetMeasureInput): TypesetMeasureResult;
  /** 마지막 measure() 로 그린 블록 요소(harness 촬영·비교용). 다음 measure() 에서 재사용된다 */
  readonly blockElement: HTMLElement;
  readonly hostElement: HTMLElement;
  dispose(): void;
}

export interface OpenTypesetMeasurerOptions {
  document?: Document;
  /** 1:1 로 보이는 측정 영역이 필요할 때(harness 촬영) 넘긴다. 없으면 보이지 않는 고정 host 를 만든다 */
  host?: HTMLElement;
  /** 기본 TYPESET_COMMON.fontFamily. 폰트 미준비 실패 경로 검증용으로만 바꾼다 */
  fontFamily?: string;
}

export type OpenTypesetMeasurerResult =
  | { ok: true; measurer: TypesetMeasurer }
  | { ok: false; reason: 'font-not-ready'; fonts: Extract<TypesetFontReadiness, { ok: false }> };

/** host 배율 확인용 고정 폭(px) */
const HOST_PROBE_WIDTH = 100;

/**
 * 글리프 대체 확인 — 지정 family 뒤에 서로 다른 generic 을 붙이고 Canvas lang 을 바꿔 같은 글자를 잰다.
 * 지정 폰트에 글리프가 있으면 결과가 모두 같고, 하나라도 다르면 대체 폰트로 그린 것이다.
 * CJK 한자는 모든 generic 이 같은 시스템 폰트로 대체될 수 있어 lang(ko/ja/zh) 차이로 잡는다.
 * 오탐은 없지만, 모든 조합이 같은 대체 폰트로 가는 글자는 놓칠 수 있다.
 */
const GLYPH_PROBE_GENERICS = ['serif', 'monospace', 'sans-serif', 'cursive'] as const;
const GLYPH_PROBE_LANGS = ['ko', 'ja', 'zh-CN'] as const;
const GLYPH_PROBE_PX = 100;

/**
 * 폰트가 준비된 경우에만 측정기를 연다. 준비되지 않았으면 fallback 폰트로 측정하지 않고 실패를 돌려준다.
 */
export async function openTypesetMeasurer(options: OpenTypesetMeasurerOptions = {}): Promise<OpenTypesetMeasurerResult> {
  const doc = options.document ?? document;
  const family = options.fontFamily ?? TYPESET_COMMON.fontFamily;
  const fonts = await checkTypesetFontReady(doc, family);
  if (!fonts.ok) return { ok: false, reason: 'font-not-ready', fonts };

  const ownsHost = !options.host;
  const host = options.host ?? doc.createElement('div');
  if (ownsHost) {
    // 레이아웃·포인터에 영향 없이 1:1 로 렌더한다. visibility:hidden 이어도 레이아웃과 rect 는 정상 계산된다
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'fixed', left: '0px', top: '0px', visibility: 'hidden', pointerEvents: 'none', zIndex: '-1' });
    doc.body.appendChild(host);
  }
  // 블록은 host 원점 기준으로 놓는다 — host 가 섹션 로컬 원점이다
  Object.assign(host.style, {
    width: `${HOST_PROBE_WIDTH}px`,
    height: `${HOST_PROBE_WIDTH}px`,
    margin: '0px',
    padding: '0px',
    border: '0px',
    boxSizing: 'content-box',
    overflow: 'visible',
  });
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const block = doc.createElement('div');
  block.dataset.typesetBlock = '';
  host.appendChild(block);
  const canvas = doc.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  let disposed = false;
  const glyphFallbackCache = new Map<string, boolean>();
  const familyCss = `"${family}"`;

  const isFallbackGlyph = (c: CanvasRenderingContext2D, grapheme: string, weight: string): boolean => {
    if (/^[\s\u00a0]+$/.test(grapheme)) return false;
    const key = `${weight}|${grapheme}`;
    const cached = glyphFallbackCache.get(key);
    if (cached !== undefined) return cached;
    const langCtx = c as CanvasRenderingContext2D & { lang?: string };
    const supportsLang = 'lang' in langCtx;
    const previousLang = langCtx.lang;
    c.letterSpacing = '0px';
    const signatures = new Set<string>();
    for (const lang of supportsLang ? GLYPH_PROBE_LANGS : [undefined]) {
      if (lang) langCtx.lang = lang;
      for (const generic of GLYPH_PROBE_GENERICS) {
        c.font = `${weight} ${GLYPH_PROBE_PX}px ${familyCss}, ${generic}`;
        const m = c.measureText(grapheme);
        signatures.add([m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent].join());
      }
    }
    if (supportsLang) langCtx.lang = previousLang;
    const fallback = signatures.size > 1;
    glyphFallbackCache.set(key, fallback);
    return fallback;
  };

  const measure = (input: TypesetMeasureInput): TypesetMeasureResult => {
    if (disposed) return { ok: false, reason: 'measurer-disposed', detail: '' };
    if (!ctx) return { ok: false, reason: 'canvas-unavailable', detail: 'getContext("2d") returned null' };
    if (!('letterSpacing' in ctx)) {
      return { ok: false, reason: 'canvas-letter-spacing-unsupported', detail: '자간을 반영한 ink 를 잴 수 없다' };
    }
    const { bbox } = input;
    if (!isTypesetRole(input.role) || ![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) {
      return { ok: false, reason: 'invalid-input', detail: `role=${String(input.role)} bbox=${JSON.stringify(bbox)}` };
    }
    const style = typesetTextStyle(input.role, input.sourceImageWidth, input.userFontScale);
    if (!style) return { ok: false, reason: 'invalid-input', detail: `sourceImageWidth=${input.sourceImageWidth}` };

    const hostRect = host.getBoundingClientRect();
    const scale = hostRect.width / HOST_PROBE_WIDTH;
    if (scale !== 1) {
      return { ok: false, reason: 'non-unit-scale', detail: `host 화면 배율 ${scale} — 원본 px 로 잴 수 없다` };
    }
    const toLocal = (r: DOMRect): LocalRect => ({
      left: r.left - hostRect.left,
      top: r.top - hostRect.top,
      right: r.right - hostRect.left,
      bottom: r.bottom - hostRect.top,
    });

    // 조판 CSS — 앱 전역 CSS 가 값을 바꾸지 못하도록 줄바꿈·글꼴에 영향을 주는 속성을 모두 명시한다
    block.style.cssText = '';
    Object.assign(block.style, {
      position: 'absolute',
      left: `${bbox.x}px`,
      top: `${bbox.y}px`,
      width: `${bbox.width}px`,
      height: `${bbox.height}px`,
      boxSizing: 'border-box',
      margin: '0px',
      padding: '0px',
      border: '0px',
      overflow: 'visible',
      fontFamily: familyCss,
      fontSize: style.fontSize,
      fontWeight: String(style.fontWeight),
      fontStyle: 'normal',
      fontKerning: style.fontKerning,
      fontFeatureSettings: 'normal',
      fontVariant: 'normal',
      fontSynthesis: 'none',
      letterSpacing: style.letterSpacing,
      wordSpacing: 'normal',
      lineHeight: String(style.lineHeight),
      color: style.color,
      textAlign: input.textAlign ?? style.textAlign,
      whiteSpace: style.whiteSpace,
      wordBreak: 'normal',
      overflowWrap: 'normal',
      lineBreak: 'auto',
      hyphens: 'manual',
      textTransform: 'none',
      textIndent: '0px',
      direction: 'ltr',
    });
    block.textContent = input.text;

    const computed = getComputedStyle(block);
    const fontPx = parseFloat(computed.fontSize);
    const letterSpacingPx = computed.letterSpacing === 'normal' ? 0 : parseFloat(computed.letterSpacing);
    const blockRect = toLocal(block.getBoundingClientRect());

    // 1) 브라우저가 확정한 줄 조각 수집 — 글자 단위 Range rect. 폭 0 rect(접힌 공백·개행·줄 끝 공백)는 그려지지 않은 글자다
    type Glyph = { index: number; length: number; rect: LocalRect };
    type CollectedLine = { graphemes: string[]; rect: LocalRect; first: Glyph; last: Glyph };
    const lines: CollectedLine[] = [];
    const range = doc.createRange();
    const textNode = block.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      const graphemes = segmenter
        ? Array.from(segmenter.segment(input.text), (s) => ({ index: s.index, segment: s.segment }))
        : Array.from(input.text).reduce<{ index: number; segment: string }[]>((acc, ch) => {
            const prev = acc[acc.length - 1];
            acc.push({ index: prev ? prev.index + prev.segment.length : 0, segment: ch });
            return acc;
          }, []);
      for (const g of graphemes) {
        range.setStart(textNode, g.index);
        range.setEnd(textNode, g.index + g.segment.length);
        const visible = Array.from(range.getClientRects()).find((r) => r.width > 0);
        if (!visible) continue;
        const glyph: Glyph = { index: g.index, length: g.segment.length, rect: toLocal(visible) };
        const r = glyph.rect;
        const current = lines[lines.length - 1];
        // 세로 중심이 현재 줄 아래 경계보다 위면 같은 줄
        if (current && (r.top + r.bottom) / 2 < current.rect.bottom) {
          current.graphemes.push(g.segment);
          current.last = glyph;
          current.rect = union([current.rect, r])!;
        } else {
          lines.push({ graphemes: [g.segment], rect: r, first: glyph, last: glyph });
        }
      }
    }

    // 대체 폰트로 그린 글자가 있으면 fallback 으로 측정을 계속하지 않는다
    const fallbackGraphemes = new Set<string>();
    for (const line of lines) {
      for (const g of line.graphemes) if (isFallbackGlyph(ctx, g, computed.fontWeight)) fallbackGraphemes.add(g);
    }
    if (fallbackGraphemes.size > 0) {
      const list = Array.from(fallbackGraphemes);
      return {
        ok: false,
        reason: 'glyph-fallback',
        detail: `"${family}" ${computed.fontWeight} 에 없는 글자 ${list.length}개: ${list.slice(0, 20).join('')}`,
        fallbackGraphemes: list,
      };
    }

    // 2) 실제 baseline — 각 줄 첫 글자를 nowrap span 으로 묶고 그 앞에 0×0 inline-block 을 둔다. inline-block 의 아래 경계가 baseline 이다.
    //    inline-block 단독이면 앞 줄 끝으로 붙을 수 있어 첫 글자와 묶는다.
    //    넣은 뒤 줄 구조가 그대로인지 확인한다: 각 줄의 첫·마지막 글자가 같은 줄(top)에 있으면 줄 경계와 줄 수가 같다.
    //    텍스트 노드를 나누면 가로 위치·정렬 오프셋이 LayoutUnit(1/64px) 단위로 움직일 수 있어 가로는 비교하지 않는다 —
    //    probe DOM 에서는 baseline 세로 위치만 쓰고, 줄 조각·가로 위치는 probe 전 DOM 값을 쓴다.
    const baselines: number[] = [];
    if (lines.length > 0 && textNode) {
      const probes: HTMLElement[] = [];
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const { index, length } = lines[i].first;
        const node = textNode as Text;
        node.splitText(index + length);
        const glyph = node.splitText(index);
        const wrap = doc.createElement('span');
        wrap.style.whiteSpace = 'nowrap';
        const probe = doc.createElement('span');
        Object.assign(probe.style, { display: 'inline-block', width: '0px', height: '0px', verticalAlign: 'baseline' });
        glyph.parentNode!.insertBefore(wrap, glyph);
        wrap.append(probe, glyph);
        probes[i] = probe;
      }
      // 원문 offset 의 글자가 지금 그려진 rect — 나뉜 텍스트 노드를 순서대로 따라간다
      const textNodes: Text[] = [];
      const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);
      const rectAt = ({ index, length }: Glyph): LocalRect | null => {
        let offset = 0;
        for (const n of textNodes) {
          if (index < offset + n.length) {
            range.setStart(n, index - offset);
            range.setEnd(n, index - offset + length);
            const visible = Array.from(range.getClientRects()).find((r) => r.width > 0);
            return visible ? toLocal(visible) : null;
          }
          offset += n.length;
        }
        return null;
      };
      let changed = '';
      lines.forEach((line, i) => {
        for (const g of [line.first, line.last]) {
          const now = rectAt(g);
          if (!now || now.top !== g.rect.top || now.bottom !== g.rect.bottom) {
            changed ||= `line ${i} glyph@${g.index} ${JSON.stringify(g.rect)} → ${JSON.stringify(now)}`;
          }
        }
        baselines[i] = toLocal(probes[i].getBoundingClientRect()).bottom;
      });
      block.textContent = input.text;
      if (changed) return { ok: false, reason: 'baseline-probe-changed-layout', detail: changed };
    }

    // 3) Canvas TextMetrics — DOM 과 같은 글꼴·크기·자간·kerning 으로 줄마다 실제 glyph 경계를 잰다
    ctx.font = `${computed.fontWeight} ${fontPx}px ${familyCss}`;
    ctx.letterSpacing = `${letterSpacingPx}px`;
    ctx.fontKerning = 'normal';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.direction = 'ltr';

    const measured: TypesetLineMeasure[] = lines.map((line, i) => {
      const text = line.graphemes.join('');
      const m = ctx.measureText(text);
      const originX = line.first.rect.left;
      const baselineY = baselines[i];
      return {
        text,
        rect: line.rect,
        baselineY,
        ink: {
          left: originX - m.actualBoundingBoxLeft,
          right: originX + m.actualBoundingBoxRight,
          top: baselineY - m.actualBoundingBoxAscent,
          bottom: baselineY + m.actualBoundingBoxDescent,
        },
        canvasAdvanceWidth: m.width,
      };
    });

    const ink = union(measured.map((l) => l.ink));

    return {
      ok: true,
      coordinateSpace: 'section-local-original-px',
      bbox,
      fontPx,
      fontWeight: Number(computed.fontWeight),
      letterSpacingPx,
      blockRect,
      domBounds: union(measured.map((l) => l.rect)),
      lines: measured,
      ink,
      overflow: ink ? inkOverflowSides(ink, bbox) : NO_OVERFLOW,
    };
  };

  return {
    ok: true,
    measurer: {
      measure,
      blockElement: block,
      hostElement: host,
      dispose() {
        disposed = true;
        block.remove();
        if (ownsHost) host.remove();
      },
    },
  };
}
