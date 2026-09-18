'use client';

import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import type { JobCurrentStep } from '@/lib/api/types';
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
// 디자인 확인용 preview 고정 — mock 환경 전용. `?previewStep=N2`처럼 쿼리로
// 렌더링 화면만 특정 step에 고정한다(서버 currentStep·polling·task
// 진행은 그대로 두고 화면 분기만 override). 이번엔 N2만 실제 지원하고,
// 추후 N3~N6을 추가할 때는 SUPPORTED_PREVIEW_STEPS에 값만 더하면 된다 —
// 분기 처리 지점은 이 한 곳(resolvePreviewStep)뿐이다.
// ─────────────────────────────────────────────────────────────────
const SUPPORTED_PREVIEW_STEPS: ReadonlySet<JobCurrentStep> = new Set<JobCurrentStep>(['N2']);

function resolvePreviewStep(raw: string | null): JobCurrentStep | null {
  if (!IS_MOCK_ENABLED || !raw) return null;
  return (SUPPORTED_PREVIEW_STEPS as ReadonlySet<string>).has(raw) ? (raw as JobCurrentStep) : null;
}

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

  // useSearchParams()는 정적 렌더링 시 이 컴포넌트를 Suspense 경계까지
  // client-only로 opt-in시킨다(Next.js 공식 요구사항, app/jobs/new/page.tsx와
  // 동일 패턴) — fallback 없이 즉시 그리는 얇은 wrapper로 감싼다.
  return (
    <Suspense fallback={null}>
      <PageInner jobId={jobId} />
    </Suspense>
  );
}

function PageInner({ jobId }: { jobId: string }) {
  // tasks polling(GET /jobs/:jobId/tasks)은 페이지에서 한 번만 실행하고,
  // currentStep으로 화면을 분기한다. N2View / N4ProcessingView는 이 결과를
  // status props로 전달받아 재사용한다. currentStep/userFacingStatus는 서버
  // 응답 그대로 쓴다 — 여기서 다시 계산하지 않는다.
  const tasksQuery = useJobTasksQuery(jobId, { polling: true });
  const rawCurrentStep = tasksQuery.data?.currentStep;

  const searchParams = useSearchParams();
  const previewStep = resolvePreviewStep(searchParams.get('previewStep'));

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
  const dwellGatedStep =
    IS_MOCK_ENABLED && n2EnteredAt !== null && !n2DwellElapsed && rawCurrentStep !== 'N2'
      ? 'N2'
      : rawCurrentStep;

  // previewStep은 위 최소 체류 게이트보다 우선한다 — polling으로 서버
  // currentStep이 더 진행돼도(N3 이상) 쿼리가 붙어 있는 한 화면은 그대로
  // 고정된다. jobId+쿼리스트링만으로 매 렌더 다시 계산되는 순수 파생값이라
  // 새로고침해도 동일하게 유지된다(별도 저장 불필요).
  const currentStep = previewStep ?? dwellGatedStep;
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
