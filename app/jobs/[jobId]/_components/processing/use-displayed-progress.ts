'use client';

import { useEffect, useState } from 'react';

import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import {
  COMPLETION_ANIMATE_MS,
  COMPLETION_TICK_MS,
  DISPLAY_TICK_MS,
  completionProgressAt,
  stepDisplayedProgress,
  toShownPercent,
} from '@/lib/processing/displayed-progress';
import {
  clearDisplayedProgress,
  readDisplayedProgress,
  writeDisplayedProgress,
} from '@/lib/processing/displayed-progress-storage';

// ─────────────────────────────────────────────────────────────────
// 처리 화면(N2·N4) 표시 % hook — 계산 규칙은 lib/processing/displayed-progress.ts.
//
// 이 hook 이 소유하는 것은 표시 숫자뿐이다: 지금 값(value)과 지금까지 열린 상한(ceiling).
// 호출하는 쪽이 이번 poll 의 서버 관측 단계로 상한만 넘긴다 — 상한이 올라가도 숫자를 그 자리로
// 옮기지 않고 tick 마다 조금씩 올린다. 행·caption 은 호출하는 쪽이 서버 값으로 그리며, 이 숫자로
// 단계나 완료를 판정하지 않는다.
//
// isCompleted 는 page.tsx 가 실제 완료(currentStep 전환) 응답을 받은 뒤에만 true 로 넘긴다. 그때만
// 현재 값 → 100 으로 올린다. 저장은 lib/processing/displayed-progress-storage.ts 참고.
// ─────────────────────────────────────────────────────────────────

/**
 * 서버가 실패를 알렸는지 — 표시용 진행률 증가를 멈출 때만 쓴다.
 * 실패 UI(부분 실패 배너)와 화면 전환은 기존 로직이 그대로 담당한다.
 */
export function hasProcessingFailure(status: ApiJobTaskStatus): boolean {
  return (
    status.jobStatus === 'failed' ||
    status.userFacingStatus === 'failed' ||
    (status.failedCount ?? 0) > 0 ||
    (status.stages ?? []).some((s) => s.status === 'failed') ||
    (status.items ?? []).some((i) => i.status === 'failed')
  );
}

interface ProgressState {
  value: number;
  ceiling: number;
  /** 완료 표시를 시작한 값 — isCompleted 가 된 첫 렌더에 정한다 */
  completionFrom: number | null;
}

export function useDisplayedProgress({
  persistKey,
  ceiling,
  isFrozen,
  isCompleted,
}: {
  /** sessionStorage 키(n2DisplayedProgressKey · n4DisplayedProgressKey) */
  persistKey: string;
  /** 이번 poll 에서 관측한 단계가 여는 상한(0~99). 이전보다 낮으면 무시한다. */
  ceiling: number;
  /** 서버가 실패를 알리면 true — 증가를 멈춘다 */
  isFrozen: boolean;
  /** 실제 완료 응답 뒤 완료 표시 중 — 현재 값에서 100 으로 올린다 */
  isCompleted: boolean;
}): number {
  const [state, setState] = useState<ProgressState>(() => {
    const stored = readDisplayedProgress(persistKey, Date.now());
    return { value: stored?.value ?? 0, ceiling: Math.max(stored?.ceiling ?? 0, ceiling), completionFrom: null };
  });
  const [completionElapsedMs, setCompletionElapsedMs] = useState(0);

  // 새 상한이 더 높으면 연다(숫자는 그대로). 완료 표시 시작 값을 잡는다. 렌더 중 조건부 setState —
  // React 가 권장하는 "이전 값에서 state 조정" 패턴이라 effect 로 한 번 더 렌더하지 않는다.
  let current = state;
  if (ceiling > current.ceiling) current = { ...current, ceiling };
  if (isCompleted && current.completionFrom === null) current = { ...current, completionFrom: current.value };
  if (current !== state) setState(current);

  useEffect(() => {
    if (isCompleted || isFrozen) return;
    const interval = setInterval(() => {
      setState((s) => {
        const value = stepDisplayedProgress(s.value, s.ceiling, false);
        return value === s.value ? s : { ...s, value };
      });
    }, DISPLAY_TICK_MS);
    return () => clearInterval(interval);
  }, [isCompleted, isFrozen]);

  useEffect(() => {
    if (!isCompleted) return;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setCompletionElapsedMs(elapsed);
      if (elapsed >= COMPLETION_ANIMATE_MS) clearInterval(interval);
    }, COMPLETION_TICK_MS);
    return () => clearInterval(interval);
  }, [isCompleted]);

  useEffect(() => {
    if (isCompleted) return;
    writeDisplayedProgress(persistKey, { value: state.value, ceiling: state.ceiling });
  }, [persistKey, state.value, state.ceiling, isCompleted]);

  // 화면이 다음 단계로 넘어가 사라지면 지운다 — 같은 job 을 나중에 다시 처리할 때 이전 값에서 시작하지 않게.
  useEffect(() => () => clearDisplayedProgress(persistKey), [persistKey]);

  if (isCompleted && current.completionFrom !== null) {
    return toShownPercent(completionProgressAt(current.completionFrom, completionElapsedMs), true);
  }
  return toShownPercent(current.value, false);
}
