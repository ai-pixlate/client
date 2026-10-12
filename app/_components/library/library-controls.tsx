// M1 보관함 공용 컨트롤 — Figma 719:7428 안의 디자인 시스템 인스턴스를 옮긴다.
//
// 이 프로젝트에는 공용 디자인 시스템 컴포넌트 디렉터리가 없어 화면이 Figma 컴포넌트를
// Tailwind로 옮겨 쓴다. 아이콘은 Figma optical glyph(Card/Navigation/Arrow Left 16,
// Card/Action/Search 14, Card/Navigation/Chevron Down 14, Card/Action/Plus 12/16) 원본 SVG를
// public/library/icons/에 저장해 쓰고, glyph 박스 안 Group inset·bleed 비율도 Figma 그대로 둔다
// ("Geometry is size-specific, not container-resized").

/** 선택 상태 stroke — Checkbox/Compact와 선택된 카드가 같은 값을 쓴다(primary #FF6A38 / border #EAEAEA). */
export const SELECTED_BORDER_CLASS = 'border-[#ff6a38]';
export const UNSELECTED_BORDER_CLASS = 'border-[#eaeaea]';

/**
 * Checkbox / Compact(1063:5156) 인스턴스 — 20×20 frame 안에 18×18 visual(white, radius 4).
 *   Unchecked(1063:5143): border #EAEAEA
 *   Checked(1063:5146):   border #FF6A38 + Card/Action/Check 16 glyph(visual 좌상단 0,0 기준 — Figma inside
 *                         stroke라 CSS border 안쪽 기준으로는 −1px)
 */
export function CompactCheckbox({
  id,
  checked,
  onChange,
  label,
  testId,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  /** 화면에 보이는 label이 없을 때의 접근성 이름 */
  label?: string;
  testId?: string;
}) {
  return (
    <span className="relative flex size-5 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        aria-label={label}
        data-testid={testId}
        className="peer absolute inset-0 size-5 cursor-pointer opacity-0"
      />
      <span
        data-checkbox-visual=""
        className={`pointer-events-none relative block size-[18px] overflow-hidden rounded-[4px] border bg-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#ff6a38] ${
          checked ? SELECTED_BORDER_CLASS : UNSELECTED_BORDER_CLASS
        }`}
      >
        {checked && <CheckGlyph16 />}
      </span>
    </span>
  );
}

/* eslint-disable @next/next/no-img-element -- 고정 크기 장식 SVG glyph라 next/image 최적화가 필요 없다 */

/** Card/Action/Check · Size=16 (53:1166) — Checkbox/Compact Checked 안에서만 쓴다. */
function CheckGlyph16() {
  return (
    <span aria-hidden="true" data-testid="checkbox-check-glyph" className="absolute -top-px -left-px block size-4 overflow-hidden">
      <span className="absolute inset-[30%_22.5%]">
        <span className="absolute inset-[-9.77%_-7.1%]">
          <img alt="" src="/library/icons/check-16-primary.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Navigation/Arrow Left · Size=16 (53:971) */
export function ArrowLeftGlyph16() {
  return (
    <span aria-hidden="true" className="relative block size-4 shrink-0 overflow-hidden">
      <span className="absolute top-1/4 right-[20%] bottom-1/4 left-[20%]">
        <span className="absolute inset-[-7.81%_-6.51%]">
          <img alt="" src="/library/icons/arrow-left-16.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Action/Search · Size=14 (53:1180) */
export function SearchGlyph14() {
  return (
    <span aria-hidden="true" className="relative block size-[14px] shrink-0 overflow-hidden">
      <span className="absolute inset-[20%]">
        <span className="absolute inset-[-4.46%_-4.47%_-4.46%_-4.46%]">
          <img alt="" src="/library/icons/search-14.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Navigation/Chevron Down · Size=14 (53:1052) */
export function ChevronDownGlyph14() {
  return (
    <span aria-hidden="true" className="relative block size-[14px] shrink-0 overflow-hidden">
      <span className="absolute inset-[37.5%_22.5%_35%_22.5%]">
        <span className="absolute inset-[-12.99%_-6.49%]">
          <img alt="" src="/library/icons/chevron-down-14.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Action/Plus · Size=12, Icon Button Circle/XXS/Secondary 색(#707070) (285:2110) */
export function PlusGlyph12() {
  return (
    <span aria-hidden="true" className="relative block size-3 shrink-0 overflow-hidden">
      <span className="absolute inset-[20%]">
        <span className="absolute inset-[-5.21%]">
          <img alt="" src="/library/icons/plus-12-secondary.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Action/Plus · Size=16 (53:1132) */
export function PlusGlyph16() {
  return (
    <span aria-hidden="true" className="relative block size-4 shrink-0 overflow-hidden">
      <span className="absolute inset-[20%]">
        <span className="absolute inset-[-6.51%]">
          <img alt="" src="/library/icons/plus-16.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/* eslint-enable @next/next/no-img-element */
