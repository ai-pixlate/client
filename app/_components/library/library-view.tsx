'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
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
import { ArrowLeftGlyph16, ChevronDownGlyph14, CompactCheckbox, SearchGlyph14 } from './library-controls';
import { LibraryDownloadModal } from './library-download-modal';
import { LibraryPagination } from './library-pagination';

// ─────────────────────────────────────────────────────────────────
// M1 보관함 (Figma 719:7428, 기준 frame 1920×1080)
//
//   back Icon Button        x40 y40, 40×40 (Rounded/MD/Secondary, Arrow Left 16)
//   제목/설명 (753:6374)     x120 y80, 세로 Auto Layout gap 12 — 제목 32 Bold(높이 38), 설명 14 Regular(17)
//   필터1 (1069:11738)       y187, 높이 39, 좌(검색 404·국가 124·정렬 124, gap 16) ↔ 우(gap 12)
//   카드 grid (721:7647)     y250, 4열, column gap 27, row gap 24
//
// 1920 고정 캔버스를 그대로 복사하지 않는다. content는 좌측 120px에서 시작하고 폭은
// "viewport − 좌우 여백(120 + 119)"을 따르되 최대 1681px이다 — 1920에서 정확히 1681(카드 400×4 +
// gap 27×3)이 되고, 그보다 좁은 화면에서는 4열이 함께 줄어 가로로 넘치지 않는다.
//
// 데이터: GET /library → toLibraryCardViewModels(adapter) → 검색·국가 필터·최신순
// (lib/library/view.ts) → 카드. 국가·언어 표시 이름은 GET /master/countries·languages.
//
// 하단 pagination(832:6472)은 Figma 모습 그대로 두되 계약(page/total)이 없어 visual shell + disabled다.
// 페이지는 세로 flex라 내용이 짧으면 pagination이 화면 하단(아래 여백 60)에, 길면 내용 아래에 온다.
//
// 계약이 없어 연결하지 않은 것: 삭제(DELETE /library/{jobId} 12월 미확정), 다운로드(bulk API 없음),
// 다른 버전 만들기(POST /jobs/{jobId}/versions 12월 미확정), 미완료 카드(status/currentStep 없음).
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
  const hasVisibleSelection = visibleIds.some((id) => selected.has(id));

  // 다운로드 모달 — 선택이 1건 이상이면 상단 다운로드로 연다. 닫아도 카드 선택은 유지하고
  // 포커스는 다운로드 버튼으로 돌려준다.
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadButtonRef = useRef<HTMLButtonElement>(null);
  const closeDownload = useCallback(() => {
    setDownloadOpen(false);
    downloadButtonRef.current?.focus();
  }, []);

  // master 응답 전·실패·미등록 코드는 code 그대로 보여준다(빈칸 금지).
  const countryLabel = (code: string | null) => (code == null ? null : getCodeLabel(code, countryNames));
  const languageLabel = (code: string | null) => (code == null ? null : getCodeLabel(code, languageNames));

  return (
    <main className="relative flex min-h-screen flex-col bg-white">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="뒤로 가기"
        className="absolute top-10 left-10 flex size-10 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white transition-colors hover:bg-gray-50"
      >
        <ArrowLeftGlyph16 />
      </button>

      <div className="ml-[120px] w-[calc(100%-239px)] max-w-[1681px] pt-20">
        <header className="flex flex-col items-start gap-3 leading-[normal]">
          <h1 className="text-[32px] font-bold tracking-[-0.64px] text-[#171717]">보관함</h1>
          <p className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">저장한 결과물과 진행 중인 작업을 한곳에서 관리합니다.</p>
        </header>

        {/* 필터1 — 좌측 control group과 우측 action group을 양끝 정렬(justify-between).
            좁은 화면에서는 검색 폭만 줄어든다(Select/Dropdown 최소 폭 가이드 160). */}
        <div className="mt-10 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <label className="relative flex w-[404px] min-w-[160px] shrink items-center">
              <span className="sr-only">상품명 검색</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="검색 하기"
                data-testid="library-search"
                className="w-full rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[38px] pl-[14px] text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070] placeholder:text-[#707070] outline-none focus:border-[#ff6a38] [&::-webkit-search-cancel-button]:hidden"
              />
              <span className="pointer-events-none absolute top-1/2 right-[14px] -translate-y-1/2">
                <SearchGlyph14 />
              </span>
            </label>

            <label className="relative flex w-[124px] shrink-0 items-center">
              <span className="sr-only">국가 필터</span>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                data-testid="library-country-filter"
                className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[38px] pl-[14px] text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070] outline-none focus:border-[#ff6a38]"
              >
                <option value="">국가</option>
                {countryCodes.map((code) => (
                  <option key={code} value={code}>
                    {getCodeLabel(code, countryNames)}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute top-1/2 right-[14px] -translate-y-1/2">
                <ChevronDownGlyph14 />
              </span>
            </label>

            <label className="relative flex w-[124px] shrink-0 items-center">
              <span className="sr-only">정렬</span>
              <select
                value={SORT_NEWEST}
                onChange={() => {}}
                data-testid="library-sort"
                className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[38px] pl-[14px] text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070] outline-none focus:border-[#ff6a38]"
              >
                <option value={SORT_NEWEST}>최신순</option>
              </select>
              <span className="pointer-events-none absolute top-1/2 right-[14px] -translate-y-1/2">
                <ChevronDownGlyph14 />
              </span>
            </label>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-2">
              <CompactCheckbox
                id="library-select-all"
                checked={allSelected}
                onChange={() => setSelected((prev) => toggleSelectAll(prev, visibleIds))}
                testId="library-select-all"
              />
              <label
                htmlFor="library-select-all"
                className="cursor-pointer text-[12px] leading-[normal] font-light tracking-[-0.48px] whitespace-nowrap text-[#171717]"
              >
                전체선택
              </label>
            </div>
            {/* Button Tertiary/SM(57:1605): px 12 + label container px 8(좌우 합 20), 12 Regular −0.24 →
                81×30. Button Danger/XS(57:1704): border #E5484D(inside), px 10 + label px 2,
                12 Regular −0.24 → 45×24. 다운로드(F-LST-06)는 선택이 있으면 모달을 연다(실제 파일
                다운로드는 계약 대기). 삭제(F-LST-04): API 계약 확정 후 활성화. */}
            <button
              ref={downloadButtonRef}
              type="button"
              disabled={!hasVisibleSelection}
              onClick={() => setDownloadOpen(true)}
              aria-haspopup="dialog"
              data-testid="library-download"
              className="flex items-center justify-center rounded-[4px] bg-white px-5 py-2 text-[12px] leading-[normal] tracking-[-0.24px] whitespace-nowrap text-[#171717] disabled:cursor-not-allowed disabled:opacity-40"
            >
              다운로드
            </button>
            <button
              type="button"
              disabled
              data-testid="library-delete"
              className="flex items-center justify-center rounded-[4px] border border-[#e5484d] bg-white px-[11px] py-1 text-[12px] leading-[normal] tracking-[-0.24px] whitespace-nowrap text-[#e5484d] disabled:cursor-not-allowed disabled:opacity-40"
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
            <div data-testid="library-grid" className="mt-6 grid grid-cols-4 gap-x-[27px] gap-y-6">
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

      {/* Figma: frame 하단에서 60px 위, 가로 중앙(1920에서 x838 y992). */}
      <div className="mt-auto flex justify-center pt-10 pb-[60px]">
        <LibraryPagination />
      </div>

      {downloadOpen && <LibraryDownloadModal onClose={closeDownload} />}
    </main>
  );
}
