'use client';

import { useRef, useState, type RefObject } from 'react';

import { useModalDialog } from '../use-modal-dialog';
import { CompactCheckbox } from './library-controls';

// M1 보관함 - 다운로드 모달 (Figma 1056:9744, Modal 1069:11251)
//   Dim(1056:9983): viewport 전체 rgba(23,23,23,0.4)
//   Modal: 420×505, white, border #EAEAEA, radius 8, shadow 0 8 12 rgba(0,0,0,0.08),
//          pt 32 / px 20 / pb 20, 세로 gap 32, viewport 중앙
//   Header: 제목 20 SemiBold −0.4 / 설명 14 Regular −0.14, gap 8, 가운데 정렬
//   Output list: 상단 divider 후 4행, 행 = Checkbox/Compact + gap 16 + 이름(14)·설명(12 Light) gap 8 ↔
//                "개별 다운로드"(Tertiary/XS 97×24), 행 아래 divider
//                (Figma에서 첫 행만 Output Row 원본 인스턴스라 행-divider 간격 20, 나머지 3행은 16)
//   Footer: 취소(Secondary/LG) · 다운로드(Primary/LG) flex 1:1, gap 12, 높이 45
//
// 선택된 카드 묶음 다운로드 API 계약이 없다 — 모달은 열고 닫기와 산출물 체크 선택(FE local state)까지만
// 동작한다. Footer "다운로드"와 행별 "개별 다운로드"는 실제 동작이 없어 disabled다(Figma는 Default 모습).
// 닫기 X와 backdrop 클릭 닫기는 Figma에 없어 두지 않는다 — 취소 버튼과 Escape로만 닫는다.
//
// PSD는 N6 다운로드 모달과 같은 정책으로 항상 비활성이다(12월 제공 예정) — checkbox disabled,
// 텍스트 흐림, 선택 집합에도 들어가지 않는다(다운로드 요청이 생겨도 PSD가 포함될 수 없다).

const OUTPUTS = [
  { key: 'images', name: 'images/', description: '번역이 적용된 최종 이미지 묶음' },
  { key: 'html', name: 'HTML', description: '편집 가능한 HTML 결과물' },
  { key: 'csv', name: 'content.csv', description: '원문 · 번역문 · 판정 정보를 포함한 CSV' },
  { key: 'psd', name: 'PSD', description: '레이어 편집이 가능한 PSD 산출물' },
] as const;

type OutputKey = (typeof OUTPUTS)[number]['key'];

/** N6(n6-result-view ArtifactRow)와 같은 정책 — PSD는 선택·다운로드할 수 없다. */
const DISABLED_OUTPUTS: ReadonlySet<OutputKey> = new Set(['psd']);

/** Figma 1056:9744 화면의 초기 체크 모습(images/·HTML). 서버 export 기본값이 아니다. */
const FIGMA_INITIAL_OUTPUTS: OutputKey[] = ['images', 'html'];

const DISABLED_CLASS = 'disabled:cursor-not-allowed disabled:opacity-40';

export function LibraryDownloadModal({
  onClose,
  returnFocusRef,
  fallbackFocusRef,
}: {
  onClose: () => void;
  /** 닫힌 뒤 포커스를 돌려줄 곳(모달을 연 다운로드 버튼). */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** returnFocusRef가 사라졌거나 비활성일 때의 대체 위치(화면 제목, tabIndex -1). */
  fallbackFocusRef: RefObject<HTMLElement | null>;
}) {
  const [checked, setChecked] = useState<Set<OutputKey>>(
    () => new Set(FIGMA_INITIAL_OUTPUTS.filter((key) => !DISABLED_OUTPUTS.has(key))),
  );
  const dialogRef = useRef<HTMLDivElement>(null);

  // 배경 inert · focus trap · Escape 닫기 · 배경 스크롤 막기 · 닫힌 뒤 포커스 복귀(다운로드 버튼, 없으면 화면 제목)
  useModalDialog(dialogRef, { onClose, returnFocusRef, fallbackFocusRef });

  const toggle = (key: OutputKey) => {
    if (DISABLED_OUTPUTS.has(key)) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div data-testid="library-download-dim" className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(23,23,23,0.4)]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-download-title"
        aria-describedby="library-download-description"
        tabIndex={-1}
        data-testid="library-download-modal"
        className="flex w-[420px] max-w-[calc(100vw-32px)] flex-col items-center gap-8 rounded-[8px] border border-[#eaeaea] bg-white px-5 pt-8 pb-5 shadow-[0_8px_12px_rgba(0,0,0,0.08)] outline-none"
      >
        <div className="flex w-full flex-col items-center gap-2 leading-[normal] whitespace-nowrap">
          <h2 id="library-download-title" className="text-[20px] leading-[24px] font-semibold tracking-[-0.4px] text-[#171717]">
            해당 작업을 다운로드할까요?
          </h2>
          <p id="library-download-description" className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
            선택된 산출물을 다운로드 합니다.
          </p>
        </div>

        <div className="flex w-full flex-col gap-4">
          <div className="h-px w-full bg-[#eaeaea]" />
          {OUTPUTS.map((output, i) => (
            <OutputRow
              key={output.key}
              output={output}
              checked={checked.has(output.key)}
              disabled={DISABLED_OUTPUTS.has(output.key)}
              onToggle={() => toggle(output.key)}
              dividerGapClass={i === 0 ? 'gap-5' : 'gap-4'}
            />
          ))}
        </div>

        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            data-testid="library-download-cancel"
            className="flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-8"
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#171717]">취소</span>
          </button>
          <button
            type="button"
            disabled
            data-testid="library-download-confirm"
            className={`flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] bg-[#171717] px-8 ${DISABLED_CLASS}`}
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">다운로드</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function OutputRow({
  output,
  checked,
  disabled,
  onToggle,
  dividerGapClass,
}: {
  output: (typeof OUTPUTS)[number];
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  dividerGapClass: 'gap-5' | 'gap-4';
}) {
  const inputId = `library-download-output-${output.key}`;
  return (
    <div data-testid={`library-download-row-${output.key}`} className={`flex w-full flex-col ${dividerGapClass}`}>
      <div className="flex w-full items-center gap-4">
        <CompactCheckbox id={inputId} checked={checked && !disabled} disabled={disabled} onChange={onToggle} testId={inputId} />
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          {/* 비활성 행 텍스트 색은 N6 ArtifactRow와 같다(#999 / #B8B8B8). */}
          <label
            htmlFor={inputId}
            className={`flex min-w-0 flex-col gap-2 leading-[normal] ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`text-[14px] leading-[17px] tracking-[-0.14px] ${disabled ? 'text-[#999]' : 'text-[#171717]'}`}>
              {output.name}
            </span>
            <span className={`text-[12px] leading-[14px] font-light tracking-[-0.48px] ${disabled ? 'text-[#b8b8b8]' : 'text-[#707070]'}`}>
              {output.description}
            </span>
          </label>
          {/* Button Tertiary/XS(57:1572) 97×24 — 개별 다운로드 계약이 없어 disabled */}
          <button
            type="button"
            disabled
            data-testid={`library-download-single-${output.key}`}
            className={`flex h-6 w-[97px] shrink-0 items-center justify-center gap-0.5 rounded-[4px] bg-white px-2.5 py-[5px] ${DISABLED_CLASS}`}
          >
            <span className="px-0.5 text-[12px] leading-[14px] tracking-[-0.24px] whitespace-nowrap text-[#171717]">개별 다운로드</span>
          </button>
        </div>
      </div>
      <div className="h-px w-full bg-[#eaeaea]" />
    </div>
  );
}
