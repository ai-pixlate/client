'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

import { useJobTasksQuery } from '@/lib/queries/pixlate';
import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { COMPLETION_PRESENTATION_MS } from '@/lib/processing/displayed-progress';
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
// 처리 화면 완료 표시 — N2 → N3, N4 → N5. mock/실서버 공통.
//
// 실제 완료는 서버 currentStep 전환뿐이다. 서버는 마지막 단계를 끝낸 바로 그 응답에서 currentStep 을
// 바꿔 줄 수 있어서(2초 polling 사이에 끝나는 단계는 화면에 남지 않는다) 그대로 교체하면 30% 같은 중간
// 숫자에서 갑자기 다음 화면이 된다. 그래서 처리 화면이 떠 있던 중에 정상 완료 전환 응답을 받으면, 그
// 응답을 받은 뒤에만 같은 처리 화면을 COMPLETION_PRESENTATION_MS 동안 유지한다 — 숫자를 현재 값에서
// 100 까지 올리고(isCompleted) 5단계 전부 완료를 잠깐 보여 준 다음 다음 화면으로 넘어간다.
// 서버 작업을 기다리는 지연이 아니라 이미 끝난 결과를 보여 주는 시간이다. 정상 완료가 아닌 전환(N2 → N1
// 복귀 등)은 붙잡지 않고 바로 이동한다. currentStep 정본, polling, task 상태는 바꾸지 않는다.
//
// 10/22 — mock 전용 N2 최소 체류(7초)와 경과 시간으로 만든 mock 표시 progress 를 없앴다. 서버가 이미
// 끝냈는데 화면만 붙잡고 %·5단계를 시간으로 흘려보내는 것이었고, 실서버에서는 status.progress 를 그대로
// 보여 줘 N3 직전 숫자가 낮았다. 이제 N2·N4 모두 표시 % 는 처리 화면이 관측 단계 상한 안에서 따로 만든다.
// ─────────────────────────────────────────────────────────────────
const COMPLETION_TRANSITIONS: Record<string, string> = { N2: 'N3', N4: 'N5' };

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

  // 완료 표시(위 COMPLETION_TRANSITIONS 주석) — 렌더 중 조건부 setState("이전 값에서 state 조정" 패턴)로
  // 전환 순간을 잡고, 시간이 지나면 effect 의 timer 로 푼다.
  const [shownStep, setShownStep] = useState(currentStep);
  const [completion, setCompletion] = useState<{ step: 'N2' | 'N4'; status: ApiJobTaskStatus } | null>(null);
  if (currentStep !== shownStep) {
    setShownStep(currentStep);
    if ((shownStep === 'N2' || shownStep === 'N4') && COMPLETION_TRANSITIONS[shownStep] === currentStep && tasksQuery.data) {
      setCompletion({ step: shownStep, status: tasksQuery.data });
    }
  }
  useEffect(() => {
    if (!completion) return;
    const timer = setTimeout(() => setCompletion(null), COMPLETION_PRESENTATION_MS);
    return () => clearTimeout(timer);
  }, [completion]);
  const displayStep = completion?.step ?? currentStep;
  // N2 전체 분석 실패 SSOT — currentStep=N2 && jobStatus=failed 뿐이다. failedCount·stages·progress·
  // analysisProgress.status 는 보지 않는다(LOCAL_JUDGE_FAILED 부분 제외는 실패가 아니다).
  const isN2Failed = !completion && currentStep === 'N2' && tasksQuery.data?.jobStatus === 'failed';
  const meta = (displayStep && STEP_META[displayStep]) || STEP_META_FALLBACK;

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* 상단 헤더 — N2/N3/N4/N5/N6는 Figma 기준 자체 헤더(StepNav+나가기)를 가지므로 숨긴다 */}
      {displayStep !== 'N2' &&
        displayStep !== 'N3' &&
        displayStep !== 'N4' &&
        displayStep !== 'N5' &&
        displayStep !== 'N6' && (
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
            {displayStep === 'N2' && (
              <N2AnalysisView
                jobId={jobId}
                status={completion?.status ?? tasksQuery.data}
                isCompleted={completion?.step === 'N2'}
                isFailed={isN2Failed}
              />
            )}
            {displayStep === 'N3' && <N3View jobId={jobId} />}
            {displayStep === 'N4' && (
              <N4ProcessingView
                jobId={jobId}
                status={completion?.status ?? tasksQuery.data}
                isCompleted={completion?.step === 'N4'}
              />
            )}
            {displayStep === 'N5' && <N5View jobId={jobId} />}
            {displayStep === 'N6' && <N6ResultView jobId={jobId} />}
          </>
        )}
      </div>
    </div>
  );
}
