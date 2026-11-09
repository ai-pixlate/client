/**
 * N5 블록 배치 저장(BlockPatch.layoutAdjust) Mock 서버 동작 — OpenAPI 3.5.10 blockPatch 「블록 배치」 계약을 흉내 낸다.
 * 실제 서버 구현이 아니다(서버 구현 대기). FE 코드와 분리해 둔 순수 함수다(scripts/verify-n5-layout-adjust.mjs).
 *
 * - 요청 형식(422): 빈 객체 · box 좌표 일부만 · 정의되지 않은 키 · fontScale ≤ 0
 * - 업무 검증(400): 섹션 밖 박스(0 ≤ x, 0 ≤ y, w > 0, h > 0, x+w ≤ 폭, y+h ≤ 높이 — 허용 오차 없음, 보정하지 않음)
 * - 병합: layoutAdjust null = 전부 해제 / 안쪽 생략 = 유지 / 안쪽 null = 그 값만 해제
 * - 정규화: fontScale 1.0 → null, box = 원본 bbox → null, 둘 다 null → layoutAdjust null(필드마다 따로)
 */

import type { ApiLayoutAdjust, ApiLayoutAdjustPatch, ApiLayoutBox } from '../api/n5-schema';

/** 블록 원본 bbox(TextBlock.bbox) */
type OriginalBox = { x?: number; y?: number; w?: number; h?: number } | null | undefined;

export type MockLayoutPatchParse =
  | { ok: true; patch: ApiLayoutAdjustPatch | null }
  | { ok: false; status: 422; message: string };

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** body.layoutAdjust 값(키가 있을 때만 부른다) */
export function parseMockLayoutPatch(raw: unknown): MockLayoutPatchParse {
  if (raw === null) return { ok: true, patch: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, status: 422, message: 'layoutAdjust must be an object or null' };
  const keys = Object.keys(raw);
  if (keys.length === 0) return { ok: false, status: 422, message: 'layoutAdjust must not be empty' };
  if (keys.some((key) => key !== 'box' && key !== 'fontScale')) return { ok: false, status: 422, message: 'unknown key in layoutAdjust' };
  const value = raw as { box?: unknown; fontScale?: unknown };
  const patch: ApiLayoutAdjustPatch = {};
  if ('box' in value) {
    if (value.box === null) patch.box = null;
    else {
      const box = value.box as Record<string, unknown> | undefined;
      if (!box || typeof box !== 'object' || !['x', 'y', 'w', 'h'].every((k) => isNumber(box[k])) || Object.keys(box).length !== 4) {
        return { ok: false, status: 422, message: 'box needs x, y, w, h' };
      }
      patch.box = { x: box.x as number, y: box.y as number, w: box.w as number, h: box.h as number };
    }
  }
  if ('fontScale' in value) {
    if (value.fontScale === null) patch.fontScale = null;
    else if (!isNumber(value.fontScale) || value.fontScale <= 0) return { ok: false, status: 422, message: 'fontScale must be > 0' };
    else patch.fontScale = value.fontScale;
  }
  return { ok: true, patch };
}

export function isMockBoxInSection(box: ApiLayoutBox, section: { width: number; height: number }): boolean {
  return box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 && box.x + box.w <= section.width && box.y + box.h <= section.height;
}

const sameAsOriginal = (box: ApiLayoutBox, original: OriginalBox) =>
  original != null && box.x === original.x && box.y === original.y && box.w === original.w && box.h === original.h;

/** 저장 조정 병합 + 정규화 */
export function applyMockLayoutPatch(
  current: ApiLayoutAdjust | null | undefined,
  patch: ApiLayoutAdjustPatch | null,
  original: OriginalBox,
): ApiLayoutAdjust | null {
  if (patch === null) return null;
  const merged = {
    box: 'box' in patch ? (patch.box ?? null) : (current?.box ?? null),
    fontScale: 'fontScale' in patch ? (patch.fontScale ?? null) : (current?.fontScale ?? null),
  };
  const box = merged.box && !sameAsOriginal(merged.box, original) ? merged.box : null;
  const fontScale = merged.fontScale != null && merged.fontScale !== 1 ? merged.fontScale : null;
  return box == null && fontScale == null ? null : { box, fontScale };
}

export function isSameMockLayout(a: ApiLayoutAdjust | null | undefined, b: ApiLayoutAdjust | null | undefined): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left === null || right === null) return left === right;
  const sameBox =
    left.box === null || right.box === null
      ? left.box === right.box
      : left.box.x === right.box.x && left.box.y === right.box.y && left.box.w === right.box.w && left.box.h === right.box.h;
  return sameBox && left.fontScale === right.fontScale;
}

/**
 * legacy 적용 박스(server PR #116 대비) — /blocks 의 layoutAdjust 는 null 인데 렌더 입력(renderInput.box)에는 이전 저장 출처의 박스가
 * 적용되는 상태. Mock 내부 상태이며 /blocks DTO 에는 싣지 않는다(?mockScenario=n5-layout-legacy).
 * 셀러가 box 를 정하거나(box 키) 전부 해제하면(layoutAdjust null) 사라진다 — 그래서 null → null 저장도 적용 박스가 바뀌는 실제 변경이다.
 */
export function clearsMockLegacyBox(patch: ApiLayoutAdjustPatch | null): boolean {
  return patch === null || 'box' in patch;
}

/** 렌더 입력 계산용 — 셀러 박스가 없으면 legacy 박스를 적용값으로 얹는다(배율은 셀러 값 그대로) */
export function withMockLegacyBox<T extends { layoutAdjust?: ApiLayoutAdjust | null }>(block: T, legacyBox: ApiLayoutBox | undefined): T {
  if (!legacyBox || block.layoutAdjust?.box) return block;
  return { ...block, layoutAdjust: { box: legacyBox, fontScale: block.layoutAdjust?.fontScale ?? null } };
}
