'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useJobQuery, useN5BlocksQuery, useN5PreviewQuery } from '@/lib/queries/pixlate';
import { toBlockViewModel, toPreviewViewModel } from '@/lib/n5/adapter';
import type { BlockViewModel, PreviewViewModel } from '@/lib/n5/adapter';
import type { N5ViewMode } from '@/lib/n5/viewport';
import { StepNav } from '../step-nav';
import { N5Viewport } from './n5-viewport';
import { N5Panel } from './n5-panel';

// ─────────────────────────────────────────────────────────────────
// N5 — 검수 shell (Figma node 544:3168, "N5 검수" 기준)
//
// 3단계(v3.4.2 실제 계약 연결): GET /jobs/{jobId} + GET /jobs/{jobId}/blocks +
// GET /jobs/{jobId}/preview 세 조회를 병렬로 받아 각각 Adapter(lib/n5/adapter.ts)를
// 거쳐 ViewModel로만 하위 컴포넌트에 전달한다. N5Viewport/N5Panel은 generated
// DTO(Api*)를 직접 import하지 않는다.
//
// 구 /review, /preview(API-CFM-03 v3.4.1) 계약 기반 코드(useReviewQuery,
// usePreviewQuery, ReviewSection/PreviewSourceImage)는 5단계에서 호출부가
// 전혀 없음을 확인하고 완전히 제거했다. ReviewSection/ReviewSourceImage
// "타입"만 app/perf/long-page(별도 성능 검증 spike 화면)가 여전히 써서
// lib/api/types.ts에는 남아 있다 — 이 화면(N5)에서는 더 이상 참조하지 않는다.
//
// F-CFM-13(이번 반영): selectedBlockId/selectedSectionId는 이 컴포넌트(N5Loaded)
// 하나가 정본으로 소유하고, N5Viewport(좌)와 N5Panel(우) 둘 다 이 값을 prop으로만
// 받는다 — 각자 별도 selection state를 두지 않는다. 좌→우 방향(선택 시 우측
// 자동 스크롤)은 N5Panel 내부에서 ref+scrollIntoView로 처리하고, 우→좌 방향은
// N5Viewport의 selectionAutoMove effect가 pan을 옮겨 해당 block/section을
// 화면 안으로 들어오게 한다.
//
// revealRequestSeq(9/24 edge case 보정): selectedBlockId/selectedSectionId는
// selection 값 자체의 SSOT일 뿐, "지금 이 위치를 다시 보여달라"는 요청까지는
// 표현하지 못한다 — 예를 들어 이미 선택된 block을 사용자가 우측에서 다시
// 클릭해도 selection 값은 안 바뀐다. 그런데 그 사이 사용자가 좌측을 수동
// pan해서 그 block을 화면 밖으로 보냈다면, 같은 row를 다시 클릭했을 때도
// 좌측이 다시 이동해야 한다(F-CFM-13). 그래서 selection 갱신과 별개로,
// "우측에서 위치 이동을 요구하는 상호작용"(row/editor 클릭, textarea
// focus)이 일어날 때마다 이 숫자를 무조건 1 증가시킨다 — selection의
// 정본이 아니라 일회성 navigation 신호일 뿐이라 N5Panel에는 넘기지 않고
// N5Viewport에만 전달한다.
// ─────────────────────────────────────────────────────────────────

function N5Loaded({
  jobId,
  preview,
  blocks,
}: {
  jobId: string;
  preview: PreviewViewModel;
  blocks: BlockViewModel[];
}) {
  // N5는 번역 검수 화면이다 — 렌더 이미지가 없다는 이유로 원문 모드로
  // 강제 전환하지 않는다. 최초 진입은 항상 'translated'다(요청 3). 렌더가
  // 안 된 section은 캔버스 쪽에서 개별 section 단위로 "렌더 대기 중"을
  // 보여줄 뿐(n5-viewport.tsx ImageLayer의 isPending, 변경하지 않음),
  // 패널의 번역문 편집 자체를 막지 않는다. "번역 렌더 이미지가 없다"는
  // 캔버스 전용 개념이라 N5Panel은 이 상태를 아예 모른다 — 한때 이
  // 컴포넌트가 계산해 N5Viewport에 내려주던 전체 안내용 플래그
  // (translatedPreviewUnavailable)는 section-local 표시와 중복돼 4차
  // 정리에서 없앴다.
  const [viewMode, setViewMode] = useState<N5ViewMode>('translated');
  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  // selection 값과 무관하게 "다시 보여달라"는 요청 자체를 매번 새 값으로
  // 알리기 위한 일회성 navigation 토큰(위 F-CFM-13 주석 참고).
  const [revealRequestSeq, setRevealRequestSeq] = useState(0);

  function handleSelectBlock(block: BlockViewModel) {
    setSelectedBlockId(block.id);
    setSelectedSectionId(block.sectionId);
    setRevealRequestSeq((seq) => seq + 1);
  }

  function handleSelectSection(sectionId: number) {
    setSelectedSectionId(sectionId);
    setSelectedBlockId(null);
    setRevealRequestSeq((seq) => seq + 1);
  }

  return (
    <div className="flex h-full w-full bg-white">
      {/* 좌측 rail — 나가기 버튼 + StepNav. Figma(544:3168) 실측: 나가기
          버튼(849:7253)은 x=40,y=40,w=40,h=40로 StepNav와 별개의 떠 있는
          요소이고, StepNav(585:3283)는 세로 중앙(top:calc(50%+40px))에
          온다 — N1/N2/N4(processing-stage-layout.tsx)가 이미 쓰는 같은
          rail 패턴을 그대로 재사용한다(새 레이아웃을 만들지 않는다). 이전
          구조는 나가기 버튼을 본문 위 헤더 줄로 올려서, 그 아래 gray
          workspace가 Figma처럼 세로 꽉 채움(top:0, height:1080)이 아니라
          헤더 높이만큼 아래로 밀려 있었다. */}
      <div className="relative ml-9 h-full w-[44px] shrink-0">
        <Link
          href="/"
          aria-label="보관함으로 나가기"
          className="absolute top-10 left-1/2 z-20 flex size-10 -translate-x-1/2 shrink-0 items-center justify-center rounded-md border border-[#eaeaea] bg-white text-[#171717] transition-colors hover:bg-gray-50"
        >
          {/* N5 3차 디테일 정렬 — Figma(849:7253 "Card/Navigation/Close", 16px
              glyph) 실제 asset을 내려받아 좌표를 확인했다: X선은 16px 박스
              전체가 아니라 가운데 8×8 영역(4~12, inset 25%)에만 있고,
              stroke-width는 1.25다. 기존엔 2~14(12×12, inset 12.5%) +
              strokeWidth 1.5라 Figma보다 크고 굵었다. */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <div className="absolute inset-0 pt-[100px] pb-6">
          <StepNav currentStep="N5" />
        </div>
      </div>

      {/* 본문: 중앙 viewer + 우측 panel. 세로 padding을 주지 않는다 — Figma의
          gray workspace(602:4953)가 top:0, height:1080(뷰포트 전체)이라,
          이 행 자체가 위아래 여백 없이 h-full을 그대로 채워야 workspace도
          같이 꽉 찬다(세로 여백은 N5Panel 안쪽에서 개별적으로 준다, 아래
          참고). 좌우 padding은 rail→workspace 간격(pl, ProcessingStageLayout
          의 calc(6.25vw-80px) 공식과 동일 — rail 몫 80px을 먼저 상쇄)과
          panel→프레임 오른쪽 끝 간격(pr, 같은 화면들의 clamp(45px,3.125vw,
          60px)과 동일)을 그대로 재사용한다. workspace와 panel 사이 gap은
          Figma 실측(52px, 1920 기준 2.708vw)을 상한으로 쓴다. */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 gap-[clamp(20px,2.708vw,52px)] pr-[clamp(45px,3.125vw,60px)] pl-[clamp(0px,calc(6.25vw_-_80px),40px)]">
        <N5Viewport
          preview={preview}
          blocks={blocks}
          viewMode={viewMode}
          selectedBlockId={selectedBlockId}
          selectedSectionId={selectedSectionId}
          revealRequestSeq={revealRequestSeq}
          onSelectBlock={handleSelectBlock}
          onSelectSection={handleSelectSection}
        />
        <N5Panel
          jobId={jobId}
          sections={preview.sections}
          blocks={blocks}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selectedBlockId={selectedBlockId}
          selectedSectionId={selectedSectionId}
          onSelectBlock={handleSelectBlock}
          onSelectSection={handleSelectSection}
        />
      </div>
    </div>
  );
}

export function N5View({ jobId }: { jobId: string }) {
  const jobQuery = useJobQuery(jobId);
  const blocksQuery = useN5BlocksQuery(jobId);
  const previewQuery = useN5PreviewQuery(jobId);

  const isLoading = jobQuery.isLoading || blocksQuery.isLoading || previewQuery.isLoading;
  const isError = jobQuery.isError || blocksQuery.isError || previewQuery.isError;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <span className="text-sm text-gray-400">검수 데이터를 불러오는 중...</span>
      </div>
    );
  }

  if (isError) {
    const err = jobQuery.error ?? blocksQuery.error ?? previewQuery.error;
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-red-500">
          {err instanceof Error ? err.message : '오류가 발생했습니다.'}
        </p>
      </div>
    );
  }

  if (!jobQuery.data || !blocksQuery.data || !previewQuery.data) return null;

  const blocks = blocksQuery.data.map(toBlockViewModel);
  const preview = toPreviewViewModel(previewQuery.data);

  return <N5Loaded jobId={jobId} preview={preview} blocks={blocks} />;
}
