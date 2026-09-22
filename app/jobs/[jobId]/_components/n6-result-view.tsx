'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  useJobTasksQuery,
  useN6RenderMutation,
  useDeliverablesQuery,
  useValidationQuery,
  useExportMutation,
  useExportDownloadMutation,
  useExportDownloadByTypeMutation,
  useSaveJobMutation,
} from '@/lib/queries/pixlate';
import type { ApiDeliverable, ApiDeliverableComponent, ApiExportArtifactType } from '@/lib/api/n6-schema';
import { StepNav } from './step-nav';
import { ZoomControls } from './n5/n5-toolbar';

// ─────────────────────────────────────────────────────────────────
// N6 — 저장 및 내보내기 (Figma node 643:5523 "N6 저장" 기준)
//
// 8단계(Figma 최종 UI 반영): 2단계에서 연결한 render→tasks→deliverables→
// validation→export→download→save 데이터 흐름은 그대로 두고, 화면만
// Figma에 맞춘다. StepNav/"보관함으로 나가기"/제목·설명은 N1·N5와 같은
// 기존 패턴을 그대로 재사용한다(app/jobs/[jobId]/_components/step-nav.tsx,
// n5-view.tsx). 줌 컨트롤은 N5Viewport 전체(2D pan/드래그, 블록 오버레이)가
// 아니라 그 중 좌표 무관 부분(n5-toolbar.tsx의 ZoomControls)만 재사용한다 —
// N6 deliverables 응답(id/imageUrl/format/colorSpace/fileSize)에는 N5
// preview처럼 section별 width/height/scale이 없어(원본 좌표 데이터 자체가
// 없다), block bbox 오버레이나 pan 같은 좌표 기반 기능은 애초에 적용할 데이터가
// 없다 — 그래서 순수 확대/축소 배율만 이 화면 자체가 소유한다.
//
// validation(GET /jobs/{jobId}/validation) 조회는 계약대로 유지하지만,
// Figma에 별도 검증 상세 카드가 없어 그 결과를 화면에 렌더하지 않는다 —
// deliverables/render 완료 여부만 이 화면의 "완료" 판단에 쓴다.
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// 렌더 진행 상태 — POST /render(자동 등록·수동 재렌더 공용) → GET /tasks
// polling(taskType=render·unitType='job'). deliverables/validation은 이
// 상태가 done이어야 조회한다.
// ─────────────────────────────────────────────────────────────────

function RenderProgress({
  status,
  onRetry,
  retryPending,
}: {
  status: 'running' | 'failed';
  onRetry: () => void;
  retryPending: boolean;
}) {
  if (status === 'failed') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[14px] text-red-500" data-testid="n6-render-error">
          최종 이미지 렌더링에 실패했습니다.
        </p>
        <button
          type="button"
          onClick={onRetry}
          disabled={retryPending}
          className="rounded-[6px] bg-[#171717] px-8 py-3.5 text-[14px] font-medium tracking-[-0.03em] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {retryPending ? '재시도 중...' : '다시 렌더링'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6" data-testid="n6-render-progress">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#eaeaea] border-t-[#ff6a38]" />
      <p className="text-[14px] text-[#707070]">최종 이미지를 렌더링하고 있습니다...</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 완료 배너 — Figma node 665:4062 "N6 / Completion Banner". Orange Glow와
// pix/ate 마크(3개 layer)는 실제 Figma 자산을 받아 public/mock/n6/에 커밋해
// 두고 그대로 쓴다(직접 그린 대체 svg 아님).
// ─────────────────────────────────────────────────────────────────

function PixMark() {
  return (
    <div className="relative size-[66px] overflow-hidden" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mock/n6/pix-mark-top-left.svg" alt="" className="absolute inset-[0_53.55%_53.55%_0] block size-full" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mock/n6/pix-mark-bottom-right.svg"
        alt=""
        className="absolute inset-[53.55%_0_0_53.55%] block size-full"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mock/n6/pix-mark-main.svg"
        alt=""
        className="absolute inset-[10.71%_10.71%_10.71%_14.28%] block size-full"
      />
    </div>
  );
}

function CompletionBanner() {
  return (
    <div className="relative h-[150px] w-full shrink-0 overflow-hidden rounded-[8px] bg-[#171717]">
      <div className="absolute left-[310px] top-[-38px] size-[170px]">
        <div className="absolute inset-[-21.18%]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mock/n6/orange-glow.svg" alt="" className="block size-full max-w-none" />
        </div>
      </div>
      <div className="absolute left-6 top-5 flex w-[300px] flex-col gap-6">
        <p className="text-[12px] font-light tracking-[-0.04em] text-[#b8b8b8]">READY TO EXPORT</p>
        <p className="text-[20px] font-semibold tracking-[-0.02em] text-white">번역이 완료되었습니다.</p>
        <div className="text-[12px] font-light leading-normal tracking-[-0.04em] text-[#b8b8b8]">
          <p>최종 결과물을 원하는 형식으로 내려받거나</p>
          <p>보관함에 저장할 수 있습니다.</p>
        </div>
      </div>
      <div className="absolute right-5 top-5">
        <PixMark />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 중앙 Final Preview — Figma node 643:5526 "N6 / Final Preview".
// deliverables의 최종 이미지를 sourceImageId 순서 그대로 세로로 이어붙여
// 보여준다. N6 deliverables 응답에는 section별 width/height/scale이 없어
// N5Viewport의 좌표 변환·오버레이는 재사용할 데이터가 없고, 대신 N5Viewport와
// 같은 컨테이너 톤(rounded-[8px] bg-[#f5f5f5], 우상단 오버레이 컨트롤,
// 얇은 스크롤바)과 ZoomControls(n5-toolbar.tsx)를 그대로 재사용한다.
// ─────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function PreviewImage({ deliverable }: { deliverable: ApiDeliverable }) {
  const [failed, setFailed] = useState(false);

  if (!deliverable.imageUrl || failed) {
    return (
      <div className="flex h-48 w-full flex-col items-center justify-center gap-2 border-b border-[#eaeaea] bg-[#f5f5f5] text-[12px] text-[#999] last:border-b-0">
        이미지를 불러올 수 없습니다
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={deliverable.imageUrl}
      alt="번역 결과 이미지"
      className="block w-full border-b border-[#eaeaea] last:border-b-0"
      onError={() => setFailed(true)}
    />
  );
}

function FinalPreview({ deliverables }: { deliverables: ApiDeliverable[] }) {
  const [zoom, setZoom] = useState(1);
  const hasContent = deliverables.length > 0;

  return (
    <div
      data-testid="n6-final-preview"
      className="relative min-w-0 flex-1 overflow-hidden rounded-[8px] bg-[#f5f5f5]"
    >
      {hasContent && (
        <div className="absolute right-5 top-5 z-10">
          <ZoomControls
            zoom={zoom}
            onZoomIn={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            onZoomOut={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            onSetZoom={(next) => setZoom(clampZoom(next))}
          />
        </div>
      )}

      <div className="h-full overflow-y-auto p-6 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded-[2px] [&::-webkit-scrollbar-thumb]:bg-[#999] [&::-webkit-scrollbar-track]:bg-transparent">
        {!hasContent ? (
          <div className="flex h-full items-center justify-center text-[14px] text-[#999]">
            표시할 결과 이미지가 없습니다.
          </div>
        ) : (
          <div
            data-testid="n6-preview-canvas"
            className="mx-auto flex w-[792px] flex-col items-start border border-[#eaeaea] bg-white"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
          >
            {deliverables.map((dlv, i) => (
              <PreviewImage key={dlv.id ?? i} deliverable={dlv} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 우측 산출물 내보내기 패널 — Figma node 667:7646/667:7644/667:7645.
// ─────────────────────────────────────────────────────────────────

const ARTIFACT_LABEL: Record<string, string> = {
  images: 'images/',
  csv: 'content.csv',
  html: 'HTML',
  psd: 'PSD',
};

const ARTIFACT_DESC: Record<string, string> = {
  images: '번역이 적용된 최종 이미지 묶음',
  csv: '원문 · 번역문 · 판정 정보를 포함한 CSV',
  html: '편집 가능한 HTML 결과물',
  psd: '레이어 편집이 가능한 PSD 산출물',
};

const DEFAULT_SELECTED_TYPES = new Set(['images', 'csv']);

/** Figma Checkbox(28:77) — checked(white+orange border)/unchecked(white+gray border)/disabled(gray fill) 3종. */
function ArtifactCheckbox({
  id,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <span className="relative flex size-[18px] shrink-0 items-center justify-center">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="peer absolute inset-0 size-[18px] cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        className={`pointer-events-none flex size-[18px] items-center justify-center rounded-[4px] border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#ff6a38] ${
          disabled ? 'border-[#eaeaea] bg-[#f5f5f5]' : checked ? 'border-[#ff6a38] bg-white' : 'border-[#eaeaea] bg-white'
        }`}
      >
        {checked && !disabled && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
            <path d="M1 4.2 3.5 6.7 9 1.2" stroke="#ff6a38" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </span>
  );
}

/**
 * 행별 개별 다운로드 — GET /jobs/{jobId}/export/download?artifactType=(images|csv|html).
 * POST /export(묶음 선택)와 별개 흐름이라, 행마다 독립된 mutation을 갖는다.
 * PSD는 이 컨트롤 자체를 렌더하지 않는다(항상 disabled, 호출 자체가 없다).
 */
function ArtifactRow({
  jobId,
  component,
  checked,
  onToggle,
}: {
  jobId: string;
  component: ApiDeliverableComponent;
  checked: boolean;
  onToggle: () => void;
}) {
  const type = component.type ?? 'unknown';
  const isPsd = type === 'psd';
  const disabled = isPsd || !component.isActive;
  const label = ARTIFACT_LABEL[type] ?? type;
  const desc = ARTIFACT_DESC[type] ?? '';

  const downloadMutation = useExportDownloadByTypeMutation(jobId);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex w-full items-center gap-4">
        <ArtifactCheckbox id={`artifact-${type}`} checked={checked} disabled={disabled} onChange={onToggle} />
        <div className="flex items-center gap-2">
          <label htmlFor={`artifact-${type}`} className="flex w-[310px] flex-col gap-2">
            <span className={`text-[14px] tracking-[-0.01em] ${disabled ? 'text-[#999]' : 'text-[#171717]'}`}>{label}</span>
            <span className={`text-[12px] font-light tracking-[-0.04em] ${disabled ? 'text-[#b8b8b8]' : 'text-[#707070]'}`}>
              {desc}
            </span>
          </label>

          {isPsd ? (
            <span className="w-[94px] shrink-0 text-[12px] font-light tracking-[-0.04em] text-[#999]">12월 제공 예정</span>
          ) : downloadMutation.data ? (
            <a
              href={downloadMutation.data.url}
              download={downloadMutation.data.fileName}
              target="_blank"
              rel="noreferrer"
              data-testid={`n6-download-row-${type}`}
              className="w-[97px] shrink-0 rounded-[4px] bg-white px-2.5 py-[5px] text-center text-[12px] text-[#ff6a38] hover:underline"
            >
              다운로드
            </a>
          ) : (
            <button
              type="button"
              data-testid={`n6-download-row-${type}`}
              onClick={() => downloadMutation.mutate(type as ApiExportArtifactType)}
              disabled={disabled || downloadMutation.isPending}
              className="w-[97px] shrink-0 rounded-[4px] bg-white px-2.5 py-[5px] text-[12px] text-[#171717] hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:text-[#b8b8b8]"
            >
              {downloadMutation.isPending ? '준비 중...' : '개별 다운로드'}
            </button>
          )}
        </div>
      </div>

      {downloadMutation.isError && (
        <p className="text-[11px] text-red-500" data-testid={`n6-download-row-error-${type}`}>
          다운로드 링크를 가져오지 못했습니다.
        </p>
      )}

      <div className="h-px w-full bg-[#eaeaea]" />
    </div>
  );
}

function ExportPanel({ jobId, components }: { jobId: string; components: ApiDeliverableComponent[] }) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(components.filter((c) => c.isActive && DEFAULT_SELECTED_TYPES.has(c.type ?? '')).map((c) => c.type as string)),
  );

  const exportMutation = useExportMutation(jobId);
  const downloadMutation = useExportDownloadMutation(jobId);
  const saveMutation = useSaveJobMutation(jobId);

  const toggle = (type: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const hasSelection = selected.size > 0;
  const selectedLabels = [...selected].map((type) => ARTIFACT_LABEL[type] ?? type);

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
    <div data-testid="n6-export-panel" className="flex h-full w-[456px] shrink-0 flex-col gap-8 overflow-y-auto pr-1">
      <CompletionBanner />

      <div className="flex w-full flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">산출물 내보내기</p>
          <p className="text-[12px] font-light tracking-[-0.04em] text-[#707070]">
            필요한 항목을 선택해 개별로 받거나 한 번에 내려받을 수 있습니다.
          </p>
        </div>

        <div className="flex w-full flex-col gap-7">
          <div className="h-px w-full bg-[#eaeaea]" />
          {components.map((component) => (
            <ArtifactRow
              key={component.type ?? 'unknown'}
              jobId={jobId}
              component={component}
              checked={selected.has(component.type ?? '')}
              onToggle={() => toggle(component.type ?? '')}
            />
          ))}
        </div>
      </div>

      <div className="flex w-full flex-col gap-1">
        <div className="flex w-full flex-col gap-2 rounded-[4px] bg-[#f5f5f5] p-5">
          <p className="text-[14px] font-medium tracking-[-0.03em] text-[#171717]">선택된 산출물 {selected.size}개</p>
          <p className="text-[12px] font-light tracking-[-0.04em] text-[#707070]">
            {hasSelection ? `${selectedLabels.join(' + ')} · export.zip으로 묶어 다운로드합니다.` : '내보낼 항목을 선택해 주세요.'}
          </p>
        </div>
        <p className="text-[12px] tracking-[-0.02em] text-[#707070]">
          일부 산출물 생성에 실패해도 성공한 항목은 내려받을 수 있습니다.
        </p>
      </div>

      <div className="flex w-full flex-col gap-2">
        <button
          type="button"
          data-testid="n6-export-button"
          onClick={handleExport}
          disabled={!hasSelection || exportMutation.isPending}
          className="w-full rounded-[6px] bg-[#171717] px-8 py-3.5 text-[14px] font-medium tracking-[-0.03em] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {exportMutation.isPending ? '내보내는 중...' : '선택 항목 내보내기'}
        </button>

        {exportMutation.isError && (
          <p className="text-[12px] text-red-500" data-testid="n6-export-error">
            내보내기에 실패했습니다. 다시 시도해주세요.
          </p>
        )}
        {downloadMutation.isPending && <p className="text-[12px] text-[#999]">다운로드 링크 준비 중...</p>}
        {downloadMutation.data && (
          <a
            href={downloadMutation.data.url}
            download={downloadMutation.data.fileName}
            target="_blank"
            rel="noreferrer"
            data-testid="n6-download-link"
            className="w-full rounded-[6px] border border-[#eaeaea] bg-white px-8 py-3 text-center text-[14px] font-medium tracking-[-0.03em] text-[#ff6a38] hover:bg-[#faf3ed]"
          >
            {downloadMutation.data.fileName} 다운로드
          </a>
        )}
        {downloadMutation.isError && (
          <p className="text-[12px] text-red-500" data-testid="n6-download-error">
            다운로드 링크를 가져오지 못했습니다.
          </p>
        )}

        {saveMutation.isSuccess ? (
          <span
            data-testid="n6-save-done"
            className="flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-[#eaeaea] bg-white px-8 py-3.5 text-[14px] font-medium tracking-[-0.03em] text-[#04421f]"
          >
            보관함에 저장됨
          </span>
        ) : (
          <button
            type="button"
            data-testid="n6-save-button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full rounded-[6px] border border-[#eaeaea] bg-white px-8 py-3.5 text-[14px] font-medium tracking-[-0.03em] text-[#171717] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveMutation.isPending ? '저장하는 중…' : '보관함에 저장'}
          </button>
        )}
        {saveMutation.isError && (
          <p className="text-[12px] text-red-500" data-testid="n6-save-error">
            저장에 실패했습니다. 다시 시도해주세요.
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// N6ResultView — 진입점 (Figma node 643:5523 "N6 저장")
//
// happy path: (confirm이 자동 등록한) render task를 tasks polling으로 확인
// → done이면 deliverables/validation 조회 → export 선택·실행 → download URL
// 조회 → save. render task가 없거나(도달 불가 상태) failed일 때만 수동으로
// POST /render를 호출한다 — 있으면 다시 호출하지 않는다.
// ─────────────────────────────────────────────────────────────────

export function N6ResultView({ jobId }: { jobId: string }) {
  const tasksQuery = useJobTasksQuery(jobId, { polling: true });
  const renderMutation = useN6RenderMutation(jobId);

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

  // render가 끝나야만 의미 있는 조회다(렌더 전 deliverables는 항상 빈 목록) —
  // validation은 계약대로 계속 불러오지만(아래 body 참고), 화면에는 쓰지 않는다.
  const deliverablesQuery = useDeliverablesQuery(jobId, { enabled: renderDone });
  const validationQuery = useValidationQuery(jobId, { enabled: renderDone });

  let body: React.ReactNode;

  if (tasksQuery.isLoading) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-[14px] text-[#999]">작업 상태를 확인하고 있습니다.</span>
      </div>
    );
  } else if (tasksQuery.isError) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[14px] text-red-500">
          {tasksQuery.error instanceof Error ? tasksQuery.error.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  } else if (!renderDone) {
    body = (
      <RenderProgress
        status={renderFailed ? 'failed' : 'running'}
        onRetry={() => renderMutation.mutate()}
        retryPending={renderMutation.isPending}
      />
    );
  } else if (deliverablesQuery.isLoading || validationQuery.isLoading) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-[14px] text-[#999]">결과를 불러오는 중...</span>
      </div>
    );
  } else if (deliverablesQuery.isError) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[14px] text-red-500">
          {deliverablesQuery.error instanceof Error ? deliverablesQuery.error.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  } else {
    const deliverables = deliverablesQuery.data?.deliverables ?? [];
    const components = deliverablesQuery.data?.components ?? [];

    body = (
      <div className="flex min-h-0 flex-1 gap-6 px-8 pb-8">
        <FinalPreview deliverables={deliverables} />
        <ExportPanel jobId={jobId} components={components} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-white">
      <StepNav currentStep="N6" />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 헤더 — Figma(643:5523, node 849:7259 "보관함으로 나가기")는 N1·N5와
            동일한 닫기(X) 아이콘 + 제목/설명 조합이다. */}
        <div className="shrink-0 px-8 pt-8 pb-4">
          <Link
            href="/"
            className="mb-6 flex size-10 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
            aria-label="보관함으로 나가기"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </Link>

          <div className="flex items-center gap-4">
            <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[#171717]">저장 및 내보내기</h1>
            <p className="text-[14px] tracking-[-0.01em] text-[#707070]">
              최종 결과물을 확인하고 내려받거나 보관함에 저장합니다.
            </p>
          </div>
        </div>

        {body}
      </div>
    </div>
  );
}
