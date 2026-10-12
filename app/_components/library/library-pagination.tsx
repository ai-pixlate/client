// M1 보관함 pagination — Figma 719:7428 "Frame 477"(832:6472).
//   Icon Button Rounded/XS 28×28 × 7, gap 8, radius 4 / 선택 = bg #171717 + 흰 glyph, 나머지 = bg white
//   glyph는 모두 12px optical(Chevron Left·Right, Number 1·2·3·7, More) 원본 SVG(public/library/icons)
//
// Pagination contract unavailable — visual shell only.
// GET /library에 page·pageSize·total·totalPages·cursor가 없다. 페이지 번호·선택 상태는 Figma의
// 초기 모습일 뿐 실제 서버 page가 아니며, 모든 control은 disabled다(데이터 분할·이동 없음).
// 비활성 표현은 다운로드·삭제 disabled와 같은 opacity-40을 pagination 전체에 준다.

/* eslint-disable @next/next/no-img-element -- 고정 크기 장식 SVG glyph라 next/image 최적화가 필요 없다 */

/** Card/Navigation/Chevron Left · Size=12 (53:997) */
function ChevronLeftGlyph12() {
  return (
    <span aria-hidden="true" className="relative block size-3 shrink-0 overflow-hidden">
      <span className="absolute inset-[22.5%_37.5%_22.5%_35%]">
        <span className="absolute inset-[-5.68%_-11.36%]">
          <img alt="" src="/library/icons/chevron-left-12.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Navigation/Chevron Right · Size=12 (53:1014) */
function ChevronRightGlyph12() {
  return (
    <span aria-hidden="true" className="relative block size-3 shrink-0 overflow-hidden">
      <span className="absolute inset-[22.5%_35%_22.5%_37.5%]">
        <span className="absolute inset-[-5.68%_-11.36%]">
          <img alt="" src="/library/icons/chevron-right-12.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Navigation/More · Size=12 (53:1082) */
function MoreGlyph12() {
  return (
    <span aria-hidden="true" className="relative block size-3 shrink-0 overflow-hidden">
      <span className="absolute inset-[46.25%_21.25%]">
        <img alt="" src="/library/icons/more-12.svg" className="absolute inset-0 block size-full max-w-none" />
      </span>
    </span>
  );
}

/** Icon/Number · Size=12 (290:2334) — glyph SVG가 12×12 frame 전체를 차지한다. */
function NumberGlyph12({ src }: { src: string }) {
  return (
    <span aria-hidden="true" className="relative block size-3 shrink-0">
      <img alt="" src={src} className="absolute inset-0 block size-full max-w-none" />
    </span>
  );
}

/* eslint-enable @next/next/no-img-element */

const PAGE_BUTTON_CLASS =
  'flex size-7 shrink-0 cursor-not-allowed items-center justify-center rounded-[4px]';

/** Figma Frame 477 그대로의 페이지 번호 구성. 실제 page 수와 무관하다. */
const SHELL_PAGES = [
  { label: '1', src: '/library/icons/number-1-12-selected.svg', selected: true },
  { label: '2', src: '/library/icons/number-2-12.svg', selected: false },
  { label: '3', src: '/library/icons/number-3-12.svg', selected: false },
  null, // More(…)
  { label: '7', src: '/library/icons/number-7-12.svg', selected: false },
] as const;

export function LibraryPagination() {
  return (
    <nav aria-label="보관함 페이지" data-testid="library-pagination" className="flex items-center gap-2 opacity-40">
      <button type="button" disabled aria-label="이전 페이지" data-testid="library-page-prev" className={`${PAGE_BUTTON_CLASS} bg-white`}>
        <ChevronLeftGlyph12 />
      </button>
      {SHELL_PAGES.map((page, i) =>
        page === null ? (
          <span key={`more-${i}`} aria-hidden="true" data-testid="library-page-more" className={`${PAGE_BUTTON_CLASS} cursor-default bg-white`}>
            <MoreGlyph12 />
          </span>
        ) : (
          <button
            key={page.label}
            type="button"
            disabled
            aria-label={`${page.label} 페이지`}
            aria-current={page.selected ? 'page' : undefined}
            data-testid={`library-page-${page.label}`}
            className={`${PAGE_BUTTON_CLASS} ${page.selected ? 'bg-[#171717]' : 'bg-white'}`}
          >
            <NumberGlyph12 src={page.src} />
          </button>
        ),
      )}
      <button type="button" disabled aria-label="다음 페이지" data-testid="library-page-next" className={`${PAGE_BUTTON_CLASS} bg-white`}>
        <ChevronRightGlyph12 />
      </button>
    </nav>
  );
}
