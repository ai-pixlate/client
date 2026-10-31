'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/lib/api/pixlate';
import {
  pixlateKeys,
  useSectionDetailQuery,
  useSectionsQuery,
  useSourceImagesQuery,
  useUpdateSectionBucketMutation,
  useSectionProceedMutation,
} from '@/lib/queries/pixlate';
import type { ApiSection, ApiSourceImage } from '@/lib/api/n3-schema';
import { getN3SectionCardState } from '@/lib/n3/section-card-state';
import {
  N3_CONTENT_LEFT_INSET,
  N3_DETAIL_IMAGE_GAP,
  N3_DETAIL_WIDTH,
  N3_IMAGE_WIDTH,
  N3_LIST_DETAIL_GAP,
  N3_LIST_WIDTH,
} from '@/lib/n3/layout';
import { StepNav } from '../step-nav';
import { DetailPanel } from './detail-panel';
import { SectionCropThumbnail } from './section-crop-thumbnail';
import { SectionListCard } from './section-list-card';

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 확인 (Figma 1422:10176 「N3 섹션 확인 / 디폴트」, PRD v3.5.10 F-SEC-02·03)
//
// 구조:
// - 좌측 rail(나가기 버튼 + StepNav)
// - 섹션 목록(sectionOrder 순 단일 목록 — 포함/제외를 나누지 않고 재정렬도 없다)
// - 선택 섹션 판정 상세(DetailPanel)
// - 선택 섹션 이미지(SourceImage + bbox crop)
// - 하단 CTA 「이대로 진행」(목록 폭)
//
// bucket 변경은 카드/상세의 버튼으로만 한다(기존 PATCH mutation 재사용, 드래그 없음).
// 버튼은 선택을 바꾸지 않는다 — 옮긴 섹션이 그대로 선택된 채 상태만 바뀐다.
//
// 이미지 계약: Section 자체엔 이미지 URL이 없다. SourceImage.fileUrl + Section.bbox를
// SectionCropThumbnail(lib/n3/crop.ts)로 잘라 보여 준다.
// ─────────────────────────────────────────────────────────────────

function sortByOrder(sections: ApiSection[]): ApiSection[] {
  return [...sections].sort((a, b) => (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0));
}

function findSourceImage(
  images: ApiSourceImage[] | undefined,
  sourceImageId: number | null | undefined,
): ApiSourceImage | null {
  if (sourceImageId == null) return null;
  return images?.find((img) => img.id === sourceImageId) ?? null;
}

/** 서버가 전 섹션 제외로 진행을 거절했는지(409 ALL_SECTIONS_EXCLUDED, API-SEC-04) */
function isAllSectionsExcludedError(err: unknown): boolean {
  if (!(err instanceof ApiRequestError) || err.status !== 409) return false;
  const body = err.body as { error?: { code?: unknown } } | null;
  return body?.error?.code === 'ALL_SECTIONS_EXCLUDED';
}

function errorMessageOf(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const body = err.body as { error?: { message?: unknown } } | null;
    if (typeof body?.error?.message === 'string') return body.error.message;
  }
  return err instanceof Error ? err.message : '진행하지 못했습니다. 다시 시도해 주세요.';
}

/** Figma 1437:15953 「모든게 제외된 상황」 말풍선 문구 */
const NO_INCLUDED_SECTION_NOTICE = '번역 가능한 섹션이 있어야 진행 가능합니다';

function ExitIcon() {
  // N2(n2-analysis-view.tsx)와 동일 패턴 재사용 — Figma(849:7241) glyph는
  // 7일 만료 원격 asset이라 커밋 코드에 하드링크하지 않는다.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function N3View({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const sectionsQuery = useSectionsQuery(jobId);
  const sourceImagesQuery = useSourceImagesQuery(jobId);
  const mutation = useUpdateSectionBucketMutation(jobId);
  const proceedMutation = useSectionProceedMutation(jobId);

  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [proceedError, setProceedError] = useState<string | null>(null);

  const sections = useMemo(
    () => sortByOrder([...(sectionsQuery.data?.exclude ?? []), ...(sectionsQuery.data?.include ?? [])]),
    [sectionsQuery.data],
  );
  const includeCount = sectionsQuery.data?.include?.length ?? 0;
  const hasNoIncluded = sectionsQuery.isSuccess && includeCount === 0;

  // 최초 진입은 판정 확인이 필요한 첫 제외 섹션, 없으면 첫 섹션을 렌더 중 파생한다
  const effectiveSelectedId =
    selectedSectionId ?? sections.find((s) => s.bucket === 'exclude')?.id ?? sections[0]?.id ?? null;
  const selectedSection = sections.find((s) => s.id === effectiveSelectedId) ?? null;
  const detailQuery = useSectionDetailQuery(jobId, selectedSection?.id ?? null);
  const selectedSourceImage = findSourceImage(sourceImagesQuery.data, selectedSection?.sourceImageId);

  function changeBucket(section: ApiSection) {
    if (section.id == null) return;
    // 기본 선택은 "첫 제외 섹션"으로 파생된다 — 고정하지 않으면 bucket이 바뀌는 순간
    // 다른 섹션으로 선택이 넘어간다. 버튼은 선택을 바꾸지 않으므로 지금 선택을 고정한다.
    if (selectedSectionId == null) setSelectedSectionId(effectiveSelectedId);
    setProceedError(null);
    mutation.mutate({ sectionId: section.id, bucket: getN3SectionCardState(section).targetBucket });
  }

  function handleProceed() {
    if (proceedMutation.isPending || hasNoIncluded) return;
    setProceedError(null);
    proceedMutation.mutate(undefined, {
      onError: (err) => {
        if (isAllSectionsExcludedError(err)) {
          // 화면을 유지하고 이유를 보여 준 뒤, 서버 정본으로 목록을 다시 받는다
          setProceedError(NO_INCLUDED_SECTION_NOTICE);
          queryClient.invalidateQueries({ queryKey: pixlateKeys.sections(jobId) });
          return;
        }
        setProceedError(errorMessageOf(err));
      },
    });
  }

  const isCtaDisabled = proceedMutation.isPending || hasNoIncluded || !sectionsQuery.isSuccess;

  return (
    <div className="flex h-full w-full bg-white">
      {/* 좌측 rail — 나가기 버튼 + StepNav (N2와 동일 패턴 재사용) */}
      <div className="relative ml-9 h-full w-[44px] shrink-0">
        <Link
          href="/"
          aria-label="보관함으로 나가기"
          className="absolute top-10 left-1/2 z-20 flex size-10 -translate-x-1/2 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
        >
          <ExitIcon />
        </Link>
        <div className="absolute inset-0 pt-[100px] pb-6">
          <StepNav currentStep="N3" />
        </div>
      </div>

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col pt-[60px] pr-8 pb-[clamp(24px,5.56vh,60px)]"
        style={{ paddingLeft: N3_CONTENT_LEFT_INSET }}
      >
        <div className="flex shrink-0 items-center gap-[11px] pb-[23px]">
          <h1 className="text-[24px] leading-[normal] font-semibold tracking-[-0.02em] whitespace-nowrap text-[#171717]">섹션 확인</h1>
          <p className="text-[14px] tracking-[-0.01em] text-[#707070]">
            전체 섹션에서 제외 판정을 확인하고, 필요한 경우 번역에 포함하세요.
          </p>
        </div>

        {sectionsQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-gray-400">섹션 목록을 불러오는 중...</span>
          </div>
        ) : sectionsQuery.isError ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-red-500">
              {sectionsQuery.error instanceof Error ? sectionsQuery.error.message : '오류가 발생했습니다.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1">
              <div
                data-testid="n3-section-list"
                className="flex h-full shrink-0 flex-col gap-3 overflow-y-auto rounded-[4px] bg-[#f5f5f5] p-7"
                style={{ width: N3_LIST_WIDTH }}
              >
                {sections.map((section) => (
                  <SectionListCard
                    key={section.id}
                    section={section}
                    sourceImage={findSourceImage(sourceImagesQuery.data, section.sourceImageId)}
                    isSelected={section.id === effectiveSelectedId}
                    isMutating={mutation.isPending}
                    onSelect={() => setSelectedSectionId(section.id ?? null)}
                    onChangeBucket={() => changeBucket(section)}
                  />
                ))}
                {sections.length === 0 && <p className="px-1 text-center text-xs text-[#999]">섹션이 없습니다.</p>}
              </div>

              <div
                className="h-full shrink-0 pt-[7px]"
                style={{ width: N3_DETAIL_WIDTH, marginLeft: N3_LIST_DETAIL_GAP }}
              >
                <DetailPanel
                  section={selectedSection}
                  detail={detailQuery.data?.id === selectedSection?.id ? detailQuery.data : undefined}
                  isDetailLoading={detailQuery.isLoading}
                  isDetailError={detailQuery.isError}
                  isMutating={mutation.isPending}
                  onChangeBucket={() => selectedSection && changeBucket(selectedSection)}
                />
              </div>

              <div
                data-testid="n3-section-image"
                data-section-id={selectedSection?.id ?? ''}
                className="h-full shrink-0 overflow-x-hidden overflow-y-auto rounded-[4px]"
                style={{ width: N3_IMAGE_WIDTH, marginLeft: N3_DETAIL_IMAGE_GAP }}
              >
                {selectedSection &&
                  (sourceImagesQuery.isLoading ? (
                    <p className="pt-4 text-center text-sm text-[#999]">원본 이미지를 불러오는 중...</p>
                  ) : sourceImagesQuery.isError ? (
                    <p className="pt-4 text-center text-sm text-[#999]">원본 이미지를 불러오지 못했습니다.</p>
                  ) : (
                    <SectionCropThumbnail
                      key={selectedSection.id}
                      sourceImage={selectedSourceImage}
                      bbox={selectedSection.bbox}
                      targetWidth="100%"
                      alt={`섹션 ${selectedSection.sectionOrder ?? ''} 이미지`}
                    />
                  ))}
              </div>
            </div>

            <div className="relative mt-[14px] shrink-0" style={{ width: N3_LIST_WIDTH }}>
              {(hasNoIncluded || proceedError) && (
                // Figma 1437:15953 — CTA 위 orange 말풍선
                <div
                  role="status"
                  data-testid="n3-proceed-notice"
                  className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 rounded-[8px] border border-[#ff6a38] bg-white p-2.5 text-[12px] font-light whitespace-nowrap tracking-[-0.04em] text-[#ff6a38]"
                >
                  {proceedError ?? NO_INCLUDED_SECTION_NOTICE}
                  <span
                    aria-hidden="true"
                    className="absolute top-full left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r border-b border-[#ff6a38] bg-white"
                  />
                </div>
              )}
              <button
                type="button"
                data-testid="n3-proceed"
                disabled={isCtaDisabled}
                onClick={handleProceed}
                className="w-full rounded-[6px] bg-[#171717] px-8 py-3.5 text-[14px] leading-[normal] font-medium tracking-[-0.03em] text-white transition-colors disabled:cursor-not-allowed disabled:bg-[#f5f5f5] disabled:text-[#999]"
              >
                {proceedMutation.isPending ? '진행하는 중...' : '이대로 진행'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
