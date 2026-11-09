'use client';

import { getSignalTone } from '@/lib/n5/adapter';
import type { SectionStatusViewModel, SignalBadge, SignalTone } from '@/lib/n5/adapter';

// ─────────────────────────────────────────────────────────────────
// N5 오류 표시 공용 조각(Figma 388:3814). 상태 정의는 lib/n5/adapter.ts가 맡고 여기는 그리기만 한다.
// - SignalRows: block 번호 아래 [라벨] 사유 행(1244:8031)
// - PanelSectionStatus / CanvasSectionStatus: Section 태그 아래 상태(1244:8444)
// - RetryButton: 다시 시도 버튼. 디자인만 있고 호출은 없다(아래 주석)
// block signal과 section 상태는 위치와 데이터가 달라 섞지 않는다.
// ─────────────────────────────────────────────────────────────────

const TONE_TAG_CLASS: Record<SignalTone, string> = {
  warning: 'bg-[#fff0eb] text-[#ff6a38]',
  neutral: 'bg-[#f5f5f5] text-[#171717]',
};

const TONE_REASON_CLASS: Record<SignalTone, string> = {
  warning: 'text-[#ff6a38]',
  neutral: 'text-[#707070]',
};

/** Figma Tag/Status — h26, radius 6, 글자 12/14. fixedWidth는 패널의 라벨 칸 정렬용 최소 폭 70 */
function StatusTag({ tone, fixedWidth = false, children }: { tone: SignalTone; fixedWidth?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`flex h-[26px] shrink-0 items-center justify-center rounded-[6px] px-2 text-[12px] leading-[14px] whitespace-nowrap ${
        fixedWidth ? 'min-w-[70px]' : ''
      } ${TONE_TAG_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/** Figma Badge — h24, 6px 점 + 12px 글자 */
function VerdictBadge({ label }: { label: string }) {
  return (
    <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] border border-[#ff6a38] bg-[#fff0eb] px-2 text-[12px] leading-[normal] tracking-[-0.02em] whitespace-nowrap text-[#ff6a38]">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-[#ff6a38]" />
      {label}
    </span>
  );
}

/**
 * 다시 시도 버튼(Figma Button h24). API-JOB-06(/tasks/{taskId}/retry)의 공개 계약은 x-screen이 N2·N4라 N5에서 호출할 수
 * 있다고 단정할 수 없다 — BE 계약이 확인될 때까지 비활성으로 두고 요청을 보내지 않는다.
 */
export function RetryButton({ label, testId }: { label: string; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled
      title="아직 다시 시도할 수 없습니다."
      className="flex h-6 shrink-0 cursor-not-allowed items-center justify-center rounded-[4px] border border-[#eaeaea] bg-white px-3 text-[12px] leading-[normal] tracking-[-0.02em] whitespace-nowrap text-[#999]"
    >
      {label}
    </button>
  );
}

export function SignalRows({ badges, testIdPrefix }: { badges: SignalBadge[]; testIdPrefix: string }) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {badges.map((badge, i) => {
        const tone = getSignalTone(badge.code);
        return (
          <div key={`${badge.code}-${i}`} data-testid={`${testIdPrefix}-${badge.code}`} className="flex items-start gap-2">
            <StatusTag tone={tone} fixedWidth>{badge.label}</StatusTag>
            {badge.reason && (
              <p className={`min-w-0 flex-1 py-1.5 text-[12px] leading-[normal] font-light break-words ${TONE_REASON_CLASS[tone]}`}>
                {badge.reason}
                {badge.basisArticle ? ` (${badge.basisArticle})` : ''}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const STAGE_LABELS = { render: '렌더링', inpaint: '인페인팅' } as const;

function PreviewNotice({ status, testIdPrefix }: { status: SectionStatusViewModel; testIdPrefix: string }) {
  if (!status.previewNotice) return null;
  return (
    <div data-testid={`${testIdPrefix}-notice`} data-input-error-code={status.previewInputErrorCode ?? undefined} className="flex">
      <StatusTag tone="neutral">{status.previewNotice}</StatusTag>
    </div>
  );
}

/**
 * Section 상태 행(Figma 1244:8444 Frame 626·627) — 실패 / 되살림·판정 배지 / 품질. 좌측 canvas(650)와 우측 패널(433)이 같이
 * 쓴다. 좌측은 gap 8에 한 줄(이미지 위 공간이 행 수로 정해진다)이고 태그가 내용 폭이다. 우측은 gap 4로 줄을 바꾸고 실패 태그가
 * 라벨 칸(70)이다.
 */
function SectionStatusRows({
  status,
  variant,
  testIdPrefix,
}: {
  status: SectionStatusViewModel;
  variant: 'canvas' | 'panel';
  testIdPrefix: string;
}) {
  const hasTagRow = status.restoredInN3 || status.verdictLabels.length > 0;
  return (
    <>
      {status.failedStages.length > 0 && (
        <div data-testid={`${testIdPrefix}-failed`} className="flex h-[26px] items-center gap-2">
          <StatusTag tone="warning" fixedWidth={variant === 'panel'}>
            실행 실패
          </StatusTag>
          {status.failedStages.map((stage) => (
            <span key={stage} className="text-[12px] leading-[normal] font-light tracking-[-0.04em] whitespace-nowrap text-[#ff6a38]">
              {STAGE_LABELS[stage]}
            </span>
          ))}
          {/* 인페인팅은 재시도 계약이 없어 버튼을 내지 않는다 */}
          {status.failedStages.includes('render') && <RetryButton label="렌더링 다시 시도" testId={`${testIdPrefix}-render-retry`} />}
        </div>
      )}
      {hasTagRow && (
        <div data-testid={`${testIdPrefix}-tags`} className={`flex items-center ${variant === 'canvas' ? 'gap-2' : 'flex-wrap gap-1'}`}>
          {status.restoredInN3 && <StatusTag tone="neutral">N3에서 되살린 섹션</StatusTag>}
          {status.verdictLabels.map((label) => (
            <VerdictBadge key={label} label={label} />
          ))}
        </div>
      )}
      {status.warningLabel && (
        <div className="flex">
          <StatusTag tone="neutral">{status.warningLabel}</StatusTag>
        </div>
      )}
      {/* 미리보기 안내(최신 아님·없음·입력 오류·다시 불러오는 중) — 기존 중립 태그 행을 그대로 쓴다(Figma 에 이 문구 표본은 없다).
          입력 오류 원래 코드는 화면 문구가 아니라 data 속성으로만 남긴다. canvas 는 이 행 대신 N5PreviewStatusSlot 에 보인다 */}
      {variant === 'panel' && <PreviewNotice status={status} testIdPrefix={testIdPrefix} />}
    </>
  );
}

/** 우측 패널 — Section 태그 아래(16), block 목록 시작 전(28). 행 간격 4 */
export function PanelSectionStatus({ sectionOrder, status }: { sectionOrder: number; status: SectionStatusViewModel }) {
  const prefix = `n5-section-status-${sectionOrder}`;
  return (
    <div data-testid={prefix} className="flex w-full flex-col gap-1">
      {status.progressLabel && (
        <div data-testid={`${prefix}-progress`} className="flex">
          <StatusTag tone="neutral">{status.progressLabel}</StatusTag>
        </div>
      )}
      <SectionStatusRows status={status} variant="panel" testIdPrefix={prefix} />
      <SignalRows badges={status.signals} testIdPrefix={`${prefix}-signal`} />
    </div>
  );
}

/** 좌측 canvas — Section 태그 아래(16), 이미지 위(4). 폭 650. 호출부가 이미지 위 공간을 실제로 비운다 */
export function CanvasSectionStatus({ status }: { status: SectionStatusViewModel }) {
  return (
    <div data-testid="n5-canvas-section-status" className="flex w-[650px] flex-col gap-1">
      <SectionStatusRows status={status} variant="canvas" testIdPrefix="n5-canvas-section-status" />
    </div>
  );
}

/**
 * 좌측 canvas section 의 미리보기 상태 자리 — section 위에 absolute 로 얹어 문서 흐름 높이를 바꾸지 않는다.
 * 상태가 생기고 사라져도 viewer·section·block 위치가 그대로다. 비어 있어도 항상 둔다(자리 고정).
 * 지금은 기존 임시 안내(previewNotice)를 기존 중립 태그로 보인다 — 자리 맞춤·넘침 판정 상태 디자인이 오면 이 안쪽만 바꾼다.
 * 클릭은 아래 block·section 으로 그대로 넘긴다. block 번호 핀(block 왼쪽 위)·제외하기(오른쪽 위)를 가리지 않게 왼쪽 아래에 둔다(임시 위치).
 */
export function N5PreviewStatusSlot({ sectionId, status }: { sectionId: number; status: SectionStatusViewModel | undefined }) {
  return (
    <div
      data-testid={`n5-preview-status-slot-${sectionId}`}
      className="pointer-events-none absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-16px)] flex-col items-start gap-1"
    >
      {status && <PreviewNotice status={status} testIdPrefix="n5-canvas-section-status" />}
    </div>
  );
}
