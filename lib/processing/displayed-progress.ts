/**
 * 처리 화면(N4)의 "표시용 진행 상태" 순수 계산.
 *
 * 세 값을 일부러 다른 이름으로 구분한다.
 * - serverProgress: GET /jobs/{jobId}/tasks 의 최상위 progress(0~1). 서버 원본 그대로 두고
 *   task/stage 판정(render 04/05 분리 포함)은 계속 이 값과 stages[] 로 한다.
 * - presentationStage: 화면 단계(N4 5단계). 서버 stages[] 에서 파생한다.
 * - displayedProgress: 사용자에게 보여 주는 숫자(0~100 정수). 이 파일이 만드는 값이다.
 *
 * displayedProgress 는 "정확한 서버 처리율"이 아니다. 서버가 단계 안의 세부 진행을 주지 않고,
 * 단계가 바뀔 때 global progress 가 오히려 작아지기도 한다. 그래서 단계별 구간(band) 안에서만
 * 시간에 따라 천천히 움직이고, 한 번 보여 준 숫자와 단계는 내리지 않는다. 이 값들을 서버 상태
 * 판정이나 API 요청에 쓰지 않는다.
 */

/** presentation stage 하나가 차지하는 표시 구간(0~100 정수, 양 끝 포함). */
export interface ProgressBand {
  floor: number;
  ceiling: number;
}

/**
 * 0~1 경과 비율 → 0~1 진행 비율. ease-out(2차)이라 초반에는 눈에 띄게 움직이고
 * 끝으로 갈수록 완만해진다. 비율이 1을 넘으면 1에서 멈춘다.
 */
export function easeOutProgressRatio(elapsedRatio: number): number {
  if (!Number.isFinite(elapsedRatio) || elapsedRatio <= 0) return 0;
  const t = Math.min(1, elapsedRatio);
  return 1 - (1 - t) * (1 - t);
}

/** 서버 progress(0~1, 없으면 0) → 0~100 정수. 서버 값 자체는 바꾸지 않는다. */
export function toServerPercent(serverProgress: number | null | undefined): number {
  if (serverProgress == null || !Number.isFinite(serverProgress)) return 0;
  return Math.floor(Math.min(1, Math.max(0, serverProgress)) * 100);
}

export interface DisplayedProgressInput {
  band: ProgressBand;
  /** toServerPercent 결과(0~100) */
  serverPercent: number;
  /** 현재 presentation stage 에 들어온 뒤 지난 시간 */
  elapsedMs: number;
  /** band 의 floor → ceiling 까지 시간 기반으로 채우는 데 걸리는 시간. null 이면 시간 기반 증가 없음 */
  activeDurationMs: number | null;
  /** 서버가 실패를 알렸을 때 true — 시간 기반 증가를 멈춘다 */
  isFrozen: boolean;
  /** 지금까지 화면에 보여 준 최댓값 */
  previousShown: number;
}

/**
 * band 안에서 max(시간 기반 값, 서버 값)을 고르고, 이전에 보여 준 값보다 작으면 이전 값을 유지한다.
 * - 진행 중 단계는 ceiling(다음 단계 floor - 1)을 넘지 않는다.
 * - 다음 단계로 넘어가면 그 단계의 floor 이상이 된다.
 * - 실패(isFrozen)면 시간 기반 증가를 쓰지 않는다.
 */
export function computeDisplayedProgress(input: DisplayedProgressInput): number {
  const { band, serverPercent, elapsedMs, activeDurationMs, isFrozen, previousShown } = input;
  const span = band.ceiling - band.floor;
  const timeBased =
    isFrozen || activeDurationMs == null || activeDurationMs <= 0
      ? band.floor
      : band.floor + Math.floor(span * easeOutProgressRatio(elapsedMs / activeDurationMs));
  const target = Math.min(band.ceiling, Math.max(band.floor, timeBased, serverPercent));
  return Math.max(previousShown, target);
}

/**
 * 이미 보여 준 stage 와 이번 응답에서 파생한 stage 중 진행 순서상 더 뒤의 것을 고른다.
 * 서버 데이터는 바꾸지 않고 화면 단계만 뒤로 가지 않게 한다. 순서에 없는 값은 가장 앞으로 본다.
 */
export function pickFurtherStage<Stage extends string>(
  stageOrder: readonly Stage[],
  shownStage: Stage,
  incomingStage: Stage,
): Stage {
  return stageOrder.indexOf(incomingStage) > stageOrder.indexOf(shownStage) ? incomingStage : shownStage;
}
