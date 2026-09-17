'use client';

import type { ApiJobTaskStatus } from '@/lib/api/job-schema';

const N4_SUBSTEP_FALLBACK = '번역 결과를 생성하고 있습니다.';

/**
 * 오늘(N1→N6 happy path): GET /jobs/:jobId/tasks(JobTaskStatus)로 갈아탔다.
 * N2View와 같은 이유로 substep 코드 매핑을 걷어내고 stages[].label을 그대로
 * 쓴다 — progress는 0.0~1.0 실수라 반올림한 정수 %로 표시한다.
 */
export function N4ProcessingView({ status }: { status: ApiJobTaskStatus }) {
  const runningStages = (status.stages ?? []).filter((s) => s.status === 'running');
  const primaryLabel = runningStages[0]?.label ?? N4_SUBSTEP_FALLBACK;
  const progressPercent = Math.round((status.progress ?? 0) * 100);
  const failedItems = (status.items ?? []).filter((i) => i.status === 'failed');

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6">
      {/* 스피너 */}
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-violet-50">
        <svg
          className="h-10 w-10 animate-spin text-violet-500"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            fill="currentColor"
          />
        </svg>
      </div>

      {/* 제목 + 현재 단계 */}
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-800">번역을 진행하고 있습니다</h2>
        <p className="mt-1 text-sm text-gray-500">{primaryLabel}</p>
      </div>

      {/* 진행률 바 */}
      <div className="w-full max-w-sm space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">전체 진행률</span>
          <span className="font-semibold tabular-nums text-violet-600">{progressPercent}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-violet-500 transition-[width] duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 병렬 처리 중인 서브스텝 태그 */}
      {runningStages.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {runningStages.map((stage) => (
            <span
              key={stage.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
              {stage.label}
            </span>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400">완료되면 자동으로 검수 단계로 이동합니다.</p>

      {/* 부분 실패 안내 */}
      {failedItems.length > 0 && (
        <div className="w-full max-w-sm rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="mb-2 text-sm font-medium text-orange-700">
            일부 텍스트 블록을 처리하지 못했습니다
          </p>
          <ul className="mb-3 space-y-1">
            {failedItems.map((item) => (
              <li key={item.taskId} className="text-xs text-orange-600">
                {item.unitType} #{item.unitId} — {item.errorCode ?? '알 수 없는 오류'}
              </li>
            ))}
          </ul>
          <p className="text-xs text-orange-500">
            처리가 완료되면 N5 검수 화면에서 실패 블록을 직접 수정할 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}
