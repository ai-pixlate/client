'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { JobHeader } from '@/app/jobs/_components/job-header';
import { useJobExitGuard, type ExitGuardStatus } from '@/app/jobs/_components/job-exit-guard';
import { S0Rail } from '@/app/jobs/_components/s0-rail';
import type { StepNavStep } from '@/app/jobs/_components/step-nav';
import { isJobNotFoundError } from '@/lib/api/pixlate';
import { useJobAbort, useJobCancellationRecheck, useJobQuery, useJobTasksQuery } from '@/lib/queries/pixlate';
import { isCancelledJob } from '@/lib/api/job-status';
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

/** 화면이 rail 옆을 차지하는 단계 */
const SCREEN_STEPS: readonly (string | undefined)[] = ['N2', 'N3', 'N4', 'N5', 'N6'];

function toStepNavStep(step: string | undefined): StepNavStep | null {
  return step === 'N1' || SCREEN_STEPS.includes(step) ? (step as StepNavStep) : null;
}

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
  // [중단](API-JOB-07) — 처리 중·오류 화면 공용. 요청·재조회·안내는 hook 이 맡고, 화면 전환은 재조회로 바뀐 currentStep 이 정한다.
  // 요청 중에는 2초 polling 을 멈춘다 — 중단 처리 전 상태를 담은 늦은 응답이 복귀한 화면을 처리 단계로 되돌리지 않게(재조회는 hook 이 한다).
  // 처리 완료와 경합하면 서버 정본을 따른다(409 → 재조회 결과가 N3·N5 등이면 그 화면)
  const jobAbort = useJobAbort(jobId);
  const tasksQuery = useJobTasksQuery(jobId, { polling: !jobAbort.pending });
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
  // N4 전체 실패도 같은 기준이다. items 에 실패가 있어도 job 이 진행 중이면 부분 실패다
  const isN4Failed = !completion && currentStep === 'N4' && tasksQuery.data?.jobStatus === 'failed';
  // N6 완료 작업 — 저장 여부의 정본은 서버 job.isSaved 다(API-FIN-06 저장 성공 = is_saved=true). N6 에서만 조회하고(N1~N5 는
  // 요청을 늘리지 않는다), [저장] 성공 시 useSaveJobMutation 이 같은 key 의 cache 를 이동보다 먼저 isSaved=true 로 바꾼다. 다운로드 URL
  // 발급 뒤에는 job 을 다시 받기만 한다(다운로드가 is_saved 를 바꾸는지는 계약에 없다 — FE 가 isSaved 를 만들지 않는다).
  // 실패·false 는 완료로 추정하지 않는다(작업 취소 확인 유지).
  const isN6 = displayStep === 'N6';
  const jobQuery = useJobQuery(jobId, { enabled: isN6 });
  // 나가기 판단용 조회 상태(useJobExitGuard) — 서버 응답이 있는 값부터 본다(재조회 실패에도 받아 둔 값은 남는다).
  // 단계를 모르거나 N6 완료 여부를 아직 모르면 loading(나가기를 잡아 두고 기다린다), N6 isSaved=true 는 saved(묻지 않음),
  // 없는 작업(404)은 not-found, 첫 조회가 실패해 완료 여부를 모르면 error(취소하지 않고 「상태를 확인하지 못함」 창으로 묻는다)다.
  const isNotFound = tasksQuery.isError && isJobNotFoundError(tasksQuery.error);
  // 취소된 작업 — 구 서버 archived · 새 서버 cancelled(server PR #157, 200 응답) 둘 다 같다(lib/api/job-status.ts). 기존 404 도 받는다:
  // 404 는 위 없는 작업 화면, 취소는 편집 화면을 다시 그리지 않고 종료 안내만 둔다(지킬 작업이 없다 — 나가기도 DELETE 없이 통과).
  // N6 에서는 GET /jobs/{id} 의 status 도 본다(서버 응답이 취소라고 말할 때만 — 조회 실패·없음은 취소로 추정하지 않는다)
  const isCancelled = isCancelledJob(tasksQuery.data) || (isN6 && isCancelledJob(jobQuery.data));
  // 변경 요청이 409 INVALID_STATE · RETRY_NOT_ALLOWED 로 끝나면 /tasks 를 다시 받아 위 판단에 넣는다(취소일 때만 안내로 바뀜)
  useJobCancellationRecheck(jobId);
  let exitStatus: ExitGuardStatus = 'loading';
  if (isNotFound || isCancelled) exitStatus = 'not-found';
  else if (tasksQuery.data && !isN6) exitStatus = 'active';
  else if (tasksQuery.data && jobQuery.data) exitStatus = jobQuery.data.isSaved ? 'saved' : 'active';
  else if (tasksQuery.data ? jobQuery.isError : tasksQuery.isError) exitStatus = 'error';
  // 조회 실패 창의 [다시 확인] — 같은 기준으로 다시 받아 결과 상태를 돌려준다(재조회 GET 뿐 · 새 요청 계약 없음)
  const recheckExitStatus = async (): Promise<ExitGuardStatus> => {
    const tasks = await tasksQuery.refetch();
    if (tasks.isError) return isJobNotFoundError(tasks.error) ? 'not-found' : 'error';
    if (!tasks.data) return 'error';
    // 재조회 결과가 취소(archived · cancelled)면 진행 중 작업으로 보지 않는다 — 취소 확인(DELETE)을 다시 열지 않는다
    if (isCancelledJob(tasks.data)) return 'not-found';
    if (tasks.data.currentStep !== 'N6') return 'active';
    const job = await jobQuery.refetch();
    if (job.isError || !job.data) return 'error';
    if (isCancelledJob(job.data)) return 'not-found';
    return job.data.isSaved ? 'saved' : 'active';
  };
  // 중단 요청 중에는 나가기(작업 취소 DELETE)를 잡아 둔다 — 같은 작업에 중단과 취소가 겹쳐 나가지 않게
  const exitGuard = useJobExitGuard({ jobId, status: exitStatus, recheck: recheckExitStatus, locked: jobAbort.pending });
  // 서버 currentStep=N1(draft) — N2 중단 복귀 등. N1 화면은 /jobs/new 하나라, 같은 작업 id 로 그 화면을 열어 서버 값으로 복원한다
  // (새 작업을 만들지 않는다). 취소된 작업은 옮기지 않고 아래 종료 안내를 둔다
  const router = useRouter();
  const isServerN1 = !isCancelled && currentStep === 'N1';
  useEffect(() => {
    if (isServerN1) router.replace(`/jobs/new?jobId=${encodeURIComponent(jobId)}`);
  }, [isServerN1, jobId, router]);
  // 취소된 작업은 단계 화면이 아니다 — 단계를 모를 때와 같이 화면명·현재 단계를 그리지 않는다
  const screenStep = isCancelled ? undefined : displayStep;
  const hasScreen = SCREEN_STEPS.includes(screenStep);
  const headerStep = toStepNavStep(screenStep);

  return (
    <div className="relative flex h-screen flex-col bg-gray-50" data-exit-guard={exitGuard.guarding ? 'on' : 'off'} data-exit-state={exitStatus}>
      {/* N1~N6 작업용 공통 헤더(Figma 1809:42006 작업용) — 화면 위에 겹쳐 놓아 본문 위치를 바꾸지 않는다.
          상태 조회 중·실패처럼 단계를 모르는 동안에는 화면명을 추측하지 않으므로 그리지 않는다 */}
      {headerStep && <JobHeader step={headerStep} onLogoutRequest={exitGuard.requestLogout} />}

      {/* S0 rail 과 나가기 확인창은 단계 화면 밖에 한 번만 둔다 — 자동 전환에도 확인창과 진행 중인 취소 요청이 유지된다.
          화면이 없는 동안(상태 조회 중·실패·N1)은 rail 을 겹쳐 놓아 본문 위치를 바꾸지 않는다. */}
      {exitGuard.dialog}
      <div className={`flex min-h-0 flex-1 ${hasScreen ? 'bg-white' : ''}`}>
        <S0Rail currentStep={headerStep} overlay={!hasScreen} />

        {/* 본문. 상태를 모르는 동안(작업용 헤더도 없다) 예전 헤더 높이(56)를 비워 두어 안내 문구가 기존 위치에 있게 한다 */}
        <div className={`flex min-w-0 flex-1 flex-col overflow-hidden ${screenStep ? '' : 'pt-14'}`}>
          {tasksQuery.isLoading && (
            <div className="flex flex-1 items-center justify-center">
              <span className="text-sm text-gray-400">작업 상태를 확인하고 있습니다.</span>
            </div>
          )}

          {tasksQuery.isError &&
            (isJobNotFoundError(tasksQuery.error) ? (
              // 없는 작업과 다른 계정의 작업을 서버가 같은 404 로 돌려준다 — 화면도 둘을 구분하지 않는다(소유 여부를 추정하지 않음)
              <div data-testid="job-not-found" role="alert" className="flex flex-1 flex-col items-center justify-center gap-4">
                <p className="text-sm text-[#171717]">작업을 찾을 수 없거나 접근할 수 없습니다.</p>
                <Link
                  href="/"
                  data-testid="job-not-found-library"
                  className="rounded-[6px] border border-[#eaeaea] bg-white px-4 py-2 text-[14px] leading-[17px] text-[#171717] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
                >
                  보관함으로 돌아가기
                </Link>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-red-500">
                  {tasksQuery.error instanceof Error
                    ? tasksQuery.error.message
                    : '오류가 발생했습니다.'}
                </p>
              </div>
            ))}

          {isCancelled && (
            <div data-testid="job-archived" role="alert" className="flex flex-1 flex-col items-center justify-center gap-4">
              <p className="text-sm text-[#171717]">취소된 작업입니다.</p>
              <Link
                href="/"
                data-testid="job-archived-library"
                className="rounded-[6px] border border-[#eaeaea] bg-white px-4 py-2 text-[14px] leading-[17px] text-[#171717] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
              >
                보관함으로 돌아가기
              </Link>
            </div>
          )}

          {tasksQuery.data && !isCancelled && (
            <>
              {displayStep === 'N2' && (
                <N2AnalysisView
                  jobId={jobId}
                  status={completion?.status ?? tasksQuery.data}
                  isCompleted={completion?.step === 'N2'}
                  isFailed={isN2Failed}
                  abort={{ onAbort: () => void jobAbort.abort('N2'), abortPending: jobAbort.pending, abortNotice: jobAbort.notice }}
                />
              )}
              {displayStep === 'N3' && <N3View jobId={jobId} />}
              {displayStep === 'N4' && (
                <N4ProcessingView
                  jobId={jobId}
                  status={completion?.status ?? tasksQuery.data}
                  isCompleted={completion?.step === 'N4'}
                  isFailed={isN4Failed}
                  abort={{ onAbort: () => void jobAbort.abort('N4'), abortPending: jobAbort.pending, abortNotice: jobAbort.notice }}
                />
              )}
              {displayStep === 'N5' && <N5View jobId={jobId} />}
              {displayStep === 'N6' && <N6ResultView jobId={jobId} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
