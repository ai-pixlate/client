/**
 * N5 HTML/CSS 조판 확정 규칙 — FE 기준 SSOT(순수 계산).
 *
 * 근거: 「pixlate HTML/CSS 조판 규칙 협의 v0.1」(2026-10-29)에서 합의 완료·방식 합의·기존 승인값으로 정한 항목만
 * 옮겼다. 미정 항목(조정값 저장 구조·필드명, 정렬 기준 저장, [+][-] 확대 기준점·박스 비례식, 섹션 경계 정책,
 * 자동 넘침 해소, renderer 입력·버전)은 여기 두지 않는다. API 타입을 바꾸지 않으며, 인자 이름도 API 필드가 아니다.
 *
 * React 도 브라우저 API 도 쓰지 않는다(scripts/verify-n5-typeset-rules.mjs 로 Node 에서 검증).
 * 브라우저 측정은 typeset-measurement.ts 가 맡는다 — 여기 overflow 판정은 측정 결과를 받아 비교만 한다.
 */

import type { ApiBlockRole } from '../api/n5-schema';
import type { BoundingBox } from '../api/types';
import { effectiveFontSize } from './layout-edit.ts';

/** 역할별 기준 크기를 정한 기준 이미지 폭(px) */
export const TYPESET_REFERENCE_WIDTH = 375;

/** 사용자 글자 배율 기본값 — 조정하지 않은 블록 */
export const DEFAULT_USER_FONT_SCALE = 1;

/** 조판 대상 역할. product_label 은 번역하지 않고 원본을 유지하므로(v3.4.1) 기준 style 이 없다 */
export type TypesetRole = Exclude<ApiBlockRole, 'product_label'>;

export interface RoleStyle {
  /** 기준 폭 375px 에서의 글자 크기(px) */
  fontSizePx: number;
  fontWeight: 400 | 600;
  /** CSS letter-spacing(em) */
  letterSpacingEm: number;
}

/** 역할별 기준 style(기존 승인값) */
export const ROLE_STYLE_DEFAULTS: Readonly<Record<TypesetRole, Readonly<RoleStyle>>> = {
  title: { fontSizePx: 32, fontWeight: 600, letterSpacingEm: -0.015 },
  body: { fontSizePx: 16, fontWeight: 400, letterSpacingEm: -0.03 },
  caption: { fontSizePx: 14, fontWeight: 400, letterSpacingEm: -0.01 },
  price: { fontSizePx: 24, fontWeight: 600, letterSpacingEm: -0.02 },
  caution: { fontSizePx: 16, fontWeight: 400, letterSpacingEm: -0.03 },
};

/** 역할과 무관한 공통 조판 값 */
export const TYPESET_COMMON = {
  fontFamily: 'Pretendard',
  color: '#222222',
  /** 정렬 기준이 전달되지 않을 때 쓰는 값(정렬 기준 저장·전달은 미정) */
  textAlignFallback: 'left',
  lineHeight: 1.2,
  /** 명시적 개행은 반영하고 일반 공백은 브라우저 pre-line 의미를 따른다. 강제 분해·하이픈·재탐색 없음 */
  whiteSpace: 'pre-line',
  fontKerning: 'normal',
} as const;

export function isTypesetRole(role: ApiBlockRole | null | undefined): role is TypesetRole {
  return !!role && Object.hasOwn(ROLE_STYLE_DEFAULTS, role);
}

/**
 * 기본 글자 크기 = 역할 기준 크기 × 원본 이미지 폭 / 375.
 * 이미 측정된 유효 크기(예: 추정 글자 크기)에 이 배율을 다시 곱하지 않는다 — 입력은 역할 기준값뿐이다.
 * 원본 폭이 양의 유한수가 아니면 null.
 */
export function resolveRoleBaseFontPx(role: TypesetRole, sourceImageWidth: number): number | null {
  if (!Number.isFinite(sourceImageWidth) || !(sourceImageWidth > 0)) return null;
  return (ROLE_STYLE_DEFAULTS[role].fontSizePx * sourceImageWidth) / TYPESET_REFERENCE_WIDTH;
}

/**
 * 최종 글자 크기 = 기본 크기 × 사용자 배율. 직전 최종값에 다시 곱하지 않는다(effectiveFontSize 와 같은 정의).
 * 사용자 배율에 시스템 자동 축소를 섞지 않는다.
 */
export function resolveFinalFontPx(
  role: TypesetRole,
  sourceImageWidth: number,
  userFontScale: number = DEFAULT_USER_FONT_SCALE,
): number | null {
  const base = resolveRoleBaseFontPx(role, sourceImageWidth);
  return base === null ? null : effectiveFontSize(base, userFontScale);
}

/**
 * 조판에 쓸 박스 — 조정한 박스가 있으면 그것, 없으면 원본. 원본은 바꾸지 않고 그대로 보존한다.
 * 좌표는 섹션 로컬 원본 px 이며 소수를 반올림·내림·올림하지 않는다(받은 객체를 그대로 돌려준다).
 */
export function resolveActiveBBox<T extends object>(original: T, adjusted: T | null | undefined): T {
  return adjusted ?? original;
}

/** 글자 실제 그림 경계(ink) — 박스와 같은 좌표계(섹션 로컬 원본 px) */
export interface InkBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * ink 경계가 박스 경계를 한 변이라도 넘으면 overflow. 경계와 정확히 같으면 정상이다.
 * 허용 오차(1px·epsilon)나 정수 반올림을 두지 않는다 — +0.115px 도 overflow 다.
 */
export function isInkOverflow(ink: InkBounds, box: BoundingBox): boolean {
  return inkOverflowSides(ink, box).any;
}

/** 넘친 방향 — 각 축을 독립적으로 판정한다. any 는 네 방향 중 하나라도 넘쳤는지 */
export interface OverflowSides {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
  any: boolean;
}

/** 넘친 방향이 하나도 없는 값 — 그린 글자가 없거나 최종 출력에 없는 블록의 평가에 쓴다 */
export const NO_OVERFLOW_SIDES: Readonly<OverflowSides> = { left: false, right: false, top: false, bottom: false, any: false };

function overflowSides(left: boolean, right: boolean, top: boolean, bottom: boolean): OverflowSides {
  return { left, right, top, bottom, any: left || right || top || bottom };
}

/** isInkOverflow 와 같은 비교를 방향별로 돌려준다(경계와 같으면 정상, 허용 오차 없음) */
export function inkOverflowSides(ink: InkBounds, box: BoundingBox): OverflowSides {
  return overflowSides(
    ink.left < box.x,
    ink.right > box.x + box.width,
    ink.top < box.y,
    ink.bottom > box.y + box.height,
  );
}

/**
 * 최종 이미지 경계 이탈 감지 — 블록 박스 overflow 와 별개다.
 * ink 는 섹션 로컬 원본 px, sectionOffset 은 그 섹션 원점이 최종 이미지에서 놓이는 위치(원본 px)다.
 * 최종 출력 기준 평가는 typeset-final-output.ts 의 evaluateFinalImageBoundary 로 호출한다(/preview 의 displayTop 을 넣지 않는다).
 * 감지만 한다 — N5 확정 차단·N6 오류는 서버 계약이 온 뒤 별도 단계에서 연결한다.
 */
export function imageBoundaryViolation(
  ink: InkBounds,
  sectionOffset: { x: number; y: number },
  image: { width: number; height: number },
): OverflowSides & { inkInImage: InkBounds } {
  const inkInImage: InkBounds = {
    left: ink.left + sectionOffset.x,
    top: ink.top + sectionOffset.y,
    right: ink.right + sectionOffset.x,
    bottom: ink.bottom + sectionOffset.y,
  };
  return {
    ...overflowSides(inkInImage.left < 0, inkInImage.right > image.width, inkInImage.top < 0, inkInImage.bottom > image.height),
    inkInImage,
  };
}

/** 조판 텍스트 CSS 계약(React style 객체 형태). 화면에는 TypesetBlock·측정기가 typesetBlockStyle 을 거쳐 쓴다 */
export interface TypesetTextStyle {
  fontFamily: string;
  fontSize: string;
  fontWeight: number;
  letterSpacing: string;
  lineHeight: number;
  color: string;
  textAlign: string;
  whiteSpace: string;
  fontKerning: string;
}

export function typesetTextStyle(
  role: TypesetRole,
  sourceImageWidth: number,
  userFontScale: number = DEFAULT_USER_FONT_SCALE,
): TypesetTextStyle | null {
  const fontPx = resolveFinalFontPx(role, sourceImageWidth, userFontScale);
  if (fontPx === null) return null;
  const roleStyle = ROLE_STYLE_DEFAULTS[role];
  return {
    fontFamily: TYPESET_COMMON.fontFamily,
    fontSize: `${fontPx}px`,
    fontWeight: roleStyle.fontWeight,
    letterSpacing: `${roleStyle.letterSpacingEm}em`,
    lineHeight: TYPESET_COMMON.lineHeight,
    color: TYPESET_COMMON.color,
    textAlign: TYPESET_COMMON.textAlignFallback,
    whiteSpace: TYPESET_COMMON.whiteSpace,
    fontKerning: TYPESET_COMMON.fontKerning,
  };
}

export type TypesetTextAlign = 'left' | 'center' | 'right';

/**
 * 서버 /preview renderInput.blocks[].style 8키 — FE 내부 모델(값은 그대로 옮긴다, lib/n5/preview-state.ts toTypesetServerStyle).
 * 이 값이 있으면 역할 기본값(ROLE_STYLE_DEFAULTS)으로 다시 계산하지 않는다. fontSizePx 는 배율 적용 전 섹션 원본 px 다.
 */
export interface TypesetServerStyle {
  fontFamily: string;
  fontWeight: number;
  fontSizePx: number;
  /** 서버에 저장된 적용 배율(절대값) */
  fontScale: number;
  /** '#RRGGBB' 그대로 */
  fontColor: string;
  align: TypesetTextAlign;
  letterSpacingEm: number;
  lineHeightRatio: number;
}

/** 서버 style 의 최종 글자 크기 = fontSizePx × 절대 배율, 한 번만 곱한다. 배율은 세션 초안이 있으면 그것, 없으면 서버 fontScale */
export function resolveServerFontPx(style: TypesetServerStyle, userFontScale?: number): number {
  return effectiveFontSize(style.fontSizePx, userFontScale ?? style.fontScale);
}

/** 조판 블록 한 개를 그리는 데 필요한 입력 — API DTO 가 아니다 */
export interface TypesetBlockStyleInput {
  role: TypesetRole;
  sourceImageWidth: number;
  /** 절대 배율. 없으면 서버 style 의 fontScale, 그것도 없으면 1 */
  userFontScale?: number;
  /** 섹션 로컬 원본 px. 조정 박스/원본 선택은 호출자가 resolveActiveBBox 로 한다 */
  bbox: BoundingBox;
  /** 없으면 서버 style.align, 그것도 없으면 TYPESET_COMMON.textAlignFallback */
  textAlign?: TypesetTextAlign;
  /** 서버 renderInput style. 있으면 역할 기본값 대신 이 값만 쓴다(표시·측정 공통) */
  serverStyle?: TypesetServerStyle | null;
}

/**
 * 조판 블록의 완성 CSS — TypesetBlock(표시)과 측정기(측정)가 같은 값을 쓰게 하는 단일 정본이다.
 * 앱 전역 CSS 가 값을 바꾸지 못하도록 줄바꿈·글꼴에 영향을 주는 속성을 모두 명시한다.
 * 모든 값이 문자열이라 React style 과 element.style 어디에 넣어도 같은 결과다.
 */
export function typesetBlockStyle(
  input: TypesetBlockStyleInput,
  fontFamily: string = TYPESET_COMMON.fontFamily,
): Record<string, string> | null {
  const server = input.serverStyle;
  const style: TypesetTextStyle | null = server
    ? {
        fontFamily: server.fontFamily,
        fontSize: `${resolveServerFontPx(server, input.userFontScale)}px`,
        fontWeight: server.fontWeight,
        letterSpacing: `${server.letterSpacingEm}em`,
        lineHeight: server.lineHeightRatio,
        color: server.fontColor,
        textAlign: server.align,
        whiteSpace: TYPESET_COMMON.whiteSpace,
        fontKerning: TYPESET_COMMON.fontKerning,
      }
    : typesetTextStyle(input.role, input.sourceImageWidth, input.userFontScale);
  if (!style) return null;
  // 서버 style 이 있으면 글꼴도 그 값이다(측정기 기본 글꼴로 바꾸지 않는다)
  const family = server ? server.fontFamily : fontFamily;
  const { bbox } = input;
  return {
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
    fontFamily: `"${family}"`,
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
  };
}
