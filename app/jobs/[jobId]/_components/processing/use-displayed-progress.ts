'use client';

import { useEffect, useState } from 'react';

import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { computeDisplayedProgress, pickFurtherStage, type ProgressBand } from '@/lib/processing/displayed-progress';

// ─────────────────────────────────────────────────────────────────
// 처리 화면(N4) 표시용 진행 상태 hook — 계산 규칙은 lib/processing/displayed-progress.ts.
//
// 이 hook 이 소유하는 것은 표시 숫자뿐이다: 숫자 구간(band)을 고르기 위해 지금까지 본 가장
// 뒤의 stage, 그 stage 에 언제 들어왔는지(enteredAt), 지금까지 보여 준 최댓값(maxShown).
// 서버 status 는 읽기만 하고 바꾸지 않으며, 여기서 나온 값을 task 상태 판정에 쓰지 않는다.
//
// 숫자는 뒤로 가지 않는다 — 서버에서 관측한 stage 가 앞 단계로 돌아가도(섹션마다 단계가 다르다)
// 이미 들어간 band 를 유지한다. 이 band 용 stage 는 반환하지 않는다: 화면 행·caption 은 호출하는
// 쪽이 이번 poll 의 서버 관측 상태로 그린다(숫자 유지 정책으로 실제 처리 단계를 굳히지 않는다).
//
// 새로고침해도 처음으로 돌아가지 않도록 sessionStorage 에 같은 값을 남긴다(탭 단위,
// 30분 지나면 버린다). 화면이 다음 단계로 넘어가 이 hook 을 쓰는 컴포넌트가 사라지면
// 지운다 — 같은 job 을 나중에 다시 처리할 때 이전 값에서 시작하지 않게 하기 위해서다.
// 저장소를 쓸 수 없으면(사생활 보호 모드 등) 기록 없이 그대로 동작한다.
// ─────────────────────────────────────────────────────────────────

const TICK_MS = 1000;
const STORAGE_PREFIX = 'pixlate:displayed-progress:';
const STORAGE_TTL_MS = 30 * 60 * 1000;

interface DisplayTracker {
  stageKey: string;
  enteredAt: number;
  maxShown: number;
}

function storageKeyOf(persistKey: string) {
  return `${STORAGE_PREFIX}${persistKey}`;
}

function readStoredTracker(persistKey: string, now: number): DisplayTracker | null {
  try {
    const raw = window.sessionStorage.getItem(storageKeyOf(persistKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DisplayTracker & { savedAt: number }>;
    if (
      typeof parsed.stageKey !== 'string' ||
      typeof parsed.enteredAt !== 'number' ||
      typeof parsed.maxShown !== 'number' ||
      typeof parsed.savedAt !== 'number' ||
      now - parsed.savedAt > STORAGE_TTL_MS
    ) {
      return null;
    }
    return { stageKey: parsed.stageKey, enteredAt: parsed.enteredAt, maxShown: parsed.maxShown };
  } catch {
    return null;
  }
}

/**
 * 서버가 실패를 알렸는지 — 표시용 진행률의 시간 기반 증가를 멈출 때만 쓴다.
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

export function useDisplayedProgress<Stage extends string>({
  persistKey,
  serverStage,
  stageOrder,
  bandOf,
  activeDurationOf,
  serverPercent,
  isFrozen,
}: {
  /** sessionStorage 키 구분값(화면 + jobId) */
  persistKey: string;
  /** 서버 stages/progress 에서 관측한 이번 응답의 stage — band 선택에만 쓴다 */
  serverStage: Stage;
  /** stage 진행 순서(앞 → 뒤) */
  stageOrder: readonly Stage[];
  bandOf: (stage: Stage) => ProgressBand;
  /** null 이면 그 stage 에서는 시간 기반으로 올리지 않는다 */
  activeDurationOf: (stage: Stage) => number | null;
  /** toServerPercent(status.progress) — 서버 원본에서 만든 0~100 */
  serverPercent: number;
  /** 서버가 실패를 알리면 true — 시간 기반 증가를 멈춘다 */
  isFrozen: boolean;
}): { displayedProgress: number } {
  const [now, setNow] = useState(() => Date.now());
  const [tracker, setTracker] = useState<DisplayTracker>(() => {
    const initNow = Date.now();
    const stored = readStoredTracker(persistKey, initNow);
    // 새로고침 전에 보여 준 stage 가 같거나 더 뒤면 그 기록(enteredAt 포함)을 이어 쓴다.
    if (stored && pickFurtherStage(stageOrder, stored.stageKey as Stage, serverStage) === stored.stageKey) return stored;
    return { stageKey: serverStage, enteredAt: initNow, maxShown: stored?.maxShown ?? 0 };
  });

  // 이미 보여 준 stage 보다 낮은 stage 가 오면 무시한다. 더 높은 stage 로 올라가면 enteredAt 을
  // 새로 잡는다(maxShown 은 이어받아 숫자가 내려가지 않는다). 렌더 중 조건부 setState —
  // React 가 권장하는 "이전 값에서 state 조정" 패턴이라 effect 로 한 번 더 렌더하지 않는다.
  const nextStage = pickFurtherStage(stageOrder, tracker.stageKey as Stage, serverStage);
  const current: DisplayTracker =
    nextStage !== tracker.stageKey ? { stageKey: nextStage, enteredAt: now, maxShown: tracker.maxShown } : tracker;
  const bandStage = current.stageKey as Stage;
  const band = bandOf(bandStage);
  const activeDurationMs = activeDurationOf(bandStage);
  const displayedProgress = computeDisplayedProgress({
    band,
    serverPercent,
    elapsedMs: Math.max(0, now - current.enteredAt),
    activeDurationMs,
    isFrozen,
    previousShown: current.maxShown,
  });
  if (current !== tracker || displayedProgress !== tracker.maxShown) {
    setTracker({ ...current, maxShown: displayedProgress });
  }

  const shouldTick = !isFrozen && activeDurationMs != null && displayedProgress < band.ceiling;
  useEffect(() => {
    if (!shouldTick) return;
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, [shouldTick]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKeyOf(persistKey), JSON.stringify({ ...tracker, savedAt: Date.now() }));
    } catch {
      // 저장소를 쓸 수 없어도 화면 표시는 그대로 동작한다.
    }
  }, [persistKey, tracker]);

  useEffect(
    () => () => {
      try {
        window.sessionStorage.removeItem(storageKeyOf(persistKey));
      } catch {
        // 위와 같은 이유로 무시한다.
      }
    },
    [persistKey],
  );

  return { displayedProgress };
}
