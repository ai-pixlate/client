'use client';

import { use, useState } from 'react';

import {
  useJobStatusQuery,
  useSectionsQuery,
  useUpdateSectionBucketMutation,
  useAdvanceJobStepMutation,
} from '@/lib/queries/pixate';
import type { JobStatusResponse, Section } from '@/lib/api/types';
import { N4ProcessingView } from './_components/n4-processing-view';
import { N5ReviewView } from './_components/n5-review-view';
import { N6ResultView } from './_components/n6-result-view';

// ─────────────────────────────────────────────────────────────────
// processingSubStep → 사용자 안내 문구
// TODO: 백엔드 파이프라인 명세 확정 후 키 목록을 union으로 좁힐 것
// ─────────────────────────────────────────────────────────────────
const SUBSTEP_LABELS: Record<string, string> = {
  ocr: '이미지에서 텍스트를 읽고 있습니다.',
  section_decomposition: '상세페이지의 내용을 섹션으로 나누고 있습니다.',
  verdict: '규제 및 현지 적합성을 확인하고 있습니다.',
  inpainting: '원본 텍스트 영역을 정리하고 있습니다.',
  translation: '텍스트를 번역하고 있습니다.',
  compliance_check: '번역 결과의 규제 적합성을 확인하고 있습니다.',
  render: '최종 이미지를 생성하고 있습니다.',
};
const SUBSTEP_FALLBACK = '이미지를 분석하고 있습니다.';

// ─────────────────────────────────────────────────────────────────
// N2 — 분석 진행 화면
// ─────────────────────────────────────────────────────────────────
function N2View({ status }: { status: JobStatusResponse }) {
  const data = status;

  const subStepLabel = SUBSTEP_LABELS[data.processingSubStep] ?? SUBSTEP_FALLBACK;

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
          <span className="font-semibold tabular-nums text-blue-600">{data.progress}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          aria-valuenow={data.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-blue-500 transition-[width] duration-500 ease-out"
            style={{ width: `${data.progress}%` }}
          />
        </div>
      </div>

      <p className="text-xs text-gray-400">완료되면 자동으로 다음 단계로 이동합니다.</p>

      {/* 부분 실패 알림 */}
      {data.failedItems.length > 0 && (
        <div className="w-full max-w-sm rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="mb-2 text-sm font-medium text-orange-700">일부 항목을 처리하지 못했습니다</p>
          <ul className="space-y-1">
            {data.failedItems.map((item) => (
              <li key={item.id} className="text-xs text-orange-600">
                {item.id} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 카드
// ─────────────────────────────────────────────────────────────────
function SectionCard({
  section,
  onToggle,
  isDisabled,
  isMutating,
}: {
  section: Section;
  onToggle: () => void;
  isDisabled: boolean;
  isMutating: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const isExcluded = section.bucket === 'exclude';

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm transition-opacity duration-200 ${
        isExcluded ? 'opacity-50' : 'opacity-100'
      }`}
    >
      <div className="flex gap-4">
        {/* 썸네일 */}
        <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg bg-gray-100">
          {!imgFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={section.thumbnailUrl}
              alt={`섹션 ${section.sectionOrder} 미리보기`}
              className="h-full w-full object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1">
              <div className="h-6 w-6 rounded bg-gray-200" />
              <span className="text-[10px] text-gray-400">이미지 없음</span>
            </div>
          )}
        </div>

        {/* 본문 */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* 헤더: 섹션 번호 + 상태 뱃지 + 버튼 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">
                섹션 {section.sectionOrder}
              </span>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  isExcluded
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {isExcluded ? '제외됨' : '포함'}
              </span>
            </div>

            <button
              type="button"
              onClick={onToggle}
              disabled={isDisabled}
              className={`shrink-0 rounded-lg border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                isExcluded
                  ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 active:bg-gray-100'
              }`}
            >
              {isMutating ? '처리 중…' : isExcluded ? '되살리기' : '제외'}
            </button>
          </div>

          {/* 자동 제외 이유 */}
          {section.exclusionReason && (
            <p className="text-xs text-gray-500">{section.exclusionReason}</p>
          )}

          {/* 판정 결과 (규제/로컬라이제이션 경고) */}
          {section.verdicts.length > 0 && (
            <ul className="space-y-1.5">
              {section.verdicts.map((v) => (
                <li
                  key={v.verdictId}
                  className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2"
                >
                  <p className="text-xs font-medium text-yellow-800">⚠ {v.problemText}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-yellow-700">{v.basis}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 확인 화면
// ─────────────────────────────────────────────────────────────────
function N3View({ jobId }: { jobId: string }) {
  const { data, isLoading, isError, error } = useSectionsQuery(jobId);
  const mutation = useUpdateSectionBucketMutation(jobId);
  const advanceMutation = useAdvanceJobStepMutation(jobId);
  const [pendingSectionId, setPendingSectionId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-gray-400">섹션 목록을 불러오는 중...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-red-500">
          {error instanceof Error ? error.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const includedCount = data.sections.filter((s) => s.bucket === 'include').length;

  return (
    <>
      {/* 섹션 목록 (스크롤 영역) */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-3 px-6 py-6">
          <p className="text-sm text-gray-500">
            전체 {data.sections.length}개 섹션 중{' '}
            <span className="font-semibold text-gray-800">{includedCount}개</span> 포함됩니다.
          </p>

          {data.sections.map((section) => (
            <SectionCard
              key={section.sectionId}
              section={section}
              isDisabled={mutation.isPending}
              isMutating={mutation.isPending && pendingSectionId === section.sectionId}
              onToggle={() => {
                setPendingSectionId(section.sectionId);
                mutation.mutate(
                  {
                    sectionId: section.sectionId,
                    bucket: section.bucket === 'include' ? 'exclude' : 'include',
                    stage: 'N3',
                  },
                  { onSettled: () => setPendingSectionId(null) },
                );
              }}
            />
          ))}
        </div>
      </div>

      {/* 하단 액션 바 */}
      <div className="shrink-0 border-t bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl justify-between">
          <p className="text-sm text-gray-500">
            확인이 끝나면 번역을 시작하세요.
          </p>
          <button
            type="button"
            disabled={advanceMutation.isPending}
            onClick={() => advanceMutation.mutate()}
            className="rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {advanceMutation.isPending ? '번역 시작 중...' : '번역 시작 →'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// 페이지 루트
// ─────────────────────────────────────────────────────────────────

const STEP_META: Record<string, { label: string; desc: string }> = {
  N2: { label: 'N2', desc: '이미지 분석' },
  N3: { label: 'N3', desc: '섹션 확인' },
  N4: { label: 'N4', desc: '번역 처리' },
  N5: { label: 'N5', desc: '검수' },
  N6: { label: 'N6', desc: '최종 결과' },
};

export default function Page({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);

  // status polling은 페이지에서 한 번만 실행하고, currentStep으로 화면을 분기한다.
  // N2View / N4ProcessingView는 이 결과를 status props로 전달받아 재사용한다.
  const statusQuery = useJobStatusQuery(jobId, { polling: true });

  const currentStep = statusQuery.data?.currentStep;
  const meta = STEP_META[currentStep ?? 'N2'];

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* 상단 헤더 */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-white px-6 shadow-sm">
        <a
          href="/"
          className="text-sm text-gray-500 transition-colors hover:text-gray-700"
        >
          ← 뒤로
        </a>
        <div className="h-4 w-px bg-gray-200" />
        <div className="flex items-center gap-2">
          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
            {meta.label}
          </span>
          <span className="text-sm font-medium text-gray-700">{meta.desc}</span>
        </div>
      </header>

      {/* 본문 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {statusQuery.isLoading && (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-gray-400">작업 상태를 확인하고 있습니다.</span>
          </div>
        )}

        {statusQuery.isError && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-red-500">
              {statusQuery.error instanceof Error
                ? statusQuery.error.message
                : '오류가 발생했습니다.'}
            </p>
          </div>
        )}

        {statusQuery.data && (
          <>
            {currentStep === 'N2' && <N2View status={statusQuery.data} />}
            {currentStep === 'N3' && <N3View jobId={jobId} />}
            {currentStep === 'N4' && <N4ProcessingView status={statusQuery.data} />}
            {currentStep === 'N5' && <N5ReviewView jobId={jobId} />}
            {currentStep === 'N6' && <N6ResultView jobId={jobId} />}
          </>
        )}
      </div>
    </div>
  );
}
