'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/lib/api/pixlate';
import { REGULATORY_CLASS_LABELS } from '@/lib/job/regulatory-class-labels';
import { toJobMetaViewModel } from '@/lib/n5/adapter';
import {
  pixlateKeys,
  useJobQuery,
  useMasterCategoriesQuery,
  useMasterChannelSpecsQuery,
  useMasterCountriesQuery,
  useSectionDetailQuery,
  useSectionsQuery,
  useSourceImagesQuery,
  useUpdateSectionBucketMutation,
  useSectionProceedMutation,
} from '@/lib/queries/pixlate';
import type { ApiSection, ApiSourceImage } from '@/lib/api/n3-schema';
import { getN3SectionCardState } from '@/lib/n3/section-card-state';
import {
  N3_BOTTOM_INSET,
  N3_COLUMNS,
  N3_DETAIL_BOTTOM_GAP,
  N3_INNER_GAP,
  N3_LEFT_GROUP_TOP,
  N3_LEFT_INSET,
  N3_OUTER_GAP,
  N3_RIGHT_INSET,
  N3_WORK_AREA_MAX_WIDTH,
} from '@/lib/n3/layout';
import { JobMetaTags } from '../job-meta-tags';
import { DetailPanel } from './detail-panel';
import { SectionCropThumbnail } from './section-crop-thumbnail';
import { SectionListCard } from './section-list-card';

// ─────────────────────────────────────────────────────────────────
// N3 — 섹션 확인 (Figma 1759:11529 「N3 섹션 확인 / 디폴트 수정」, PRD v3.5.10 F-SEC-02·03)
//
// 구조: [선택 섹션 이미지 | 판정 상세]  [섹션 목록 + 이대로 진행]  (lib/n3/layout.ts)
// - 선택 섹션 이미지(SourceImage + bbox crop) · 판정 상세(DetailPanel) — 왼쪽 묶음, 1:1
// - 섹션 목록(sectionOrder 순 단일 목록 — 포함/제외를 나누지 않고 재정렬도 없다)
// - 하단 CTA 「이대로 진행」 — 목록과 한 칼럼이다(목록 아래 12). 목록만 세로 스크롤한다
// 노트북에서도 같은 가로 구조를 비율로 줄여 유지한다(세로 stack · 가로 스크롤 없음).
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

function ProceedBubble({
  role,
  id,
  testId,
  className = '',
  children,
}: {
  role: 'alert' | 'tooltip';
  id?: string;
  testId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={role}
      id={id}
      data-testid={testId}
      className={`absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 rounded-[8px] border border-[#ff6a38] bg-white p-2.5 text-[12px] font-light whitespace-nowrap tracking-[-0.04em] text-[#ff6a38] ${className}`}
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute top-full left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r border-b border-[#ff6a38] bg-white"
      />
    </div>
  );
}

export function N3View({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const sectionsQuery = useSectionsQuery(jobId);
  const sourceImagesQuery = useSourceImagesQuery(jobId);
  const mutation = useUpdateSectionBucketMutation(jobId);
  const proceedMutation = useSectionProceedMutation(jobId);
  // 목록 위 작업 조건(Figma 「N3 섹션 상단」) — N5 와 같은 데이터·표시. 받지 못한 항목은 비워 둔다(N3 진행은 막지 않는다)
  const jobQuery = useJobQuery(jobId);
  const countriesQuery = useMasterCountriesQuery();
  const categoriesQuery = useMasterCategoriesQuery();
  // 채널 목록을 받지 못해도(실패·조회 중) N3 는 그대로 — 채널 글자만 생략된다
  const channelSpecsQuery = useMasterChannelSpecsQuery();
  const jobMeta = jobQuery.data
    ? toJobMetaViewModel(jobQuery.data, countriesQuery.data ?? [], categoriesQuery.data ?? [], REGULATORY_CLASS_LABELS, channelSpecsQuery.data ?? [])
    : null;

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

  // 전 섹션 제외는 aria-disabled로 막는다 — native disabled면 hover·focus가 닿지 않아 이유를 볼 수 없다.
  // 실제 요청은 handleProceed가 막는다.
  const isCtaDisabled = proceedMutation.isPending || !sectionsQuery.isSuccess;
  const isCtaBlocked = isCtaDisabled || hasNoIncluded;

  return (
    <div className="flex h-full w-full bg-white">
      {/* Figma 1759:11529 — 목록 패널은 공통 헤더 바로 아래(y72)에서 시작하고 본문 아래 여백은 60(1080 기준)이다.
          예전 제목·설명 행은 최신 Figma 에서 빠지고 공통 작업 헤더(JobHeader)의 화면명이 대신한다 — h1 은 화면 읽기용으로만 둔다 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-[72px]" style={{ paddingBottom: N3_BOTTOM_INSET }}>
        <h1 className="sr-only">섹션 확인</h1>

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
          <div className="flex min-h-0 flex-1" style={{ paddingLeft: N3_LEFT_INSET, paddingRight: N3_RIGHT_INSET }}>
            <div
              data-testid="n3-work-area"
              className="mx-auto grid h-full min-h-0 w-full"
              style={{ maxWidth: N3_WORK_AREA_MAX_WIDTH, gridTemplateColumns: N3_COLUMNS, columnGap: N3_OUTER_GAP }}
            >
              {/* 왼쪽 묶음 — 목록 패널보다 24 아래(y96, 진행 단계 top 과 같은 줄)에서 CTA 아래 끝(y1020)까지 */}
              <div className="flex min-h-0 min-w-0" style={{ paddingTop: N3_LEFT_GROUP_TOP }}>
                <div
                  data-testid="n3-left-group"
                  className="grid h-full w-full min-w-0 grid-cols-2 items-start"
                  style={{ columnGap: N3_INNER_GAP }}
                >
                  {/* Figma 1759:11592 — 이미지 칸 404×924(가운데 정렬 · 넘치면 자름). 섹션 crop 은 원본 비율 그대로 폭에 맞추고,
                      칸보다 길면 이 칸만 세로로 스크롤한다(짧으면 세로 가운데) */}
                  <div
                    data-testid="n3-section-image"
                    data-section-id={selectedSection?.id ?? ''}
                    className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto rounded-[4px]"
                  >
                    {selectedSection && (
                      <div className="my-auto w-full">
                        {sourceImagesQuery.isLoading ? (
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
                        )}
                      </div>
                    )}
                  </div>

                  {/* Figma 1759:11821 — 판정 상세 404×863: 아래 끝(y959)이 이미지 칸보다 61 위다 */}
                  <div className="min-h-0 min-w-0" style={{ height: `calc(100% - ${N3_DETAIL_BOTTOM_GAP})` }}>
                    <DetailPanel
                      section={selectedSection}
                      detail={detailQuery.data?.id === selectedSection?.id ? detailQuery.data : undefined}
                      isDetailLoading={detailQuery.isLoading}
                      isDetailError={detailQuery.isError}
                      isMutating={mutation.isPending}
                      onChangeBucket={() => selectedSection && changeBucket(selectedSection)}
                    />
                  </div>
                </div>
              </div>

              {/* 오른쪽 — 목록(flex-1, 내부 스크롤) · gap 12 · 이대로 진행 45 */}
              <div className="flex min-h-0 min-w-0 flex-col gap-3">
                <div
                  data-testid="n3-section-list"
                  className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-[4px] bg-[#f5f5f5] px-7 py-6"
                >
                  {/* Figma 1759:11535 — 패널 안 x28 · y24, 높이 28, 아래 12 뒤 첫 카드(y64) */}
                  {jobMeta && <JobMetaTags meta={jobMeta} testId="n3-job-meta" className="h-7 shrink-0" />}
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

                <div className="group relative shrink-0">
                  {/* Figma 1437:15953 — CTA 위 orange 말풍선. 서버가 거절한 진행 오류는 계속 보이고, 전 섹션 제외 안내는 hover·focus에만 보인다 */}
                  {proceedError ? (
                    <ProceedBubble role="alert" testId="n3-proceed-notice">
                      {proceedError}
                    </ProceedBubble>
                  ) : (
                    hasNoIncluded && (
                      <ProceedBubble
                        role="tooltip"
                        id="n3-proceed-tooltip"
                        testId="n3-proceed-tooltip"
                        className="hidden group-focus-within:block group-hover:block"
                      >
                        {NO_INCLUDED_SECTION_NOTICE}
                      </ProceedBubble>
                    )
                  )}
                  <button
                    type="button"
                    data-testid="n3-proceed"
                    disabled={isCtaDisabled}
                    aria-disabled={isCtaBlocked}
                    aria-describedby={hasNoIncluded && !proceedError ? 'n3-proceed-tooltip' : undefined}
                    onClick={handleProceed}
                    className={`h-[45px] w-full rounded-[6px] px-8 text-[14px] leading-[normal] font-medium tracking-[-0.03em] transition-colors ${
                      isCtaBlocked ? 'cursor-not-allowed bg-[#f5f5f5] text-[#999]' : 'bg-[#171717] text-white'
                    }`}
                  >
                    {proceedMutation.isPending ? '진행하는 중...' : '이대로 진행'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
