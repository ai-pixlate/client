'use client';

import { use, useEffect, useState } from 'react';
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
// N2 최소 체류 시간 — mock 환경(NEXT_PUBLIC_API_MOCKING=enabled) 전용.
// mock 서버는 poll 2회(약 4초) 만에 N2 task를 끝내버려 화면을 확인할
// 여유조차 없어, 화면 구성 확인 목적으로만 최소 7초를 보장한다. 서버가
// 이미 다음 단계로 넘어갔어도(task 완료) 이 시간 전에는 화면을 넘기지
// 않고, 반대로 서버가 7초보다 오래 걸리면 기존처럼 task 완료 시점까지
// 그대로 기다린다 — 즉 "task 완료"와 "최소 체류 충족" 둘 다 필요하다.
// 실서버/mock 비활성 환경에서는 이 게이트를 아예 타지 않는다(기존 동작
// 그대로). polling 주기(2초)나 mock의 task 완료 로직 자체는 건드리지
// 않는다.
// ─────────────────────────────────────────────────────────────────
const N2_MOCK_MIN_DWELL_MS = 7000;
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

  // task는 끝났지만(rawCurrentStep이 N2를 벗어남) 최소 체류 시간이 아직
  // 안 지났으면 N2 화면을 그대로 유지한다. 두 조건이 모두 만족되면(=
  // n2DwellElapsed) 실제 서버 상태를 그대로 반영한다.
  const currentStep =
    IS_MOCK_ENABLED && n2EnteredAt !== null && !n2DwellElapsed && rawCurrentStep !== 'N2'
      ? 'N2'
      : rawCurrentStep;
  const meta = (currentStep && STEP_META[currentStep]) || STEP_META_FALLBACK;

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
    const serverCompleted = rawCurrentStep !== 'N2';
    // 서버가 끝났고 7초도 다 찼을 때만 100% — 그 전에는 어느 쪽이든
    // 99%에서 멈춰 기다린다("100%인데 화면이 안 넘어가는 상태" 방지).
    mockN2Progress = serverCompleted && elapsedRatio >= 1 ? 1 : Math.min(0.99, elapsedRatio);
  }

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
            {currentStep === 'N2' && <N2AnalysisView status={tasksQuery.data} progressOverride={mockN2Progress} />}
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
