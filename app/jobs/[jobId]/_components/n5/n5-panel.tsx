'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/lib/api/pixlate';
import type { ApiTextBlock } from '@/lib/api/n5-schema';
import {
  areAllSectionsExcluded,
  buildAcknowledgedWarnings,
  getSectionStatusRowCount,
  getSignalRows,
  getTranslationFailure,
  hasSectionStatus,
  isAllSectionsExcludedError,
  isCheckNotSettledError,
  isInvalidStateError,
  parseApiError,
  toBlockViewModel,
  toPreviewViewModel,
} from '@/lib/n5/adapter';
import type { BlockTaskFailures, BlockViewModel, PreviewSectionViewModel, RetryTarget, SectionStatusViewModel } from '@/lib/n5/adapter';
import { PanelSectionStatus, SignalRows } from './n5-section-status';
import { TaskRetryButton, UpcomingRetryButton } from './n5-task-retry';
import {
  groupExpectedBySection,
  isConfirmPreviewSettling,
  isSectionPreviewInProgress,
  judgeConfirmSaveBarrier,
  toExpectedSavedBlock,
  type ConfirmSaveBarrierResult,
  type ExpectedSavedBlock,
} from '@/lib/n5/confirm-preview-barrier';
import { buildN5ReviewIssues, formatN5ReviewIssueLocation, groupN5ReviewIssues, type N5ReviewIssue } from '@/lib/n5/review-issues';
import type { N5ViewMode } from '@/lib/n5/viewport';
import {
  editTranslationDraft,
  type TranslationDraft,
} from '@/lib/n5/failed-drafts';
import { useModalDialog } from '@/app/_components/use-modal-dialog';
import {
  fetchN5Snapshot,
  pixlateKeys,
  publishN5Snapshot,
  refreshN5Snapshot,
  useN5TaskStatusQuery,
  useConfirmN5Mutation,
} from '@/lib/queries/pixlate';
import { ViewModeToggle } from './n5-toolbar';
import type { N5EditSessionApi } from './use-n5-edit-session';

/** [저장하러 가기]가 재렌더 완료를 기다리는 polling 주기(계약 기본 2초)와 상한(약 3분) */
const N5_CONFIRM_RERENDER_POLL_MS = 2_000;
const N5_CONFIRM_RERENDER_MAX_POLLS = 90;

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
// 담당한다. 자동 스크롤 단위는 section이다 — 선택된 section이 바뀔 때만 그 section
// 시작점으로 한 번 이동하고, 같은 section 안에서 block만 바뀌면 움직이지 않는다.
// 현재 section은 SectionTag가 스크롤 영역 위에 sticky로 붙어 보여 준다.
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
//   화면에 안 그릴 뿐이다.
// - 원문(SourceField)과 번역문(TranslationEditor/ReadOnlyTranslation)을
//   한 카드 안에 동시에 쌓아 보여주던 구조를 없앴다. `viewMode`가 이제
//   "같은 content slot에서 무엇을 보여줄지"를 결정한다 — 'original'이면
//   원문만, 'translated'면 번역문(+확인 버튼+번역근거)만 보인다. 이
//   viewMode는 이미 N5View가 소유하던 그 상태 그대로다(새 state 없음).
//   (최신 Figma 1069:10267 기준으로 번역문 아래에 원문 참고 영역을 다시 둔다 — SourceReference. 번역 전 모드는 그대로 원문만 보인다.)
// - "번역근거" 영역 — BlockViewModel에 번역근거 필드가 없어 값이 없으면 "—"다. signal 사유는 번호 아래 [라벨] 사유
//   행(Figma 1244:8031, SignalRows)에서 직접 보여 준다(같은 글을 근거 칸에 또 쓰지 않는다).
// - "US (EN) · N개 텍스트 블록" 줄을 없앴다 — 검수에 필요한 정보가 아니라
//   디버깅성 메타였고 Figma에도 이 위치에 대응하는 요소가 없다. 이 줄에만
//   쓰이던 targetCountry/targetLanguage props도 함께 걷어냈다(N5View →
//   N5Panel로 내려오던 죽은 prop을 남기지 않는다).
// ─────────────────────────────────────────────────────────────────

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
 * 번역근거 — Figma(903:7265/7274-7276): 제목과 내용 박스는 번역문 모드에서 항상 보인다. 번역근거 전용 API 필드가
 * 없어 지어낸 문구를 넣지 않고 "—"로 둔다. 번역이 생성되지 않은 block만 Figma 1244:8238 문구를 보여 준다.
 */
function EvidenceSection({ translationFailed }: { translationFailed: boolean }) {
  return (
    <div className="mt-4 flex flex-col gap-1">
      <p className="text-[14px] leading-[normal] tracking-[-0.01em] text-[#707070]">번역근거</p>
      <div className="rounded-[6px] border border-[#eaeaea] bg-white px-5 py-4 leading-[normal]">
        {translationFailed ? (
          <p className="text-[14px] tracking-[-0.01em] text-[#707070]">번역문이 생성되지 않아 번역 근거가 없습니다.</p>
        ) : (
          <p className="text-[14px] tracking-[-0.01em] text-[#999]">—</p>
        )}
      </div>
    </div>
  );
}

function AlertGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M7.99961 2.80005L14.3996 13.2H1.59961L7.99961 2.80005Z" stroke="#FF6A38" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 6.4668V9.73348M8 11.6001H8.008" stroke="#FF6A38" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Figma 「N5 실패문구」 variant(1244:8238) — 번역문 칸 안의 실패·안내 한 줄 */
function CellFailureMessage({ kind }: { kind: 'translate' | 'verify' | 'preview' }) {
  const text = {
    translate: '번역하지 못했습니다',
    verify: '검사하지 못했습니다',
    preview: '미리보기를 갱신하지 못했습니다',
  }[kind];
  return (
    <p data-testid={`n5-cell-failure-${kind}`} className="flex items-center gap-1 text-[12px] leading-[normal] text-[#ff6a38]">
      <AlertGlyph />
      {text}
    </p>
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
  draftEntry,
  onDraftUpdate,
  taskFailures,
  editSession,
  previewSection,
}: {
  jobId: string;
  block: BlockViewModel;
  onSelect: () => void;
  taskFailures: BlockTaskFailures;
  editSession: N5EditSessionApi;
  /** 이 블록 섹션의 /preview 상태 — 자기 재렌더 task 가 같은 섹션의 후속 저장으로 대체됐을 때 이어 본다 */
  previewSection: PreviewSectionViewModel | undefined;
  /** 이 칸의 미저장 초안(N5Panel 소유 — 이 편집기가 사라졌다 다시 생겨도 남는다). 없으면 서버값 그대로 */
  draftEntry: TranslationDraft | undefined;
  onDraftUpdate: (
    blockId: number,
    update: (prev: TranslationDraft | undefined) => TranslationDraft | undefined,
  ) => void;
}) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  // 초안의 정본은 N5Panel 의 draftEntry 다(원문 보기 전환으로 이 컴포넌트가 unmount 돼도 남아야 한다).
  // 여기는 마지막으로 맞춘 서버값(syncedText/revision)과 409·오류 표시만 들고, 초안이 없으면 서버값을 보인다.
  const [syncedText, setSyncedText] = useState(block.translatedText);
  const [syncedRevision, setSyncedRevision] = useState(block.revision);
  // 재렌더 task 와 실행 취소 쪽 충돌은 편집 세션이 들고 있다 — 저장과 실행 취소가 같은 흐름으로 이어진다
  // task 는 이유와 상관없이 따라간다(완료 뒤 재조회·실패 표시·넘침 최신성). 「재렌더링 중…」 안내는 번역문 저장이 만든 task 에만 보인다 —
  // 박스 이동·크기·배율·실행 취소로 생긴 백그라운드 재렌더는 이 칸의 저장·재검사가 아니다
  const rerenderEntry = editSession.rerenderTaskByBlock.get(block.id);
  const rerenderTaskId = rerenderEntry?.taskId ?? null;
  const isTranslationRerender = rerenderEntry?.reason === 'translation';
  const [saveConflict, setSaveConflict] = useState<ApiTextBlock | null>(null);
  const conflictLatest = saveConflict ?? editSession.historyConflicts.get(block.id) ?? null;
  const [saveError, setSaveError] = useState<string | null>(null);
  // 상태를 셋으로 나눠 둔다(PM 확정):
  // - draft(clean/dirty): 입력 즉시 바뀐다 — 왼쪽 미리보기도 같은 초안(editSession.translationDrafts)으로 바로 그린다
  // - 검사 결과(넘침·잘림·금지 표현·verify signal): 마지막 서버 결과를 그대로 둔다. dirty 라고 숨기거나 지우지 않는다
  // - 저장/재렌더(saving·rerendering·failed): [확인] → PATCH → 재렌더·재검사 → 새 서버 결과가 오면 그때 표시가 바뀐다
  const draft = draftEntry?.draft ?? syncedText;
  const isDirty = draft !== syncedText;

  function setDraft(text: string) {
    onDraftUpdate(block.id, (prev) => editTranslationDraft(prev, text, syncedText));
  }

  // 다시 마운트됐을 때 서버값이 그 사이 초안과 같아졌다면 남은 초안 항목을 정리한다(미저장 변경이 아니다).
  useEffect(() => {
    if (draftEntry && draftEntry.draft === syncedText) onDraftUpdate(block.id, () => undefined);
  }, [block.id, draftEntry, syncedText, onDraftUpdate]);

  // block.revision이 이 draft가 마지막으로 맞춰졌던 값과 달라졌는데 편집
  // 중(dirty)이 아니면 render 도중 바로 맞춘다 — React의 "prop이 바뀌면 state를
  // 조정한다" 공식 패턴이다(useEffect+setState 대신). effect 안에서 다시
  // setState하면 한 프레임 늦게 반영되고 불필요한 re-render가 하나 더
  // 생긴다 — 여기서는 그 프레임 지연 없이 즉시 맞춘다.
  if (block.revision !== syncedRevision && !isDirty) {
    setSyncedRevision(block.revision);
    setSyncedText(block.translatedText); // 초안이 없으므로 화면도 이 값을 따른다
  }

  // 같은 섹션을 이어서 저장하면 서버는 앞선 미리보기 시도를 대체(superseded)하고 /tasks 에서 내리거나 cancelled 로 둔다.
  // 저장 뒤 받은 목록에 내 task 가 없거나 cancelled 면 그 task 는 더 따라가지 않고(무한 polling·거짓 실패 없음),
  // 「재렌더링 중…」은 섹션의 현재 미리보기 시도(/preview)로 이어 본다. 과거 task 가 없다는 사실을 성공·실패로 해석하지 않는다.
  const [supersededTaskId, setSupersededTaskId] = useState<number | null>(null);
  const isSuperseded = rerenderTaskId != null && supersededTaskId === rerenderTaskId;
  const taskQuery = useN5TaskStatusQuery(jobId, isSuperseded ? null : rerenderTaskId);
  const activeTaskItem =
    rerenderTaskId != null && !isSuperseded ? taskQuery.data?.items?.find((i) => i.taskId === rerenderTaskId) : undefined;
  if (rerenderTaskId != null && !isSuperseded && taskQuery.data && (!activeTaskItem || activeTaskItem.status === 'cancelled')) {
    setSupersededTaskId(rerenderTaskId);
  }
  const isRerendering = isSuperseded
    ? isSectionPreviewInProgress(previewSection)
    : rerenderTaskId != null && activeTaskItem?.status !== 'done' && activeTaskItem?.status !== 'failed' && activeTaskItem?.status !== 'cancelled';
  const rerenderFailed = activeTaskItem?.status === 'failed';
  // 재렌더 완료·대체 뒤 /blocks·/preview 재조회는 이 칸이 하지 않는다 — use-n5-preview-sync.ts 한 곳이 같은 task 를 보고
  // 한 쌍으로 다시 받는다(같은 task 의 중복 재조회 · 번역 전/후 전환으로 이 칸이 다시 mount 될 때의 재조회를 만들지 않는다).
  // 이 칸은 위 activeTaskItem 으로 「재렌더링 중…」 종료·실패 표시만 바꾼다.

  const translationFailure = getTranslationFailure(block.badges);
  // 이 칸이 저장해 받은 재렌더 task(섹션 render)의 실패만 칸에 보인다 — 서버는 블록 단위 render task 를 만들지 않는다
  const previewFailure: RetryTarget | null = rerenderFailed
    ? { taskId: rerenderTaskId as number, retryable: activeTaskItem?.retryable === true }
    : null;
  // 일반 넘침(서버 render.result.overflow · width_overflow)은 사용자에게 「짧은 표현이 필요합니다」로 알리지 않는다(팀 QA 결정).
  // 서버 넘침 값(block.serverOverflow)은 그대로 받아 두고 이 칸에 표시만 하지 않는다.
  // 서버 저장값과 달라지는 순간부터(입력 중·칸을 벗어난 뒤 모두) 「저장하지 않은 수정」을 보인다.
  // 저장 중([확인] → 저장 중…)·저장 실패(409 충돌 · 오류 문구)는 각자의 표시가 우선이라 함께 내지 않는다
  const showUnsaved = isDirty && !isSaving && !saveError && !conflictLatest;
  // 지금 보이는 검사 결과(금지 표현 등 signal·검사 실패)는 입력 중인 초안이 아니라 마지막 저장값의 서버 결과다 — 그 기준을 함께 알린다
  const hasServerChecks = taskFailures.verifyFailed || getSignalRows(block.badges).length > 0;
  const hasFailureMessage = translationFailure != null || taskFailures.verifyFailed || previewFailure != null;

  async function handleSave() {
    if (isSaving) return; // 저장 중 중복 PATCH 방지(다른 서버 저장 중이면 saveTranslation 이 시작하지 않는다)
    setSaveError(null);
    setSaveConflict(null);
    const sentText = draft;
    setIsSaving(true);
    // 저장 경로는 [저장하러 가기]의 미저장 초안 저장과 같다(use-n5-edit-session.ts saveTranslation)
    const result = await editSession.saveTranslation(block.id, sentText);
    setIsSaving(false);
    if (!result.started) return;
    if (result.ok) {
      setSyncedText(sentText);
      setSyncedRevision(result.revision ?? block.revision);
      return;
    }
    // 초안은 그대로 두고 실패 표시만 켠다(PM: 번역문 저장 실패는 입력 유지) — 409 포함
    if (result.conflict) {
      setSaveConflict(result.conflict);
      return;
    }
    setSaveError(result.error instanceof Error ? result.error.message : '저장에 실패했습니다.');
  }

  function handleLoadServerValue() {
    if (!conflictLatest) return;
    const latest = conflictLatest;
    queryClient.setQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId), (prev) =>
      prev ? prev.map((b) => (b.id === latest.id ? latest : b)) : prev,
    );
    setSyncedText(latest.trans1 ?? '');
    setSyncedRevision(latest.revision ?? block.revision);
    setSaveConflict(null);
    editSession.clearHistoryConflict(block.id);
    onDraftUpdate(block.id, () => undefined); // 사용자가 최신 값을 고른 경우에만 초안을 버린다
  }

  return (
    // N5 3차 디테일 정렬 — Figma(903:7265/7267-7268)는 회색 편집 박스
    // 바로 위에 "직접 수정하기" 라벨을 상시 노출한다(클릭해야 나타나는
    // 숨김 버튼이 아니다 — 평문 <p>, 박스와 8px 간격). 이전 구현엔 이
    // 라벨 자체가 없었다 — 새 인터랙션(클릭→editor 활성화)을 만들지
    // 않고, Figma가 보여준 그대로 "항상 보이는 설명 라벨 + 항상 편집
    // 가능한 박스" 구조로 복구했다. PATCH/revision 로직은 그대로다.
    <div className="mt-4 flex flex-col gap-1">
      <p className="text-[16px] leading-[normal] tracking-[-0.03em] text-[#171717]">직접 수정하기</p>
      <div className="rounded-[6px] bg-[#f5f5f5] p-5">
        <p className="text-[12px] leading-[normal] font-light tracking-[-0.04em] text-[#999]">번역문</p>
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
          // [저장하러 가기] 최종 저장 중에는 새 입력을 받지 않는다(handler 에서도 막는다)
          readOnly={editSession.isFinalizing}
          rows={3}
          placeholder={translationFailure ? '번역문을 직접 입력하세요' : undefined}
          // Figma 1069:10215 — 글 높이만큼 늘어나고 버튼까지 60을 띄운다. 미지원 브라우저는 rows 높이로 표시된다
          className="mt-1 block w-full resize-none bg-transparent text-[16px] leading-[normal] tracking-[-0.03em] text-[#171717] outline-none [field-sizing:content] placeholder:text-[#999]"
        />
        {hasFailureMessage && (
          <div data-testid={`n5-block-failures-${block.id}`} className="mt-2 flex flex-col gap-1">
            {translationFailure && <CellFailureMessage kind="translate" />}
            {taskFailures.verifyFailed && <CellFailureMessage kind="verify" />}
            {previewFailure && <CellFailureMessage kind="preview" />}
          </div>
        )}
        <div className="mt-[60px] flex items-center justify-end gap-2">
          {isRerendering && isTranslationRerender && <span className="text-[11px] text-[#999]">재렌더링 중…</span>}
          {/* 규칙 검사 상태(BlockCheck) — 진행 표시는 「재렌더링 중…」과 같은 작은 회색 글로 둔다. 실패는 위 「검사하지 못했습니다」 */}
          {taskFailures.checkState === 'in_progress' && (
            <span data-testid={`n5-block-check-${block.id}`} data-check-state="in_progress" className="text-[11px] text-[#999]">
              검사 중…
            </span>
          )}
          {(taskFailures.checkState === 'missing' || taskFailures.checkState === 'outdated') && (
            <span data-testid={`n5-block-check-${block.id}`} data-check-state={taskFailures.checkState} className="text-[11px] text-[#999]">
              검사 준비 중
            </span>
          )}
          {showUnsaved && (
            <span role="status" data-testid={`n5-block-unsaved-${block.id}`} className="text-[11px] text-[#999]">
              저장하지 않은 수정
              {hasServerChecks && <span data-testid={`n5-block-checks-basis-${block.id}`}> · 검사 결과는 마지막 저장값 기준</span>}
            </span>
          )}
          <button
            type="button"
            data-testid={`n5-block-save-${block.id}`}
            onClick={(e) => {
              e.stopPropagation();
              handleSave();
            }}
            disabled={!isDirty || isSaving || editSession.isEditLocked}
            className="flex h-6 items-center justify-center rounded-[4px] bg-white px-2.5 text-[12px] leading-[normal] tracking-[-0.02em] text-[#171717] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSaving ? '저장 중…' : '확인'}
          </button>
        </div>

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
      {/* Figma 1244:8238·8641 — 재시도 버튼은 번역문 칸 아래에 둔다. 서버가 준 taskId·retryable 로 API-JOB-06 을 부른다(n5-task-retry.tsx) */}
      {(translationFailure || previewFailure) && (
        <div className="flex flex-wrap items-center gap-2">
          {/* 번역 실패의 [다시 시도]·부분 재실행은 12월 범위(PRD F-CFM-05) — 버튼은 보이되 비활성이고 재시도 요청을 보내지 않는다.
              서버가 준 taskId·retryable(translationFailure.retry)은 그대로 둔다(12월 연결 때 TaskRetryButton 으로 바꾼다) */}
          {translationFailure && <UpcomingRetryButton label="다시 시도" testId={`n5-block-translate-retry-${block.id}`} />}
          {previewFailure && (
            <TaskRetryButton
              label="미리보기 다시 시도"
              testId={`n5-block-preview-retry-${block.id}`}
              target={previewFailure}
              // 새 재렌더 시도를 이 칸의 재렌더로 이어 추적한다(「재렌더링 중…」 → 끝나면 미리보기 재조회)
              onRetried={(task) => {
                if (task.taskId != null) {
                  editSession.setRerenderTask(block.id, task.taskId, editSession.rerenderTaskByBlock.get(block.id)?.reason ?? 'translation');
                }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** 번역문 아래 원문 참고 영역(Figma 1069:10267). 원문이 없으면 그리지 않는다 */
function SourceReference({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p
      data-testid="n5-block-source-reference"
      className="mt-1 rounded-[6px] bg-[#f5f5f5] p-5 text-[14px] leading-[normal] tracking-[-0.01em] text-[#707070]"
    >
      {text}
    </p>
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
  draftEntry,
  onDraftUpdate,
  taskFailures,
  editSession,
  previewSection,
}: {
  jobId: string;
  block: BlockViewModel;
  taskFailures: BlockTaskFailures;
  editSession: N5EditSessionApi;
  previewSection: PreviewSectionViewModel | undefined;
  index: number;
  /** content slot(원문/번역문)이 이 값에 따라 통째로 바뀐다 — 동시에 쌓아 보여주지 않는다. */
  viewMode: N5ViewMode;
  isSelected: boolean;
  onSelect: () => void;
  rowRef: (el: HTMLLIElement | null) => void;
  draftEntry: TranslationDraft | undefined;
  onDraftUpdate: (
    blockId: number,
    update: (prev: TranslationDraft | undefined) => TranslationDraft | undefined,
  ) => void;
}) {
  const signalRows = getSignalRows(block.badges);
  return (
    // sticky section 태그(위)와 아래 페이드(72) 뒤로 숨지 않게 nearest 이동에 여백을 둔다
    <li ref={rowRef} className="scroll-mt-12 scroll-mb-[72px]">
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
          // 행 자신에 포커스가 있을 때만 키보드 선택으로 처리한다. 안쪽 textarea·버튼에서
          // 버블돼 온 스페이스·Enter·한글 조합 입력은 막지 않는다(F1: 번역문에 띄어쓰기가
          // 들어가지 않았다).
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className="cursor-pointer"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <BlockNumberBadge index={index} isSelected={isSelected} />
        </div>

        {/* Figma 1244:8031 — 번호 아래(16) [라벨] 사유 행. 사유는 hover 없이 바로 읽는다 */}
        {signalRows.length > 0 && (
          <div className="mt-4">
            <SignalRows badges={signalRows} testIdPrefix={`n5-block-signal-${block.id}`} />
          </div>
        )}

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
              <TranslationEditor
                jobId={jobId}
                block={block}
                onSelect={onSelect}
                draftEntry={draftEntry}
                onDraftUpdate={onDraftUpdate}
                taskFailures={taskFailures}
                editSession={editSession}
                previewSection={previewSection}
              />
            ) : (
              <ReadOnlyTranslation text={block.translatedText} />
            )}
            <SourceReference text={block.sourceText} />
            {block.editable && block.autoAdjust.applied && (
              <p className="mt-2 text-[11px] tracking-[-0.02em] text-[#999]">
                자동 글자 크기 조정 적용됨 ({Math.round(block.autoAdjust.fontScale * 100)}%)
              </p>
            )}
            <EvidenceSection translationFailed={getTranslationFailure(block.badges) != null} />
          </>
        )}
      </div>
    </li>
  );
}

/** section.id -> 그 section에 속한 block 목록(block도 상태도 없는 section은 제외), sectionOrder 오름차순 */
function groupBlocksBySection(
  sections: PreviewSectionViewModel[],
  blocks: BlockViewModel[],
  sectionStatusById: ReadonlyMap<number, SectionStatusViewModel>,
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
    .filter((group) => group.blocks.length > 0 || hasSectionStatus(sectionStatusById.get(group.sectionId)));
}

const NO_TASK_FAILURES: BlockTaskFailures = { verifyFailed: false, checkState: null };

/**
 * 패널 자동 이동 요청(n5-view.tsx 소유) — selection 값과 별개인 일회성 이벤트다. seq 가 바뀔 때만 한 번 처리한다.
 * block: 그 row 를 nearest 로 보이게(이미 보이면 움직이지 않는다) · section: 그 section 시작점으로
 */
export type N5PanelRevealRequest = { kind: 'block' | 'section'; id: number; seq: number };

export function N5Panel({
  jobId,
  sections,
  blocks,
  sectionStatusById,
  blockTaskFailuresById,
  viewMode,
  onViewModeChange,
  selectedBlockId,
  selectedSectionId,
  revealRequest,
  onSelectBlock,
  onSelectSection,
  editSession,
}: {
  jobId: string;
  sections: PreviewSectionViewModel[];
  blocks: BlockViewModel[];
  sectionStatusById: ReadonlyMap<number, SectionStatusViewModel>;
  blockTaskFailuresById: ReadonlyMap<number, BlockTaskFailures>;
  /** 같은 대상을 다시 골라도 그 위치를 다시 보여 달라는 요청 횟수(n5-view.tsx) */
  viewMode: N5ViewMode;
  onViewModeChange: (mode: N5ViewMode) => void;
  selectedBlockId: number | null;
  selectedSectionId: number | null;
  /** 패널 자동 이동 요청. selection 이 바뀌었다는 이유만으로는 움직이지 않는다 */
  revealRequest: N5PanelRevealRequest | null;
  /** 패널 안에서 고른 선택(패널 출처) — 캔버스만 그 대상을 보이게 하고 패널은 그대로다 */
  onSelectBlock: (block: BlockViewModel) => void;
  onSelectSection: (sectionId: number) => void;
  /** N5 편집 세션(N5Loaded 소유) — 이력·번역문 초안의 정본이다 */
  editSession: N5EditSessionApi;
}) {
  const groups = useMemo(() => groupBlocksBySection(sections, blocks, sectionStatusById), [sections, blocks, sectionStatusById]);
  const previewSectionById = useMemo(() => new Map(sections.map((section) => [section.id, section])), [sections]);
  // 블록 칸이 추적 중인 재렌더 task — 그 칸이 실패 문구·[미리보기 다시 시도]를 보이므로 섹션 안내에는 같은 버튼을 다시 내지 않는다
  const trackedRerenderTaskIds = useMemo(
    () => new Set([...editSession.rerenderTaskByBlock.values()].flatMap((task) => (task.taskId != null ? [task.taskId] : []))),
    [editSession.rerenderTaskByBlock],
  );
  const firstGroupHasStatus = groups.length > 0 && getSectionStatusRowCount(sectionStatusById.get(groups[0].sectionId)) > 0;

  const confirmMutation = useConfirmN5Mutation(jobId);
  const queryClient = useQueryClient();
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // 서버가 실제로 검사하는 것과 같은 규칙(최소 1개 include section)을 이미
  // 로드된 sections로 미리 계산한다 — 실패가 확실한 요청을 막을 뿐, FE가
  // 새 조건을 지어내는 게 아니다(lib/n5/adapter.ts의 areAllSectionsExcluded 참고).
  const allSectionsExcluded = areAllSectionsExcluded(sections);
  // [저장하러 가기] = N5 최종 저장. 확정(POST /confirm)은 모든 N5 변경이 서버 정본에 반영된 뒤에만 보낸다 — BE 계약(release 44e7164):
  // confirm 은 「confirm 시점에 DB 에 저장 완료된 값」(revision·번역문·layout/bbox·fontScale·style·배경 입력)으로 최종 렌더 입력을 고정한다.
  // PATCH 를 먼저 보냈다는 것만으로 먼저 처리된다는 보장이 없고(job row lock 을 confirm 이 먼저 잡으면 이전 값으로 확정되고 늦은 PATCH 는
  // 409 job_not_editable), 여러 block PATCH 는 한 transaction 이 아니다. 그래서 FE 가 저장 순서를 책임진다 — 서버 409 에 기대지 않는다. 확정 전 장벽:
  //   ① 진행 중인 서버 저장(번역문 [확인]·섹션·서버 실행 취소/다시 실행)이 있으면 시작하지 않는다(버튼 비활성 + 핸들러 재확인)
  //   ② 저장하지 않은 수정을 블록 순서대로 하나씩 저장하고 각각의 성공 응답을 기다린다(saveBlockForConfirm) —
  //      서버값과 다른 번역 초안, 그리고 박스 위치·크기·글자 배율·높이 초안(배치는 N5 조작 중에는 local 만 바꾸고 여기서 처음 저장한다).
  //      같은 블록의 번역 초안과 배치는 한 PATCH(최신 revision 1회)로, 이미 [확인]으로 저장한 번역문은 다시 보내지 않는다.
  //      하나라도 실패(409·4xx·5xx·네트워크)하면 나머지를 보내지 않고 확정하지 않으며 N5 에 남는다(local 초안 유지·기존 충돌/실패 표시).
  //      N6 데이터 정확성의 기준은 이 PATCH 저장 완료다 — confirm 은 그 뒤에만 나간다
  //   ③ 모든 저장이 끝난 뒤, 저장으로 영향받은 섹션의 「현재」 미리보기(/preview render.isCurrent)가 현재 입력 기준으로 끝날 때까지 기다린다(2초 polling).
  //      PATCH 응답의 rerenderTaskId 생명주기는 보지 않는다 — 같은 섹션의 후속 저장이 앞선 시도를 대체(superseded·cancelled)하고 /tasks 에서 내릴 수 있다.
  //      현재 시도가 실패하면 확정하지 않고 기존 실패 표시로 남긴다.
  //      이것은 N6 반영을 위한 서버 필수 조건이 아니다(confirm 은 진행 중 preview 재렌더를 취소하고 저장된 값으로 최종 렌더를 따로 만든다).
  //      사용자가 최신 저장 결과의 미리보기를 확인하게 하는 UX 장벽이며, 재렌더 실패 시 진행 여부는 PM/UX 정책 확인 전까지 현재대로 막는다
  //      완료 조건은 revision 까지 본다 — 저장마다 PATCH 응답 block(서버 정본)의 revision 을 기록하고, 섹션별로 저장한 모든 block 이
  //      /blocks 와 /preview renderInput 에서 그 revision 그대로일 때만 완료다(빈 번역 등 렌더 대상이 아닌 저장은 renderInput 에서 빠져 있어야 정상).
  //      더 큰 revision 은 내 저장 뒤 다른 저장(다른 탭 등) — 정상 완료로 보지 않고 확정하지 않는다(lib/n5/confirm-preview-barrier.ts)
  //      ③ 의 polling 응답은 판정에만 쓴다 — 기다리는 중(waiting)에는 화면 캐시를 바꾸지 않고, 판정이 끝났을 때(완료·충돌·실패·확인 불가)만
  //      받은 /blocks·/preview 한 쌍을 화면에 한 번에 넣는다(publishN5Snapshot)
  //   ④ 확인 항목은 ②(Phase A, 서버 저장) 직후 계산한다. 항목이 있으면 ③(Phase B, 미리보기 장벽)을 기다리지 않고 확인창을 바로 연다.
  //      [확인하고 저장] 또는 항목이 없을 때 ③을 기다린 뒤, 완료된 /blocks 정본으로 확인 항목을 다시 만들어 사용자가 확인하지 않은
  //      새 항목이 있으면 확정하지 않고 확인창을 다시 연다. 없으면 같은 정본으로 acknowledgedWarnings 를 만들어 곧바로 confirm 한다
  // 저장 대상을 정한 뒤 생긴 local 수정이 confirm 에서 빠지지 않도록, ②~확정 동안 편집 세션을 잠근다(beginFinalizationLock — 번역 입력·[확인]·
  // 박스·배율·실행 취소/다시 실행·섹션 제외/복원 handler 가 무시한다).
  // confirm 에 기대 block revision 집합을 보내는 필드는 아직 계약이 없다 — 임의 필드를 만들지 않는다. 그래서 마지막 확인 ~ confirm 트랜잭션 사이의
  // 다른 탭 저장은 FE 가 막을 수 없다(서버 계약 필요). FE 는 그 창을 좁힐 뿐이다.
  // 저장하지 못한 번역문을 확인창에서 그대로 넘기던 정책(10/29)은 이번 요구(N5 수정값이 N6 에서 사라지면 안 된다)로 바뀌었다.
  const isServerSaving = editSession.hasPendingServerEdits || editSession.pendingSectionIds.size > 0;
  const [isFinalizing, setIsFinalizing] = useState(false);
  const finalizingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { translationDrafts, updateTranslationDraft: handleDraftUpdate } = editSession;
  // [저장하러 가기] 때 확인받을 항목(F-CFM-09). 항목이 없으면 확인창 없이 바로 확정한다. 항목은 열리는 순간의 값으로 고정한다.
  const [reviewIssues, setReviewIssues] = useState<N5ReviewIssue[] | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const closeReviewDialog = useCallback(() => setReviewIssues(null), []);
  // 포함 섹션 블록의 규칙 검사가 진행 중(check.state=in_progress)이면 확정하지 않는다(confirmReview 「규칙 검사 연결」 — 버튼 비활성).
  // missing·outdated 는 버튼을 막지 않는다 — 확정 요청이 서버의 보조 복구 경로다(409 check_not_settled 로 답한다)
  const includedSectionIds = new Set(sections.filter((section) => section.bucket !== 'exclude').map((section) => section.id));
  const isCheckInProgress = blocks.some(
    (block) => includedSectionIds.has(block.sectionId) && blockTaskFailuresById.get(block.id)?.checkState === 'in_progress',
  );
  const isConfirmBlocked = allSectionsExcluded || confirmMutation.isPending || isFinalizing || isServerSaving || isCheckInProgress;

  /** 최신 /blocks 캐시(서버 정본) — 클릭 시점 closure 의 blocks 가 아니라 재조회 뒤의 값을 쓴다 */
  function readLatestBlocks(): BlockViewModel[] {
    const latest = queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId));
    return latest ? latest.map(toBlockViewModel) : blocks;
  }

  /** 이번 최종 저장에서 PATCH 응답으로 받은 서버 정본(blockId → 기대값). 확인창을 거친 확정 직전 장벽도 이 값을 쓴다 */
  const expectedSavedRef = useRef(new Map<number, ExpectedSavedBlock>());
  /** 기대 revision 없이 현재 미리보기만 기다리는 섹션(클릭 전 [확인]·실행 취소로 아직 만들어지는 중이던 섹션) */
  const previewOnlySectionIdsRef = useRef(new Set<number>());
  /** 이번 저장 전에 저장된(클릭 전 [확인]·실행 취소) 섹션 — 장벽 첫 조회 때 그 미리보기가 아직 진행 중이면 함께 기다린다 */
  const earlierSectionIdsRef = useRef(new Set<number>());
  /** 확인창에 보여 준 항목 — 장벽 뒤 다시 만든 항목 중 여기 없는 것이 있으면 확정하지 않고 다시 보여 준다 */
  const acknowledgedIssueKeysRef = useRef(new Set<string>());

  /**
   * 장벽 판정용으로 /blocks·/preview 를 함께 새로 받는다. query 의 fetch 를 함께 쓰지 않는다(화면 쪽 invalidate 가 진행 중 fetch 를 취소하면 장벽이 안내 없이 끊긴다).
   * 기다리는 중(waiting)이면 화면 캐시를 바꾸지 않는다 — 그 응답은 판정에만 쓴다. 판정이 끝났으면 받은 한 쌍을 화면에 한 번에 넣는다
   */
  async function fetchAndJudgeServerState(): Promise<{ result: ConfirmSaveBarrierResult; sections: PreviewSectionViewModel[] }> {
    const snapshot = await fetchN5Snapshot(jobId);
    const sections = toPreviewViewModel(snapshot.preview).sections;
    const result = judgeConfirmSaveBarrier({
      sections,
      expectedBySection: groupExpectedBySection(expectedSavedRef.current.values()),
      previewOnlySectionIds: previewOnlySectionIdsRef.current,
      latestBlocks: snapshot.blocks.flatMap((block) =>
        typeof block.id === 'number'
          ? [
              {
                id: block.id,
                revision: block.revision ?? null,
                trans1: block.trans1 ?? null,
                sectionId: block.sectionId ?? null,
                sectionInputFingerprint: block.sectionInputFingerprint ?? null,
              },
            ]
          : [],
      ),
    });
    if (result.state !== 'waiting') publishN5Snapshot(queryClient, jobId, snapshot);
    return { result, sections };
  }

  /** 판정이 완료가 아닐 때의 안내(내부 판정과 사용자 문구를 나눈다). 다른 저장이 있었으면 그 칸을 보여 준다 */
  function reportBarrierStop(result: ConfirmSaveBarrierResult) {
    if (result.state === 'conflict') {
      const block = readLatestBlocks().find((candidate) => candidate.id === result.conflictBlockIds[0]);
      if (block) selectBlockFromPanel(block, { reveal: true });
      setConfirmError('저장한 뒤 다른 곳에서 내용이 바뀌어 다음 단계로 넘어가지 않았습니다. 바뀐 내용을 확인한 뒤 다시 시도해 주세요.');
    } else if (result.state === 'failed') {
      setConfirmError('미리보기를 다시 만들지 못한 칸이 있어 다음 단계로 넘어가지 않았습니다. 해당 칸에서 다시 시도해 주세요.');
    } else if (result.state === 'invalid') {
      setConfirmError('미리보기 상태를 확인하지 못해 다음 단계로 넘어가지 않았습니다. 새로고침 후 다시 시도해 주세요.');
    } else {
      setConfirmError('미리보기 재렌더가 끝나지 않아 다음 단계로 넘어가지 않았습니다. 잠시 뒤 다시 시도해 주세요.');
    }
  }

  /**
   * Phase A(②) — 저장하지 않은 수정(번역 초안 · 배치 초안)을 블록 순서대로 하나씩 저장하고 각 응답을 기다린다. 성공하면 true, 실패하면 안내를 남기고 false.
   * 응답의 rerenderTaskId 는 모으지 않는다 — 같은 섹션의 다음 저장이 그 시도를 대체(superseded)할 수 있어 완료 기준이 아니다.
   * 응답 block 의 revision 을 서버 정본 기대값으로 기록한다(FE 가 +1 로 추측하지 않는다). 미리보기 완료는 Phase B 가 본다
   */
  async function saveUnsavedEdits(): Promise<boolean> {
    const sectionIdOf = (blockId: number) =>
      (readLatestBlocks().find((candidate) => candidate.id === blockId) ?? blocks.find((candidate) => candidate.id === blockId))?.sectionId;
    expectedSavedRef.current = new Map();
    previewOnlySectionIdsRef.current = new Set();
    for (const blockId of editSession.listUnsavedBlockIds()) {
      const sectionId = sectionIdOf(blockId);
      const result = await editSession.saveBlockForConfirm(blockId);
      if (!mountedRef.current) return false;
      if (!result.started || !result.ok) {
        const block = blocks.find((candidate) => candidate.id === blockId);
        if (block) selectBlockFromPanel(block, { reveal: true });
        setConfirmError('저장하지 못한 수정이 있어 다음 단계로 넘어가지 않았습니다. 표시된 칸을 확인한 뒤 다시 시도해 주세요.');
        return false;
      }
      const expected = result.block ? toExpectedSavedBlock(result.block) : null;
      if (expected) {
        expectedSavedRef.current.set(expected.blockId, expected);
      } else if (sectionId != null && (result.block != null || result.rerenderTaskId != null)) {
        // PATCH 는 했지만 응답 block 으로 기대값을 만들 수 없다 — revision 정합은 볼 수 없어 현재 미리보기만 기다린다
        previewOnlySectionIdsRef.current.add(sectionId);
      }
    }
    const affectedSectionIds = new Set([...expectedSavedRef.current.values()].map((expected) => expected.sectionId));
    const earlierSectionIds = new Set<number>();
    for (const blockId of editSession.rerenderTaskByBlock.keys()) {
      const sectionId = sectionIdOf(blockId);
      if (sectionId != null && !affectedSectionIds.has(sectionId)) earlierSectionIds.add(sectionId);
    }
    earlierSectionIdsRef.current = earlierSectionIds;
    return true;
  }

  /**
   * Phase B(③) — 모든 저장이 끝난 뒤, 영향받은 섹션의 「현재」 미리보기가 현재 저장 입력 기준으로 끝났는지 /preview 로 기다린다(2초 polling).
   * 과거 task 의 done·cancelled·목록에서 사라짐은 보지 않는다(최신성 정본 = 서버 render.isCurrent, lib/n5/confirm-preview-barrier.ts).
   * 앞선 저장 섹션은 첫 조회 때 그 섹션의 시도가 아직 진행 중일 때만 함께 기다린다. 기다릴 섹션이 없어도 한 번은 새로 받아 같은 조건을 확인한다.
   * 완료면 true(그 응답이 화면에 들어가 있다). 아니면 안내를 남기고 false
   */
  async function waitForPreviewBarrier(): Promise<boolean> {
    for (let attempt = 0; ; attempt += 1) {
      let judged = await fetchAndJudgeServerState();
      if (!mountedRef.current) return false;
      if (attempt === 0) {
        const settling = [...earlierSectionIdsRef.current].filter((sectionId) =>
          isConfirmPreviewSettling(judged.sections.find((section) => section.id === sectionId)),
        );
        if (settling.length > 0) {
          for (const sectionId of settling) previewOnlySectionIdsRef.current.add(sectionId);
          judged = await fetchAndJudgeServerState();
          if (!mountedRef.current) return false;
        }
      }
      const { result } = judged;
      if (result.state === 'complete') return true;
      if (result.state !== 'waiting' || attempt >= N5_CONFIRM_RERENDER_MAX_POLLS) {
        reportBarrierStop(result);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, N5_CONFIRM_RERENDER_POLL_MS));
      if (!mountedRef.current) return false;
    }
  }

  const issueKeyOf = (issue: N5ReviewIssue) =>
    `${issue.kind}|${issue.sectionId}|${issue.blockId ?? ''}|${issue.stageLabel ?? ''}|${issue.message}`;
  /** 확인 항목 — 블록은 최신 /blocks 캐시(서버 정본, 제외 블록 포함 — 항목 집합은 그대로), 섹션 상태는 이 화면 값(기존 입력 구성 그대로).
   *  블록 번호만 화면에 보이는 블록(blocks — 제외 블록 없음)의 섹션 안 번호로 맞춘다(패널·캔버스 번호와 같게) */
  const buildIssuesNow = () => {
    const blockOrderById = new Map<number, number>();
    const countBySection = new Map<number, number>();
    for (const block of blocks) {
      const order = (countBySection.get(block.sectionId) ?? 0) + 1;
      countBySection.set(block.sectionId, order);
      blockOrderById.set(block.id, order);
    }
    return buildN5ReviewIssues({
      sections,
      blocks: readLatestBlocks(),
      sectionStatusById,
      blockTaskFailuresById,
      failedDraftBlockIds: new Set(),
      blockOrderById,
    });
  };

  async function handleConfirmClick() {
    // ① 같은 tick 의 연속 클릭·강제 이벤트도 막도록 ref 로 다시 확인한다
    if (finalizingRef.current || confirmMutation.isPending || allSectionsExcluded || editSession.isServerEditPending()) return;
    // 저장 대상을 정하기 전에 편집 세션을 잠근다 — 이후 새 local 수정은 시작되지 않는다(이미 있던 초안은 그대로 저장한다)
    if (!editSession.beginFinalizationLock()) return;
    finalizingRef.current = true;
    setIsFinalizing(true);
    setConfirmError(null);
    try {
      // Phase A — 서버 저장이 모두 성공해야 다음으로 간다
      if (!(await saveUnsavedEdits())) return;
      // 미저장 초안은 모두 저장됐다 — 저장하지 못한 번역문 항목은 남지 않는다. 확인 항목이 있으면 미리보기 장벽을 기다리지 않고 바로 보여 준다
      const issues = buildIssuesNow();
      if (issues.length > 0) {
        acknowledgedIssueKeysRef.current = new Set(issues.map(issueKeyOf));
        setReviewIssues(issues);
        return;
      }
      acknowledgedIssueKeysRef.current = new Set();
      await handleConfirm();
    } catch {
      // 저장·장벽 조회 실패(네트워크 등) — 확정하지 않고 N5 에 남는다(초안은 그대로)
      if (mountedRef.current) setConfirmError('서버 상태를 확인하지 못해 다음 단계로 넘어가지 않았습니다. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      finalizingRef.current = false;
      editSession.endFinalizationLock();
      if (mountedRef.current) setIsFinalizing(false);
    }
  }

  // [확인하고 저장] — Phase B(미리보기 장벽)부터 이어서 확정한다. 이 선택을 서버에 따로 남기지 않는다.
  function handleReviewContinue() {
    setReviewIssues(null);
    void handleConfirm();
  }

  async function handleConfirm() {
    // 확정 직전 재확인 — 진행 중인 서버 저장이 있으면 보내지 않는다(확인창이 열린 사이에 생긴 경우 포함)
    if (confirmMutation.isPending || editSession.isServerEditPending()) return;
    // 확인창 경로는 여기서 잠근다([저장하러 가기] 흐름 안에서는 이미 잠겨 있다)
    const ownsLock = editSession.beginFinalizationLock();
    if (ownsLock) {
      finalizingRef.current = true;
      setIsFinalizing(true);
    }
    setConfirmError(null);
    try {
      // 저장 대상을 정한 뒤 생긴 수정이 남아 있으면 확정하지 않는다(잠금 이전 경로 방어 — 수정은 그대로 둔다)
      if (editSession.listUnsavedBlockIds().length > 0) {
        setConfirmError('저장하지 않은 수정이 있어 다음 단계로 넘어가지 않았습니다. [저장하러 가기]를 다시 눌러 주세요.');
        return;
      }
      // Phase B — /blocks·/preview 를 새로 받아 이번 저장 revision·지문 A=B·현재 미리보기가 맞을 때까지 기다린다(확인창이 열린 사이의 다른 저장 포함).
      // 마지막 완료 판정 뒤에는 다른 await 없이 바로 confirm 한다. 이 확인 ~ confirm 트랜잭션 사이의 다른 저장은 서버 계약 없이는 막을 수 없다
      try {
        if (!(await waitForPreviewBarrier())) return;
      } catch {
        if (mountedRef.current) setConfirmError('서버 상태를 확인하지 못해 다음 단계로 넘어가지 않았습니다. 잠시 뒤 다시 시도해 주세요.');
        return;
      }
      if (!mountedRef.current) return;
      // 최종 경고 재검증 — 장벽이 받은 정본으로 확인 항목을 다시 만든다. 사용자가 확인하지 않은 항목이 생겼으면 확정하지 않고 다시 보여 준다
      const issues = buildIssuesNow();
      if (issues.some((issue) => !acknowledgedIssueKeysRef.current.has(issueKeyOf(issue)))) {
        acknowledgedIssueKeysRef.current = new Set(issues.map(issueKeyOf));
        setReviewIssues(issues);
        return;
      }
      const response = await confirmMutation.mutateAsync({
        // 최신 서버 정본의 경고 집합(클릭 시점 closure 가 아니다)
        acknowledgedWarnings: buildAcknowledgedWarnings(readLatestBlocks()),
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
        if (parsed && isCheckNotSettledError(parsed)) {
          // 검사가 끝나지 않은 블록이 있다 — 서버가 필요한 검사를 등록했다(registeredBlockIds). 확정하지 않고 N5 에 남아
          // 블록 검사 상태를 다시 받는다(in_progress 가 되면 버튼이 비활성이 되고 끝날 때까지 추적한다)
          setConfirmError('번역문 검사가 아직 끝나지 않아 다음 단계로 넘어가지 않았습니다. 검사가 끝나면 다시 저장해 주세요.');
          await refreshN5Snapshot(queryClient, jobId).catch(() => {
            void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Blocks(jobId) });
          });
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
    } finally {
      if (ownsLock) {
        editSession.endFinalizationLock();
        finalizingRef.current = false;
        if (mountedRef.current) setIsFinalizing(false);
      }
    }
  }

  const blockRowRefs = useRef(new Map<number, HTMLLIElement>());
  const sectionGroupRefs = useRef(new Map<number, HTMLDivElement>());
  // 마지막으로 처리한 이동 요청 — 같은 요청을 두 번 처리하지 않는다(blocks 재조회 등으로 다시 그려져도)
  const handledRevealSeqRef = useRef(revealRequest?.seq ?? 0);

  // 좌→우 자동 이동(F-CFM-13, PM 확정) — selection 값의 변화가 아니라 명시적인 요청이 있을 때만 움직인다.
  // 왼쪽 section 배경 클릭은 요청을 보내지 않아 패널(사용자가 스크롤해 둔 위치)이 그대로다.
  // block 은 그 row 를 nearest 로 — 이미 보이면 그대로, 밖이면 필요한 만큼만(section 맨 위로 올리지 않는다).
  // 같은 block 을 다시 골라도 seq 가 새로 오므로 수동으로 밀어 둔 row 를 다시 보여 준다.
  useEffect(() => {
    if (!revealRequest || revealRequest.seq === handledRevealSeqRef.current) return;
    handledRevealSeqRef.current = revealRequest.seq;
    if (revealRequest.kind === 'block') {
      blockRowRefs.current.get(revealRequest.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      sectionGroupRefs.current.get(revealRequest.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [revealRequest]);

  /** 패널 안에서 고른 선택 — 사용자가 이미 보고 있는 자리라 패널을 움직이지 않는다. reveal은 그 행을 보이게 한다(저장 실패 칸 안내) */
  function selectBlockFromPanel(block: BlockViewModel, options: { reveal?: boolean } = {}) {
    onSelectBlock(block);
    if (options.reveal) blockRowRefs.current.get(block.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function selectSectionFromPanel(sectionId: number) {
    onSelectSection(sectionId);
  }

  return (
    // width: Figma(544:3168) 실측 433px 를 상한으로 1440 까지 유지하고(그 위에서는 gap·gutter 가 먼저 준다,
    // n5-view.tsx), 1440 아래에서 1px 씩 줄어 하한 360px 에 닿는다(100vw − 1007px).
    // pt/pb: 패널이 이제 rail과 같은 h-full(세로 전체)이라, Figma가 보여준
    // "패널 타이틀 y=60, 저장 버튼 하단 여백=80"을 패널 자신의 바깥 padding
    // 으로 준다 — 60/1080=5.56vh, 80/1080≈7.41vh(다른 화면의 하단 gutter와
    // 같은 계수, ProcessingStageLayout의 pb-[clamp(60px,7.41vh,80px)] 참고).
    <div
      data-testid="n5-panel"
      className="flex h-full w-[var(--n5-panel-width)] shrink-0 flex-col pt-[clamp(24px,5.56vh,60px)] pb-[clamp(40px,7.41vh,80px)] [--n5-panel-width:clamp(360px,calc(100vw_-_1007px),433px)]"
    >
      {/* Figma(544:3168)는 타이틀과 번역문/원문 토글이 한 줄에 justify-between으로
          나란히 있다. 국가/언어·블록 개수 메타 줄은 Figma에 대응 요소가 없고
          검수에 필수인 정보도 아니라 뺐다(위 파일 상단 주석 참고). */}
      {/* Figma 1256:6916 — 높이 30, 아래 40 뒤에 목록(y130)이 시작한다 */}
      {/* 첫 section에 상태가 있으면 Figma 1244:8444처럼 목록이 y123에서 시작한다(아래 33) */}
      <div
        className={`flex shrink-0 items-center justify-between ${
          firstGroupHasStatus ? 'pb-[clamp(16px,3.06vh,33px)]' : 'pb-[clamp(16px,3.7vh,40px)]'
        }`}
      >
        <h2 className="text-[18px] leading-[normal] font-medium tracking-[-0.03em] text-[#171717]">번역 결과</h2>
        <ViewModeToggle mode={viewMode} onChange={onViewModeChange} />
      </div>

      {/* 목록만 스크롤하고 저장 버튼은 아래에 남는다. 스크롤바(pix-hover-scroll, hover·focus·스크롤 때만 표시)는 패널
          오른쪽 바깥 6px에 두어 내용 폭이 Figma 433 그대로다. 아래쪽 페이드는 Figma 1069:10284(높이 72). */}
      <div className="relative flex min-h-0 flex-1">
        <div
          data-testid="n5-panel-body"
          className="pix-hover-scroll -mr-1.5 min-h-0 flex-1"
        >
          {/* 내용 폭 = panel 폭(clamp 변수) — 고정 px 가 아니라 panel 과 함께 줄고, 긴 글은 칸 안에서 줄바꿈한다 */}
          <div className="flex w-[var(--n5-panel-width)] min-w-0 flex-col gap-6 pb-[72px] break-words">
        {groups.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-center text-sm text-[#999]">
            표시할 텍스트 블록이 없습니다.
          </p>
        ) : (
          groups.map((group) => (
            <div
              key={group.sectionId}
              data-testid={`n5-panel-section-${group.sectionOrder}`}
              className="flex flex-col"
              ref={(el) => {
                if (el) sectionGroupRefs.current.set(group.sectionId, el);
                else sectionGroupRefs.current.delete(group.sectionId);
              }}
            >
              {/* 현재 section 표시 — 스크롤 영역 위에 붙고, 다음 section 그룹이 올라오면 자연스럽게 밀려난다(CSS sticky).
                  흰 바탕 pb-4는 붙어 있을 때 아래 내용과 떼어 두는 몫이며 펼친 상태의 간격(태그→상태 16, 태그→목록 28)은 그대로다 */}
              <div data-testid={`n5-section-tag-sticky-${group.sectionOrder}`} className="sticky top-0 z-10 flex bg-white pb-4">
                <SectionTag
                  sectionOrder={group.sectionOrder}
                  isSelected={group.sectionId === selectedSectionId}
                  onSelect={() => selectSectionFromPanel(group.sectionId)}
                />
              </div>
              {hasSectionStatus(sectionStatusById.get(group.sectionId)) && (
                <PanelSectionStatus
                  sectionOrder={group.sectionOrder}
                  status={sectionStatusById.get(group.sectionId) as SectionStatusViewModel}
                  trackedRerenderTaskIds={trackedRerenderTaskIds}
                />
              )}
              {/* 9/23 디테일 보정 — block 카드 사이 간격을 이전 gap-4(16px)에서
                  8px 늘려 gap-6(24px)으로 뒀다. block 내부(번호~번역근거)
                  간격을 줄인 것과 대비해, block과 block 사이는 더 뚜렷하게
                  분리되도록 한다(위 TranslationEditor/EvidenceSection
                  mt-3 참고). border/divider를 새로 넣지 않고 spacing만으로
                  구분한다. */}
              <ul
                className={`flex flex-col gap-6 ${hasSectionStatus(sectionStatusById.get(group.sectionId)) ? 'mt-7' : 'mt-3'}`}
              >
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
                    onSelect={() => selectBlockFromPanel(block)}
                    rowRef={(el) => {
                      if (el) blockRowRefs.current.set(block.id, el);
                      else blockRowRefs.current.delete(block.id);
                    }}
                    draftEntry={translationDrafts.get(block.id)}
                    onDraftUpdate={handleDraftUpdate}
                    taskFailures={blockTaskFailuresById.get(block.id) ?? NO_TASK_FAILURES}
                    editSession={editSession}
                    previewSection={previewSectionById.get(block.sectionId)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
          </div>
        </div>
        <div
          aria-hidden="true"
          data-testid="n5-panel-fade"
          className="pointer-events-none absolute right-0 bottom-0 left-0 h-[72px] bg-gradient-to-t from-white to-transparent"
        />
      </div>

      <div className="shrink-0 pt-[clamp(16px,3.7vh,40px)]">
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
        {!confirmError && !allSectionsExcluded && isCheckInProgress && (
          <p data-testid="n5-confirm-check-notice" className="mb-2 text-[12px] text-[#707070]">
            번역문 검사가 끝나면 저장할 수 있습니다.
          </p>
        )}
        {/* 저장하지 못한 번역문은 disabled 조건에 넣지 않는다(PM 확정) — 확인창으로만 알린다 */}
        <button
          ref={confirmButtonRef}
          type="button"
          data-testid="n5-confirm-button"
          disabled={isConfirmBlocked}
          title={
            allSectionsExcluded
              ? '모든 섹션이 제외되어 있어 확정할 수 없습니다.'
              : isCheckInProgress
                ? '번역문 검사가 끝나면 저장할 수 있습니다.'
                : undefined
          }
          onClick={() => void handleConfirmClick()}
          className="flex h-[45px] w-full items-center justify-center rounded-md bg-[#171717] px-8 text-[14px] font-medium tracking-[-0.42px] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {confirmMutation.isPending || isFinalizing ? '저장하는 중…' : '저장하러 가기'}
        </button>
      </div>
      {reviewIssues && (
        <ReviewIssuesDialog
          issues={reviewIssues}
          onCancel={closeReviewDialog}
          onContinue={handleReviewContinue}
          returnFocusRef={confirmButtonRef}
        />
      )}
    </div>
  );
}

/** 확인 항목이 이 개수 이상이면 목록을 5건 높이로 제한하고 목록만 스크롤한다 */
const N5_REVIEW_SCROLL_FROM = 6;
/** 묶음(section) 아래 여백 py-4 */
const N5_REVIEW_ROW_BOTTOM_GAP = 16;

/**
 * 저장 전 확인창(Figma 1313:12384, F-CFM-09). 폭 518, 최대 높이 710(낮은 화면은 화면 높이 − 32). 항목 1~5건은 내용에 맞추고(HUG), 6건 이상은 목록을 5건 높이로 제한해 목록만 스크롤한다. 동작은 useModalDialog(배경 inert, focus trap, Escape=돌아가기, 닫히면
 * [저장하러 가기]로 포커스 복귀)를 쓴다. 항목이 많으면 목록만 스크롤하고 버튼은 남는다. 저장하지 못한 번역문은 Figma에 없는
 * 묶음이라 같은 형식으로 더했다.
 */
function ReviewIssuesDialog({
  issues,
  onCancel,
  onContinue,
  returnFocusRef,
}: {
  issues: N5ReviewIssue[];
  onCancel: () => void;
  onContinue: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, { onClose: onCancel, returnFocusRef });
  const groups = groupN5ReviewIssues(issues);

  // 스크롤 기준은 높이가 아니라 전체 항목 수(issues.length)다 — 1~5건은 내용에 맞추고(HUG), 6건 이상이면 목록을 5번째 항목까지
  // 보이는 높이로 제한하고 목록만 스크롤한다. 묶음(group) 머리말 수에 따라 5건의 높이가 달라 실제로 그려진 5번째 항목의 아래 끝을 잰다.
  // 화면 값만 바꾸는 측정이라 state 로 두지 않고 목록 요소에 바로 쓴다.
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (issues.length < N5_REVIEW_SCROLL_FROM) {
      list.style.maxHeight = '';
      return;
    }
    const fifth = list.querySelectorAll<HTMLElement>('[data-review-issue]')[N5_REVIEW_SCROLL_FROM - 2];
    if (!fifth) return;
    // 5번째 항목 아래 끝 + 묶음 아래 여백(py-4) — 6번째 항목이 목록 아래에서 시작한다
    const height = fifth.getBoundingClientRect().bottom - list.getBoundingClientRect().top + list.scrollTop + N5_REVIEW_ROW_BOTTOM_GAP;
    list.style.maxHeight = `${Math.ceil(height)}px`;
  }, [issues]);

  return (
    <div data-testid="n5-review-dim" className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(23,23,23,0.4)]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="n5-review-title"
        aria-describedby="n5-review-description"
        tabIndex={-1}
        data-testid="n5-review-dialog"
        className="flex max-h-[min(710px,calc(100vh-32px))] w-[518px] max-w-[calc(100vw-32px)] flex-col gap-8 rounded-[8px] bg-white p-8 shadow-[0_8px_12px_rgba(0,0,0,0.08)] outline-none"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex shrink-0 flex-col items-center gap-1 text-center leading-[normal]">
            <h2 id="n5-review-title" className="text-[20px] leading-[24px] font-semibold tracking-[-0.02em] text-[#171717]">
              확인할 항목이 있습니다
            </h2>
            <p id="n5-review-description" className="text-[14px] leading-[17px] tracking-[-0.01em] text-[#707070]">
              해결되지 않은 항목이 남아 있습니다.
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <p className="flex shrink-0 items-center justify-end gap-1 leading-[normal]">
              <span className="text-[12px] tracking-[-0.02em] text-[#707070]">확인 필요</span>
              <span data-testid="n5-review-total" className="text-[14px] font-medium tracking-[-0.03em] text-[#171717]">
                {issues.length}건
              </span>
            </p>
            <div ref={listRef} data-testid="n5-review-list" className="pix-hover-scroll min-h-0 flex-1 border-t border-[#eaeaea]">
              {groups.map((group) => (
                <section
                  key={group.kind}
                  data-testid={`n5-review-group-${group.kind}`}
                  className="flex items-center justify-between gap-4 border-b border-[#eaeaea] py-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-col gap-3">
                    <h3 className={`text-[18px] leading-[normal] font-medium tracking-[-0.03em] ${group.isWarning ? 'text-[#ff6a38]' : 'text-[#171717]'}`}>
                      {group.title}
                    </h3>
                    {group.issues.map((issue, i) => (
                      <div key={`${issue.sectionId}-${issue.blockId ?? issue.stageLabel}-${i}`} data-review-issue className="flex items-center gap-3">
                        <span aria-hidden="true" className={`size-[5px] shrink-0 rounded-full ${group.isWarning ? 'bg-[#ff6a38]' : 'bg-[#707070]'}`} />
                        <div className="flex min-w-0 flex-col gap-0.5 leading-[normal] text-[#707070]">
                          <p className="text-[14px] tracking-[-0.01em]">{formatN5ReviewIssueLocation(issue)}</p>
                          <p className="text-[12px] tracking-[-0.02em]">{issue.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p data-testid={`n5-review-count-${group.kind}`} className="shrink-0 text-[18px] leading-[normal] font-medium tracking-[-0.03em] text-[#171717]">
                    {group.issues.length}건
                  </p>
                </section>
              ))}
            </div>
          </div>

          <p className="shrink-0 bg-[#f5f5f5] p-4 text-center text-[12px] leading-[14px] tracking-[-0.02em] text-[#707070]">
            확인하고 저장하면 그대로 최종 렌더링 단계로 이동합니다.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            data-testid="n5-review-cancel"
            className="flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white"
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.03em] whitespace-nowrap text-[#171717]">돌아가서 확인</span>
          </button>
          <button
            type="button"
            onClick={onContinue}
            data-testid="n5-review-continue"
            className="flex h-[45px] min-w-0 flex-1 items-center justify-center rounded-[6px] bg-[#171717]"
          >
            <span className="px-3 text-[14px] leading-[17px] font-medium tracking-[-0.03em] whitespace-nowrap text-white">확인하고 저장</span>
          </button>
        </div>
      </div>
    </div>
  );
}
