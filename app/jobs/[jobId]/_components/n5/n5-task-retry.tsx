'use client';

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { retryJobTask } from '@/lib/api/pixlate';
import type { ApiJobAsyncTaskItem } from '@/lib/api/n5-schema';
import type { RetryTarget } from '@/lib/n5/adapter';
import { TooltipArrow } from '@/app/_components/tooltip-arrow';
import { pixlateKeys, refreshN5Snapshot, useN5TaskStatusQuery } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// N5 실패 작업 [다시 시도] — API-JOB-06 POST /jobs/{jobId}/tasks/{taskId}/retry.
// 실패 상태가 서버에서 받은 taskId·retryable(RetryTarget)만 쓴다 — blockId·sectionId 로 task 를 찾지 않는다.
//   retryable=false · taskId 없음 → 버튼 비활성
//   누름 → 재시도 요청(버튼 비활성·「다시 시도하는 중…」) → 응답의 새 taskId 를 기존 2초 task 조회로 추적
//   → 끝나면(done·failed·cancelled·목록에서 사라짐) /blocks·/preview 를 한 쌍으로 다시 받고 /tasks 를 갱신한다
//   요청 실패(409 등)·재시도 실패 → 서버가 주는 실패 상태가 그대로 남는다
// 미리보기 갱신 실패·섹션 렌더 실패는 각자의 자리와 상태를 그대로 두고 이 버튼만 같이 쓴다.
// 번역 실패 [다시 시도]는 12월 범위라 UpcomingRetryButton(비활성·요청 없음)을 쓴다. 인페인팅은 재시도 계약이 없어 버튼이 없다.
// ─────────────────────────────────────────────────────────────────

const N5JobIdContext = createContext<string | null>(null);

export function N5TaskRetryProvider({ jobId, children }: { jobId: string; children: ReactNode }) {
  return <N5JobIdContext.Provider value={jobId}>{children}</N5JobIdContext.Provider>;
}

function useN5TaskRetry(target: RetryTarget | null, onRetried?: (task: ApiJobAsyncTaskItem) => void) {
  const jobId = useContext(N5JobIdContext);
  const queryClient = useQueryClient();
  const [trackedTaskId, setTrackedTaskId] = useState<number | null>(null);
  const mutation = useMutation({ mutationFn: (taskId: number) => retryJobTask(jobId as string, taskId) });
  const status = useN5TaskStatusQuery(jobId ?? '', trackedTaskId);
  const item = trackedTaskId != null ? status.data?.items?.find((candidate) => candidate.taskId === trackedTaskId) : undefined;
  const finished =
    trackedTaskId != null &&
    status.data != null &&
    (item == null || item.status === 'done' || item.status === 'failed' || item.status === 'cancelled');

  // 끝난 재시도 — 추적을 멈추고(렌더 중 상태 조정) 끝난 시도 번호를 남긴다. 재조회는 아래 effect 가 한 번만 한다
  const [finishedTaskId, setFinishedTaskId] = useState<number | null>(null);
  if (finished && trackedTaskId != null) {
    setFinishedTaskId(trackedTaskId);
    setTrackedTaskId(null);
  }
  useEffect(() => {
    if (finishedTaskId == null || !jobId) return;
    void refreshN5Snapshot(queryClient, jobId).catch(() => {
      void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Blocks(jobId) });
      void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Preview(jobId) });
    });
    void queryClient.invalidateQueries({ queryKey: pixlateKeys.tasks(jobId), exact: true });
  }, [finishedTaskId, jobId, queryClient]);

  const busy = mutation.isPending || trackedTaskId != null;
  const canRetry = jobId != null && target != null && target.retryable && target.taskId != null && !busy;
  const retry = () => {
    if (!canRetry || !target) return;
    mutation.mutate(target.taskId, {
      onSuccess: (task) => {
        if (task.taskId != null) setTrackedTaskId(task.taskId);
        onRetried?.(task);
      },
    });
  };
  return { canRetry, busy, retry, failed: mutation.isError };
}

/** Figma Button Style=Secondary · Size=XS(57:1440) — 24 높이 · 좌우 12 · radius 4 · #eaeaea 선 · 12px Regular #171717 */
const RETRY_BUTTON_CLASS =
  'flex h-6 shrink-0 items-center justify-center rounded-[4px] border px-3 text-[12px] leading-[normal] tracking-[-0.02em] whitespace-nowrap text-[#171717]';
const RETRY_BUTTON_ENABLED_CLASS = 'border-[#eaeaea] bg-white hover:bg-[#f5f5f5]';
/** Figma Button Style=Secondary · Size=XS · State=Disabled(57:1450) — BG/subtle #f5f5f5 면 · 선 없음(높이 유지를 위해 투명 선) · 글자 그대로 · hover 없음 */
const RETRY_BUTTON_DISABLED_CLASS = 'cursor-not-allowed border-transparent bg-[#f5f5f5]';

const UPCOMING_RETRY_TOOLTIP = '다시 시도는 12월 구현 예정입니다.';

/**
 * 제품 범위가 12월인 [다시 시도](번역 실패 부분 재실행 — PRD F-CFM-05). 모양은 비활성 [다시 시도] 그대로이고 어떤 요청도 보내지 않는다.
 * 이유는 단계 이동(step-nav)·N1 인증 마크와 같은 말풍선으로 hover·focus 때 알린다. 안내가 보이도록 disabled 대신 aria-disabled 를 쓴다.
 */
export function UpcomingRetryButton({ label, testId }: { label: string; testId: string }) {
  const tooltipId = useId();
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        data-testid={testId}
        aria-disabled="true"
        aria-describedby={tooltipId}
        // Safari 는 클릭해도 버튼에 포커스를 주지 않는다 — 눌렀을 때 안내가 남도록 직접 옮긴다(step-nav 와 같다)
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.focus();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
        className={`peer ${RETRY_BUTTON_CLASS} ${RETRY_BUTTON_DISABLED_CLASS} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]`}
      >
        {label}
      </button>
      {/* 말풍선은 Figma 1090:10048(N1 인증 마크 안내) 그대로 — 흰 면 · #ff6a38 선 · radius 8 · padding 10 · 12px Light · 아래 화살표.
          24px 버튼 글자를 가리지 않게 화살표 끝이 버튼 위 가장자리에 닿도록 둔다(버튼 위 11px) */}
      <span
        id={tooltipId}
        role="tooltip"
        data-testid={`${testId}-tooltip`}
        className="pointer-events-none invisible absolute bottom-[calc(100%+11px)] left-0 z-40 rounded-[8px] border border-[#ff6a38] bg-white p-2.5 text-[12px] leading-[normal] font-light tracking-[-0.04em] whitespace-nowrap text-[#ff6a38] peer-hover:visible peer-focus:visible"
      >
        {UPCOMING_RETRY_TOOLTIP}
        <TooltipArrow className="left-5" />
      </span>
    </span>
  );
}

/** Figma 1244:8238·8444 의 [다시 시도] 버튼 모양 그대로 — 재시도할 수 없으면 비활성 */
export function TaskRetryButton({
  label,
  testId,
  target,
  onRetried,
}: {
  label: string;
  testId: string;
  /** 실패 상태가 서버에서 받은 재시도 대상(taskId·retryable). 없으면 비활성 */
  target: RetryTarget | null;
  /** 재시도 요청이 받아들여진 뒤(새 시도) — 같은 칸의 재렌더 추적을 새 taskId 로 잇는 데 쓴다 */
  onRetried?: (task: ApiJobAsyncTaskItem) => void;
}) {
  const { canRetry, busy, retry, failed } = useN5TaskRetry(target, onRetried);
  return (
    <button
      type="button"
      data-testid={testId}
      data-retry-state={busy ? 'retrying' : failed ? 'request-failed' : 'idle'}
      disabled={!canRetry}
      aria-busy={busy || undefined}
      title={canRetry || busy ? undefined : '다시 시도할 수 없습니다.'}
      onClick={(e) => {
        e.stopPropagation();
        retry();
      }}
      className={`${RETRY_BUTTON_CLASS} ${canRetry ? RETRY_BUTTON_ENABLED_CLASS : RETRY_BUTTON_DISABLED_CLASS}`}
    >
      {busy ? '다시 시도하는 중…' : label}
    </button>
  );
}
