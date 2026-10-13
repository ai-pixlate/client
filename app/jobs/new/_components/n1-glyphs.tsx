// N1 이미지 정보 입력 — Figma(525:3023 / 1094:11283) optical glyph.
//
// Figma 원본 SVG를 public/n1/icons/에 저장해 쓰고, glyph 박스 안 Group inset·bleed 비율을 Figma
// 그대로 둔다("Geometry is size-specific, not container-resized"). Figma 임시 asset URL은 쓰지 않는다.

/* eslint-disable @next/next/no-img-element -- 고정 크기 장식 SVG glyph라 next/image 최적화가 필요 없다 */

/** Card/Utility/Info · Size=20 (53:1759) */
export function InfoGlyph20() {
  return (
    <span aria-hidden="true" className="relative block size-5 shrink-0 overflow-hidden">
      <span className="absolute inset-[15%]">
        <span className="absolute inset-[-4.46%]">
          <img alt="" src="/n1/icons/info-20.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Navigation/Close · Size=16 (53:1073) */
export function CloseGlyph16() {
  return (
    <span aria-hidden="true" className="relative block size-4 shrink-0 overflow-hidden">
      <span className="absolute inset-1/4">
        <span className="absolute inset-[-7.81%]">
          <img alt="" src="/n1/icons/close-16.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Action/Plus · Size=24 (63:2504) */
export function PlusGlyph24() {
  return (
    <span aria-hidden="true" className="relative block size-6 shrink-0 overflow-hidden">
      <span className="absolute inset-[20%]">
        <span className="absolute inset-[-6.08%]">
          <img alt="" src="/n1/icons/plus-24.svg" className="block size-full max-w-none" />
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
        <span className="absolute inset-[-4.46%_-4.47%_-4.47%_-4.46%]">
          <img alt="" src="/n1/icons/search-14.svg" className="block size-full max-w-none" />
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
          <img alt="" src="/n1/icons/chevron-down-14.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Radio(28:88) 18px visual — selected(orange ring + dot) / unselected(#EAEAEA ring). */
export function RadioGlyph18({ selected }: { selected: boolean }) {
  return (
    <span aria-hidden="true" className="relative block size-[18px] shrink-0">
      <img
        alt=""
        src={selected ? '/n1/icons/radio-selected-18.svg' : '/n1/icons/radio-unselected-18.svg'}
        className="absolute inset-0 block size-full max-w-none"
      />
    </span>
  );
}

/** Tooltip(1090:10048) 아래쪽 꼬리 — Group 11(11.547×11), bleed 0 −4.33% −4.55% −4.33%. 위치는 쓰는 쪽이 정한다. */
export function TooltipTail({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className={`block h-[11px] w-[11.547px] ${className}`}>
      <span className="absolute inset-[0_-4.33%_-4.55%_-4.33%]">
        <img alt="" src="/n1/icons/tooltip-tail.svg" className="block size-full max-w-none" />
      </span>
    </span>
  );
}

/**
 * Card/Action/Trash · Size=14 — 인증 마크 카드 삭제 버튼(1170:8460). 같은 glyph를 N5 toolbar(686:7996)가
 * 20px slot으로 쓰고 있어 그 path geometry를 그대로 14px로 그린다. 색은 버튼 글자색(currentColor)을 따른다.
 */
export function TrashGlyph14() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 20 20" fill="none" className="block shrink-0">
      <path
        d="M4.5 6H15.5M8 3.5H12M6 6L6.7 16H13.3L14 6M8.5 8.5V13.5M11.5 8.5V13.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Card/Action/Plus · Size=16 — compact FileUploader(1170:8460)의 40×40 원형 icon. N1 좌측 compact uploader와 같은 geometry. */
export function PlusGlyph16() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" className="block shrink-0">
      <path d="M12 4V20M4 12H20" stroke="#171717" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* eslint-enable @next/next/no-img-element */
