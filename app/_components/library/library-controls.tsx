// M1 보관함 공용 컨트롤 — Figma 719:7428에서 쓰는 Checkbox / 아이콘.
//
// 이 프로젝트에는 공용 디자인 시스템 컴포넌트 디렉터리가 없고, 각 화면이 같은
// Figma 컴포넌트를 Tailwind로 옮겨 쓴다. 아래 Checkbox는 N6(n6-result-view.tsx
// ArtifactCheckbox, Figma Checkbox 28:77)와 같은 스타일이다 — N6 파일을 수정하지
// 않기 위해 import 대신 같은 스타일로 둔다. 아이콘은 N1(app/jobs/new/page.tsx)의
// inline SVG와 같은 선 굵기·색을 쓴다(Figma glyph는 7일 만료 원격 asset이라 커밋
// 코드에 링크하지 않는다).

/**
 * Compact Checkbox — component frame 20×20 안에 18×18 visual(white, border #EAEAEA, radius 4).
 * visual 스타일은 Figma Checkbox(28:77, N6와 동일): checked(white+orange border)/unchecked.
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
        className={`pointer-events-none flex size-[18px] items-center justify-center rounded-[4px] border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#ff6a38] ${
          checked ? 'border-[#ff6a38] bg-white' : 'border-[#eaeaea] bg-white'
        }`}
      >
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
            <path d="M1 4.2 3.5 6.7 9 1.2" stroke="#ff6a38" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </span>
  );
}

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" stroke="#707070" strokeWidth="1.3" />
      <path d="M12 12L9.5 9.5" stroke="#707070" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 5.5L7 9L10.5 5.5" stroke="#707070" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Circle/XXS/Secondary 버튼 안 12px glyph — N1 CloseIcon과 같은 inset(3~9)·색(#707070). */
export function PlusGlyph12() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 3V9M3 6H9" stroke="#707070" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** 추가 생성 카드의 40px Circle 버튼 안 16px plus — N1 업로드 타일 PlusIcon과 동일. */
export function PlusIcon16() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4V20M4 12H20" stroke="#171717" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** 좌측 상단 back Icon Button glyph(16px) — N1 "보관함으로 나가기"와 같은 inset(4~12)·굵기. */
export function BackGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M12 8H4M7.5 4.5L4 8L7.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
