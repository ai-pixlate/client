/**
 * N5 HTML/CSS 조판 확정 규칙 — FE 기준 SSOT(순수 계산).
 *
 * 근거: 「pixlate HTML/CSS 조판 규칙 협의 v0.1」(2026-10-29)에서 합의 완료·방식 합의·기존 승인값으로 정한 항목만
 * 옮겼다. 미정 항목(조정값 저장 구조·필드명, 정렬 기준 저장, [+][-] 확대 기준점·박스 비례식, 섹션 경계 정책,
 * 자동 넘침 해소, renderer 입력·버전)은 여기 두지 않는다. API 타입을 바꾸지 않으며, 인자 이름도 API 필드가 아니다.
 *
 * React 도 브라우저 API 도 쓰지 않는다(scripts/verify-n5-typeset-rules.mjs 로 Node 에서 검증).
 * 실제 글자 경계(ink) 측정 엔진은 FE 에 없다 — isInkOverflow 는 측정 결과를 받아 비교만 한다.
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
  return (
    ink.left < box.x ||
    ink.top < box.y ||
    ink.right > box.x + box.width ||
    ink.bottom > box.y + box.height
  );
}

/** 조판 텍스트 CSS 계약(React style 객체 형태). 화면에 연결하는 곳은 아직 없다 */
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
