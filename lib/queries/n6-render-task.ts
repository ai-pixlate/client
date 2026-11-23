import type { ApiJobTaskStatus } from '@/lib/api/n5-schema';

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
 * N6 에서 현재 최종 렌더가 1건으로 관측되지 않는 상태(none·ambiguous)를 계속 기다리는 상한.
 * 프로젝트에 공통 polling 종료 정책은 없다. 가장 가까운 선례인 N5 [저장하러 가기]의 재렌더 대기
 * (2초 × 90회 ≈ 3분, n5-panel.tsx)를 그대로 따른 FE 제안값이며 서버 timeout 계약이 아니다.
 * 넘으면 polling 을 멈추고 「상태 확인 불가」 + [다시 확인](/tasks 재조회만)을 보인다.
 */
export const N6_TASK_UNRESOLVED_LIMIT_MS = 2_000 * 90;

/** jobId → none·ambiguous 가 처음 관측된 응답 시각(dataUpdatedAt). 같은 /tasks query 를 구독하는 page.tsx·N6 화면이 함께 쓴다 */
const unresolvedSince = new Map<string, number>();

/**
 * 현재 최종 렌더를 N6_TASK_UNRESOLVED_LIMIT_MS 넘게 1건으로 확인하지 못했는가.
 * 1건(또는 N6 가 아닌 응답)이 오면 기준을 지운다. 같은 응답에 몇 번 불러도 결과가 같다.
 */
export function isN6RenderStatusUnknown(jobId: string, data: ApiJobTaskStatus | undefined, dataUpdatedAt: number): boolean {
  const kind = selectN6RenderTask(data, jobId).kind;
  if ((kind !== 'none' && kind !== 'ambiguous') || dataUpdatedAt <= 0) {
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
