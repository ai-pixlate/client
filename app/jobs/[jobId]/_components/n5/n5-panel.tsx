'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/lib/api/pixate';
import type { ApiTextBlock } from '@/lib/api/n5-schema';
import {
  areAllSectionsExcluded,
  buildAcknowledgedWarnings,
  getRerenderTaskId,
  getRevisionConflictLatestBlock,
  isAllSectionsExcludedError,
  isInvalidStateError,
  isRevisionConflict,
  parseApiError,
} from '@/lib/n5/adapter';
import type { BlockViewModel, PreviewSectionViewModel, SignalBadge } from '@/lib/n5/adapter';
import type { N5ViewMode } from '@/lib/n5/viewport';
import {
  pixateKeys,
  usePatchN5BlockMutation,
  useN5TaskStatusQuery,
  useConfirmN5Mutation,
} from '@/lib/queries/pixate';
import { ViewModeToggle } from './n5-toolbar';

// ─────────────────────────────────────────────────────────────────
// N5 — 우측 검수 panel (Figma node 544:3168 "N5 검수" 기준)
//
// 3단계(v3.4.2 실제 계약 연결): 9/9 placeholder("block table로 구현 예정")를
// 실제 GET /jobs/{jobId}/blocks 데이터(BlockViewModel[], N5Adapter를 거침)로
// 교체했다. 기존 "다른 번역 보기" 후보 UI는 v3.2.1부터 번역 후보 계약 자체가
// 폐기되어 존재하지 않는다.
//
// F-CFM-13(이번 반영, Figma 544:3168 갱신본): block을 section 단위로 그룹핑하고,
// 그룹마다 "SectionN" 태그(Tag/Selectable)를 헤더로 둔다 — 좌측 캔버스와 같은
// 그룹 단위다. selection 정본은 N5View가 소유하고, 이 컴포넌트는
// selectedBlockId/selectedSectionId를 prop으로만 받아 좌→우 자동 스크롤만
// 담당한다(ref + scrollIntoView, 전체 목록 재렌더나 강제 상단 이동 없음).
//
// block 선택 표시는 Figma가 실제 보여준 값(번호 원형 배지: 기본
// border-[#eaeaea] size-5, 선택 bg-[#ff6a38])을 쓴다 — 이전(3단계)에 썼던
// "행 전체 orange border"는 그 시점 Figma 갱신본에서 확인되지 않아 걷어냈다. 번호는
// Figma의 Card/Number/N(1~9 전용 SVG asset) 대신 텍스트로 렌더한다 — 실제
// block 개수가 9개를 넘으면(현재 mock도 12개) 대응하는 asset이 아예 없어서다
// (그 외 색상/크기는 그대로 따른다). 좌측 canvas에도 같은 배지를 쓴다
// (n5-viewport.tsx BlockPinBadge, 7단계).
//
// 7단계(544:3168 재확인): block row 자체를 감싸던 중립 카드
// (border-[#eaeaea] + p-3 + hover:border-[#171717])는 이 Figma 갱신본에
// 없다 — 선택 표시가 번호 배지 색상 하나뿐이라 걷어냈다. BlockRow는 더 이상
// 카드가 아니라 배지·태그·본문이 그대로 흐르는 여백만 있는 영역이다.
//
// section 태그의 "선택 안 됨" 스타일은 Figma에 예시가 없다 — Design
// Direction(중립 톤: border-[#eaeaea] text-[#707070])으로 최소 보완했다.
//
// 4단계(이번 반영): TranslationEditor가 실제 PATCH /jobs/{jobId}/blocks/{blockId}
// 흐름을 갖는다 — trans1 수정 → revision 낙관적 잠금 → 성공 시 서버가 돌려준
// block(charCount 즉시, overflow/autoAdjust는 재렌더 전이라 아직 이전 값)으로
// 캐시 갱신 → rerenderTaskId를 2초 간격 polling → done이면 blocks/preview를
// invalidate해 재조회한다. 409 REVISION_CONFLICT는 Adapter의
// isRevisionConflict/getRevisionConflictLatestBlock으로 판별하고, 사용자
// 초안(draft)과 서버 최신값을 모두 화면에 남긴다 — 어느 쪽도 자동으로 버리거나
// 덮어쓰지 않는다. Figma(544:3168 최신본)에는 conflict 상태 디자인이 없어
// modal 등 새 UI를 만들지 않고, 기존 카드 톤(중립 텍스트, 에러는 이 앱이 이미
// 쓰던 text-red-500)만으로 상태와 데이터를 보여준다.
//
// 6단계(이번 반영): "저장하러 가기"가 실제 POST /jobs/{jobId}/confirm(N5→N6,
// API-CFM-04)에 연결된다. 버튼 디자인은 그대로 유지하고 동작만 붙인다.
// 활성 조건은 areAllSectionsExcluded(sections)뿐이다 — 서버가 실제로 거절하는
// 조건(전 섹션 제외)을 그대로 옮긴 것이지 FE가 새로 지어낸 규칙이 아니다.
// acknowledgedWarnings는 signal별 "개별 확인" UI가 없어(Figma에도 없음)
// 클릭 시점에 로드된 block 전체의 badge를 buildAcknowledgedWarnings로 모아
// 보낸다. 실패(409 ALL_SECTIONS_EXCLUDED/INVALID_STATE)해도 N5 화면과
// selection/zoom/pan/viewMode는 전혀 건드리지 않는다 — confirm mutation은
// 이 컴포넌트 로컬 상태(confirmError)만 바꾸고 N5View/N5Viewport 쪽 state에는
// 손대지 않는다. 성공(currentStep==='N6' 확인 후)에는 page.tsx가 이미 쓰고
// 있는 구 status polling 캐시를 invalidate해 화면 전환을 맡긴다 — N6 화면
// 자체는 이미 구현돼 있고(n6-result-view.tsx), 그 화면의 렌더 task 등록·
// JOB-05 폴링만 이번 단계 범위 밖이다.
// ─────────────────────────────────────────────────────────────────

function RoleTag({ label }: { label: string }) {
  return (
    <span className="rounded-[4px] border border-[#eaeaea] bg-white px-2 py-0.5 text-[11px] tracking-[-0.02em] text-[#171717]">
      {label}
    </span>
  );
}

function SignalTag({ badge }: { badge: SignalBadge }) {
  return (
    <span
      className="rounded-[4px] border border-[#eaeaea] bg-white px-2 py-0.5 text-[11px] tracking-[-0.02em] text-[#707070]"
      title={badge.reason ?? undefined}
    >
      {badge.label}
    </span>
  );
}

/** block 선택 표시(Figma Card/Number 배지 값 그대로: size-5 원형, 기본/선택 2색) */
function BlockNumberBadge({ index, isSelected }: { index: number; isSelected: boolean }) {
  return (
    <span
      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
        isSelected ? 'bg-[#ff6a38] text-white' : 'border border-[#eaeaea] bg-white text-[#171717]'
      }`}
    >
      {index}
    </span>
  );
}

/** section 그룹 헤더(Figma Tag/Selectable). 선택 시에만 orange — 미선택 기본값은 Figma에 없어 중립 톤으로 보완 */
function SectionTag({
  sectionOrder,
  isSelected,
  onSelect,
}: {
  sectionOrder: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`n5-section-tag-${sectionOrder}`}
      aria-pressed={isSelected}
      onClick={onSelect}
      className={`flex h-7 items-center justify-center rounded-[6px] border px-2 text-[12px] transition-colors ${
        isSelected ? 'border-[#ff6a38] bg-white text-[#ff6a38]' : 'border-[#eaeaea] bg-white text-[#707070]'
      }`}
    >
      Section{sectionOrder}
    </button>
  );
}

/** 원문(sourceKo) — 항상 읽기 전용. 흰 바탕 border 카드("번역근거"와 같은 참고자료 톤) */
function SourceField({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-[6px] border border-[#eaeaea] bg-white p-3">
      <p className="text-[12px] font-light tracking-[-0.02em] text-[#999]">원문</p>
      <p className="mt-1 text-[14px] tracking-[-0.01em] text-[#707070]">{text || '—'}</p>
    </div>
  );
}

/**
 * editable===true인 block에서 쓴다. Figma "직접 수정하기" 카드(bg-[#f5f5f5] 회색
 * 편집 표면 + "확인" Tertiary/XS 버튼)와 같은 톤을 쓴다.
 *
 * 로컬 draft는 block.revision이 "이 draft가 마지막으로 동기화된 시점"과 다를
 * 때만 서버값으로 동기화한다 — 사용자가 편집 중(dirty)이면 절대 덮어쓰지
 * 않는다(미저장 입력을 조용히 버리지 않는다).
 */
function TranslationEditor({ jobId, block }: { jobId: string; block: BlockViewModel }) {
  const queryClient = useQueryClient();
  const patchMutation = usePatchN5BlockMutation(jobId);

  const [draft, setDraft] = useState(block.translatedText);
  const [syncedText, setSyncedText] = useState(block.translatedText);
  const [syncedRevision, setSyncedRevision] = useState(block.revision);
  const [rerenderTaskId, setRerenderTaskId] = useState<number | null>(null);
  const [conflictLatest, setConflictLatest] = useState<ApiTextBlock | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isDirty = draft !== syncedText;

  // block.revision이 이 draft가 마지막으로 맞춰졌던 값과 달라졌는데 편집
  // 중(dirty)이 아니면 render 도중 바로 맞춘다 — React의 "prop이 바뀌면 state를
  // 조정한다" 공식 패턴이다(useEffect+setState 대신). effect 안에서 다시
  // setState하면 한 프레임 늦게 반영되고 불필요한 re-render가 하나 더
  // 생긴다 — 여기서는 그 프레임 지연 없이 즉시 맞춘다.
  if (block.revision !== syncedRevision && !isDirty) {
    setSyncedRevision(block.revision);
    setSyncedText(block.translatedText);
    setDraft(block.translatedText);
  }

  const taskQuery = useN5TaskStatusQuery(jobId, rerenderTaskId);
  const activeTaskItem =
    rerenderTaskId != null ? taskQuery.data?.items?.find((i) => i.taskId === rerenderTaskId) : undefined;
  const isRerendering = rerenderTaskId != null && activeTaskItem?.status !== 'done' &&
    activeTaskItem?.status !== 'failed' && activeTaskItem?.status !== 'cancelled';
  const rerenderFailed = activeTaskItem?.status === 'failed' || activeTaskItem?.status === 'cancelled';

  // invalidateQueries는 실제 네트워크 재조회를 트리거하는 부수효과라 effect에
  // 남긴다 — 다만 그 결과로 파생되는 표시값(isRerendering/rerenderFailed 위)은
  // 이 effect가 아니라 render 중 activeTaskItem에서 직접 계산한다. handledTaskIdRef는
  // 같은 완료된 task를 두 번 invalidate하지 않기 위한 가드일 뿐 React state가
  // 아니라서(재렌더를 유발하지 않는다) set-state-in-effect 대상이 아니다.
  const handledTaskIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeTaskItem) return;
    if (activeTaskItem.status !== 'done' && activeTaskItem.status !== 'failed' && activeTaskItem.status !== 'cancelled') {
      return;
    }
    if (handledTaskIdRef.current === activeTaskItem.taskId) return;
    handledTaskIdRef.current = activeTaskItem.taskId ?? null;
    if (activeTaskItem.status === 'done') {
      queryClient.invalidateQueries({ queryKey: pixateKeys.n5Blocks(jobId) });
      queryClient.invalidateQueries({ queryKey: pixateKeys.n5Preview(jobId) });
    }
  }, [activeTaskItem, jobId, queryClient]);

  async function handleSave() {
    if (patchMutation.isPending) return; // 저장 중 중복 PATCH 방지
    setSaveError(null);
    setConflictLatest(null);
    handledTaskIdRef.current = null; // 새 저장 사이클이므로 이전 task 완료 처리 기록을 리셋
    try {
      const response = await patchMutation.mutateAsync({
        blockId: block.id,
        payload: { trans1: draft, revision: block.revision },
      });
      setSyncedText(draft);
      setSyncedRevision(response.block?.revision ?? block.revision);
      setRerenderTaskId(getRerenderTaskId(response));
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        const parsed = parseApiError(err.body);
        if (parsed && isRevisionConflict(parsed)) {
          setConflictLatest(getRevisionConflictLatestBlock(parsed));
          return;
        }
      }
      setSaveError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    }
  }

  function handleLoadServerValue() {
    if (!conflictLatest) return;
    const latest = conflictLatest;
    queryClient.setQueryData<ApiTextBlock[]>(pixateKeys.n5Blocks(jobId), (prev) =>
      prev ? prev.map((b) => (b.id === latest.id ? latest : b)) : prev,
    );
    setDraft(latest.trans1 ?? '');
    setSyncedText(latest.trans1 ?? '');
    setSyncedRevision(latest.revision ?? block.revision);
    setConflictLatest(null);
  }

  return (
    <div className="mt-4 rounded-[6px] bg-[#f5f5f5] p-5">
      <p className="text-[12px] font-light tracking-[-0.02em] text-[#999]">번역문</p>
      <textarea
        data-testid={`n5-block-editor-${block.id}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        rows={3}
        className="mt-1 w-full resize-none bg-transparent text-[16px] tracking-[-0.03em] text-[#171717] outline-none"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {isRerendering && <span className="text-[11px] text-[#999]">재렌더링 중…</span>}
        <button
          type="button"
          data-testid={`n5-block-save-${block.id}`}
          onClick={(e) => {
            e.stopPropagation();
            handleSave();
          }}
          disabled={!isDirty || patchMutation.isPending}
          className="rounded-[4px] bg-white px-2.5 py-[5px] text-[12px] text-[#171717] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {patchMutation.isPending ? '저장 중…' : '확인'}
        </button>
      </div>

      {rerenderFailed && (
        <p className="mt-2 text-[11px] text-red-500">재렌더에 실패했습니다. 다시 시도해 주세요.</p>
      )}
      {saveError && <p className="mt-2 text-[11px] text-red-500">{saveError}</p>}

      {conflictLatest && (
        <div
          data-testid={`n5-block-conflict-${block.id}`}
          className="mt-2 rounded-[6px] border border-[#eaeaea] bg-white p-3"
        >
          <p className="text-[11px] text-red-500">다른 곳에서 이미 수정되어 저장할 수 없습니다.</p>
          <p className="mt-1 text-[12px] font-light text-[#999]">서버 최신값</p>
          <p className="mt-0.5 text-[14px] text-[#707070]">{conflictLatest.trans1 || '—'}</p>
          <button
            type="button"
            data-testid={`n5-block-conflict-load-${block.id}`}
            onClick={(e) => {
              e.stopPropagation();
              handleLoadServerValue();
            }}
            className="mt-2 rounded-[4px] border border-[#eaeaea] bg-white px-2.5 py-1 text-[11px] text-[#171717]"
          >
            최신 값 불러오기
          </button>
        </div>
      )}
    </div>
  );
}

/** isExcluded===true(role=product_label)인 block에서 쓴다. 영구히 읽기 전용이다. */
function ReadOnlyTranslation({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-[6px] border border-[#eaeaea] bg-white p-3">
      <p className="text-[12px] font-light tracking-[-0.02em] text-[#999]">번역문 (읽기 전용)</p>
      <p className="mt-1 text-[16px] tracking-[-0.03em] text-[#171717]">{text || '—'}</p>
    </div>
  );
}

function BlockRow({
  jobId,
  block,
  index,
  isSelected,
  onSelect,
  rowRef,
}: {
  jobId: string;
  block: BlockViewModel;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  rowRef: (el: HTMLLIElement | null) => void;
}) {
  return (
    <li ref={rowRef}>
      {/*
        button이 아니라 role="button" div를 쓴다 — 내부에 향후(4단계) 실제
        textarea가 들어갈 TranslationEditor가 있어, button 안에 폼 컨트롤을
        중첩시키지 않기 위함이다(선택 클릭 영역과 편집 클릭 영역을 구분).

        7단계 — Figma(544:3168 재확인)는 block마다 카드 테두리를 두르지 않는다.
        선택 표시는 번호 배지 색(BlockNumberBadge) 하나뿐이라 이전에 있던
        border/padding/hover-border 카드 스타일을 걷어냈다.
      */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        data-testid={`n5-block-row-${block.id}`}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className="cursor-pointer"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <BlockNumberBadge index={index} isSelected={isSelected} />
          <RoleTag label={block.roleLabel} />
          {block.badges.map((badge, i) => (
            <SignalTag key={`${badge.code}-${i}`} badge={badge} />
          ))}
        </div>

        <SourceField text={block.sourceText} />

        {block.editable ? (
          <TranslationEditor jobId={jobId} block={block} />
        ) : (
          <ReadOnlyTranslation text={block.translatedText} />
        )}

        {block.autoAdjust.applied && (
          <p className="mt-2 text-[11px] tracking-[-0.02em] text-[#999]">
            자동 글자 크기 조정 적용됨 ({Math.round(block.autoAdjust.fontScale * 100)}%)
          </p>
        )}
      </div>
    </li>
  );
}

/** section.id -> 그 section에 속한 block 목록(빈 section은 제외), sectionOrder 오름차순 */
function groupBlocksBySection(
  sections: PreviewSectionViewModel[],
  blocks: BlockViewModel[],
): { sectionId: number; sectionOrder: number; blocks: BlockViewModel[] }[] {
  const bySection = new Map<number, BlockViewModel[]>();
  for (const block of blocks) {
    const list = bySection.get(block.sectionId);
    if (list) list.push(block);
    else bySection.set(block.sectionId, [block]);
  }
  return sections
    .map((section) => ({
      sectionId: section.id,
      sectionOrder: section.sectionOrder,
      blocks: bySection.get(section.id) ?? [],
    }))
    .filter((group) => group.blocks.length > 0);
}

export function N5Panel({
  jobId,
  targetCountry,
  targetLanguage,
  sections,
  blocks,
  viewMode,
  onViewModeChange,
  translatedDisabled,
  selectedBlockId,
  selectedSectionId,
  onSelectBlock,
  onSelectSection,
}: {
  jobId: string;
  targetCountry: string | null;
  targetLanguage: string | null;
  sections: PreviewSectionViewModel[];
  blocks: BlockViewModel[];
  viewMode: N5ViewMode;
  onViewModeChange: (mode: N5ViewMode) => void;
  translatedDisabled: boolean;
  selectedBlockId: number | null;
  selectedSectionId: number | null;
  onSelectBlock: (block: BlockViewModel) => void;
  onSelectSection: (sectionId: number) => void;
}) {
  const groups = useMemo(() => groupBlocksBySection(sections, blocks), [sections, blocks]);

  const confirmMutation = useConfirmN5Mutation(jobId);
  const queryClient = useQueryClient();
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // 서버가 실제로 검사하는 것과 같은 규칙(최소 1개 include section)을 이미
  // 로드된 sections로 미리 계산한다 — 실패가 확실한 요청을 막을 뿐, FE가
  // 새 조건을 지어내는 게 아니다(lib/n5/adapter.ts의 areAllSectionsExcluded 참고).
  const allSectionsExcluded = areAllSectionsExcluded(sections);

  async function handleConfirm() {
    if (confirmMutation.isPending) return; // 중복 confirm 방지
    setConfirmError(null);
    try {
      const response = await confirmMutation.mutateAsync({
        acknowledgedWarnings: buildAcknowledgedWarnings(blocks),
      });
      // 성공(200)이어도 응답이 실제로 N6를 가리킬 때만 성공으로 다룬다 —
      // 200이라는 이유만으로 N6 이동을 낙관적으로 가정하지 않는다.
      if (response.currentStep !== 'N6') {
        setConfirmError('확정은 됐지만 예상과 다른 응답입니다. 새로고침 후 다시 확인해 주세요.');
      }
      // currentStep==='N6'이면 별도 navigate가 필요 없다 — useConfirmN5Mutation의
      // onSuccess가 이미 pixateKeys.status를 invalidate했고, page.tsx가 그
      // 결과(currentStep)로 N6 화면을 고른다(기존 useAdvanceJobStepMutation과
      // 같은 라우팅 메커니즘 재사용).
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        const parsed = parseApiError(err.body);
        if (parsed && isAllSectionsExcludedError(parsed)) {
          setConfirmError(parsed.message);
          return;
        }
        if (parsed && isInvalidStateError(parsed)) {
          setConfirmError(parsed.message);
          // 내가 보낸 경고 집합이 서버의 현재 집합과 달랐다는 뜻이다 — block
          // 목록이 낡았을 수 있으니 다음 시도가 최신 signals로 다시 계산되게
          // 재조회한다(어떤 경고가 있었는지는 FE가 임의로 지어내지 않는다).
          queryClient.invalidateQueries({ queryKey: pixateKeys.n5Blocks(jobId) });
          return;
        }
        if (parsed) {
          setConfirmError(parsed.message);
          return;
        }
      }
      setConfirmError(err instanceof Error ? err.message : '확정에 실패했습니다.');
    }
  }

  const blockRowRefs = useRef(new Map<number, HTMLLIElement>());
  const sectionHeaderRefs = useRef(new Map<number, HTMLDivElement>());

  // F-CFM-13 좌→우 자동 스크롤 — 선택된 block(없으면 선택된 section 헤더)을
  // panel 자신의 overflow 컨테이너 안에서 scrollIntoView한다. 전체 목록을
  // 다시 그리거나 상단으로 강제 이동시키지 않는다 — 'nearest'라 이미 보이는
  // 위치면 스크롤 자체가 일어나지 않는다.
  useEffect(() => {
    if (selectedBlockId != null) {
      blockRowRefs.current.get(selectedBlockId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (selectedSectionId != null) {
      sectionHeaderRefs.current
        .get(selectedSectionId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedBlockId, selectedSectionId]);

  let runningIndex = 0;

  return (
    <div data-testid="n5-panel" className="flex h-full w-[430px] shrink-0 flex-col">
      {/* 7단계 — Figma(544:3168 재확인)는 타이틀과 번역문/원문 토글이 한 줄에
          justify-between으로 나란히 있다. 이전엔 토글이 타이틀 위 별도 줄이었다. */}
      <div className="shrink-0 pb-4">
        <div className="flex items-start justify-between">
          <h2 className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">번역 결과</h2>
          <ViewModeToggle
            mode={viewMode}
            onChange={onViewModeChange}
            translatedDisabled={translatedDisabled}
          />
        </div>
        <p className="mt-1 text-[12px] tracking-[-0.02em] text-[#999]">
          {targetCountry ?? '-'}
          {targetLanguage ? ` (${targetLanguage.toUpperCase()})` : ''} · {blocks.length}개 텍스트 블록
        </p>
      </div>

      <div
        data-testid="n5-panel-body"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded-[2px] [&::-webkit-scrollbar-thumb]:bg-[#eaeaea] [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {groups.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-center text-sm text-[#999]">
            표시할 텍스트 블록이 없습니다.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.sectionId} className="flex flex-col gap-3">
              <div
                ref={(el) => {
                  if (el) sectionHeaderRefs.current.set(group.sectionId, el);
                  else sectionHeaderRefs.current.delete(group.sectionId);
                }}
              >
                <SectionTag
                  sectionOrder={group.sectionOrder}
                  isSelected={group.sectionId === selectedSectionId}
                  onSelect={() => onSelectSection(group.sectionId)}
                />
              </div>
              <ul className="flex flex-col gap-4">
                {group.blocks.map((block) => {
                  runningIndex += 1;
                  return (
                    <BlockRow
                      key={block.id}
                      jobId={jobId}
                      block={block}
                      index={runningIndex}
                      isSelected={block.id === selectedBlockId}
                      onSelect={() => onSelectBlock(block)}
                      rowRef={(el) => {
                        if (el) blockRowRefs.current.set(block.id, el);
                        else blockRowRefs.current.delete(block.id);
                      }}
                    />
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 pt-6">
        {confirmError && (
          <p data-testid="n5-confirm-error" className="mb-2 text-[12px] text-red-500">
            {confirmError}
          </p>
        )}
        {!confirmError && allSectionsExcluded && (
          <p data-testid="n5-confirm-blocked-notice" className="mb-2 text-[12px] text-red-500">
            모든 섹션이 제외되어 있어 저장할 수 없습니다. 최소 1개 섹션을 포함해 주세요.
          </p>
        )}
        <button
          type="button"
          data-testid="n5-confirm-button"
          disabled={allSectionsExcluded || confirmMutation.isPending}
          title={allSectionsExcluded ? '모든 섹션이 제외되어 있어 확정할 수 없습니다.' : undefined}
          onClick={handleConfirm}
          className="w-full rounded-md bg-[#171717] px-8 py-3.5 text-[14px] font-medium tracking-[-0.42px] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {confirmMutation.isPending ? '저장하는 중…' : '저장하러 가기'}
        </button>
      </div>
    </div>
  );
}
