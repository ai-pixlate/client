'use client';

import { useRef, type RefObject } from 'react';

import { useModalDialog } from '@/app/_components/use-modal-dialog';

// ─────────────────────────────────────────────────────────────────
// S0 ✕ 확인창(PRD F-JOB-07) — 서버 작업이 있는지에 따라 둘로 나뉜다.
//
// - 작업 없음(N1 [다음] 전): 입력값과 고른 로컬 이미지가 남지 않는다는 안내 → [나가기]로 보관함 이동. 서버 요청 없음.
// - 작업 있음(N1 draft · N2~N6): 삭제 대상을 열거하고 되돌릴 수 없음을 밝힌다 → DELETE /jobs/{jobId}(API-JOB-04).
//   성공해야 보관함으로 이동하고, 실패하면 창과 화면을 그대로 두어 다시 시도할 수 있다.
//
// 전용 Figma 프레임이 없어 M1 보관함 다운로드 모달(Figma 1056:9744)의 dim·모달·제목/설명·footer 버튼 값과
// 동작(useModalDialog: 배경 inert, focus trap, Escape=닫기, 닫히면 ✕로 포커스 복귀)을 그대로 쓴다.
// 삭제 대상 문구는 PRD 수용 조건에 맞춘 초안이며 PRD 정본 문구가 오면 교체한다.
// ─────────────────────────────────────────────────────────────────

const COPY = {
  leave: {
    title: '작성을 그만두고 나갈까요?',
    description: ['입력한 정보와 선택한 이미지는 저장되지 않습니다.'],
    dismiss: '계속 작성',
    confirm: '나가기',
    pending: '나가는 중...',
  },
  cancelJob: {
    title: '작업을 취소할까요?',
    description: [
      '원본 이미지, 섹션 분해 결과, 인페인팅 결과, 번역문, 판정 근거, 수정 전후 문구가 삭제되며 되돌릴 수 없습니다.',
      '취소 후 보관함으로 이동합니다.',
    ],
    dismiss: '계속하기',
    confirm: '작업 취소',
    pending: '취소 중...',
  },
} as const;

export function S0ExitDialog({
  hasJob,
  isBusy,
  cancelFailed,
  onDismiss,
  onConfirm,
  returnFocusRef,
}: {
  hasJob: boolean;
  isBusy: boolean;
  cancelFailed: boolean;
  /** 안정된 참조로 넘긴다(useModalDialog onClose) */
  onDismiss: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, { onClose: onDismiss, returnFocusRef });
  const copy = hasJob ? COPY.cancelJob : COPY.leave;

  return (
    <div data-testid="s0-exit-dim" className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(23,23,23,0.4)]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="s0-exit-title"
        aria-describedby="s0-exit-description"
        tabIndex={-1}
        data-testid="s0-exit-dialog"
        className="flex w-[420px] max-w-[calc(100vw-32px)] flex-col items-center gap-8 rounded-[8px] border border-[#eaeaea] bg-white px-5 pt-8 pb-5 shadow-[0_8px_12px_rgba(0,0,0,0.08)] outline-none"
      >
        <div className="flex w-full flex-col items-center gap-2 text-center leading-[normal]">
          <h2 id="s0-exit-title" className="text-[20px] leading-[24px] font-semibold tracking-[-0.4px] text-[#171717]">
            {copy.title}
          </h2>
          <div id="s0-exit-description" className="flex flex-col gap-1 text-[14px] leading-[20px] tracking-[-0.14px] break-keep text-[#707070]">
            {copy.description.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          {cancelFailed && (
            // 프로젝트 공통 오류 한 줄 문구(text-red-500). 작업은 그대로 남아 있다
            <p role="alert" className="text-[12px] text-red-500">
              작업을 취소하지 못했습니다. 다시 시도해 주세요.
            </p>
          )}
        </div>
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            onClick={onDismiss}
            disabled={isBusy}
            className="flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-8 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#171717]">
              {copy.dismiss}
            </span>
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className="flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] bg-[#171717] px-8 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">
              {isBusy ? copy.pending : copy.confirm}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
