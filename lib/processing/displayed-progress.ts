/**
 * 처리 화면(N2 분석 중 · N4 번역 중)의 "표시용 진행 %" 순수 계산.
 *
 * 처리 화면은 다섯 가지를 서로 대신 쓰지 않는다.
 * A. 서버 상태 — GET /jobs/{jobId}/tasks 의 progress·stages·analysisProgress. 읽기만 한다.
 * B. 지금 실제로 하는 세부 작업 — 화면 컴포넌트가 이번 poll 값으로 LOG 설명 줄에 쓴다.
 * C. 5단계 presentation — 화면 컴포넌트가 이번 poll 값으로 정한다.
 * D. 표시 %(displayedProgress) — 이 파일이 만드는 값. 서버 처리율이 아니다.
 * E. 실제 완료 — 서버 currentStep 전환(N2 → N3, N4 → N5)뿐. page.tsx 가 판단한다.
 *
 * 표시 % 규칙
 * - 서버에서 관측한 단계는 숫자가 "올라갈 수 있는 상한(ceiling)"만 연다. 단계가 바뀌었다고 그 단계의
 *   하한으로 숫자를 끌어올리지 않는다(30 → 80 같은 점프 없음). 상한은 내려가지 않는다.
 * - 화면 tick 마다 상한까지 남은 거리의 일부만큼, 그러나 tick 당 MAX_STEP_PER_TICK 이하로만 오른다.
 *   같은 단계에 오래 머물면 상한 근처에서 점점 느려지며 멈춘다. 숫자는 내려가지 않는다.
 * - 처리 중에는 PROCESSING_MAX_PERCENT(99)를 넘지 않는다. 서버가 실패를 알리면 멈춘다.
 * - 실제 완료 응답을 받은 뒤에만 현재 값 → 100 으로 짧게 올린다(완료 표시). 이 시간은 서버 작업을
 *   기다리는 가짜 지연이 아니라, 이미 끝난 결과를 보여 주는 화면 전환 시간이다.
 *
 * 이 값들을 서버 상태 판정이나 API 요청에 쓰지 않는다. 서버 progress 로 단계를 추정하지 않는다.
 */

/**
 * 처리 중 화면 tick. polling(2초)보다 촘촘해야 2초마다 숫자가 뚝뚝 끊기지 않는다. 시간 경과가 아니라
 * tick 수로 오르므로, 백그라운드 탭에서 timer 가 느려져도 돌아왔을 때 한 번에 뛰지 않는다.
 */
export const DISPLAY_TICK_MS = 150;
/**
 * tick 당 최대 상승 폭(%p). 150ms tick 이면 초당 약 5%p — mock·실서버의 짧은 처리(수 초~수십 초)에서도
 * 움직임이 보이고, 정수 표시는 tick 당 1 이하로만 바뀐다.
 */
export const MAX_STEP_PER_TICK = 0.8;
/**
 * tick 마다 상한까지 남은 거리 중 줄이는 비율. 0.02 면 남은 거리가 약 5초마다 절반으로 준다 — 같은 단계에
 * 오래 머물수록 상한 근처에서 느려진다(서버 처리율처럼 보이지 않게, 멈춘 것처럼도 보이지 않게).
 */
export const APPROACH_RATIO_PER_TICK = 0.02;
/** 처리 중 표시 상한. 100 은 실제 완료(currentStep 전환) 응답 뒤에만 보인다. */
export const PROCESSING_MAX_PERCENT = 99;

/** 완료 표시: 현재 값 → 100 으로 올리는 시간과 그 tick(눈에 보이게 촘촘히) */
export const COMPLETION_ANIMATE_MS = 450;
export const COMPLETION_TICK_MS = 40;
/** 완료 표시: 100% 와 완료 상태를 확인할 수 있게 유지하는 시간 */
export const COMPLETION_HOLD_MS = 300;
/** page.tsx 가 실제 완료 응답 뒤 처리 화면을 유지하는 총 시간(올리기 + 유지) */
export const COMPLETION_PRESENTATION_MS = COMPLETION_ANIMATE_MS + COMPLETION_HOLD_MS;

/** 상한을 처리 중 범위(0~99)로 자른다. */
export function clampProcessingCeiling(ceiling: number): number {
  if (!Number.isFinite(ceiling)) return 0;
  return Math.min(PROCESSING_MAX_PERCENT, Math.max(0, ceiling));
}

/**
 * 처리 중 tick 한 번 — 이전 값에서 상한 쪽으로 조금 올린다. 상한 이상이거나 실패(isFrozen)면 그대로다.
 * 이전 값보다 작아지지 않는다.
 */
export function stepDisplayedProgress(previous: number, ceiling: number, isFrozen: boolean): number {
  const cap = clampProcessingCeiling(ceiling);
  if (isFrozen || previous >= cap) return previous;
  const step = Math.min(MAX_STEP_PER_TICK, (cap - previous) * APPROACH_RATIO_PER_TICK);
  return Math.min(cap, previous + step);
}

/** 완료 표시 중 값 — from 에서 시작해 COMPLETION_ANIMATE_MS 동안 ease-out 으로 100 에 닿는다. */
export function completionProgressAt(from: number, elapsedMs: number): number {
  const ratio = Number.isFinite(elapsedMs) ? Math.min(1, Math.max(0, elapsedMs / COMPLETION_ANIMATE_MS)) : 0;
  const eased = 1 - (1 - ratio) * (1 - ratio);
  return from + (100 - from) * eased;
}

/** 화면에 쓰는 정수. 처리 중이면 99 를 넘지 않는다. */
export function toShownPercent(value: number, isCompleted: boolean): number {
  const shown = Math.floor(Math.max(0, value));
  return isCompleted ? Math.min(100, shown) : Math.min(PROCESSING_MAX_PERCENT, shown);
}
