'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getJobTasks } from '@/lib/api/pixlate';
import { pixlateKeys, refreshN5Snapshot } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// N5 규칙 검사 진행 추적(confirmReview 「규칙 검사 연결」) — 블록 check.state=in_progress 인 동안만
// /tasks 를 2초마다 보고(taskType=verify · unitType=section), 진행 중인 검사 시도가 없으면 /blocks·/preview 를 한 쌍으로 다시 받는다.
// 검사 중인 블록이 없으면 아무 요청도 하지 않는다. 다시 받은 쌍은 공통 publish 규칙(stale snapshot guard)을 그대로 따른다.
// ─────────────────────────────────────────────────────────────────

const CHECK_POLL_MS = 2_000;

export function useN5CheckSync(jobId: string, checkInProgress: boolean): void {
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: pixlateKeys.tasks(jobId),
    queryFn: () => getJobTasks(jobId),
    enabled: !!jobId && checkInProgress,
    refetchInterval: checkInProgress ? CHECK_POLL_MS : false,
  });
  const verifyRunning = (tasks.data?.items ?? []).some(
    (item) => item.taskType === 'verify' && item.unitType === 'section' && (item.status === 'pending' || item.status === 'running'),
  );
  const observedAt = tasks.dataUpdatedAt;

  useEffect(() => {
    if (!checkInProgress || observedAt === 0 || verifyRunning) return;
    // 검사 시도가 끝났거나(또는 보이지 않는다) 블록은 아직 검사 중으로 보인다 — 블록 검사 상태를 다시 받는다
    void refreshN5Snapshot(queryClient, jobId).catch(() => {
      void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Blocks(jobId) });
    });
  }, [checkInProgress, observedAt, verifyRunning, queryClient, jobId]);
}
