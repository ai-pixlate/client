'use client';

import { useRef, type RefObject } from 'react';

import { useModalDialog } from '@/app/_components/use-modal-dialog';

// M2 미저장 이탈 확인창(F-BRD-07). 전용 Figma 프레임이 없어 N1 ✕ 확인창과 같은 Modal 값·동작을 쓴다
// (Figma 1056:9744 기준, useModalDialog: 배경 inert, focus trap, Escape=머무름).
// API가 없어 [저장하고 나가기]는 두지 않는다 — 저장하려면 창을 닫고 화면의 [변경사항 저장]을 누른다.
export function M2UnsavedDialog({
  changes,
  onStay,
  onDiscard,
  returnFocusRef,
}: {
  changes: string[];
  /** 안정된 참조로 넘긴다(useModalDialog onClose) */
  onStay: () => void;
  onDiscard: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, { onClose: onStay, returnFocusRef });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(23,23,23,0.4)]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="m2-unsaved-title"
        aria-describedby="m2-unsaved-description"
        tabIndex={-1}
        data-testid="m2-unsaved-dialog"
        className="flex w-[420px] max-w-[calc(100vw-32px)] flex-col items-center gap-8 rounded-[8px] border border-[#eaeaea] bg-white px-5 pt-8 pb-5 shadow-[0_8px_12px_rgba(0,0,0,0.08)] outline-none"
      >
        <div className="flex w-full flex-col items-center gap-2 text-center leading-[normal]">
          <h2 id="m2-unsaved-title" className="text-[20px] leading-[24px] font-semibold tracking-[-0.4px] text-[#171717]">
            저장하지 않은 변경사항이 있습니다.
          </h2>
          <div id="m2-unsaved-description" className="flex flex-col items-center gap-2 text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
            <p>저장하지 않으면 다음 변경사항이 사라집니다.</p>
            <ul data-testid="m2-unsaved-changes" className="flex flex-col gap-1 text-[#171717]">
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            onClick={onStay}
            className="flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#171717]"
          >
            계속 수정
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] bg-[#171717] text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white"
          >
            변경사항 버리고 나가기
          </button>
        </div>
      </div>
    </div>
  );
}
