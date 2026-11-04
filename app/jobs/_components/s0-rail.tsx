'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { useCancelJobMutation } from '@/lib/queries/pixlate';

import { S0ExitDialog } from './s0-exit-dialog';
import { StepNav, type StepNavStep } from './step-nav';

// ─────────────────────────────────────────────────────────────────
// S0 전역 프로세스 바(PRD F-NAV-01 · F-JOB-07) — N1~N6 좌측 고정 rail. 화면마다 만들지 않고 이것만 쓴다.
//
// Figma 1920×1080: ✕ x40 y40 40×40 · 진행단계(298:2872) x36 y150 44×860.
// 진행단계 위쪽은 max(100px, 100vh-930px)다. 1080 에서는 150 이고, 낮은 창에서는 ✕ 아래 20px 여백을 지키며
// 남는 높이를 진행단계에 준다. 1080 공식을 그대로 옮기면 낮은 창에서 1단계가 ✕ 뒤로 들어간다.
//
// ✕ 동작: 서버 작업이 있으면(jobId) 작업 전체 취소, 아직 없는 N1 이면 저장 없이 나가기.
// 취소는 단계가 아니라 작업 전체에 대한 동작이다. /jobs/[jobId] 에서는 페이지가 이 rail 을 한 번만 그려
// N2→N3 · N4→N5 자동 전환에도 확인창과 진행 중인 DELETE 가 그대로 유지된다.
// N2·N4 의 [중단](F-JOB-08)은 작업을 남기는 다른 동작이라 여기서 다루지 않는다.
// ─────────────────────────────────────────────────────────────────

export function S0Rail({
  currentStep,
  jobId = null,
  exitDisabled = false,
  overlay = false,
}: {
  /** 서버가 알려 준 현재 단계. 모르면(상태 조회 중·실패) 진행단계를 그리지 않고 ✕만 둔다. 추측하지 않는다 */
  currentStep: StepNavStep | null;
  /** 서버 작업 id. 없으면 작업이 아직 없는 N1 이다 */
  jobId?: string | null;
  /** 눌러도 안 되는 동안(N1 POST /jobs 응답 전 — 나간 뒤 작업이 생겨 남는 것을 막는다) */
  exitDisabled?: boolean;
  /** 본문을 밀지 않고 왼쪽 위에 겹쳐 놓는다. 가장 가까운 positioned 조상이 화면 전체여야 한다 */
  overlay?: boolean;
}) {
  const router = useRouter();
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const { mutateAsync: cancelJob, reset: resetCancelJob, isPending, isError } = useCancelJobMutation();
  const isBusy = isPending || isLeaving;

  const closeDialog = useCallback(() => {
    if (isBusy) return;
    setIsDialogOpen(false);
    resetCancelJob();
  }, [isBusy, resetCancelJob]);

  const handleConfirm = () => {
    if (!jobId) {
      setIsLeaving(true);
      router.push('/');
      return;
    }
    cancelJob(jobId)
      .then(() => {
        setIsLeaving(true);
        router.push('/');
      })
      .catch(() => {
        // 실패는 isError 로 창 안에 보여 주고 화면과 작업을 그대로 둔다
      });
  };

  return (
    <div
      data-testid="s0-rail"
      className={overlay ? 'absolute top-0 bottom-0 left-0 z-20 ml-9 w-[44px]' : 'relative ml-9 h-full w-[44px] shrink-0'}
    >
      <button
        ref={exitButtonRef}
        type="button"
        onClick={() => setIsDialogOpen(true)}
        disabled={exitDisabled}
        aria-label={jobId ? '작업 취소' : '보관함으로 나가기'}
        data-testid="s0-exit"
        className="absolute top-10 left-1 z-20 flex size-10 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {/* Figma Card/Navigation/Close 16px — X선은 가운데 8×8(4~12), stroke 1.25 */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {currentStep && (
        <div data-testid="s0-steps" className="absolute inset-0 pt-[max(100px,calc(100vh-930px))] pb-[70px]">
          <StepNav currentStep={currentStep} />
        </div>
      )}
      {isDialogOpen && (
        <S0ExitDialog
          hasJob={jobId !== null}
          isBusy={isBusy}
          cancelFailed={isError}
          onDismiss={closeDialog}
          onConfirm={handleConfirm}
          returnFocusRef={exitButtonRef}
        />
      )}
    </div>
  );
}
