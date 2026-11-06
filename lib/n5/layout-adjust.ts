/**
 * N5 블록 배치 저장(F-CFM-15, BlockPatch.layoutAdjust) — 계약 확정·서버 구현 대기.
 *
 * - 박스: 섹션 로컬 원본 px(N5 local bbox 와 같은 좌표계). 화면 px 로 바꾸지 않고 반올림·내림하지 않는다.
 * - 배율: 기준 글자 크기 대비 절대 배율(직전 배율에 곱하지 않는다). 1.0 은 서버가 null 로 정규화한다.
 * - 끌기·손잡이 = box 만, [+][−] = box + fontScale 을 한 요청으로(바꾼 필드만 싣는다 — 안쪽 생략 = 유지).
 * - `layoutAdjust: null` = 전부 해제, 안쪽 null = 그 값만 해제, 빈 객체 `{}` 는 보내지 않는다.
 * - 배치만 바꿔도 trans1 은 필수다 — 서버에 저장된 현재 번역문을 보낸다(저장하지 않은 초안을 몰래 저장하지 않는다).
 *
 * 순수 모듈이다(React·브라우저 API 없음, scripts/verify-n5-layout-adjust.mjs).
 */

import type { ApiBlockPatch, ApiLayoutAdjustPatch, ApiLayoutBox, ApiTextBlock } from '../api/n5-schema';
import type { BoundingBox } from '../api/types';

/**
 * /blocks 에 실린 저장 조정. 키가 없는 응답(현행 서버 — 구현 전)은 'missing' 으로 따로 둔다 — null(조정 없음)과 섞지 않는다.
 */
export type N5StoredLayout =
  | { kind: 'missing' }
  | { kind: 'none' }
  | { kind: 'value'; box: BoundingBox | null; fontScale: number | null };

export function fromLayoutBox(box: ApiLayoutBox): BoundingBox {
  return { x: box.x, y: box.y, width: box.w, height: box.h };
}

/** 값을 그대로 옮긴다 — 반올림·내림 없음 */
export function toLayoutBox(box: BoundingBox): ApiLayoutBox {
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

export function readStoredLayout(dto: Pick<ApiTextBlock, 'layoutAdjust'>): N5StoredLayout {
  if (!('layoutAdjust' in dto) || dto.layoutAdjust === undefined) return { kind: 'missing' };
  if (dto.layoutAdjust === null) return { kind: 'none' };
  return {
    kind: 'value',
    box: dto.layoutAdjust.box ? fromLayoutBox(dto.layoutAdjust.box) : null,
    fontScale: typeof dto.layoutAdjust.fontScale === 'number' ? dto.layoutAdjust.fontScale : null,
  };
}

/** 저장 조정의 박스(없으면 null — 원본 bbox 를 쓴다) */
export function storedLayoutBox(stored: N5StoredLayout): BoundingBox | null {
  return stored.kind === 'value' ? stored.box : null;
}

/** 저장 조정의 배율(없으면 null — 적용 배율 1.0) */
export function storedLayoutFontScale(stored: N5StoredLayout): number | null {
  return stored.kind === 'value' ? stored.fontScale : null;
}

/**
 * 저장 응답 block 의 적용값 — null 은 원본 bbox·배율 1.0 으로 해석한다. 키가 없으면(서버 구현 전 응답) null — 호출부가 화면 값을 유지한다.
 */
export function appliedLayoutFromBlock(dto: Pick<ApiTextBlock, 'layoutAdjust' | 'bbox'>): { bbox: BoundingBox; fontScale: number } | null {
  const stored = readStoredLayout(dto);
  if (stored.kind === 'missing' || !dto.bbox) return null;
  const original: BoundingBox = { x: dto.bbox.x ?? 0, y: dto.bbox.y ?? 0, width: dto.bbox.w ?? 0, height: dto.bbox.h ?? 0 };
  return { bbox: storedLayoutBox(stored) ?? original, fontScale: storedLayoutFontScale(stored) ?? 1 };
}

/** FE 조작 → layoutAdjust 요청. 바꾼 필드만 싣는다 */
export type N5LayoutChange = { kind: 'box'; box: BoundingBox } | { kind: 'box-and-scale'; box: BoundingBox; fontScale: number };

export function buildLayoutAdjustPatch(change: N5LayoutChange): ApiLayoutAdjustPatch {
  return change.kind === 'box' ? { box: toLayoutBox(change.box) } : { box: toLayoutBox(change.box), fontScale: change.fontScale };
}

/** 해제 요청 — 'all' = layoutAdjust null, 'box'·'fontScale' = 그 값만 null. 빈 객체는 만들지 않는다 */
export function buildLayoutAdjustReset(target: 'all' | 'box' | 'fontScale'): ApiLayoutAdjustPatch | null {
  if (target === 'all') return null;
  return target === 'box' ? { box: null } : { fontScale: null };
}

/**
 * 배치 저장 PATCH 본문 — trans1 은 서버의 현재 번역문(같은 값이라 번역문은 no-op), revision 은 실행 시점의 최신 서버 값.
 * 빈 객체 layoutAdjust 는 계약상 422 라 만들지 않는다(빈 객체면 throw — 호출 버그).
 */
export function buildLayoutBlockPatch(current: Pick<ApiTextBlock, 'trans1' | 'revision'>, layoutAdjust: ApiLayoutAdjustPatch | null): ApiBlockPatch {
  if (current.revision == null) throw new Error('N5 layoutAdjust: revision 이 없습니다');
  if (layoutAdjust && Object.keys(layoutAdjust).length === 0) throw new Error('N5 layoutAdjust: 빈 객체는 보내지 않는다');
  return { trans1: current.trans1 ?? '', revision: current.revision, layoutAdjust };
}

/**
 * 서버가 배치를 저장하는 렌더 대상인지 — 라벨·로고(isExcluded)·빈 원문·빈 번역문은 아니다(409 not_render_target).
 * FE 는 이런 블록의 배치를 서버로 보내지 않는다(세션 local 편집만).
 */
export function isLayoutRenderTarget(block: { editable: boolean; sourceText: string; translatedText: string }): boolean {
  return block.editable && block.sourceText.trim() !== '' && block.translatedText.trim() !== '';
}

/** 409 INVALID_STATE details.reason=not_render_target */
export function isNotRenderTargetError(error: { code: string; details: Record<string, unknown> | null } | null): boolean {
  return error?.code === 'INVALID_STATE' && error.details?.reason === 'not_render_target';
}

/** 서버 계약 범위 — 0 ≤ x, 0 ≤ y, w > 0, h > 0, x+w ≤ 폭, y+h ≤ 높이(허용 오차 없음). FE 는 보정하지 않는다 */
export function isLayoutBoxInSection(box: ApiLayoutBox, section: { width: number; height: number }): boolean {
  return box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= section.width && box.y + box.h <= section.height;
}
