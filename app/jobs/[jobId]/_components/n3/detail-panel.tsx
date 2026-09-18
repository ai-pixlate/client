'use client';

import { useEffect, useRef, useState } from 'react';

import { EXCLUSION_REASON_LABELS } from '@/lib/api/labels';
import type { ApiSection, ApiSourceImage } from '@/lib/api/n3-schema';
import { InfoBadge, VerdictCard } from './verdict-card';

// ─────────────────────────────────────────────────────────────────
// N3 — 중앙 workspace 카드 (Figma 570:5136 "N3 / 원본 상세페이지 스크롤
// 뷰포트" + 판정 카드 컬럼).
//
// 3단계 데이터 가정: section 자체 이미지가 아니라, section.sourceImageId와
// 같은 SourceImage.fileUrl "전체 원본"을 보여준다. object-cover로 잘라내지
// 않고 원본 비율 그대로 폭에 맞춰 축소한 뒤 세로 scroll한다.
// ─────────────────────────────────────────────────────────────────

export function DetailPanel({
  section,
  sourceImage,
  sourceImagesLoading,
  sourceImagesError,
}: {
  section: ApiSection | null;
  sourceImage: ApiSourceImage | null;
  sourceImagesLoading: boolean;
  sourceImagesError: boolean;
}) {
  const cardClass = 'rounded-[20px] bg-white shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)]';

  if (!section) {
    return (
      <div className={`flex h-full flex-1 items-center justify-center ${cardClass}`}>
        <p className="text-sm text-[#999]">삭제 후보로 남은 섹션이 없습니다.</p>
      </div>
    );
  }

  const exclusionLabel = section.exclusionReason ? EXCLUSION_REASON_LABELS[section.exclusionReason] : null;
  const verdicts = section.verdicts ?? [];

  return (
    <div className={`flex h-full flex-1 items-start gap-4 overflow-hidden pl-5 ${cardClass}`}>
      <SourceImageViewport section={section} sourceImage={sourceImage} isLoading={sourceImagesLoading} isError={sourceImagesError} />

      <div className="flex h-full w-[402px] shrink-0 flex-col gap-10 overflow-y-auto py-10 pr-10 pl-3">
        {exclusionLabel && (
          <div className="flex w-full flex-col items-start gap-3 rounded-[8px] bg-white px-5 py-3">
            <InfoBadge label={exclusionLabel} />
          </div>
        )}

        {verdicts.map((verdict) => (
          <VerdictCard key={verdict.id ?? `${section.id}-${verdict.verdictType}`} verdict={verdict} />
        ))}

        {!exclusionLabel && verdicts.length === 0 && (
          <p className="px-1 text-sm text-[#999]">판정 정보가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

function SourceImageViewport({
  section,
  sourceImage,
  isLoading,
  isError,
}: {
  section: ApiSection;
  sourceImage: ApiSourceImage | null;
  isLoading: boolean;
  isError: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [imgFailed, setImgFailed] = useState(false);

  // sourceImage가 바뀌면 이전 이미지의 로드 실패 상태를 이어받지 않는다.
  // effect 대신 렌더 중 상태를 보정하는 React 권장 패턴을 쓴다(리렌더 한
  // 번을 아끼고, "effect 안에서 곧장 setState" lint 규칙도 피한다).
  const [trackedSourceImageId, setTrackedSourceImageId] = useState(sourceImage?.id);
  if (sourceImage?.id !== trackedSourceImageId) {
    setTrackedSourceImageId(sourceImage?.id);
    setImgFailed(false);
  }

  // active section이 바뀔 때만 그 section의 bbox.y가 보이도록 scroll을
  // 옮긴다 — 사용자가 직접 스크롤 중일 때 강제로 되돌리지 않기 위해
  // section.id 변경에만 반응한다(렌더마다 도는 effect가 아니다).
  // bbox가 없으면 어디로 옮길지 알 수 없으므로 스크롤을 강제하지 않는다.
  useEffect(() => {
    const el = viewportRef.current;
    const y = section.bbox?.y;
    if (!el || y == null || !sourceImage?.width) return;
    const scale = el.clientWidth / sourceImage.width;
    el.scrollTo({ top: y * scale, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id, sourceImage?.id]);

  const bodyClass = 'flex h-full flex-1 min-w-[280px] items-center justify-center overflow-y-auto overflow-x-hidden rounded-[8px] bg-white';

  if (isLoading) {
    return (
      <div ref={viewportRef} data-testid="n3-source-viewport" className={bodyClass}>
        <p className="text-sm text-[#999]">원본 이미지를 불러오는 중...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div ref={viewportRef} data-testid="n3-source-viewport" className={bodyClass}>
        <p className="text-sm text-[#999]">원본 이미지를 불러오지 못했습니다.</p>
      </div>
    );
  }

  if (!sourceImage || imgFailed) {
    return (
      <div ref={viewportRef} data-testid="n3-source-viewport" className={bodyClass}>
        <p className="text-sm text-[#999]">원본 이미지를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div ref={viewportRef} data-testid="n3-source-viewport" className={`${bodyClass} items-start justify-start`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sourceImage.fileUrl}
        alt={`섹션 ${section.sectionOrder ?? ''} 소속 원본 상세페이지`}
        className="block w-full"
        style={{ height: 'auto' }}
        draggable={false}
        onError={() => setImgFailed(true)}
      />
    </div>
  );
}
