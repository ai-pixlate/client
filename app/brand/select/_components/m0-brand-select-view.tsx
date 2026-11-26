'use client';

import { useMemo, useState } from 'react';

import { AppHeader } from '@/app/_components/app-header/app-header';
import { BrandAddCard, BrandCard } from '@/app/_components/brand/brand-card';
import { ChevronDownGlyph14, CompactCheckbox, SearchGlyph14 } from '@/app/_components/library/library-controls';
import { LibraryPagination } from '@/app/_components/library/library-pagination';
import {
  filterBrands,
  isAllBrandsSelected,
  sortBrandsByNewest,
  toggleBrandSelection,
  toggleSelectAllBrands,
  toM0Brands,
} from '@/lib/brand/m0-view';
import { clampPage, getPageItems, getTotalPages } from '@/lib/library/view';
import { useBrandsQuery } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// M0 브랜드 선택 (Figma 1792:20008, 기준 frame 1920×1080)
//
//   공통 헤더(1792:20853)   0/0/1920/72 — AppHeader work 변형 · 화면명 「브랜드 선택」 · [브랜드 관리] 없음(자기 자신)
//   필터1 (1792:20031)      x120 y96, 높이 39 — 좌(검색 404 · 국가 124 · 정렬 124, gap 16) ↔ 우(전체선택)
//   카드 grid (1821:45446)  x120 y147, 4열(브랜드 추가 카드가 첫 칸) · column gap ≈27 · row gap 40(행 y 0·304·608) · 카드 264 높이
//   삭제 모달(1833:50729)   만들지 않는다 — 브랜드 삭제는 12월 이후 범위이고 DELETE /brands/{brandId} 계약도 없다. Figma 에도 여는 버튼이 없다.
//
// M1 과 같은 폭 규칙: 좌측 120에서 시작하고 "viewport − 239", 최대 1681. 좁은 화면에서는 4열이 함께 줄어 가로로 넘치지 않는다.
//
// 데이터(OpenAPI v3.5.10): GET /brands(목록) + 카드마다 GET /brands/{brandId}/logos(대표 로고). Figma 의 브랜드명·로고는 예시다.
//   검색 — 한글명·영문명 · 최신순 — updatedAt(없으면 createdAt) 내림차순(lib/brand/m0-view.ts)
//   국가 — Brand 계약에 국가가 없어 거를 수 없다. Figma 자리는 두되 비활성으로 둔다(가짜 필터 금지)
//   pagination — Figma Frame 477 자리. M1 과 같은 쪽 크기(브랜드 7 + 추가 카드 1)를 쓴다. 2쪽 이상일 때만 보인다
//
// 카드 동작(요구사항 v3.6.4 M0 · F-ACC-02): 본문 클릭의 최종 동작은 「그 브랜드의 M1 보관함」이다. 브랜드별 보관함 조회 계약이 없어
// 이번에는 연결하지 않는다(임의 API·FE 필터링 금지 — 완료 보고의 미완료 항목). 선택(주황 테두리 · checkbox)은 화면 안 시각 상태로만 둔다.
// ─────────────────────────────────────────────────────────────────

const SORT_NEWEST = 'newest';

export default function M0BrandSelectView() {
  const brandsQuery = useBrandsQuery(true);
  const brands = useMemo(() => toM0Brands(brandsQuery.data ?? []), [brandsQuery.data]);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [page, setPage] = useState(1);

  const visibleBrands = useMemo(() => sortBrandsByNewest(filterBrands(brands, query)), [brands, query]);
  const visibleIds = useMemo(() => visibleBrands.map((brand) => brand.id), [visibleBrands]);
  const totalPages = getTotalPages(visibleBrands.length);
  const currentPage = clampPage(page, totalPages);
  const pageBrands = useMemo(() => getPageItems(visibleBrands, currentPage), [visibleBrands, currentPage]);
  const allSelected = isAllBrandsSelected(selected, visibleIds);
  const isFilteredEmpty = brands.length > 0 && visibleBrands.length === 0;

  return (
    <div className="relative flex min-h-screen flex-col bg-white">
      <AppHeader variant="work" title="브랜드 선택" scope="M0" showBrandManage={false} />

      <main data-testid="m0-brand-select" className="flex flex-1 flex-col pb-[60px]">
        <div className="ml-[120px] w-[calc(100%-239px)] max-w-[1681px] pt-6">
          <h1 className="sr-only">브랜드 선택</h1>

          {/* 필터1 — M1 과 같은 Select / Dropdown(28:142) · Checkbox 인스턴스 */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <label className="relative flex w-[404px] min-w-[160px] shrink items-center">
                <span className="sr-only">브랜드명 검색</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="검색 하기"
                  data-testid="m0-search"
                  className="w-full rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[38px] pl-[14px] text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070] placeholder:text-[#707070] outline-none focus:border-[#ff6a38] [&::-webkit-search-cancel-button]:hidden"
                />
                <span className="pointer-events-none absolute top-1/2 right-[15px] -translate-y-1/2">
                  <SearchGlyph14 />
                </span>
              </label>

              {/* Brand 계약에 국가가 없어 거를 수 없다 — 자리만 두고 비활성 */}
              <label className="relative flex w-[124px] shrink-0 items-center" title="브랜드 국가 정보가 아직 제공되지 않습니다">
                <span className="sr-only">국가 필터(브랜드 국가 정보 미제공)</span>
                <select
                  value=""
                  disabled
                  onChange={() => {}}
                  data-testid="m0-country-filter"
                  className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[38px] pl-[14px] text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070] outline-none disabled:cursor-not-allowed"
                >
                  <option value="">국가</option>
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
                  data-testid="m0-sort"
                  className="w-full appearance-none rounded-[6px] border border-[#eaeaea] bg-white py-[10px] pr-[38px] pl-[14px] text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070] outline-none focus:border-[#ff6a38]"
                >
                  <option value={SORT_NEWEST}>최신순</option>
                </select>
                <span className="pointer-events-none absolute top-1/2 right-[15px] -translate-y-1/2">
                  <ChevronDownGlyph14 />
                </span>
              </label>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <CompactCheckbox
                id="m0-select-all"
                checked={allSelected}
                disabled={visibleIds.length === 0}
                onChange={() => setSelected((prev) => toggleSelectAllBrands(prev, visibleIds))}
                testId="m0-select-all"
              />
              <label
                htmlFor="m0-select-all"
                className={`text-[12px] leading-[normal] font-light tracking-[-0.48px] whitespace-nowrap ${
                  visibleIds.length === 0 ? 'cursor-not-allowed text-[#999]' : 'cursor-pointer text-[#171717]'
                }`}
              >
                전체선택
              </label>
            </div>
          </div>

          {brandsQuery.isError ? (
            // Figma 미정 fallback — M1 과 같은 한 줄 오류 문구. 실패를 빈 목록처럼 보이지 않게 한다
            <p role="alert" data-testid="m0-error" className="mt-3 text-[12px] text-red-500">
              브랜드 목록을 불러오지 못했습니다.
            </p>
          ) : brandsQuery.isPending ? (
            <p role="status" data-testid="m0-loading" className="sr-only">
              브랜드 목록을 불러오는 중입니다.
            </p>
          ) : isFilteredEmpty ? (
            <div
              role="status"
              data-testid="m0-filtered-empty"
              className="mt-3 flex h-[264px] flex-col items-center justify-center gap-2 leading-[normal]"
            >
              <p className="text-[16px] font-medium tracking-[-0.48px] text-[#171717]">검색 결과가 없습니다.</p>
              <p className="text-[12px] tracking-[-0.12px] text-[#707070]">검색어를 변경해 보세요.</p>
            </div>
          ) : (
            <div data-testid="m0-grid" className="mt-3 grid grid-cols-4 gap-x-[27px] gap-y-10">
              <BrandAddCard />
              {pageBrands.map((brand) => (
                <BrandCard
                  key={brand.id}
                  brand={brand}
                  selection={{
                    selected: selected.has(brand.id),
                    onToggle: () => setSelected((prev) => toggleBrandSelection(prev, brand.id)),
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {brandsQuery.isSuccess && totalPages > 1 && (
          <div className="mt-auto flex justify-center pt-10">
            <LibraryPagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </main>
    </div>
  );
}
