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

/** 대상 카드가 하나 이상이고 전부 선택돼 있는지. */
export function isAllSelected(selected: ReadonlySet<number>, jobIds: number[]): boolean {
  return jobIds.length > 0 && jobIds.every((id) => selected.has(id));
}

/** 전체선택 토글 — 대상이 전부 선택돼 있으면 해제, 아니면 대상 전부를 선택한다. */
export function toggleSelectAll(selected: ReadonlySet<number>, jobIds: number[]): Set<number> {
  return isAllSelected(selected, jobIds) ? new Set() : new Set(jobIds);
}
