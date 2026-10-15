'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { toLibraryCardViewModels } from '@/lib/library/adapter';
import {
  clampPage,
  countHiddenSelected,
  countSelected,
  filterLibraryCards,
  getCodeLabel,
  getCountryFilterCodes,
  getPageItems,
  getSelectionSummary,
  getTotalPages,
  isAllSelected,
  sortLibraryCardsByNewest,
  toggleSelectAll,
  toggleSelection,
  toNameMap,
} from '@/lib/library/view';
import { useLibraryQuery, useMasterCountriesQuery, useMasterLanguagesQuery } from '@/lib/queries/pixlate';

import { LibraryAddCard, LibraryCard } from './library-card';
import { ChevronDownGlyph14, CompactCheckbox, SearchGlyph14 } from './library-controls';
import { LibraryDownloadModal } from './library-download-modal';
import { LibraryPagination } from './library-pagination';

// ─────────────────────────────────────────────────────────────────
// M1 보관함 (Figma 719:7428, 기준 frame 1920×1080)
//
//   back Icon Button        x40 y40, 40×40 (Rounded/MD/Secondary, Arrow Left 16) — 현재 렌더하지 않는다(아래)
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
// 하단 pagination(832:6472): GET /library에 page 계약이 없어 받은 목록을 FE에서 나눈다. 한 페이지는 결과
// 카드 LIBRARY_PAGE_SIZE(7)장 + "이미지 추가 생성" 카드(매 페이지 마지막 칸)다. 페이지 수는 현재
// 검색·필터 결과 수로 계산하고, 2페이지 이상일 때만 pagination을 렌더한다(0건·1페이지는 숨김).
// 페이지는 세로 flex라 내용이 짧으면 pagination이 화면 하단(아래 여백 60)에, 길면 내용 아래에 온다.
// pagination이 없을 때도 아래 여백 60은 main이 유지한다.
//
// 계약이 없어 연결하지 않은 것: 삭제(DELETE /library/{jobId} 12월 미확정), 다운로드(bulk API 없음),
// 다른 버전 만들기(POST /jobs/{jobId}/versions 12월 미확정), 미완료 카드(status/currentStep 없음).
//
// 좌측 상단 back 버튼은 렌더하지 않는다 — 브라우저 히스토리(router.back)를 쓰면 진입 경로에 따라
// N1·N6·앱 외부로 이동했다. 12월 M0 브랜드 목록이 생기면 "M0로 가기"로 다시 연결한다
// (Figma 위치 x40 y40 40×40, ArrowLeftGlyph16). absolute 배치였으므로 숨겨도 레이아웃은 그대로다.
// ─────────────────────────────────────────────────────────────────

/** Figma 정렬 dropdown에 있는 항목은 "최신순" 하나뿐이다 — 다른 정렬을 임의로 추가하지 않는다. */
const SORT_NEWEST = 'newest';

export default function LibraryView() {
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

  // 검색·필터로 결과가 줄어 현재 페이지가 사라지면 존재하는 마지막 페이지를 보여준다(렌더 시 파생 —
  // 별도 effect 없이 다음 이동도 이 값에서 시작한다).
  const [page, setPage] = useState(1);
  const totalPages = getTotalPages(visibleCards.length);
  const currentPage = clampPage(page, totalPages);
  const pageCards = useMemo(() => getPageItems(visibleCards, currentPage), [visibleCards, currentPage]);

  const countryNames = useMemo(() => toNameMap(countriesQuery.data), [countriesQuery.data]);
  const languageNames = useMemo(() => toNameMap(languagesQuery.data), [languagesQuery.data]);
  const countryCodes = useMemo(() => getCountryFilterCodes(cards), [cards]);

  // 확정 정책: 전체선택의 대상은 현재 검색·필터 결과(visibleCards 전체)다. pagination이 있어도
  // 현재 페이지(pageCards)만이 아니라 조건에 맞는 카드 목록 전체를 기준으로 한다.
  // 전체해제도 같은 대상에만 적용한다 — 검색·필터에 가려진 카드의 선택은 전체선택·전체해제 어느 쪽에서도
  // 바뀌지 않고, 검색·필터를 바꿔도 선택 Set은 비우지 않는다. 선택 개수·전체선택 상태·다운로드 활성(=다운로드
  // 대상)은 모두 현재 결과 안의 선택만 센다 — 가려진 선택은 조건을 풀면 다시 개수에 잡힌다.
  const allSelected = isAllSelected(selected, visibleIds);
  const selectedCount = countSelected(selected, visibleIds);
  const hasVisibleSelection = selectedCount > 0;
  // 검색·필터에 가려진 선택은 개수·다운로드 대상에 넣지 않되, 남아 있다는 사실은 보조 문구로 알린다.
  const allIds = useMemo(() => cards.map((card) => card.jobId), [cards]);
  const hiddenSelectedCount = countHiddenSelected(selected, allIds, visibleIds);
  const selectionSummary = getSelectionSummary(selectedCount, hiddenSelectedCount);
  // 보관함 자체가 빈 상태(카드 0건)와 검색·필터 결과 0건을 구분한다.
  const isFilteredEmpty = cards.length > 0 && visibleCards.length === 0;

  // 다운로드 모달 — 선택이 1건 이상이면 상단 다운로드로 연다. 닫아도 카드 선택은 유지한다.
  // 포커스 복귀는 모달이 배경 inert를 푼 뒤(unmount) 직접 한다 — 다운로드 버튼이 없거나 비활성이면 제목으로.
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeDownload = useCallback(() => setDownloadOpen(false), []);

  // master 응답 전·실패·미등록 코드는 code 그대로 보여준다(빈칸 금지).
  const countryLabel = (code: string | null) => (code == null ? null : getCodeLabel(code, countryNames));
  const languageLabel = (code: string | null) => (code == null ? null : getCodeLabel(code, languageNames));

  return (
    <main className="relative flex min-h-screen flex-col bg-white pb-[60px]">

      <div className="ml-[120px] w-[calc(100%-239px)] max-w-[1681px] pt-20">
        <header className="flex flex-col items-start gap-3 leading-[normal]">
          {/* tabIndex -1: 모달 포커스 복귀의 대체 위치(Tab 순서에는 들어가지 않는다). */}
          <h1 ref={titleRef} tabIndex={-1} className="text-[32px] font-bold tracking-[-0.64px] text-[#171717] outline-none">
            보관함
          </h1>
          <p className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">저장한 결과물과 진행 중인 작업을 한곳에서 관리합니다.</p>
        </header>

        {/* 필터1 — 좌측 control group과 우측 action group을 양끝 정렬(justify-between).
            좁은 화면에서는 검색 폭만 줄어든다(Select/Dropdown 최소 폭 가이드 160).
            Select / Dropdown(28:142)은 border 1 + px 14라 우측 glyph(Search·Chevron Down 14)의 오른쪽 끝이
            테두리 바깥에서 15px이다 — label 기준 absolute right-[15px]. */}
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
              <span className="pointer-events-none absolute top-1/2 right-[15px] -translate-y-1/2">
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
              <span className="pointer-events-none absolute top-1/2 right-[15px] -translate-y-1/2">
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
              <span className="pointer-events-none absolute top-1/2 right-[15px] -translate-y-1/2">
                <ChevronDownGlyph14 />
              </span>
            </label>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/* 선택 개수(F-LST-03 ②) — Figma 필터1에 자리가 없어 전체선택 왼쪽에 같은 Caption
                (12 Light −0.48)의 보조색 #707070으로 최소 보완했다. 선택이 하나도 없으면 문구를 비운다. 우측
                group은 오른쪽 끝 정렬이라 문구가 생겨도 전체선택·다운로드·삭제 위치는 움직이지 않는다.
                검색·필터에 가려진 선택은 "다른 조건에서 N개 선택됨"을 덧붙인다(현재 결과 선택이 있으면 " · "로
                이어 쓴다). 보조 문구도 text/secondary #707070(흰 배경 4.95:1)을 쓴다 — text/territory #999는
                2.85:1로 일반 텍스트 AA(4.5:1)에 못 미친다. 위계는 굵기로 둔다 — 현재 결과 선택 수는
                Label/LM_pt_rg_12(12 Regular −0.24), 다른 조건 문구와 구분점은 Body/Caption_pt_lt_12(12 Light −0.48). */}
            <span
              role="status"
              data-testid="library-selected-count"
              className="text-[12px] leading-[normal] font-light tracking-[-0.48px] whitespace-nowrap text-[#707070]"
            >
              {selectionSummary && (
                <>
                  {selectionSummary.visible && (
                    <span data-testid="library-selected-count-visible" className="font-normal tracking-[-0.24px]">
                      {selectionSummary.visible}
                    </span>
                  )}
                  {selectionSummary.visible && selectionSummary.hidden && <span> · </span>}
                  {selectionSummary.hidden && (
                    <span data-testid="library-selected-count-hidden">
                      {selectionSummary.hidden}
                    </span>
                  )}
                </>
              )}
            </span>
            {/* 검색·필터 결과 0건이면 전체선택 대상이 없어 Disabled(Checkbox 28:74 — box #F5F5F5·border #EAEAEA,
                label text/territory #999). native disabled라 클릭·키보드로 바뀌지 않고, 결과 밖 선택 Set은 그대로다. */}
            <div className="flex items-center gap-2">
              <CompactCheckbox
                id="library-select-all"
                checked={allSelected}
                disabled={visibleIds.length === 0}
                onChange={() => setSelected((prev) => toggleSelectAll(prev, visibleIds))}
                testId="library-select-all"
              />
              <label
                htmlFor="library-select-all"
                data-testid="library-select-all-label"
                className={`text-[12px] leading-[normal] font-light tracking-[-0.48px] whitespace-nowrap ${
                  visibleIds.length === 0 ? 'cursor-not-allowed text-[#999]' : 'cursor-pointer text-[#171717]'
                }`}
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
          libraryQuery.isSuccess &&
          (isFilteredEmpty ? (
            // 검색·필터 결과 0건 — Figma 미정 fallback. 공용 Empty State 컴포넌트가 없어 추가 생성 카드의
            // 제목(16 Medium)·보조(12 Regular) 문구 스타일을 그대로 쓰고, 카드 한 줄 높이(280)를 차지해
            // 하단 pagination 위치가 크게 흔들리지 않게 한다. "+" 카드는 이 상태에서 보이지 않는다.
            <div
              role="status"
              data-testid="library-filtered-empty"
              className="mt-6 flex h-[280px] flex-col items-center justify-center gap-2 leading-[normal]"
            >
              <p className="text-[16px] font-medium tracking-[-0.48px] text-[#171717]">검색 결과가 없습니다.</p>
              <p className="text-[12px] tracking-[-0.12px] text-[#707070]">검색어나 필터 조건을 변경해 보세요.</p>
            </div>
          ) : (
            <div data-testid="library-grid" className="mt-6 grid grid-cols-4 gap-x-[27px] gap-y-6">
              {pageCards.map((card) => (
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
          ))
        )}
      </div>

      {/* Figma: frame 하단에서 60px 위, 가로 중앙(1920에서 x838 y992). */}
      {libraryQuery.isSuccess && totalPages > 1 && (
        <div className="mt-auto flex justify-center pt-10">
          <LibraryPagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {downloadOpen && (
        <LibraryDownloadModal onClose={closeDownload} returnFocusRef={downloadButtonRef} fallbackFocusRef={titleRef} />
      )}
    </main>
  );
}
