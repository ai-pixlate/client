'use client';

import { useEffect, useRef, useState } from 'react';

import { categoryPathValue, findCategoryPath, SELLER_DISPLAY_CATEGORIES, type DisplayCategoryNode } from '../_data/seller-display-categories';
import { ChevronRightGlyph14, CloseGlyph20 } from './n1-glyphs';

// N1 카테고리 선택 — Figma 1094:10968 「카테고리 선택」의 Category Input / Specimen(1094:11176).
//
// 1192×468, white, radius 5, padding 32, drop-shadow, 세로 gap 16:
//   선택 영역 1128×351 — 대분류 · 중분류 · 소분류 3 column(각 flex-1 ≈ 359), column 사이 gap 12 + 1px divider #EAEAEA.
//   column heading 30(px 16 · py 8, 12 Light #999), row 53(px 16 · py 18, 14 Regular). 기본 #707070,
//   선택 bg #F5F5F5 · text #FF6A38, 하위 단계가 있으면 오른쪽 Chevron right 14.
//   닫기 Close 20 — 우상단(right 24, top 24.81). 하단 행(y399, h37) 오른쪽 끝 확인 버튼(80×37, Button Primary/MD).
// 데이터가 351 높이를 넘으므로 modal 크기는 그대로 두고 각 column의 목록만 세로 스크롤한다(heading 고정).
//
// 계층 선택: 대분류 → 중분류 → (있으면) 소분류. 소분류가 없는 중분류는 그 자체가 최종 선택값이다.
// 상위를 바꾸면 하위 선택은 초기화된다. 확인은 최종 선택값이 있을 때만 누를 수 있고, 닫기·Escape·바깥 클릭은
// 임시 선택만 버린다(이미 적용된 값은 page가 그대로 들고 있다).

export function CategorySelectorModal({
  currentValue,
  onClose,
  onConfirm,
}: {
  /** 현재 적용된 카테고리 경로 값(없으면 '') — 열 때 그 경로를 미리 펼친다. */
  currentValue: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const [path, setPath] = useState<DisplayCategoryNode[]>(() => findCategoryPath(currentValue) ?? []);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [l1, l2, l3] = path;

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // 최종 선택 — 소분류가 없는 중분류이거나, 고른 소분류.
  const finalPath = l3 ? path : l2 && !l2.children ? [l1, l2] : null;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="카테고리 선택"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        data-testid="n1-category-modal"
        className="absolute top-[calc(50%+26px)] left-1/2 flex h-[468px] w-[1192px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[5px] bg-white p-8 outline-none drop-shadow-[2px_2px_12px_rgba(0,0,0,0.06)]"
      >
        <div className="flex min-h-0 w-full flex-1 items-stretch gap-3 overflow-hidden">
          <CategoryColumn
            heading="대분류"
            items={SELLER_DISPLAY_CATEGORIES}
            selected={l1}
            onSelect={(node) => setPath([node])}
          />
          <ColumnDivider />
          <CategoryColumn heading="중분류" items={l1?.children ?? []} selected={l2} onSelect={(node) => setPath([l1, node])} />
          <ColumnDivider />
          <CategoryColumn heading="소분류" items={l2?.children ?? []} selected={l3} onSelect={(node) => setPath([l1, l2, node])} />
        </div>

        <div className="flex h-[37px] w-full shrink-0 items-center justify-end">
          <button
            type="button"
            disabled={!finalPath}
            onClick={() => finalPath && onConfirm(categoryPathValue(finalPath))}
            data-testid="n1-category-confirm"
            className="flex h-[37px] items-center justify-center rounded-[6px] bg-[#171717] px-5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="px-2 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">확인</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          data-testid="n1-category-close"
          className="absolute top-[24.81px] right-6 flex size-5 items-center justify-center"
        >
          <CloseGlyph20 />
        </button>
      </div>
    </div>
  );
}

function ColumnDivider() {
  return <div aria-hidden="true" className="w-px shrink-0 self-stretch bg-[#eaeaea]" />;
}

function CategoryColumn({
  heading,
  items,
  selected,
  onSelect,
}: {
  heading: string;
  items: DisplayCategoryNode[];
  selected: DisplayCategoryNode | undefined;
  onSelect: (node: DisplayCategoryNode) => void;
}) {
  return (
    <section aria-label={heading} data-testid="n1-category-column" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-[30px] shrink-0 items-center px-4 py-2">
        <p className="text-[12px] leading-[14px] font-light tracking-[-0.48px] text-[#999]">{heading}</p>
      </div>
      {/* 목록만 세로 스크롤 — scrollbar 모양은 기존 패턴(n3-scroll-hidden)대로 숨긴다. */}
      <ul data-testid="n1-category-list" className="n3-scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {items.map((item) => {
          const isSelected = item === selected;
          return (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                aria-pressed={isSelected}
                className={`flex h-[53px] w-full items-center justify-between px-4 py-[18px] text-left text-[14px] leading-[17px] tracking-[-0.14px] whitespace-nowrap ${
                  isSelected ? 'bg-[#f5f5f5] text-[#ff6a38]' : 'text-[#707070] hover:bg-gray-50'
                }`}
              >
                <span>{item.label}</span>
                {item.children && <ChevronRightGlyph14 />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
