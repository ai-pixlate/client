'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

import { useJobTasksQuery } from '@/lib/queries/pixlate';
import type { ApiJobTaskStatus } from '@/lib/api/job-schema';
import { N2AnalysisView, isN2PresentationDone } from './_components/n2-analysis-view';
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
// N2 최소 체류 시간 — mock 환경(NEXT_PUBLIC_API_MOCKING=enabled) 전용.
// mock 서버는 poll 2회(약 4초) 만에 N2 task를 끝내버려 화면을 확인할
// 여유조차 없어, 화면 구성 확인 목적으로만 최소 7초를 보장한다. 서버가
// 이미 다음 단계로 넘어갔어도(task 완료) 이 시간 전에는 화면을 넘기지
// 않고, 반대로 서버가 7초보다 오래 걸리면 기존처럼 task 완료 시점까지
// 그대로 기다린다 — 즉 "task 완료"와 "최소 체류 충족" 둘 다 필요하다.
// 여기서 "task 완료"는 정상 완료(currentStep=N3)만 뜻한다. N1 복귀 같은
// 다른 전환은 붙잡지 않고 바로 반영한다.
// 실서버/mock 비활성 환경에서는 이 게이트를 아예 타지 않는다(기존 동작
// 그대로). polling 주기(2초)나 mock의 task 완료 로직 자체는 건드리지
// 않는다.
// ─────────────────────────────────────────────────────────────────
const N2_MOCK_MIN_DWELL_MS = 7000;

// ─────────────────────────────────────────────────────────────────
// N2 완료 표시 — mock/실서버 공통.
//
// 서버는 마지막 stage 를 끝낸 바로 그 응답에서 currentStep 을 N3 로 바꿔 줄 수 있다. 그러면
// 직전 poll 이 아직 앞 단계(예: 02·03 진행 중)였을 때 화면 5단계 중 뒤쪽 항목(04·05)은 진행
// 중으로도 완료로도 한 번도 그려지지 않은 채 N3 로 넘어간다(2초 polling 사이에 끝나는 stage 는
// 화면에 남지 않는다). 그래서 N2 가 화면에 떠 있었고 마지막으로 그린 상태가 "전부 완료"가
// 아니었다면, 서버가 N3 로 넘어간 응답을 받은 뒤 그 응답 그대로 5단계 완료 상태를 한 번 짧게
// 보여 주고 N3 로 넘어간다. 정상 완료는 N2 → N3 전환뿐이라, N1 복귀 등 다른 step 으로 나가는
// 경우에는 완료 상태를 만들지 않고 바로 이동한다. 서버가 이미 N2 완료를 알린 뒤의 표시라 처리되지 않은 일을
// 완료라고 보여 주지 않는다. 이 시점에 "진행 중" 상태를 새로 만들지 않는다 — 건너뛴 항목은
// 대기 → 완료로 바로 바뀐다. currentStep 정본, polling, task 상태는 바꾸지 않는다.
//
// N2_COMPLETION_DWELL_MS 는 API 계약값이나 실제 처리 시간이 아니라 화면 표시용 체류 시간이다
// — 마지막 완료 상태를 알아볼 수 있을 만큼만 두고, N3 진입이 늦어졌다고 느끼지 않을 정도로
// 짧게 잡은 UX 값이다.
// ─────────────────────────────────────────────────────────────────
const N2_COMPLETION_DWELL_MS = 600;
const IS_MOCK_ENABLED = process.env.NEXT_PUBLIC_API_MOCKING === 'enabled';

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
  const rawCurrentStep = tasksQuery.data?.currentStep;

  // N2 진입 시점(서버가 처음으로 currentStep==='N2'를 응답한 시점)을
  // 한 번만 기록한다 — 이미 N2를 지나 시작된 job에는 적용하지 않는다.
  const [n2EnteredAt, setN2EnteredAt] = useState<number | null>(null);
  const [n2DwellElapsed, setN2DwellElapsed] = useState(false);

  useEffect(() => {
    if (IS_MOCK_ENABLED && rawCurrentStep === 'N2' && n2EnteredAt === null) {
      setN2EnteredAt(Date.now());
    }
  }, [rawCurrentStep, n2EnteredAt]);

  // 위 effect와 별개로, n2EnteredAt이 정해진 그 순간에만 타이머를 한 번
  // 건다 — rawCurrentStep이 이후 바뀌어도(N3로 전환) 이 effect가 다시
  // 실행되며 타이머가 취소되지 않도록 의존성을 n2EnteredAt만으로 둔다.
  useEffect(() => {
    if (n2EnteredAt === null) return;
    const remaining = N2_MOCK_MIN_DWELL_MS - (Date.now() - n2EnteredAt);
    if (remaining <= 0) {
      setN2DwellElapsed(true);
      return;
    }
    const timer = setTimeout(() => setN2DwellElapsed(true), remaining);
    return () => clearTimeout(timer);
  }, [n2EnteredAt]);

  // task는 끝났지만(rawCurrentStep이 N3로 넘어감) 최소 체류 시간이 아직
  // 안 지났으면 N2 화면을 그대로 유지한다. 두 조건이 모두 만족되면(=
  // n2DwellElapsed) 실제 서버 상태를 그대로 반영한다.
  const currentStep =
    IS_MOCK_ENABLED && n2EnteredAt !== null && !n2DwellElapsed && rawCurrentStep === 'N3'
      ? 'N2'
      : rawCurrentStep;

  // N2 mock progress 동기화 — mock 서버는 실제로는 poll 2회(약 4초) 만에
  // task를 끝내버려서, 위 7초 체류 게이트가 화면을 붙잡고 있는 동안
  // status.progress는 이미 한참 전에 도달한 값(0.5 고정 등)에 머문다.
  // 그대로 두면 "진행률은 안 움직이는데 화면만 붙잡혀 있다가 갑자기
  // N3로 넘어간다" 같은 부자연스러운 인상을 준다. mock에서만, 서버가
  // 원본으로 보낸 값은 건드리지 않고 화면에 보여줄 값만 별도로 계산한다
  // (progressOverride) — 실서버/mock 비활성에서는 항상 undefined라
  // N2AnalysisView가 기존처럼 status.progress를 그대로 쓴다.
  //
  // 100ms tick으로 elapsed를 다시 계산해 progress bar가 폴링 주기(2초)에
  // 맞춰 뚝뚝 끊기지 않고 부드럽게 움직이게 한다 — dwell이 끝나면(화면이
  // N2를 벗어나거나 곧 벗어날 시점) tick을 멈춰 불필요한 타이머를 남기지
  // 않는다.
  const [, forceMockProgressTick] = useState(0);
  useEffect(() => {
    if (!IS_MOCK_ENABLED || n2EnteredAt === null || n2DwellElapsed) return;
    const interval = setInterval(() => forceMockProgressTick((t) => t + 1), 150);
    return () => clearInterval(interval);
  }, [n2EnteredAt, n2DwellElapsed]);

  let mockN2Progress: number | undefined;
  if (IS_MOCK_ENABLED && n2EnteredAt !== null) {
    const elapsedRatio = Math.min(1, (Date.now() - n2EnteredAt) / N2_MOCK_MIN_DWELL_MS);
    const serverCompleted = rawCurrentStep === 'N3';
    // 서버가 끝났고 7초도 다 찼을 때만 100% — 그 전에는 어느 쪽이든
    // 99%에서 멈춰 기다린다("100%인데 화면이 안 넘어가는 상태" 방지).
    mockN2Progress = serverCompleted && elapsedRatio >= 1 ? 1 : Math.min(0.99, elapsedRatio);
  }

  // N2 완료 표시(위 N2_COMPLETION_DWELL_MS 주석) — 렌더 중 조건부 setState("이전 값에서 state
  // 조정" 패턴)로 전환 순간을 잡고, 시간이 지나면 effect 의 timer 로 푼다.
  const [shownStep, setShownStep] = useState(currentStep);
  const [lastN2ShownDone, setLastN2ShownDone] = useState(false);
  const [n2CompletionStatus, setN2CompletionStatus] = useState<ApiJobTaskStatus | null>(null);
  if (currentStep !== shownStep) {
    setShownStep(currentStep);
    if (shownStep === 'N2' && currentStep === 'N3' && tasksQuery.data && !lastN2ShownDone) {
      setN2CompletionStatus(tasksQuery.data);
    }
  }
  if (currentStep === 'N2' && tasksQuery.data) {
    const done = isN2PresentationDone(tasksQuery.data, mockN2Progress);
    if (done !== lastN2ShownDone) setLastN2ShownDone(done);
  }
  useEffect(() => {
    if (!n2CompletionStatus) return;
    const timer = setTimeout(() => setN2CompletionStatus(null), N2_COMPLETION_DWELL_MS);
    return () => clearTimeout(timer);
  }, [n2CompletionStatus]);
  const displayStep = n2CompletionStatus ? 'N2' : currentStep;
  // N2 전체 분석 실패 SSOT — currentStep=N2 && jobStatus=failed 뿐이다. failedCount·stages·progress·
  // analysisProgress.status 는 보지 않는다(LOCAL_JUDGE_FAILED 부분 제외는 실패가 아니다).
  const isN2Failed = !n2CompletionStatus && currentStep === 'N2' && tasksQuery.data?.jobStatus === 'failed';
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
                status={n2CompletionStatus ?? tasksQuery.data}
                progressOverride={isN2Failed ? undefined : mockN2Progress}
                isCompleted={n2CompletionStatus != null}
                isFailed={isN2Failed}
              />
            )}
            {displayStep === 'N3' && <N3View jobId={jobId} />}
            {displayStep === 'N4' && <N4ProcessingView jobId={jobId} status={tasksQuery.data} />}
            {displayStep === 'N5' && <N5View jobId={jobId} />}
            {displayStep === 'N6' && <N6ResultView jobId={jobId} />}
          </>
        )}
      </div>
    </div>
  );
}
