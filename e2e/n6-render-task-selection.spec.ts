import { test, expect } from '@playwright/test';
import type { ApiJobTaskStatus } from '@/lib/api/n5-schema';
import { selectN6RenderTask } from '@/lib/queries/n6-render-task';

// N6 현재 최종 렌더 task 선택 규칙(브라우저 없이 selector 만 검증).
// 조건: currentStep=N6 · taskType=render · unitType=job · unitId=현재 jobId. 후보 개수로만 판단한다.
// taskId 크기·status·배열 순서로 최신을 추정하면 실패다(BE release 44e7164 현재 구현 확인, 공개 명세 반영 예정).

test.skip(({ browserName }) => browserName !== 'chromium', 'selector 단위 검증은 한 번만 돈다');

const JOB_ID = '7';
type Item = NonNullable<ApiJobTaskStatus['items']>[number];

function item(taskId: number, unitType: Item['unitType'], unitId: number | null, status: Item['status'] = 'running'): Item {
  return { taskId, taskType: 'render', unitType, unitId, status };
}

function tasks(items: Item[], currentStep: ApiJobTaskStatus['currentStep'] = 'N6'): ApiJobTaskStatus {
  return { currentStep, items };
}

function selectedTaskId(data: ApiJobTaskStatus): number | undefined {
  const selection = selectN6RenderTask(data, JOB_ID);
  return selection.kind === 'single' ? selection.task.taskId : undefined;
}

test('A. 후보가 정확히 1개면 그 task 를 선택한다', () => {
  expect(selectN6RenderTask(tasks([item(101, 'job', 7)]), JOB_ID)).toEqual({ kind: 'single', task: item(101, 'job', 7) });
});

test('B. section·text_block render 가 함께 와도 job/현재 jobId 만 선택한다', () => {
  expect(selectedTaskId(tasks([item(11, 'section', 11), item(20, 'text_block', 20), item(101, 'job', 7)]))).toBe(101);
});

test('B-2. 다른 jobId 의 job render 는 후보가 아니다', () => {
  expect(selectN6RenderTask(tasks([item(500, 'job', 8), item(101, 'job', 7)]), JOB_ID)).toMatchObject({ kind: 'single', task: { taskId: 101 } });
  expect(selectN6RenderTask(tasks([item(500, 'job', 8), item(501, 'job', null)]), JOB_ID)).toEqual({ kind: 'none' });
});

test('C. 후보가 0개면 다른 task 를 고르지 않고 none(관측 전)이다', () => {
  expect(selectN6RenderTask(tasks([item(999, 'section', 3), item(998, 'text_block', 4)]), JOB_ID)).toEqual({ kind: 'none' });
  expect(selectN6RenderTask(tasks([]), JOB_ID)).toEqual({ kind: 'none' });
});

test('D. 후보가 2개면 max(taskId)·첫/마지막 요소 어느 것도 고르지 않는다', () => {
  expect(selectN6RenderTask(tasks([item(100, 'job', 7), item(200, 'job', 7)]), JOB_ID)).toEqual({ kind: 'ambiguous', count: 2 });
  expect(selectN6RenderTask(tasks([item(200, 'job', 7), item(100, 'job', 7)]), JOB_ID)).toEqual({ kind: 'ambiguous', count: 2 });
});

test('E. done + running 이 함께 와도 running 을 고르지 않는다(invariant 위반)', () => {
  expect(selectN6RenderTask(tasks([item(100, 'job', 7, 'done'), item(200, 'job', 7, 'running')]), JOB_ID)).toEqual({ kind: 'ambiguous', count: 2 });
  expect(selectN6RenderTask(tasks([item(200, 'job', 7, 'pending'), item(100, 'job', 7, 'done')]), JOB_ID)).toEqual({ kind: 'ambiguous', count: 2 });
});

test('F. 관련 없는 더 큰 taskId 가 있어도 조건에 맞는 작은 taskId 를 선택한다', () => {
  expect(selectedTaskId(tasks([item(999, 'section', 1, 'done'), item(10, 'job', 7, 'running')]))).toBe(10);
});

test('G. 재시도로 taskId 가 바뀌면 매 응답 기준으로 교체된다(이전 id 기억 없음)', () => {
  expect(selectedTaskId(tasks([item(100, 'job', 7, 'failed')]))).toBe(100);
  expect(selectedTaskId(tasks([item(108, 'job', 7, 'running')]))).toBe(108);
  // 값이 작아져도 같은 규칙 — taskId 증가 순서를 가정하지 않는다
  expect(selectedTaskId(tasks([item(50, 'job', 7, 'running')]))).toBe(50);
});

test('H. currentStep 이 N6 가 아니면 render/job task 가 있어도 확정하지 않는다', () => {
  expect(selectN6RenderTask(tasks([item(101, 'job', 7)], 'N5'), JOB_ID)).toEqual({ kind: 'not-n6' });
  expect(selectN6RenderTask(undefined, JOB_ID)).toEqual({ kind: 'not-n6' });
});
