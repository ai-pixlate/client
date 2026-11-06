/**
 * 조판 렌더 입력 — FE 내부 모델이며 API DTO 가 아니다.
 *
 *   /preview renderInput → adapter(lib/n5/preview-state.ts) → TypesetRenderModel → TypesetBlock(표시) / 측정기(측정)
 * 서버 style 8키(serverStyle)가 있으면 그 값만 쓴다. 역할 기본값은 renderInput 이 없는 Mock·QA 경로에서만 쓴다.
 * 저장된 입력(renderInput) 위에 세션 local 편집값(번역 초안·박스·배율)만 덮는다.
 *
 * 순수 모듈이다(scripts/verify-n5-typeset-final-output.mjs 로 Node 에서 검증).
 */

import type { BoundingBox } from '../api/types';
import type { TypesetMeasureInput } from './typeset-measurement';
import { type TypesetRole, type TypesetServerStyle, type TypesetTextAlign, resolveActiveBBox } from './typeset-rules.ts';

export interface TypesetRenderModel {
  blockId: number;
  /** 소속 섹션 — 최종 출력 offset 을 찾을 때 쓴다 */
  sectionId: number;
  revision?: number;

  text: string;
  role: TypesetRole;

  /** 섹션 로컬 원본 px. 덮어쓰지 않는다 */
  originalBBox: BoundingBox;
  /** 섹션 로컬 원본 px. 있으면 originalBBox 대신 쓴다 */
  adjustedBBox?: BoundingBox | null;

  sourceImageWidth: number;

  /** 기준 글자 크기에 곱하는 절대 배율. 직전 최종 크기에 다시 곱하지 않는다 */
  userFontScale: number;

  /** 서버 style.align 또는 없으면 left. bbox 위치로 추측해 채우지 않는다 */
  textAlign?: TypesetTextAlign;

  /** 서버 renderInput style 8키. 없으면 역할 기본값(Mock·QA)으로 그린다 */
  serverStyle?: TypesetServerStyle | null;

  /** 블록 제외 여부. 섹션 제외(bucket)와 독립이다 */
  excluded: boolean;
}

/** 표시와 측정이 같은 박스·배율을 쓰도록 모델을 측정 입력으로 바꾼다 */
export function toTypesetMeasureInput(model: TypesetRenderModel): TypesetMeasureInput {
  return {
    text: model.text,
    role: model.role,
    sourceImageWidth: model.sourceImageWidth,
    userFontScale: model.userFontScale,
    bbox: resolveActiveBBox(model.originalBBox, model.adjustedBBox),
    textAlign: model.textAlign,
    serverStyle: model.serverStyle ?? null,
  };
}

/**
 * ?qaTypeset=1 — Mock 조판 진단 주소인지. Mock 켜짐 여부는 호출부가 함께 본다.
 * 정상 조판 경로는 이 주소와 무관하다(renderInput 이 있으면 일반 N5 도 HTML 로 그린다). QA 는 진단 표시와 renderInput 이 없는 섹션의
 * 역할 기본값 조판을 더할 뿐이다.
 */
export function isTypesetQaUrl(url: string): boolean {
  if (!url) return false;
  try {
    return new URL(url).searchParams.get('qaTypeset') === '1';
  } catch {
    return false;
  }
}
