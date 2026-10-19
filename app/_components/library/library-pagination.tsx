import { getPaginationItems } from '@/lib/library/view';

import { MaskGlyph } from './library-controls';

// M1 보관함 pagination — Figma 719:7428 "Frame 477"(832:6472).
//   Icon Button Rounded/XS 28×28, gap 8, radius 4. 상태는 디자인 시스템 Icon Button(116:995)을 따른다.
//     Default(280:2893)/Secondary(116:979): bg white, glyph #171717
//     Hover(116:980):    bg #F5F5F5, glyph #171717
//     Disabled(116:982): bg #F5F5F5, glyph #999
//     현재 페이지:        bg #171717, glyph white(Frame 477의 "1")
//   glyph는 모두 12px optical(Chevron Left·Right, Icon/Number 0–9, More) 원본 SVG(public/library/icons)이고,
//   상태별 색은 MaskGlyph(bg-current)로 칠한다.
//
// GET /library에 page 계약이 없어 받은 목록을 FE에서 나눈다(lib/library/view.ts LIBRARY_PAGE_SIZE).
// 2페이지 이상일 때만 LibraryView가 렌더한다.

/** Card/Navigation/Chevron Left · Size=12 (53:997) */
function ChevronLeftGlyph12() {
  return (
    <span aria-hidden="true" className="relative block size-3 shrink-0 overflow-hidden">
      <span className="absolute inset-[22.5%_37.5%_22.5%_35%]">
        <span className="absolute inset-[-5.68%_-11.36%]">
          <MaskGlyph src="/library/icons/chevron-left-12.svg" />
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
          <MaskGlyph src="/library/icons/chevron-right-12.svg" />
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
        <MaskGlyph src="/library/icons/more-12.svg" className="absolute inset-0 block size-full" />
      </span>
    </span>
  );
}

/**
 * Icon/Number · Size=12 (290:2334) 한 자리. 0–7·9는 SVG가 12×12 frame 전체를 차지하고,
 * 8(290:2289)만 frame 안 Group inset이 있다.
 */
function DigitGlyph12({ digit }: { digit: string }) {
  const src = `/library/icons/number-${digit}-12.svg`;
  return (
    <span aria-hidden="true" className="relative block size-3 shrink-0 overflow-hidden">
      {digit === '8' ? (
        <span className="absolute inset-[17.92%_30%_17.5%_30%]">
          <span className="absolute inset-[-5.16%_-8.33%]">
            <MaskGlyph src={src} />
          </span>
        </span>
      ) : (
        <MaskGlyph src={src} className="absolute inset-0 block size-full" />
      )}
    </span>
  );
}

/** 페이지 번호 — Figma에는 한 자리 번호만 있다. 10 이상은 Icon/Number를 자리 수만큼 이어 붙인다. */
function PageNumberGlyph({ page }: { page: number }) {
  return (
    <span aria-hidden="true" className="flex">
      {String(page)
        .split('')
        .map((digit, i) => (
          <DigitGlyph12 key={i} digit={digit} />
        ))}
    </span>
  );
}

const PAGE_BUTTON_CLASS =
  'flex h-7 min-w-7 shrink-0 items-center justify-center rounded-[4px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]';
const DEFAULT_STATE_CLASS = 'bg-white text-[#171717] hover:bg-[#f5f5f5]';
const DISABLED_STATE_CLASS = 'disabled:cursor-not-allowed disabled:bg-[#f5f5f5] disabled:text-[#999]';

export function LibraryPagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const items = getPaginationItems(currentPage, totalPages);

  return (
    <nav aria-label="보관함 페이지" data-testid="library-pagination" className="flex items-center gap-2">
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        aria-label="이전 페이지"
        data-testid="library-page-prev"
        className={`${PAGE_BUTTON_CLASS} ${DEFAULT_STATE_CLASS} ${DISABLED_STATE_CLASS}`}
      >
        <ChevronLeftGlyph12 />
      </button>
      {items.map((item, i) =>
        item === 'more' ? (
          <span
            key={`more-${i}`}
            aria-hidden="true"
            data-testid="library-page-more"
            className={`${PAGE_BUTTON_CLASS} bg-white text-[#171717]`}
          >
            <MoreGlyph12 />
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            aria-label={`${item} 페이지`}
            aria-current={item === currentPage ? 'page' : undefined}
            data-testid={`library-page-${item}`}
            className={`${PAGE_BUTTON_CLASS} ${item === currentPage ? 'bg-[#171717] text-white' : DEFAULT_STATE_CLASS}`}
          >
            <PageNumberGlyph page={item} />
          </button>
        ),
      )}
      <button
        type="button"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        aria-label="다음 페이지"
        data-testid="library-page-next"
        className={`${PAGE_BUTTON_CLASS} ${DEFAULT_STATE_CLASS} ${DISABLED_STATE_CLASS}`}
      >
        <ChevronRightGlyph12 />
      </button>
    </nav>
  );
}
