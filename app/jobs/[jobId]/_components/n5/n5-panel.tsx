'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/lib/api/pixlate';
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
  pixlateKeys,
  usePatchN5BlockMutation,
  useN5TaskStatusQuery,
  useConfirmN5Mutation,
} from '@/lib/queries/pixlate';
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
//
// N5 2차 정렬(이번 반영) — block card를 Figma(544:3168) 구조에 맞춰 다시
// 짰다:
// - "제목"/"본문" 칩(RoleTag, block.roleLabel)을 화면에서 뺐다. Figma의
//   번호별 card(903:7265)에는 번호 배지 바로 다음에 role 구분 칩이 없다
//   — 이 칩이 어디서 왔는지 추적한 결과 BlockViewModel.roleLabel(=DB role
//   필드를 한글로만 바꾼 값, lib/n5/adapter.ts BLOCK_ROLE_LABELS)을 그대로
//   렌더한 것이었다. 데이터 모델(block.role/roleLabel)은 그대로 둔다 —
//   화면에 안 그릴 뿐이다. signal 경고 칩(SignalTag)은 role 구분과 무관한
//   기능(translationFailed 등)이라 그대로 유지한다.
// - 원문(SourceField)과 번역문(TranslationEditor/ReadOnlyTranslation)을
//   한 카드 안에 동시에 쌓아 보여주던 구조를 없앴다. `viewMode`가 이제
//   "같은 content slot에서 무엇을 보여줄지"를 결정한다 — 'original'이면
//   원문만, 'translated'면 번역문(+확인 버튼+번역근거)만 보인다. 이
//   viewMode는 이미 N5View가 소유하던 그 상태 그대로다(새 state 없음).
// - "번역근거" 영역을 추가했다 — 단, Figma의 실제 문구("뭐 넣자고 했는데
//   기억이 안남")는 디자이너 미완성 placeholder라 그대로 베끼지 않았다(이미
//   n5-toolbar.tsx 이전 주석에서도 같은 문제가 지적됨). BlockViewModel에는
//   "번역근거"에 해당하는 별도 필드가 없다 — 대신 이미 있는
//   SignalBadge.reason/basisArticle(각 경고 signal이 갖고 있는 실제 근거
//   텍스트, 지금까지는 SignalTag의 title 툴팁으로만 노출됐었다)을 재사용해,
//   reason이 있는 badge만 "번역근거" 카드에 모아 보여준다(EvidenceSection).
//   reason이 있는 badge가 하나도 없으면 이 영역 자체를 렌더하지 않는다 —
//   빈 placeholder 박스를 새로 지어내지 않는다.
// - "US (EN) · N개 텍스트 블록" 줄을 없앴다 — 검수에 필요한 정보가 아니라
//   디버깅성 메타였고 Figma에도 이 위치에 대응하는 요소가 없다. 이 줄에만
//   쓰이던 targetCountry/targetLanguage props도 함께 걷어냈다(N5View →
//   N5Panel로 내려오던 죽은 prop을 남기지 않는다).
// ─────────────────────────────────────────────────────────────────

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

/**
 * block 선택 표시(Figma Card/Number 배지 값 그대로: size-5 원형, 기본/선택 2색).
 * Figma는 이 숫자를 텍스트가 아니라 전용 벡터 numeral glyph(Icon/Number
 * 컴포넌트, 903:7266 등)로 그린다 — 0~9 벡터를 새로 만들지 않고 텍스트를
 * 쓰되, `leading-none`(line-height:1)으로 폰트 기본 line-height가 만드는
 * 수직 오프셋을 없앤다. flex center(align-items/justify-content)만으로는
 * 텍스트 노드의 기본 line-height(보통 폰트 크기의 1.2~1.5배)가 위아래
 * 비대칭 여백을 만들어 중앙에서 살짝 벗어나 보였다 — padding으로 억지로
 * 맞추지 않고 line-height 자체를 1로 없앴다.
 */
function BlockNumberBadge({ index, isSelected }: { index: number; isSelected: boolean }) {
  return (
    <span
      className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] leading-none ${
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

/** 원문(sourceKo) — viewMode==='original'일 때만 그려지는 읽기 전용 표시.
 *  흰 바탕 border 카드("번역근거"와 같은 참고자료 톤) */
function SourceField({ text }: { text: string }) {
  return (
    <div className="rounded-[6px] border border-[#eaeaea] bg-white p-3">
      <p className="text-[12px] font-light tracking-[-0.02em] text-[#999]">원문</p>
      <p className="mt-1 text-[14px] tracking-[-0.01em] text-[#707070]">{text || '—'}</p>
    </div>
  );
}

/**
 * 번역근거 — Figma(903:7265/7274-7276) 기준: "번역근거" 제목과 내용 박스는
 * 번역문 모드에서 항상 보인다(재정합) — 이전엔 reason 데이터가 있는 badge가
 * 하나도 없으면 영역 전체를 숨겼는데, Figma는 제목 자체를 상시 요소로 둔다.
 * 실제 데이터는 이미 있는 badge(SignalBadge.reason/basisArticle)만 모은다 —
 * BlockViewModel에 번역근거 전용 필드가 없어(위 파일 상단 주석 참고)
 * 지어낸 문구를 넣지 않는다. 데이터가 없으면 Figma의 미완성 placeholder
 * 문구("뭐 넣자고 했는데 기억이 안남")를 그대로 쓰지 않고, 이 파일이 이미
 * 쓰는 빈 값 표기 관례("—", SourceField/ReadOnlyTranslation과 동일)를
 * 따른다.
 */
function EvidenceSection({ badges }: { badges: SignalBadge[] }) {
  const withReason = badges.filter((b) => b.reason);
  return (
    // 9/23 디테일 보정 — block 내부 그룹(번호/직접 수정하기/번역문/번역근거)이
    // 서로 조금 더 조밀하게 묶이도록 이전 mt-4(16px)에서 4px 줄였다(mt-3,
    // 12px). block과 block 사이(아래 BlockRow 목록의 gap)는 반대로 늘려
    // 그룹 내부/그룹 간 간격 대비를 키운다.
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-[14px] tracking-[-0.01em] text-[#707070]">번역근거</p>
      <div className="rounded-[6px] border border-[#eaeaea] bg-white p-5">
        {withReason.length > 0 ? (
          <div className="flex flex-col gap-2">
            {withReason.map((badge, i) => (
              <p key={`${badge.code}-${i}`} className="text-[14px] tracking-[-0.01em] text-[#707070]">
                {badge.reason}
                {badge.basisArticle ? ` (${badge.basisArticle})` : ''}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-[14px] tracking-[-0.01em] text-[#999]">—</p>
        )}
      </div>
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
 *
 * F-CFM-13(9/24) — `onSelect`는 BlockRow가 이미 갖고 있는 그 콜백을 그대로
 * 받는다(onSelectBlock(block) 호출, 새 SSOT를 만들지 않는다). card 클릭/
 * textarea 클릭은 이미 이 div 전체의 onClick 버블링으로 선택되지만,
 * 키보드(Tab)로 textarea에 바로 focus가 들어오는 경로는 클릭 이벤트가 없어
 * 선택이 갱신되지 않았다 — textarea의 onFocus에도 같은 onSelect를 연결해
 * "card 클릭 / 직접 수정하기 클릭 / textarea focus" 세 경로 모두 공용
 * selection을 갱신하게 한다.
 */
function TranslationEditor({
  jobId,
  block,
  onSelect,
}: {
  jobId: string;
  block: BlockViewModel;
  onSelect: () => void;
}) {
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
      queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Blocks(jobId) });
      queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Preview(jobId) });
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
    queryClient.setQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId), (prev) =>
      prev ? prev.map((b) => (b.id === latest.id ? latest : b)) : prev,
    );
    setDraft(latest.trans1 ?? '');
    setSyncedText(latest.trans1 ?? '');
    setSyncedRevision(latest.revision ?? block.revision);
    setConflictLatest(null);
  }

  return (
    // N5 3차 디테일 정렬 — Figma(903:7265/7267-7268)는 회색 편집 박스
    // 바로 위에 "직접 수정하기" 라벨을 상시 노출한다(클릭해야 나타나는
    // 숨김 버튼이 아니다 — 평문 <p>, 박스와 8px 간격). 이전 구현엔 이
    // 라벨 자체가 없었다 — 새 인터랙션(클릭→editor 활성화)을 만들지
    // 않고, Figma가 보여준 그대로 "항상 보이는 설명 라벨 + 항상 편집
    // 가능한 박스" 구조로 복구했다. PATCH/revision 로직은 그대로다.
    <div className="mt-3 flex flex-col gap-1">
      <p className="text-[16px] tracking-[-0.03em] text-[#171717]">직접 수정하기</p>
      <div className="rounded-[6px] bg-[#f5f5f5] p-5">
        <p className="text-[12px] font-light tracking-[-0.02em] text-[#999]">번역문</p>
        {/* N5 3차 정렬 — 이제 번역문 모드가 기본값이라 이 textarea가 항상
            보이고, row 클릭(가운데 지점)이 이 textarea 위에 떨어지는 경우가
            흔해졌다. 이전엔 여기서 stopPropagation()으로 row의 onSelect
            (block 선택)를 막았는데, "텍스트를 편집하려고 클릭"한 것과
            "그 block을 선택"하는 것은 서로 막을 이유가 없는 동작이다 —
            편집 중인 block이 선택 상태로도 표시되는 게 오히려 자연스럽다.
            그래서 이 stopPropagation을 제거했다(실측: e2e F-CFM-13류 selection
            테스트가 이 stopPropagation 때문에 row 클릭이 선택으로 이어지지
            않아 실패했었다). "확인"/"최신 값 불러오기" 버튼의
            stopPropagation은 그대로 둔다 — 그 버튼들은 실제 액션(저장/불러
            오기)이라 row 선택과 뒤섞이면 안 된다. */}
        <textarea
          data-testid={`n5-block-editor-${block.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={onSelect}
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
    </div>
  );
}

/** isExcluded===true(role=product_label)인 block에서 쓴다. 영구히 읽기 전용이다. */
function ReadOnlyTranslation({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-[6px] border border-[#eaeaea] bg-white p-3">
      <p className="text-[12px] font-light tracking-[-0.02em] text-[#999]">번역문 (읽기 전용)</p>
      <p className="mt-1 text-[16px] tracking-[-0.03em] text-[#171717]">{text || '—'}</p>
    </div>
  );
}

function BlockRow({
  jobId,
  block,
  index,
  viewMode,
  isSelected,
  onSelect,
  rowRef,
}: {
  jobId: string;
  block: BlockViewModel;
  index: number;
  /** content slot(원문/번역문)이 이 값에 따라 통째로 바뀐다 — 동시에 쌓아 보여주지 않는다. */
  viewMode: N5ViewMode;
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
          {block.badges.map((badge, i) => (
            <SignalTag key={`${badge.code}-${i}`} badge={badge} />
          ))}
        </div>

        {/* content slot — 원문/번역문을 동시에 쌓지 않는다. 같은 자리에서
            viewMode에 따라 통째로 바뀐다(요청 5번). 번역근거는 Figma(903:7265)
            기준으로 번역문 모드에서는 editable 여부와 무관하게 항상 보여준다
            (요청 5 — "번역문 mode에서는 번역 근거 제목 자체는 항상 보여준다") */}
        {viewMode === 'original' ? (
          <div className="mt-4">
            <SourceField text={block.sourceText} />
          </div>
        ) : (
          <>
            {block.editable ? (
              <TranslationEditor jobId={jobId} block={block} onSelect={onSelect} />
            ) : (
              <ReadOnlyTranslation text={block.translatedText} />
            )}
            {block.editable && block.autoAdjust.applied && (
              <p className="mt-2 text-[11px] tracking-[-0.02em] text-[#999]">
                자동 글자 크기 조정 적용됨 ({Math.round(block.autoAdjust.fontScale * 100)}%)
              </p>
            )}
            <EvidenceSection badges={block.badges} />
          </>
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
  sections,
  blocks,
  viewMode,
  onViewModeChange,
  selectedBlockId,
  selectedSectionId,
  onSelectBlock,
  onSelectSection,
}: {
  jobId: string;
  sections: PreviewSectionViewModel[];
  blocks: BlockViewModel[];
  viewMode: N5ViewMode;
  onViewModeChange: (mode: N5ViewMode) => void;
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
      // onSuccess가 이미 pixlateKeys.status를 invalidate했고, page.tsx가 그
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
          queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Blocks(jobId) });
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

  return (
    // width: Figma(544:3168) 실측 433px(1920 기준, 433/1920≈22.55vw)를 상한으로
    // 쓰고, 하한(360px)은 패널이 지나치게 좁아지는 걸 막는 안전장치다.
    // pt/pb: 패널이 이제 rail과 같은 h-full(세로 전체)이라, Figma가 보여준
    // "패널 타이틀 y=60, 저장 버튼 하단 여백=80"을 패널 자신의 바깥 padding
    // 으로 준다 — 60/1080=5.56vh, 80/1080≈7.41vh(다른 화면의 하단 gutter와
    // 같은 계수, ProcessingStageLayout의 pb-[clamp(60px,7.41vh,80px)] 참고).
    <div
      data-testid="n5-panel"
      className="flex h-full w-[clamp(360px,22.55vw,433px)] shrink-0 flex-col pt-[clamp(24px,5.56vh,60px)] pb-[clamp(40px,7.41vh,80px)]"
    >
      {/* Figma(544:3168)는 타이틀과 번역문/원문 토글이 한 줄에 justify-between으로
          나란히 있다. 국가/언어·블록 개수 메타 줄은 Figma에 대응 요소가 없고
          검수에 필수인 정보도 아니라 뺐다(위 파일 상단 주석 참고). */}
      <div className="flex shrink-0 items-start justify-between pb-4">
        <h2 className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">번역 결과</h2>
        <ViewModeToggle mode={viewMode} onChange={onViewModeChange} />
      </div>

      {/* N5 3차 디테일 정렬 — Figma(903:7293 Scroll/Thumb)는 트랙이 거의
          안 보이고 thumb만 약 3px 얇은 회색이다. 이전엔 thumb을 항상
          bg-[#eaeaea]로 그려서 스크롤이 필요 없을 때도 늘 보였다 — 기본
          상태는 thumb도 투명(사실상 안 보임)으로 두고, panel 자신에
          hover했을 때만 thumb이 #eaeaea로 나타나게 한다. width(3px)는
          hover 여부와 무관하게 항상 동일해서(scrollbar-width:thin 고정)
          thumb 색만 바뀔 뿐 트랙 폭 자체가 늘었다 줄었다 하며 카드 폭을
          흔들지 않는다. Firefox는 scrollbar-color(thumb track)로 같은
          토글을 맞춘다. */}
      <div
        data-testid="n5-panel-body"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2 [scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:#eaeaea_transparent] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[2px] [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-[#eaeaea]"
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
              {/* 9/23 디테일 보정 — block 카드 사이 간격을 이전 gap-4(16px)에서
                  8px 늘려 gap-6(24px)으로 뒀다. block 내부(번호~번역근거)
                  간격을 줄인 것과 대비해, block과 block 사이는 더 뚜렷하게
                  분리되도록 한다(위 TranslationEditor/EvidenceSection
                  mt-3 참고). border/divider를 새로 넣지 않고 spacing만으로
                  구분한다. */}
              <ul className="flex flex-col gap-6">
                {/* 번호는 section-local index다(blockIndex + 1) — section마다
                    1부터 다시 시작한다. job 전체를 관통하는 전역 index나
                    DB id를 화면 번호로 쓰지 않는다(좌측 캔버스와 동일 규칙,
                    n5-viewport.tsx blockIndexById 참고). */}
                {group.blocks.map((block, blockIndex) => (
                  <BlockRow
                    key={block.id}
                    jobId={jobId}
                    block={block}
                    index={blockIndex + 1}
                    viewMode={viewMode}
                    isSelected={block.id === selectedBlockId}
                    onSelect={() => onSelectBlock(block)}
                    rowRef={(el) => {
                      if (el) blockRowRefs.current.set(block.id, el);
                      else blockRowRefs.current.delete(block.id);
                    }}
                  />
                ))}
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
