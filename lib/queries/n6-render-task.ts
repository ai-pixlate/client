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
