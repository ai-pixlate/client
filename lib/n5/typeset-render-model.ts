/**
 * 조판 렌더 입력 — FE 내부 모델이며 API DTO 가 아니다.
 *
 * 저장·조회 계약(조정 박스, 글자 배율, 정렬 기준)이 아직 없어 이 모델을 채우는 adapter 는 만들지 않았다.
 * 계약이 오면 아래 순서로 연결한다. 비어 있는 곳은 첫 단계뿐이다.
 *   API → adapter → TypesetRenderModel → TypesetBlock(표시) / 측정기(측정) → evaluateTypesetBlock(평가)
 *
 * 순수 모듈이다(scripts/verify-n5-typeset-final-output.mjs 로 Node 에서 검증).
 */

import type { BoundingBox } from '../api/types';
import type { TypesetMeasureInput } from './typeset-measurement';
import { type TypesetRole, resolveActiveBBox } from './typeset-rules.ts';

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

  /** 기본 글자 크기에 곱하는 사용자 배율. 직전 최종 크기에 다시 곱하지 않는다 */
  userFontScale: number;

  /** 없으면 left. 기존 데이터에서 정렬 기준을 추측해 채우지 않는다 */
  textAlign?: 'left' | 'center' | 'right';

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
  };
}
