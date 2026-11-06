'use client';

import { useEffect, useId, useRef, useState } from 'react';

import type { ApiRegulatoryClass } from '@/lib/api/job-schema';

// ─────────────────────────────────────────────────────────────────
// 규제 분류 드롭다운 — Figma 525:3023 「Field / 규제 분류」의 dropdown open(1502:21358).
//
// 닫힘: 474×39 흰 배경 · #eaeaea border · radius 6 · 14px #171717 + Chevron Down 14.
// 열림: 같은 트리거(위쪽 radius만) 아래로 39px 항목 4개 — 12px Light #707070, 좌우 border,
// 마지막 항목만 아래 border·radius. Figma처럼 목록은 레이아웃 흐름 안에서 아래 내용(OTC 종류 등)을 밀어낸다.
// 우측 패널만 스크롤되고 동의·[다음]은 패널 밖이라 가려지지 않는다. 열 때와 키보드로 항목을 옮길 때
// 목록·항목이 패널 스크롤 영역 밖이면 보이는 위치까지 스크롤한다.
// 선택·hover 상태는 Figma에 없어 카테고리 트리 창의 항목 패턴(선택 #f5f5f5 + orange, hover gray-50)을
// 그대로 쓴다. 공용 dropdown primitive가 없어(다른 화면은 native select) N1 전용으로 둔다.
//
// 키보드는 WAI-ARIA select-only combobox 패턴이다 — 포커스는 트리거에 머물고
// aria-activedescendant로 현재 항목을 알린다. Enter·Space·↓·↑로 열고, 열린 상태에서 ↑↓로 이동,
// Enter·Space로 선택, Esc·Tab·바깥 클릭으로 닫는다.
// ─────────────────────────────────────────────────────────────────

export interface RegulatoryClassOption {
  value: ApiRegulatoryClass;
  label: string;
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 5.5L7 9L10.5 5.5" stroke="#707070" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RegulatoryClassDropdown({
  options,
  value,
  onChange,
  onClose,
  invalid,
  describedBy,
}: {
  options: RegulatoryClassOption[];
  value: ApiRegulatoryClass | '';
  onChange: (value: ApiRegulatoryClass) => void;
  /** 목록이 닫힐 때마다(선택 여부와 무관) — 필드 오류 표시 시점에 쓴다 */
  onClose?: () => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openList = (index = selectedIndex >= 0 ? selectedIndex : 0) => {
    setActiveIndex(index);
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    onClose?.();
  };

  const choose = (index: number) => {
    onChange(options[index].value);
    closeList();
  };

  // 패널이 낮아 목록이 스크롤 영역 아래로 잘리면 보이게 한다(흐름 배치라 주변이 밀린다)
  useEffect(() => {
    if (open) listboxRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listboxRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  // 바깥 클릭으로 닫는다 — 트리거·목록 안의 클릭은 각자 처리한다
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0) choose(activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        closeList();
        break;
      case 'Tab':
        closeList();
        break;
    }
  };

  return (
    <div ref={rootRef}>
      <button
        type="button"
        role="combobox"
        aria-label="규제 분류"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        data-testid="n1-regulatory-class"
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleKeyDown}
        className={`flex h-[39px] w-full items-center justify-between border border-[#eaeaea] bg-white px-[14px] py-[10px] text-left outline-none focus-visible:border-[#ff6a38] ${
          open ? 'rounded-t-[6px]' : 'rounded-[6px]'
        }`}
      >
        <span className="truncate text-[14px] leading-[normal] tracking-[-0.01em] text-[#171717]">
          {selected?.label ?? '선택'}
        </span>
        <ChevronDownIcon />
      </button>
      {open && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label="규제 분류"
          // 아래 border는 마지막 항목 안에 둔다 — Figma처럼 항목마다 39(목록 전체 4×39)
          className="overflow-hidden rounded-b-[6px] border-x border-[#eaeaea] bg-white"
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            const isActive = index === activeIndex;
            return (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                // 트리거의 포커스를 빼앗지 않는다(키보드 흐름 유지)
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
                className={`flex h-[39px] cursor-pointer items-center border-[#eaeaea] px-[14px] last:border-b text-[12px] leading-[normal] font-light tracking-[-0.04em] ${
                  isSelected ? 'bg-[#f5f5f5] text-[#ff6a38]' : isActive ? 'bg-gray-50 text-[#707070]' : 'text-[#707070]'
                }`}
              >
                {option.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
