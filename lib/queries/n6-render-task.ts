import type { ApiJobTaskStatus } from '@/lib/api/n5-schema';
import { jobStatusOf, userFacingStatusOf } from '@/lib/api/job-status';

type TaskItem = NonNullable<ApiJobTaskStatus['items']>[number];

/**
 * N6 최종 렌더 task 선택 결과.
 * - single: 현재 최종 렌더 1건
 * - none: 아직 현재 최종 렌더를 관측하지 못함(다른 task 로 대신하지 않는다)
 * - ambiguous: 후보가 2건 이상 — 서버 응답 invariant 위반. FE 가 어느 것도 고르지 않는다
 * - not-n6: currentStep 이 N6 가 아니라 최종 렌더로 확정하지 않는다
 */
export type N6RenderTaskSelection =
  | { kind: 'single'; task: TaskItem }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'not-n6' };

/**
 * N6 최종 렌더 task — currentStep=N6 이고 taskType=render · unitType=job · unitId=현재 jobId 인 항목.
 * BE release 44e7164 현재 구현 확인: /tasks 는 현재 final_render 실행의 현재 시도만 반환하고
 * 교체·취소된 이전 시도는 제외한다. 공개 명세 반영 예정.
 * 후보는 개수로만 판단한다. taskId 크기·status·배열 순서로 최신을 추정하지 않는다
 * (재시도로 taskId 가 바뀌어도 매 응답에서 이 조건으로 다시 찾는다).
 */
export function selectN6RenderTask(data: ApiJobTaskStatus | undefined, jobId: string): N6RenderTaskSelection {
  if (data?.currentStep !== 'N6') return { kind: 'not-n6' };
  const candidates = (data.items ?? []).filter(
    (item) => item.taskType === 'render' && item.unitType === 'job' && item.unitId != null && String(item.unitId) === jobId,
  );
  if (candidates.length === 1) return { kind: 'single', task: candidates[0] };
  if (candidates.length === 0) return { kind: 'none' };
  return { kind: 'ambiguous', count: candidates.length };
}

/**
 * N6 에서 현재 최종 렌더가 1건으로 관측되지 않거나 작업 상태와 어긋난 상태(unresolved)를 계속 기다리는 상한.
 * 프로젝트에 공통 polling 종료 정책은 없다. 가장 가까운 선례인 N5 [저장하러 가기]의 재렌더 대기
 * (2초 × 90회 ≈ 3분, n5-panel.tsx)를 그대로 따른 FE 제안값이며 서버 timeout 계약이 아니다.
 * 넘으면 polling 을 멈추고 「상태 확인 불가」 + [다시 확인](/tasks 재조회만)을 보인다.
 */
export const N6_TASK_UNRESOLVED_LIMIT_MS = 2_000 * 90;

/** jobId → unresolved 가 처음 관측된 응답 시각(dataUpdatedAt). 같은 /tasks query 를 구독하는 page.tsx·N6 화면이 함께 쓴다 */
const unresolvedSince = new Map<string, number>();

/**
 * N6 화면 상태 — 현재 최종 렌더 task 와 작업 상태(jobStatus · userFacingStatus)를 함께 본다.
 *
 * 새 서버(server PR #157 · README 7.8 ②③)와 구 서버를 같이 받는다.
 * | 구분 | jobStatus | userFacingStatus | 현재 렌더 task |
 * | 렌더 중 | processing(새) · review(구) | rendering(새) · reviewing(구) | pending · running |
 * | 저장 대기 | review | awaiting_save(새) · reviewing(구) | done |
 * | 렌더 실패 | failed(새) · review(구) | failed(새) · reviewing(구) | failed |
 * | 완료(저장 뒤) | done | done | done |
 *
 * - 구 서버의 `reviewing` 은 렌더 중 · 저장 대기를 가르지 않는다 — 그때는 지금처럼 task 상태로 가른다.
 * - task 가 done 인데 작업이 아직 렌더 중(processing · rendering)이거나 오류(failed)라고 하면 서로 어긋난 응답이다. 완료로
 *   추정하지 않고 unresolved(mismatch)로 두어 다시 조회한다(none · ambiguous 와 같은 상한 뒤 「상태 확인 불가」).
 * - task 가 failed 인데 작업이 아직 렌더 중이라고 하면(자동 재시도로 넘어가는 사이 등) 실패 화면을 내지 않고 다시 조회한다.
 * - 값이 없거나 모르는 값은 어긋남의 근거로 쓰지 않는다(구 서버 · Mock 응답을 그대로 받는다).
 * - 재시도 가능 여부는 현재 task 의 `retryable === true` 뿐이다. retryCount < maxRetry · errorCode 로 추정하지 않는다
 *   (PROCESSING_TIMEOUT 도 서버의 retryable 을 따른다 — README 7.8 ⑤, PM 11-25).
 */
export type N6RenderPhase =
  | { kind: 'not-n6' }
  | { kind: 'unresolved'; reason: 'none' | 'ambiguous' | 'mismatch' }
  | { kind: 'rendering'; task: TaskItem }
  | { kind: 'ready'; task: TaskItem }
  | { kind: 'failed'; task: TaskItem; retryable: boolean };

export function resolveN6RenderPhase(data: ApiJobTaskStatus | undefined, jobId: string): N6RenderPhase {
  const selection = selectN6RenderTask(data, jobId);
  if (selection.kind === 'not-n6') return { kind: 'not-n6' };
  if (selection.kind === 'none' || selection.kind === 'ambiguous') return { kind: 'unresolved', reason: selection.kind };
  const task = selection.task;
  const jobStatus = jobStatusOf(data);
  const userFacing = userFacingStatusOf(data);
  const jobSaysRendering = jobStatus === 'processing' || userFacing === 'rendering';
  const jobSaysFailed = jobStatus === 'failed' || userFacing === 'failed';

  if (task.status === 'done') {
    return jobSaysRendering || jobSaysFailed ? { kind: 'unresolved', reason: 'mismatch' } : { kind: 'ready', task };
  }
  if (task.status === 'failed') {
    return jobSaysRendering ? { kind: 'unresolved', reason: 'mismatch' } : { kind: 'failed', task, retryable: task.retryable === true };
  }
  // pending · running(그 밖의 값 포함) — 완료를 추정하지 않고 렌더 중으로 둔다(polling 유지)
  return { kind: 'rendering', task };
}

/**
 * 현재 최종 렌더를 N6_TASK_UNRESOLVED_LIMIT_MS 넘게 확인하지 못했는가(0건 · 여러 건 · 작업 상태와 어긋남).
 * 확인되면(또는 N6 가 아닌 응답이 오면) 기준을 지운다. 같은 응답에 몇 번 불러도 결과가 같다.
 */
export function isN6RenderStatusUnknown(jobId: string, data: ApiJobTaskStatus | undefined, dataUpdatedAt: number): boolean {
  const kind = resolveN6RenderPhase(data, jobId).kind;
  if (kind !== 'unresolved' || dataUpdatedAt <= 0) {
    unresolvedSince.delete(jobId);
    return false;
  }
  let since = unresolvedSince.get(jobId);
  if (since == null || since > dataUpdatedAt) {
    since = dataUpdatedAt;
    unresolvedSince.set(jobId, since);
  }
  return dataUpdatedAt - since >= N6_TASK_UNRESOLVED_LIMIT_MS;
}

/** N6 화면을 떠나면 기준을 지운다 — 다시 들어오면 새로 센다 */
export function resetN6RenderStatusTracking(jobId: string): void {
  unresolvedSince.delete(jobId);
}
