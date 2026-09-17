'use client';

import { use } from 'react';
import Link from 'next/link';

import { useJobTasksQuery } from '@/lib/queries/pixate';
import { N2AnalysisView } from './_components/n2-analysis-view';
import { N3View } from './_components/n3/n3-view';
import { N4ProcessingView } from './_components/n4-processing-view';
import { N5View } from './_components/n5/n5-view';
import { N6ResultView } from './_components/n6-result-view';

// ─────────────────────────────────────────────────────────────────
// N2 — 분석 진행 화면은 ./_components/n2-analysis-view.tsx로 분리됨
// (Figma 660:4139 기준 StepNav + 분석 비주얼/ANALYSIS LOG 2단 레이아웃)
//
// N3 — 섹션 확인 화면은 ./_components/n3/n3-view.tsx로 분리됨
// (Figma node 540:3119 기준 2버킷 drag & drop 레이아웃)
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
      {/* 상단 헤더 — N2/N3/N5/N6는 Figma 기준 자체 헤더(StepNav+나가기)를 가지므로 숨긴다 */}
      {currentStep !== 'N2' && currentStep !== 'N3' && currentStep !== 'N5' && currentStep !== 'N6' && (
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
            {currentStep === 'N2' && <N2AnalysisView status={tasksQuery.data} />}
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
