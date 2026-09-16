'use client';

import { use } from 'react';
import Link from 'next/link';

import { useJobTasksQuery } from '@/lib/queries/pixate';
import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { N3View } from './_components/n3/n3-view';
import { N4ProcessingView } from './_components/n4-processing-view';
import { N5View } from './_components/n5/n5-view';
import { N6ResultView } from './_components/n6-result-view';

const SUBSTEP_FALLBACK = '이미지를 분석하고 있습니다.';

// ─────────────────────────────────────────────────────────────────
// N2 — 분석 진행 화면
//
// 오늘(N1→N6 happy path): GET /jobs/:jobId/tasks(JobTaskStatus)로 갈아탔다.
// progress는 0.0~1.0 실수라 화면 표시는 반올림한 정수 %로 변환한다. 세부
// 단계 문구는 FE가 substep 코드를 자체 매핑하지 않고 서버가 내려준
// stages[].label을 그대로 쓴다(stages는 "step별 고정 단계"라 화면 표시 문구가
// 런타임 값이라고 계약에 명시돼 있다). 실패 항목은 items[]에서 status==='failed'만
// 걸러 보여준다 — 세부 재시도 UI는 오늘 범위가 아니다.
// ─────────────────────────────────────────────────────────────────
function N2View({ status }: { status: ApiJobTaskStatus }) {
  const runningStage = status.stages?.find((s) => s.status === 'running');
  const subStepLabel = runningStage?.label ?? SUBSTEP_FALLBACK;
  const progressPercent = Math.round((status.progress ?? 0) * 100);
  const failedItems = (status.items ?? []).filter((i) => i.status === 'failed');

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6">
      {/* 스피너 */}
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-50">
        <svg
          className="h-10 w-10 animate-spin text-blue-500"
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

      {/* 진행률 */}
      <div className="w-full max-w-sm space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">{subStepLabel}</span>
          <span className="font-semibold tabular-nums text-blue-600">{progressPercent}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-blue-500 transition-[width] duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <p className="text-xs text-gray-400">완료되면 자동으로 다음 단계로 이동합니다.</p>

      {/* 부분 실패 알림 */}
      {failedItems.length > 0 && (
        <div className="w-full max-w-sm rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="mb-2 text-sm font-medium text-orange-700">일부 항목을 처리하지 못했습니다</p>
          <ul className="space-y-1">
            {failedItems.map((item) => (
              <li key={item.taskId} className="text-xs text-orange-600">
                {item.unitType} #{item.unitId} — {item.errorCode ?? '알 수 없는 오류'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 확인 화면은 ./_components/n3/n3-view.tsx로 분리됨
// (Figma 540:3119 기준 2버킷 drag & drop 레이아웃)
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// 페이지 루트
// ─────────────────────────────────────────────────────────────────

const STEP_META: Record<string, { label: string; desc: string }> = {
  N1: { label: 'N1', desc: '정보 입력' },
  N2: { label: 'N2', desc: '이미지 분석' },
  N3: { label: 'N3', desc: '섹션 확인' },
  N4: { label: 'N4', desc: '번역 처리' },
  N5: { label: 'N5', desc: '검수' },
  N6: { label: 'N6', desc: '최종 결과' },
};
const STEP_META_FALLBACK = STEP_META.N2;

export default function Page({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);

  // tasks polling(GET /jobs/:jobId/tasks)은 페이지에서 한 번만 실행하고,
  // currentStep으로 화면을 분기한다. N2View / N4ProcessingView는 이 결과를
  // status props로 전달받아 재사용한다. currentStep/userFacingStatus는 서버
  // 응답 그대로 쓴다 — 여기서 다시 계산하지 않는다.
  const tasksQuery = useJobTasksQuery(jobId, { polling: true });

  const currentStep = tasksQuery.data?.currentStep;
  const meta = (currentStep && STEP_META[currentStep]) || STEP_META_FALLBACK;

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* 상단 헤더 — N3/N5는 Figma 기준 자체 헤더(뒤로가기)를 가지므로 숨긴다 */}
      {currentStep !== 'N3' && currentStep !== 'N5' && (
        <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-white px-6 shadow-sm">
          <Link
            href="/"
            className="text-sm text-gray-500 transition-colors hover:text-gray-700"
          >
            ← 뒤로
          </Link>
          <div className="h-4 w-px bg-gray-200" />
          <div className="flex items-center gap-2">
            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
              {meta.label}
            </span>
            <span className="text-sm font-medium text-gray-700">{meta.desc}</span>
          </div>
        </header>
      )}

      {/* 본문 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {tasksQuery.isLoading && (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-gray-400">작업 상태를 확인하고 있습니다.</span>
          </div>
        )}

        {tasksQuery.isError && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-red-500">
              {tasksQuery.error instanceof Error
                ? tasksQuery.error.message
                : '오류가 발생했습니다.'}
            </p>
          </div>
        )}

        {tasksQuery.data && (
          <>
            {currentStep === 'N2' && <N2View status={tasksQuery.data} />}
            {currentStep === 'N3' && <N3View jobId={jobId} />}
            {currentStep === 'N4' && <N4ProcessingView status={tasksQuery.data} />}
            {currentStep === 'N5' && <N5View jobId={jobId} />}
            {currentStep === 'N6' && <N6ResultView jobId={jobId} />}
          </>
        )}
      </div>
    </div>
  );
}
