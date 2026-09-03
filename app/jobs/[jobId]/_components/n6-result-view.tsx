'use client';

import { useState } from 'react';

import { useJobResultQuery, useSaveJobMutation } from '@/lib/queries/pixate';
import type { Deliverable, ExportArtifact, ValidationItem } from '@/lib/api/types';

// ─────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────────────────────────
// 검증 항목 행
// ─────────────────────────────────────────────────────────────────

function ValidationRow({ item }: { item: ValidationItem }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-700">{item.name}</p>
        <p className="text-[11px] text-gray-400">{item.actualValue}</p>
        {!item.passed && item.violationReason && (
          <p className="mt-0.5 text-[11px] text-red-500">{item.violationReason}</p>
        )}
      </div>
      <span
        className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
          item.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
        }`}
      >
        {item.passed ? '통과' : '확인 필요'}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 결과 이미지 카드 (deliverable 1개)
// ─────────────────────────────────────────────────────────────────

function DeliverableCard({ deliverable }: { deliverable: Deliverable }) {
  const [imgFailed, setImgFailed] = useState(false);
  const allPassed = deliverable.validationResult.passed;

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      {/* 결과 이미지 */}
      <div className="relative bg-gray-50">
        {!imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={deliverable.imageUrl}
            alt="번역 결과 이미지"
            className="w-full"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-48 flex-col items-center justify-center gap-2 bg-gray-100">
            <div className="h-12 w-12 rounded-lg bg-gray-200" />
            <p className="text-xs text-gray-400">이미지를 불러올 수 없습니다</p>
          </div>
        )}

        <span
          className={`absolute right-3 top-3 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm ${
            allPassed ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {allPassed ? '검증 통과' : '검증 실패'}
        </span>
      </div>

      {/* 파일 정보 + 검증 결과 */}
      <div className="p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {deliverable.format}
          </span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {deliverable.colorSpace}
          </span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
            {formatBytes(deliverable.fileSizeBytes)}
          </span>
        </div>
        <div className="divide-y divide-gray-100">
          {deliverable.validationResult.items.map((item) => (
            <ValidationRow key={item.ruleId} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 산출물 구성요소 레이블 맵
// ─────────────────────────────────────────────────────────────────

const ARTIFACT_META: Record<string, { label: string; desc: string; defaultChecked: boolean }> = {
  images: { label: '번역 이미지', desc: '번역이 적용된 결과 이미지 모음', defaultChecked: true },
  content_csv: { label: '콘텐츠 CSV', desc: '번역 전/후 텍스트 대조 파일', defaultChecked: true },
  html: { label: 'HTML', desc: '웹 페이지용 번역 결과', defaultChecked: false },
};

// ─────────────────────────────────────────────────────────────────
// 다운로드 산출물 섹션
// ─────────────────────────────────────────────────────────────────

function ExportSection({
  artifacts,
  exportZipUrl,
}: {
  artifacts: ExportArtifact[];
  exportZipUrl: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(artifacts.filter((a) => ARTIFACT_META[a.type]?.defaultChecked).map((a) => a.type)),
  );

  const toggleArtifact = (type: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const hasSelection = selected.size > 0;

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-700">다운로드 산출물</h3>
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">

        {/* 실제 구성요소 행 */}
        {artifacts.map((artifact) => {
          const meta = ARTIFACT_META[artifact.type] ?? { label: artifact.type, desc: '', defaultChecked: false };
          const isChecked = selected.has(artifact.type);

          return (
            <div
              key={artifact.type}
              className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0"
            >
              <input
                type="checkbox"
                id={`artifact-${artifact.type}`}
                checked={isChecked}
                onChange={() => toggleArtifact(artifact.type)}
                className="h-4 w-4 accent-blue-500"
              />
              <label htmlFor={`artifact-${artifact.type}`} className="flex-1 cursor-pointer">
                <p className="text-sm font-medium text-gray-800">{meta.label}</p>
                <p className="text-xs text-gray-400">
                  {meta.desc}
                  {artifact.fileCount !== undefined && ` · ${artifact.fileCount}개 파일`}
                </p>
              </label>
              {/* 개별 다운로드 */}
              <a
                href={artifact.downloadUrl}
                download
                className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-3 py-1 text-[11px] font-medium text-gray-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
              >
                개별 다운로드
              </a>
            </div>
          );
        })}

        {/* PSD — 비활성 (배열에 없음, UI에서만 표시) */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 opacity-35">
          <input type="checkbox" disabled className="h-4 w-4" />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-500">PSD</p>
            <p className="text-xs text-gray-400">레이어 편집용 포토샵 파일</p>
          </div>
          <span className="shrink-0 rounded-md border border-gray-200 px-3 py-1 text-[11px] text-gray-400">
            준비 중
          </span>
        </div>

        {/* ZIP 다운로드 버튼 */}
        <div className="border-t bg-gray-50 px-4 py-3">
          <a
            href={hasSelection ? exportZipUrl : undefined}
            download={hasSelection}
            aria-disabled={!hasSelection}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors ${
              hasSelection
                ? 'bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700'
                : 'cursor-not-allowed bg-gray-200 text-gray-400'
            }`}
            onClick={(e) => { if (!hasSelection) e.preventDefault(); }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            선택 항목 export.zip 다운로드
            {hasSelection && <span className="text-blue-200">({selected.size}개)</span>}
          </a>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// N6ResultView — 진입점
// ─────────────────────────────────────────────────────────────────

export function N6ResultView({ jobId }: { jobId: string }) {
  const { data, isLoading, isError, error } = useJobResultQuery(jobId);
  const saveMutation = useSaveJobMutation(jobId);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-gray-400">결과를 불러오는 중...</span>
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

  const allDeliverablesPassed = data.deliverables.every((d) => d.validationResult.passed);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 px-6 py-8">

        {/* ── 완료 헤더 ───────────────────────────────── */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900">번역이 완료됐습니다</h2>
          <p className="mt-1 text-sm text-gray-500">결과를 확인하고 보관함에 저장하세요.</p>
          {!allDeliverablesPassed && (
            <p className="mt-2 text-xs text-red-500">
              일부 이미지의 검증이 실패했습니다. 아래 내용을 확인하세요.
            </p>
          )}
        </div>

        {/* ── 결과 이미지 ─────────────────────────────── */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-gray-700">결과 이미지</h3>
          <div className="space-y-4">
            {data.deliverables.map((dlv) => (
              <DeliverableCard key={dlv.deliverableId} deliverable={dlv} />
            ))}
          </div>
        </section>

        {/* ── 다운로드 산출물 ──────────────────────────── */}
        <ExportSection artifacts={data.exportArtifacts} exportZipUrl={data.exportZipUrl} />

        {/* ── 보관함 저장 ──────────────────────────────── */}
        <section className="rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-800">보관함 저장</p>
              <p className="text-xs text-gray-500">
                {data.saved ? '이 작업이 보관함에 저장되었습니다.' : '검토가 끝나면 보관함에 저장하세요.'}
              </p>
            </div>
            {data.saved ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                보관함에 저장됨
              </span>
            ) : (
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveMutation.isPending ? '저장 중...' : '보관함에 저장'}
              </button>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
