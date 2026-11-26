/**
 * M0 브랜드 선택 · H 홈 브랜드 목록 화면 로직 — 검색 · 최신순 · 대표 로고 · 선택.
 *
 * React 없이 Node 에서 검증할 수 있는 순수 함수만 둔다(scripts/verify-m0-view.mjs).
 * 입력은 GET /brands(Brand) · GET /brands/{brandId}/logos(BrandLogo) 응답 그대로다(OpenAPI v3.5.10).
 *
 * 계약 범위:
 *   - Brand 에 국가 필드가 없다 — 국가 필터는 거를 기준이 없어 여기서 만들지 않는다(가짜 필터 금지).
 *   - 정렬은 Figma 「최신순」 하나다. Brand.updatedAt(없으면 createdAt) 내림차순이고, 둘 다 없거나 읽을 수 없으면 뒤로 보낸다.
 *   - 브랜드별 보관함(M1) 조회 계약이 없어 「브랜드 진입」은 여기서 다루지 않는다. 선택은 화면 안 시각 상태일 뿐이다.
 */

import type { ApiBrand, ApiBrandLogo } from '../api/brand-schema.ts';

/** 화면이 쓰는 브랜드 — id 가 없는 항목은 계약 밖이라 뺀다(배열 index 로 대신하지 않는다) */
export type M0Brand = ApiBrand & { id: number };

export function toM0Brands(brands: readonly ApiBrand[]): M0Brand[] {
  return brands.filter((brand): brand is M0Brand => typeof brand.id === 'number');
}

/** 카드·접근성에 쓰는 이름 — 한글명, 없으면 영문명 */
export function getBrandDisplayName(brand: ApiBrand): string {
  const ko = brand.nameKo?.trim();
  if (ko) return ko;
  return brand.nameEn?.trim() ?? '';
}

/** 검색 — 한글명·영문명 부분 일치(대소문자 무시, 앞뒤 공백 무시). 빈 검색어면 전부 */
export function filterBrands<T extends ApiBrand>(brands: readonly T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...brands];
  return brands.filter((brand) =>
    [brand.nameKo, brand.nameEn].some((name) => typeof name === 'string' && name.toLocaleLowerCase().includes(q)),
  );
}

function brandTime(brand: ApiBrand): number | null {
  for (const value of [brand.updatedAt, brand.createdAt]) {
    if (!value) continue;
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/** 최신순 — updatedAt(없으면 createdAt) 내림차순. 시각이 없는 브랜드는 서버 순서를 지킨 채 뒤로 */
export function sortBrandsByNewest<T extends ApiBrand>(brands: readonly T[]): T[] {
  return [...brands].sort((a, b) => {
    const ta = brandTime(a);
    const tb = brandTime(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  });
}

/**
 * 카드에 보일 대표 로고 — 서버 순서(orderNo ASC)의 첫 로고. FE 가 다시 정렬하지 않는다(lib/brand/m2-adapter toM2Logos 와 같은 원칙).
 * logoUrl 은 presigned(만료 5분)라 저장하지 않고 조회 결과에서 바로 쓴다. 로고가 없으면 null(카드는 영문명 워드마크를 보인다).
 */
export function pickBrandLogoUrl(logos: readonly ApiBrandLogo[] | undefined): string | null {
  const first = logos?.find((logo) => typeof logo.logoUrl === 'string' && logo.logoUrl !== '');
  return first?.logoUrl ?? null;
}

/** 로고가 없을 때 Figma 「워드마크」 변형(1839:36610)에 쓰는 글자 — 영문명(필수 필드), 없으면 한글명 */
export function getBrandWordmark(brand: ApiBrand): string {
  const en = brand.nameEn?.trim();
  if (en) return en;
  return brand.nameKo?.trim() ?? '';
}

/* ------------------------------------------------------------------ *
 * 선택 — 브랜드 id Set. 전체선택은 현재 검색 결과에만 적용한다(M1 과 같은 규칙).
 * ------------------------------------------------------------------ */

export function toggleBrandSelection(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function isAllBrandsSelected(selected: ReadonlySet<number>, ids: readonly number[]): boolean {
  return ids.length > 0 && ids.every((id) => selected.has(id));
}

/** 현재 결과가 모두 선택돼 있으면 그 결과만 해제, 아니면 결과 전부 선택. 결과 밖 선택은 그대로 둔다 */
export function toggleSelectAllBrands(selected: ReadonlySet<number>, ids: readonly number[]): Set<number> {
  const next = new Set(selected);
  if (isAllBrandsSelected(selected, ids)) ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}
