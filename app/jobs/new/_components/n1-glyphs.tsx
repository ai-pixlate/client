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

/** Card/Navigation/Close · Size=20 (53:1077) — 카테고리 선택(1094:11176) 우상단 닫기. */
export function CloseGlyph20() {
  return (
    <span aria-hidden="true" className="relative block size-5 shrink-0 overflow-hidden">
      <span className="absolute inset-1/4">
        <span className="absolute inset-[-7.5%]">
          <img alt="" src="/n1/icons/close-20.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Navigation/Chevron right · Size=14 (53:1018) — 하위 단계가 있는 카테고리 row. */
export function ChevronRightGlyph14() {
  return (
    <span aria-hidden="true" className="relative block size-[14px] shrink-0 overflow-hidden">
      <span className="absolute inset-[22.5%_35%_22.5%_37.5%]">
        <span className="absolute inset-[-6.49%_-12.99%]">
          <img alt="" src="/n1/icons/chevron-right-14.svg" className="block size-full max-w-none" />
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

/** Card/Action/Trash · Size=14 (53:1200) — 인증 마크 카드 삭제 버튼(1170:13142). 14px 전용 optical geometry, stroke white. */
export function TrashGlyph14() {
  return (
    <span aria-hidden="true" data-testid="n1-trash-glyph" className="relative block size-[14px] shrink-0 overflow-hidden">
      <span className="absolute inset-[17.5%_22.5%_20%_22.5%]">
        <span className="absolute inset-[-4.29%_-4.87%]">
          <img alt="" src="/n1/icons/trash-14.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Action/Plus · Size=16 (53:1132) — compact FileUploader(1170:8715)의 40×40 원형 icon. */
export function PlusGlyph16() {
  return (
    <span aria-hidden="true" className="relative block size-4 shrink-0 overflow-hidden">
      <span className="absolute inset-[20%]">
        <span className="absolute inset-[-6.51%]">
          <img alt="" src="/n1/icons/plus-16.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/** Card/Action/Check · Size=16 (53:1166) — Checkbox/Compact Checked(1063:5146) 안의 orange check. */
export function CheckGlyph16() {
  return (
    <span aria-hidden="true" className="relative block size-4 shrink-0 overflow-hidden">
      <span className="absolute inset-[30%_22.5%]">
        <span className="absolute inset-[-9.77%_-7.1%]">
          <img alt="" src="/n1/icons/check-16.svg" className="block size-full max-w-none" />
        </span>
      </span>
    </span>
  );
}

/* eslint-enable @next/next/no-img-element */
