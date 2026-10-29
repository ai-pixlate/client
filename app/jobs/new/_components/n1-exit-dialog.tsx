'use client';

import { useRef, type RefObject } from 'react';

import { useModalDialog } from '@/app/_components/use-modal-dialog';

// ─────────────────────────────────────────────────────────────────
// N1 ✕ 확인창 — 서버 작업(draft job)이 있는지에 따라 둘로 나뉜다(PRD F-JOB-07).
//
// - 작업 없음([다음] 전): 입력값과 고른 로컬 이미지가 남지 않는다는 안내 → [나가기]로 보관함 이동.
//   서버 요청은 하지 않는다.
// - 작업 있음([다음]으로 POST /jobs가 성공한 뒤 업로드·PATCH·분석 시작 중 하나가 실패해 N1에 남은 상태):
//   [작업 취소] → DELETE /jobs/{jobId}(API-JOB-04) → 성공해야 보관함으로 이동한다. 실패하면 창과 N1을
//   그대로 두고(작업도 그대로) 실패를 알린다.
//
// N1 전용 Figma 프레임이 없어 M1 보관함 다운로드 모달(Figma 1056:9744)의 dim·모달·제목/설명·footer 버튼
// 값과 동작(useModalDialog: 배경 inert, focus trap, Escape=닫기, 닫히면 ✕로 포커스 복귀)을 그대로 쓴다
// (N5 미저장 번역문 확인창과 같은 방식). 문구는 PRD 정본이 오면 교체한다.
// ─────────────────────────────────────────────────────────────────

const COPY = {
  leave: {
    title: '작성을 그만두고 나갈까요?',
    description: '입력한 정보와 선택한 이미지는 저장되지 않습니다.',
    confirm: '나가기',
    pending: '나가기',
  },
  cancelJob: {
    title: '작업을 취소할까요?',
    description: '이미 만든 작업과 올린 이미지가 삭제되고 보관함으로 이동합니다.',
    confirm: '작업 취소',
    pending: '취소 중...',
  },
} as const;

export function N1ExitDialog({
  hasDraftJob,
  isCancelling,
  cancelFailed,
  onDismiss,
  onConfirm,
  returnFocusRef,
}: {
  hasDraftJob: boolean;
  isCancelling: boolean;
  cancelFailed: boolean;
  /** 안정된 참조로 넘긴다(useModalDialog onClose) */
  onDismiss: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, { onClose: onDismiss, returnFocusRef });
  const copy = hasDraftJob ? COPY.cancelJob : COPY.leave;

  return (
    <div data-testid="n1-exit-dim" className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(23,23,23,0.4)]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="n1-exit-title"
        aria-describedby="n1-exit-description"
        tabIndex={-1}
        data-testid="n1-exit-dialog"
        className="flex w-[420px] max-w-[calc(100vw-32px)] flex-col items-center gap-8 rounded-[8px] border border-[#eaeaea] bg-white px-5 pt-8 pb-5 shadow-[0_8px_12px_rgba(0,0,0,0.08)] outline-none"
      >
        <div className="flex w-full flex-col items-center gap-2 text-center leading-[normal]">
          <h2 id="n1-exit-title" className="text-[20px] leading-[24px] font-semibold tracking-[-0.4px] text-[#171717]">
            {copy.title}
          </h2>
          <p id="n1-exit-description" className="text-[14px] leading-[17px] tracking-[-0.14px] text-[#707070]">
            {copy.description}
          </p>
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
            disabled={isCancelling}
            className="flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-8 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-[#171717]">
              계속 작성
            </span>
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isCancelling}
            className="flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] bg-[#171717] px-8 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">
              {isCancelling ? copy.pending : copy.confirm}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
