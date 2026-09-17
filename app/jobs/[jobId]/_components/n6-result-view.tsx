'use client';

import { useEffect, useState } from 'react';

import {
  useJobTasksQuery,
  useN6RenderMutation,
  useDeliverablesQuery,
  useValidationQuery,
  useExportMutation,
  useExportDownloadMutation,
  useSaveJobMutation,
} from '@/lib/queries/pixate';
import type { ApiDeliverable, ApiDeliverableComponent, ApiValidationDetail } from '@/lib/api/n6-schema';

// ─────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────────────────────────
// 렌더 진행 상태 (POST /render → GET /tasks polling, taskType=render·
// unitType='job'). deliverables/validation은 이 상태가 'done'이어야 조회한다.
// ─────────────────────────────────────────────────────────────────

function RenderProgress({
  status,
  onRetry,
  retryPending,
}: {
  status: 'pending' | 'running' | 'failed' | 'unknown';
  onRetry: () => void;
  retryPending: boolean;
}) {
  if (status === 'failed') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-red-500" data-testid="n6-render-error">
          최종 이미지 렌더링에 실패했습니다.
        </p>
        <button
          type="button"
          onClick={onRetry}
          disabled={retryPending}
          className="rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {retryPending ? '재시도 중...' : '다시 렌더링'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6" data-testid="n6-render-progress">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500" />
      <p className="text-sm text-gray-500">최종 이미지를 렌더링하고 있습니다...</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 결과 이미지 카드 (deliverable 1개) — GET /jobs/{jobId}/deliverables
// ─────────────────────────────────────────────────────────────────

function DeliverableCard({ deliverable }: { deliverable: ApiDeliverable }) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="relative bg-gray-50">
        {deliverable.imageUrl && !imgFailed ? (
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
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {deliverable.format && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {deliverable.format}
          </span>
        )}
        {deliverable.colorSpace && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            {deliverable.colorSpace}
          </span>
        )}
        {deliverable.fileSize != null && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
            {formatBytes(deliverable.fileSize)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 규격 검증 행 — GET /jobs/{jobId}/validation (deliverable.validationResult와
// 별개 엔드포인트. passed=null은 "미측정"이지 실패가 아니다)
// ─────────────────────────────────────────────────────────────────

function ValidationRow({ item }: { item: ApiValidationDetail }) {
  const passed = item.passed;
  const label = passed == null ? '측정 불가' : passed ? '통과' : '확인 필요';
  const tone =
    passed == null
      ? 'bg-gray-100 text-gray-500'
      : passed
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-red-100 text-red-700';

  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-700">{item.itemKey}</p>
        {item.measuredValue != null && <p className="text-[11px] text-gray-400">{item.measuredValue}</p>}
      </div>
      <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 산출물 구성요소 레이블 맵
// ─────────────────────────────────────────────────────────────────

const ARTIFACT_META: Record<string, { label: string; desc: string }> = {
  images: { label: '번역 이미지', desc: '번역이 적용된 결과 이미지 모음' },
  csv: { label: '콘텐츠 CSV', desc: '번역 전/후 텍스트 대조 파일' },
  html: { label: 'HTML', desc: '웹 페이지용 번역 결과' },
  psd: { label: 'PSD', desc: '레이어 편집용 포토샵 파일' },
};

const DEFAULT_SELECTED_TYPES = new Set(['images', 'csv']);

// ─────────────────────────────────────────────────────────────────
// 다운로드 산출물 섹션 — POST /export → GET /exports/{artifactId}/download.
// 실제 파일을 만들지 않는다 — 응답은 mock presigned URL이다.
// ─────────────────────────────────────────────────────────────────

function ExportSection({ jobId, components }: { jobId: string; components: ApiDeliverableComponent[] }) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(components.filter((c) => c.isActive && DEFAULT_SELECTED_TYPES.has(c.type ?? '')).map((c) => c.type as string)),
  );

  const exportMutation = useExportMutation(jobId);
  const downloadMutation = useExportDownloadMutation(jobId);

  const toggle = (type: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const hasSelection = selected.size > 0;

  const handleExport = () => {
    exportMutation.mutate(
      { components: [...selected] },
      {
        onSuccess: (response) => {
          if (response.artifactId != null) downloadMutation.mutate(response.artifactId);
        },
      },
    );
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-700">다운로드 산출물</h3>
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        {components.map((component) => {
          const type = component.type ?? 'unknown';
          const meta = ARTIFACT_META[type] ?? { label: type, desc: '' };
          const disabled = !component.isActive;
          const checked = selected.has(type);

          return (
            <div
              key={type}
              className={`flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 ${disabled ? 'opacity-40' : ''}`}
            >
              <input
                type="checkbox"
                id={`artifact-${type}`}
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(type)}
                className="h-4 w-4 accent-blue-500"
              />
              <label htmlFor={`artifact-${type}`} className={`flex-1 ${disabled ? '' : 'cursor-pointer'}`}>
                <p className="text-sm font-medium text-gray-800">{meta.label}</p>
                <p className="text-xs text-gray-400">{meta.desc}</p>
              </label>
              {disabled && (
                <span className="shrink-0 rounded-md border border-gray-200 px-3 py-1 text-[11px] text-gray-400">
                  {type === 'psd' ? '12월 제공 예정' : '준비 중'}
                </span>
              )}
            </div>
          );
        })}

        <div className="space-y-2 border-t bg-gray-50 px-4 py-3">
          <button
            type="button"
            data-testid="n6-export-button"
            onClick={handleExport}
            disabled={!hasSelection || exportMutation.isPending}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors ${
              hasSelection
                ? 'bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700'
                : 'cursor-not-allowed bg-gray-200 text-gray-400'
            }`}
          >
            {exportMutation.isPending ? '내보내는 중...' : `선택 항목 내보내기${hasSelection ? ` (${selected.size}개)` : ''}`}
          </button>

          {exportMutation.isError && (
            <p className="text-xs text-red-500" data-testid="n6-export-error">
              내보내기에 실패했습니다. 다시 시도해주세요.
            </p>
          )}

          {downloadMutation.isPending && <p className="text-xs text-gray-400">다운로드 링크 준비 중...</p>}

          {downloadMutation.data && (
            <a
              href={downloadMutation.data.url}
              download={downloadMutation.data.fileName}
              target="_blank"
              rel="noreferrer"
              data-testid="n6-download-link"
              className="flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100"
            >
              {downloadMutation.data.fileName} 다운로드
            </a>
          )}

          {downloadMutation.isError && (
            <p className="text-xs text-red-500" data-testid="n6-download-error">
              다운로드 링크를 가져오지 못했습니다.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────
// N6ResultView — 진입점
//
// happy path: (confirm이 자동 등록한) render task를 tasks polling으로 확인
// → done이면 deliverables/validation 조회 → export 선택·실행 → download URL
// 조회 → save. render task가 없거나(도달 불가 상태) failed일 때만 수동으로
// POST /render를 호출한다 — 있으면 다시 호출하지 않는다.
// ─────────────────────────────────────────────────────────────────

export function N6ResultView({ jobId }: { jobId: string }) {
  const tasksQuery = useJobTasksQuery(jobId, { polling: true });
  const renderMutation = useN6RenderMutation(jobId);
  const saveMutation = useSaveJobMutation(jobId);

  const renderItem = tasksQuery.data?.items?.find(
    (item) => item.taskType === 'render' && item.unitType !== 'text_block',
  );
  const renderFailed = renderItem?.status === 'failed';
  const renderDone = renderItem?.status === 'done';

  useEffect(() => {
    if (!tasksQuery.data) return; // 첫 응답 대기 중
    if (renderItem && !renderFailed) return; // 이미 진행 중이거나 완료 — 재호출하지 않는다
    if (renderMutation.isPending || renderMutation.isSuccess) return; // 중복 트리거 방지
    renderMutation.mutate();
  }, [tasksQuery.data, renderItem, renderFailed, renderMutation]);

  const deliverablesQuery = useDeliverablesQuery(jobId, { enabled: renderDone });
  const validationQuery = useValidationQuery(jobId, { enabled: renderDone });

  if (tasksQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-gray-400">작업 상태를 확인하고 있습니다.</span>
      </div>
    );
  }

  if (tasksQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-red-500">
          {tasksQuery.error instanceof Error ? tasksQuery.error.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  }

  if (!renderDone) {
    return (
      <RenderProgress
        status={renderFailed ? 'failed' : 'running'}
        onRetry={() => renderMutation.mutate()}
        retryPending={renderMutation.isPending}
      />
    );
  }

  if (deliverablesQuery.isLoading || validationQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-gray-400">결과를 불러오는 중...</span>
      </div>
    );
  }

  if (deliverablesQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-red-500">
          {deliverablesQuery.error instanceof Error ? deliverablesQuery.error.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  }

  const deliverables = deliverablesQuery.data?.deliverables ?? [];
  const components = deliverablesQuery.data?.components ?? [];
  const validationItems = validationQuery.data ?? [];
  const hasValidationIssue = validationItems.some((item) => item.passed === false);

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
          {hasValidationIssue && (
            <p className="mt-2 text-xs text-red-500">일부 규격 검증이 실패했습니다. 아래 내용을 확인하세요.</p>
          )}
        </div>

        {/* ── 결과 이미지 ─────────────────────────────── */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-gray-700">결과 이미지</h3>
          <div className="space-y-4">
            {deliverables.map((dlv) => (
              <DeliverableCard key={dlv.id} deliverable={dlv} />
            ))}
          </div>
        </section>

        {/* ── 규격 검증 결과 ───────────────────────────── */}
        {validationItems.length > 0 && (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-700">규격 검증</h3>
            <div className="divide-y divide-gray-100 rounded-xl border bg-white px-4 shadow-sm">
              {validationItems.map((item) => (
                <ValidationRow key={item.itemKey} item={item} />
              ))}
            </div>
          </section>
        )}

        {/* ── 다운로드 산출물 ──────────────────────────── */}
        <ExportSection jobId={jobId} components={components} />

        {/* ── 보관함 저장 ──────────────────────────────── */}
        <section className="rounded-xl border bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-800">보관함 저장</p>
              <p className="text-xs text-gray-500">
                {saveMutation.isSuccess ? '이 작업이 보관함에 저장되었습니다.' : '검토가 끝나면 보관함에 저장하세요.'}
              </p>
            </div>
            {saveMutation.isSuccess ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                보관함에 저장됨
              </span>
            ) : (
              <button
                type="button"
                data-testid="n6-save-button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="rounded-lg bg-blue-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveMutation.isPending ? '저장 중...' : '보관함에 저장'}
              </button>
            )}
          </div>
          {saveMutation.isError && (
            <p className="mt-2 text-xs text-red-500" data-testid="n6-save-error">
              저장에 실패했습니다. 다시 시도해주세요.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
