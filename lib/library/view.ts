/**
 * M1 보관함 화면 로직 — 검색(F-LST-01) · 국가 필터 · 최신순 · 선택(F-LST-03) · 표시 포맷.
 *
 * React 없이 Node에서 검증할 수 있는 순수 함수만 둔다(scripts/verify-library-view.mjs).
 * 입력은 lib/library/adapter.ts의 LibraryCardViewModel이다 — API DTO를 여기서 다시
 * 해석하지 않는다.
 *
 * 계약 범위(v3.4.2 LibraryCard): 검색 대상 중 상품코드·핵심 키워드는 LibraryCard에
 * 없어 productName만 검색한다. 정렬은 Figma에 있는 "최신순"(savedAt 내림차순) 하나뿐이다.
 */

import type { LibraryCardViewModel } from './adapter.ts';

export interface LibraryFilter {
  /** 상품명 검색어. 앞뒤 공백은 무시하고 대소문자를 구분하지 않는다. */
  query: string;
  /** targetCountry 코드. 빈 문자열이면 전체. */
  country: string;
}

export function filterLibraryCards(
  cards: LibraryCardViewModel[],
  filter: LibraryFilter,
): LibraryCardViewModel[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return cards.filter((card) => {
    if (filter.country && card.targetCountry !== filter.country) return false;
    if (query && !(card.productName ?? '').toLocaleLowerCase().includes(query)) return false;
    return true;
  });
}

/**
 * 최신순 — savedAt 내림차순. savedAt이 없거나 파싱할 수 없는 카드는 뒤로 보내고,
 * 같은 시각끼리는 서버 응답 순서를 유지한다(Array.prototype.sort는 안정 정렬).
 */
export function sortLibraryCardsByNewest(cards: LibraryCardViewModel[]): LibraryCardViewModel[] {
  const time = (card: LibraryCardViewModel) => {
    const t = card.savedAt ? Date.parse(card.savedAt) : Number.NaN;
    return Number.isNaN(t) ? null : t;
  };
  return [...cards].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  });
}

/** 국가 필터 옵션 — 실제 카드에 존재하는 targetCountry만, 처음 등장한 순서대로. */
export function getCountryFilterCodes(cards: LibraryCardViewModel[]): string[] {
  const codes: string[] = [];
  for (const card of cards) {
    if (card.targetCountry && !codes.includes(card.targetCountry)) codes.push(card.targetCountry);
  }
  return codes;
}

/** master 목록({code, name}) → code→name 조회 맵. code나 name이 비어 있는 항목은 버린다. */
export function toNameMap(items: { code?: string; name?: string }[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items ?? []) {
    if (item.code && item.name) map.set(item.code, item.name);
  }
  return map;
}

/**
 * 국가·언어 코드 → 표시 이름. master에서 찾으면 name, 못 찾으면(요청 실패·응답 전·미등록 코드)
 * code 그대로. 빈 문자열을 돌려주지 않는다.
 */
export function getCodeLabel(code: string, names: ReadonlyMap<string, string>): string {
  return names.get(code) ?? code;
}

/**
 * 규격(specType) 표시 이름 — N1 결과물 규격 선택과 같은 명칭(Figma 1211:6585 "M1 카드 사이즈").
 * 계약 enum 밖의 값이나 null이면 null을 돌려준다(빈칸·임의 라벨을 만들지 않는다).
 */
const SPEC_TYPE_LABEL: Record<NonNullable<LibraryCardViewModel['specType']>, string> = {
  original: '원본 유지',
  site: '판매처 맞춤',
  custom: '커스텀',
};

export function getSpecTypeLabel(specType: LibraryCardViewModel['specType']): string | null {
  if (specType == null) return null;
  return SPEC_TYPE_LABEL[specType] ?? null;
}

/** savedAt(ISO) → 'YYYY.MM.DD'(사용자 로컬 날짜). 없거나 파싱할 수 없으면 null. */
export function formatSavedDate(savedAt: string | null): string | null {
  if (!savedAt) return null;
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return null;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

/* ------------------------------------------------------------------ *
 * 선택(F-LST-03) — 선택 상태는 jobId Set이다(배열 index를 식별자로 쓰지 않는다).
 * ------------------------------------------------------------------ */

export function toggleSelection(selected: ReadonlySet<number>, jobId: number): Set<number> {
  const next = new Set(selected);
  if (next.has(jobId)) next.delete(jobId);
  else next.add(jobId);
  return next;
}

/** 대상 카드 중 선택된 개수 — 선택 개수 표시와 다운로드 활성 판단이 같은 값을 쓴다. */
export function countSelected(selected: ReadonlySet<number>, jobIds: number[]): number {
  return jobIds.reduce((count, id) => (selected.has(id) ? count + 1 : count), 0);
}

/**
 * 결과 밖 선택 수 — 보관함에 있는 카드(allJobIds) 중 현재 검색·필터 결과(visibleJobIds) 밖에서 선택된 수.
 * 재조회로 보관함에서 사라진 jobId가 선택 Set에 남아 있어도 세지 않는다.
 */
export function countHiddenSelected(
  selected: ReadonlySet<number>,
  allJobIds: number[],
  visibleJobIds: number[],
): number {
  const visible = new Set(visibleJobIds);
  return allJobIds.reduce((count, id) => (selected.has(id) && !visible.has(id) ? count + 1 : count), 0);
}

/**
 * 선택 개수 문구 — 현재 결과 안 선택(visible)과 결과 밖 선택(hidden)을 나눠 돌려준다. 둘 다 0이면 null(숨김).
 *   visible만:  "3개 선택"
 *   둘 다:      "2개 선택" + "다른 조건에서 12개 선택됨"
 *   hidden만:   "다른 조건에서 14개 선택됨"
 */
export function getSelectionSummary(
  visibleCount: number,
  hiddenCount: number,
): { visible: string | null; hidden: string | null } | null {
  if (visibleCount <= 0 && hiddenCount <= 0) return null;
  return {
    visible: visibleCount > 0 ? `${visibleCount}개 선택` : null,
    hidden: hiddenCount > 0 ? `다른 조건에서 ${hiddenCount}개 선택됨` : null,
  };
}

/** 대상 카드가 하나 이상이고 전부 선택돼 있는지. */
export function isAllSelected(selected: ReadonlySet<number>, jobIds: number[]): boolean {
  return jobIds.length > 0 && jobIds.every((id) => selected.has(id));
}

/**
 * 전체선택 토글 — 대상(현재 검색·필터 결과)이 전부 선택돼 있으면 대상만 해제하고, 아니면 대상 전부를
 * 선택에 더한다. 대상 밖(필터에 가려진) 카드의 선택은 어느 쪽이든 그대로 둔다.
 */
export function toggleSelectAll(selected: ReadonlySet<number>, jobIds: number[]): Set<number> {
  const next = new Set(selected);
  if (isAllSelected(selected, jobIds)) for (const id of jobIds) next.delete(id);
  else for (const id of jobIds) next.add(id);
  return next;
}

/* ------------------------------------------------------------------ *
 * 페이지네이션 — GET /library에 page 계약이 없어 받은 목록을 FE에서 나눈다.
 * 페이지 수는 전체 보관함이 아니라 현재 검색·필터 결과 수로 계산한다.
 * ------------------------------------------------------------------ */

/**
 * 한 페이지의 결과 카드 수. Figma 719:7428의 4열×2줄 grid는 결과 카드 7장 + "이미지 추가 생성"
 * 카드 1장이다 — 추가 카드는 매 페이지 마지막 칸에 둔다(2026-10-14 사용자 확정).
 */
export const LIBRARY_PAGE_SIZE = 7;

/** 결과 0건이면 0페이지. */
export function getTotalPages(count: number, pageSize: number = LIBRARY_PAGE_SIZE): number {
  return count <= 0 ? 0 : Math.ceil(count / pageSize);
}

/** 검색·필터로 페이지 수가 줄면 존재하는 마지막 페이지로, 0페이지면 1로 맞춘다. */
export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), Math.max(1, totalPages));
}

export function getPageItems<T>(items: T[], page: number, pageSize: number = LIBRARY_PAGE_SIZE): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export type PaginationItem = number | 'more';

/**
 * 페이지 번호 구성 — Figma Frame 477(1·2·3·…·7, 현재 1)처럼 번호 칸을 최대 5개로 고정한다.
 *   전체 5페이지 이하: 전부
 *   현재가 앞쪽(≤3):   1 2 3 … N
 *   현재가 뒤쪽(≥N−2): 1 … N−2 N−1 N
 *   그 사이:           1 … 현재 … N
 */
export function getPaginationItems(current: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, 'more', totalPages];
  if (current >= totalPages - 2) return [1, 'more', totalPages - 2, totalPages - 1, totalPages];
  return [1, 'more', current, 'more', totalPages];
}
