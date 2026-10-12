'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { toLibraryCardViewModels } from '@/lib/library/adapter';
import {
  filterLibraryCards,
  getCodeLabel,
  getCountryFilterCodes,
  isAllSelected,
  sortLibraryCardsByNewest,
  toggleSelectAll,
  toggleSelection,
  toNameMap,
} from '@/lib/library/view';
import { useLibraryQuery, useMasterCountriesQuery, useMasterLanguagesQuery } from '@/lib/queries/pixlate';

import { LibraryAddCard, LibraryCard } from './library-card';
import { BackGlyph, ChevronDownIcon, CompactCheckbox, SearchIcon } from './library-controls';

// ─────────────────────────────────────────────────────────────────
// M1 보관함 (Figma 719:7428, 1920×1080)
//
//   back Icon Button   x40  y40  40×40
//   제목/설명           x120 y80  (제목 32 Bold·높이 38, 설명 14 Regular·top 130 = 80+38+12)
//   필터 바             x120 y187 1681×39
//   카드 grid           x120 y250 repeat(4, 400px) / column-gap 27 / row-gap 24
//
// 세로 위치는 제목 영역 높이를 107px(80→187), 필터 바 높이를 39px로 두고 grid를
// 24px 아래(226→250)에서 시작해 Figma 좌표를 그대로 맞춘다.
//
// 데이터: GET /library → toLibraryCardViewModels(adapter) → 검색·국가 필터·최신순
// (lib/library/view.ts) → 카드. 국가·언어 표시 이름은 GET /master/countries·languages.
//
// 계약이 없어 이번에 연결하지 않은 것(보고 대상): 하단 pagination(응답에 page/total 없음),
// 삭제(DELETE /library/{jobId} 12월 미확정), 다운로드(bulk API 없음), 다른 버전 만들기
// (POST /jobs/{jobId}/versions 12월 미확정), 미완료 카드(LibraryCard에 status/currentStep 없음).
// ─────────────────────────────────────────────────────────────────

/** Figma 정렬 dropdown에 있는 항목은 "최신순" 하나뿐이다 — 다른 정렬을 임의로 추가하지 않는다. */
const SORT_NEWEST = 'newest';

export default function LibraryView() {
  const router = useRouter();
  const libraryQuery = useLibraryQuery();
  const countriesQuery = useMasterCountriesQuery();
  const languagesQuery = useMasterLanguagesQuery();

  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  const cards = useMemo(() => toLibraryCardViewModels(libraryQuery.data ?? []), [libraryQuery.data]);
  const visibleCards = useMemo(
    () => sortLibraryCardsByNewest(filterLibraryCards(cards, { query, country })),
    [cards, query, country],
  );
  const visibleIds = useMemo(() => visibleCards.map((card) => card.jobId), [visibleCards]);

  const countryNames = useMemo(() => toNameMap(countriesQuery.data), [countriesQuery.data]);
  const languageNames = useMemo(() => toNameMap(languagesQuery.data), [languagesQuery.data]);
  const countryCodes = useMemo(() => getCountryFilterCodes(cards), [cards]);

  // 임시 정책(PM 확인 전): 전체선택의 대상은 지금 보이는 카드다. PRD에 전체선택 범위
  // (전체 library vs 필터 결과) 명세가 없다 — 확정되면 이 부분만 바꾼다.
  const allSelected = isAllSelected(selected, visibleIds);

  // master 응답 전·실패·미등록 코드는 code 그대로 보여준다(빈칸 금지).
  const countryLabel = (code: string | null) => (code == null ? null : getCodeLabel(code, countryNames));
  const languageLabel = (code: string | null) => (code == null ? null : getCodeLabel(code, languageNames));

  return (
    <main className="relative min-h-screen bg-white">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="뒤로 가기"
        className="absolute top-10 left-10 flex size-10 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
      >
        <BackGlyph />
      </button>

      <div className="w-[1681px] pt-[80px] pl-[120px] box-content">
        <header className="flex h-[107px] flex-col gap-3">
          <h1 className="text-[32px] leading-[38px] font-bold tracking-[-0.64px] text-[#171717]">보관함</h1>
          <p className="text-[14px] tracking-[-0.14px] text-[#707070]">저장한 결과물과 진행 중인 작업을 한곳에서 관리합니다.</p>
        </header>

        <div className="flex h-[39px] items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="relative block w-[404px]">
              <span className="sr-only">상품명 검색</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="검색 하기"
                data-testid="library-search"
                className="w-full rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[36px] pl-[14px] text-[14px] leading-[17px] text-[#707070] placeholder:text-[#707070] outline-none focus:border-[#ff6a38]"
              />
              <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2">
                <SearchIcon />
              </span>
            </label>

            <label className="relative block w-[124px]">
              <span className="sr-only">국가 필터</span>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                data-testid="library-country-filter"
                className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[32px] pl-[14px] text-[14px] leading-[17px] text-[#707070] outline-none focus:border-[#ff6a38]"
              >
                <option value="">국가</option>
                {countryCodes.map((code) => (
                  <option key={code} value={code}>
                    {getCodeLabel(code, countryNames)}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2">
                <ChevronDownIcon />
              </span>
            </label>

            <label className="relative block w-[124px]">
              <span className="sr-only">정렬</span>
              <select
                value={SORT_NEWEST}
                onChange={() => {}}
                data-testid="library-sort"
                className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[32px] pl-[14px] text-[14px] leading-[17px] text-[#707070] outline-none focus:border-[#ff6a38]"
              >
                <option value={SORT_NEWEST}>최신순</option>
              </select>
              <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2">
                <ChevronDownIcon />
              </span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <CompactCheckbox
                id="library-select-all"
                checked={allSelected}
                onChange={() => setSelected((prev) => toggleSelectAll(prev, visibleIds))}
                testId="library-select-all"
              />
              <label htmlFor="library-select-all" className="cursor-pointer text-[12px] text-[#171717]">
                전체선택
              </label>
            </div>
            {/* Button Tertiary/SM(12px Regular, px12·py8, radius 4) · Danger/XS(12px, px10·py5,
                radius 4, #E5484D). 다운로드(F-LST-06)·삭제(F-LST-04): API 계약 확정 후 활성화. */}
            <button
              type="button"
              disabled
              data-testid="library-download"
              className="rounded-[4px] bg-white px-3 py-2 text-[12px] font-normal text-[#171717] disabled:cursor-not-allowed disabled:opacity-40"
            >
              다운로드
            </button>
            <button
              type="button"
              disabled
              data-testid="library-delete"
              className="rounded-[4px] border border-[#e5484d] bg-white px-2.5 py-[5px] text-[12px] text-[#e5484d] disabled:cursor-not-allowed disabled:opacity-40"
            >
              삭제
            </button>
          </div>
        </div>

        {libraryQuery.isError ? (
          // Figma 미정 fallback — 오류 상태 디자인이 없고 공용 error 컴포넌트도 없다. 실패를 빈
          // 보관함처럼 보이지 않게, 다른 화면(N3·N5·N6)과 같은 text-red-500 한 줄 문구만 둔다.
          <p role="alert" className="mt-6 text-[12px] text-red-500">
            보관함을 불러오지 못했습니다.
          </p>
        ) : (
          libraryQuery.isSuccess && (
            <div
              data-testid="library-grid"
              className="mt-6 grid grid-cols-[repeat(4,400px)] gap-x-[27px] gap-y-6 pb-20"
            >
              {visibleCards.map((card) => (
                <LibraryCard
                  key={card.jobId}
                  card={card}
                  countryName={countryLabel(card.targetCountry)}
                  languageName={languageLabel(card.targetLanguage)}
                  selected={selected.has(card.jobId)}
                  onToggleSelect={() => setSelected((prev) => toggleSelection(prev, card.jobId))}
                />
              ))}
              <LibraryAddCard />
            </div>
          )
        )}
      </div>
    </main>
  );
}
