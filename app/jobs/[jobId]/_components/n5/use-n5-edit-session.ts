'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/lib/api/pixlate';
import type { ApiLayoutAdjustPatch, ApiTextBlock } from '@/lib/api/n5-schema';
import type { BoundingBox } from '@/lib/api/types';
import {
  canRestoreSectionInN5,
  getBaseFontScale,
  getRerenderTaskId,
  getTranslatedBaseBox,
  getRevisionConflictLatestBlock,
  isRevisionConflict,
  parseApiError,
  type BlockViewModel,
  type PreviewSectionViewModel,
} from '@/lib/n5/adapter';
import { resolveTranslationSaveFailed, resolveTranslationSaveSucceeded, updateTranslationDrafts, type TranslationDraft } from '@/lib/n5/failed-drafts';
import {
  canRedo,
  canStartSave,
  canUndo,
  INITIAL_N5_EDIT_SESSION,
  peekRedo,
  peekUndo,
  reduceN5EditSession,
  type N5EditCommand,
  type N5EditEvent,
  type N5EditSession,
} from '@/lib/n5/history';
import { fitBoxToTextHeight, isSameBox, pruneBlockDrafts, stepFontScale, type N5FontScaleValue } from '@/lib/n5/layout-edit';
import {
  isLayoutRenderTarget,
  toLayoutBox,
} from '@/lib/n5/layout-adjust';
import { createIdempotencyKey } from '@/lib/api/idempotency';
import { openTypesetMeasurer, type TypesetMeasurer } from '@/lib/n5/typeset-measurement';
import { isTypesetRole } from '@/lib/n5/typeset-rules';
import {
  judgeUncertainSave,
  nextUncertainSaveStatus,
  type UncertainRefetchResult,
  type UncertainSaveCheck,
  type UncertainSaveOutcome,
} from '@/lib/n5/uncertain-save';
import type { TypesetFontGate } from './use-typeset-font-gate';
import type { N5SaveNotice } from '@/lib/n5/messages';
import type { N5ViewMode } from '@/lib/n5/viewport';
import { pixlateKeys, usePatchN5BlockMutation, useUpdateSectionBucketMutation } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// N5 편집 세션(F-CFM-03) — N5Loaded 하나가 소유하고 캔버스(N5Viewport)와 패널(N5Panel)이 함께 쓴다.
// 이력 계산은 lib/n5/history.ts 를 그대로 쓰고, 여기서는 실제 저장·화면 값 적용만 맡는다.
// 값은 이 화면의 메모리에만 있다. N5 를 벗어나거나 새로고침하면 사라진다.
//
// 저장 위치
// - 번역문·섹션 제외·되돌리기: 기존 PATCH. 성공한 뒤에만 이력·pointer 가 움직인다.
// - 박스 위치·크기·글자 배율·높이(F-CFM-15 layoutAdjust): 조작 중·조작 뒤 모두 세션 local 초안만 바꾼다(PATCH·재렌더 task 없음).
//   조작한 블록은 「배치 미저장」으로 표시해 두고, [저장하러 가기](N5 최종 저장)에서 saveBlockForConfirm 이 같은 PATCH 경로로 저장한다
//   — 실 API·Mock 동일. 같은 블록의 번역 초안과 함께 바뀌었으면 한 요청(trans1 + layoutAdjust, revision 1회)으로 보낸다.
//   실행 취소·다시 실행도 local 초안만 바꾼다. 저장이 실패하면 확정하지 않고 local 초안을 그대로 둔다.
//   초안이 없으면 renderInput 적용값 > /blocks layoutAdjust > 원본 bbox 가 기준이다(getTranslatedBaseBox·getBaseFontScale).
//
// Auto Height — 폭·글자 배율·번역문이 바뀌면 조판 규칙대로 다시 줄바꿈한 높이로 박스를 맞춘다(Figma Text의 Auto height).
// renderInput 이 연결된 블록은 표시와 같은 서버 style 8키로 잰다(역할 기본값으로 다시 재지 않는다). 그 글꼴이 준비되지 않았으면
// 재지 않는다. 연결이 없는 블록(Mock·QA·이전 계약 응답)은 역할 기본값으로 잰다.
// 잴 수 없는 블록(글이 비었거나 조판 역할이 아니거나 폰트가 준비되지 않음)은 기존 자유 크기 조절을 쓴다.
//
// 잠금
// - 서버 실행 취소·다시 실행이 진행 중이면(session.inFlight) 새 편집·실행 취소·다시 실행을 시작하지 않는다.
// - 일반 저장은 기존 정책대로 섹션·블록마다 따로 진행할 수 있어 개수(pendingEdits)로 센다. 하나라도 남아 있으면
//   실행 취소·다시 실행을 시작하지 않는다.
// - 같은 tick 의 연속 입력도 막도록 세션과 개수는 ref 를 정본으로 읽는다.
// ─────────────────────────────────────────────────────────────────

type SectionBucket = 'include' | 'exclude';
type HistoryDirection = 'undo' | 'redo';
/** 번역문 이력 값 — 글과 그때의 박스 초안(없으면 서버 박스). FE 내부 값이며 API DTO 가 아니다 */
interface N5TranslationValue {
  text: string;
  bbox: BoundingBox | null;
}

/** 응답을 받지 못한 저장 뒤 서버 상태를 다시 받는 한 번의 기다림 상한(ms) — FE 구현값. 넘으면 「확인하지 못함」으로 두고 잠금은 유지한다 */
const N5_UNCERTAIN_SAVE_RECONCILE_LIMIT_MS = 15_000;

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * 미리보기 재렌더 task 를 만든 저장의 이유.
 * - translation: 번역문 [확인] · [저장하러 가기]의 초안 저장 — 번역문 칸에 「재렌더링 중…」(저장 + 재검사)을 보인다
 * - layout: 박스 이동·크기·글자 배율 — 미리보기만 백그라운드로 다시 만든다(번역문 칸 안내 없음)
 * - history: 실행 취소·다시 실행이 다시 저장한 값 — 번역문 칸 안내 없음
 */
export type N5RerenderReason = 'translation' | 'layout' | 'history';
export interface N5RerenderTask {
  taskId: number | null;
  reason: N5RerenderReason;
}

export interface N5EditSessionApi {
  /** 응답을 받지 못한 저장의 결과를 서버에서 확인하는 중(checking) · 확인하지 못함(unconfirmed). 없으면 null — 있는 동안 편집이 잠긴다 */
  uncertainSave: { status: 'checking' | 'unconfirmed' } | null;
  /** [서버 상태 다시 확인] */
  retryServerCheck: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  notice: N5SaveNotice | null;
  /** 서버 실행 취소·다시 실행 진행 중이거나 [저장하러 가기] 최종 저장 중 — 새 편집을 시작하지 않는다 */
  isEditLocked: boolean;
  /**
   * [저장하러 가기] 최종 저장 잠금. 잠긴 동안 사용자 편집(번역 입력·[확인]·박스 이동/크기·글자 배율·실행 취소/다시 실행·섹션 제외/복원)은
   * handler 에서 무시한다 — 저장 대상을 정한 뒤 생긴 local 수정이 confirm 에서 조용히 빠지지 않게 한다. 이미 있던 초안은 그대로 저장한다.
   * 이미 잠겨 있으면 false
   */
  /** 최종 저장 잠금 중(화면 표시용). handler 는 isFinalizationLocked() 로 같은 tick 값을 읽는다 */
  isFinalizing: boolean;
  beginFinalizationLock: () => boolean;
  endFinalizationLock: () => void;
  isFinalizationLocked: () => boolean;

  /** 사용자가 직접 만든 박스(이동·크기·글자 배율·번역 저장으로 생긴 local 초안). Auto Height 표시값은 들어 있지 않다 */
  bboxDrafts: ReadonlyMap<number, BoundingBox>;
  /** 「번역 후」 화면에 그릴 박스 — 사용자 초안 > Auto Height 표시 박스. 둘 다 없으면 서버 박스(getTranslatedBaseBox)를 쓴다 */
  layoutBoxes: ReadonlyMap<number, BoundingBox>;
  /** 끄는 동안의 화면 박스. 서버 박스·Auto Height 표시 박스와 같으면 사용자 초안으로 남기지 않는다 */
  setBboxDraft: (blockId: number, next: BoundingBox) => void;
  /** manualHeight = 이 조작에서 사용자가 세로 높이를 직접 정했다(n·s 손잡이·세로로 끈 모서리) — 그 block 은 Auto Height 를 끈다 */
  commitBoxEdit: (kind: 'box-move' | 'box-resize', blockId: number, before: BoundingBox, after: BoundingBox, manualHeight?: boolean) => void;
  /** 사용자가 높이를 직접 정한 block — Auto Height 가 그 높이를 덮지 않는다(이동·가로 조절·재조회·글꼴 로딩·번역 저장 모두) */
  manualHeightIds: ReadonlySet<number>;
  /** 이 박스·배율에서 조판이 요구하는 높이로 맞춘 결과. 잴 수 없으면 null — 그 블록은 자유 크기 조절을 쓴다 */
  fitAutoHeight: (block: BlockViewModel, box: BoundingBox) => { box: BoundingBox; overflow: boolean } | null;
  /** blockId → 절대 글자 배율 초안. 항목이 없으면 저장 입력의 fontScale(getBaseFontScale) 이다 — 저장하지 않는다 */
  fontScaleDrafts: ReadonlyMap<number, number>;
  /** [+][-] 한 번 — 박스와 배율을 함께 바꾸고 이력 1단계를 남긴다 */
  changeFontScale: (block: BlockViewModel, direction: 'increase' | 'decrease') => void;
  /** 박스를 끄는 동안에는 실행 취소·다시 실행을 시작하지 않는다 */
  setLayoutDragging: (dragging: boolean) => void;

  pendingSectionIds: ReadonlySet<number>;
  failedSectionId: number | null;
  saveSectionBucket: (sectionId: number, bucket: SectionBucket) => void;

  translationDrafts: ReadonlyMap<number, TranslationDraft>;
  updateTranslationDraft: (
    blockId: number,
    update: (prev: TranslationDraft | undefined) => TranslationDraft | undefined,
  ) => void;
  /**
   * 블록별 마지막 서버 저장이 만든 미리보기 재렌더 task 와 그 이유. task 는 이유와 상관없이 추적한다(완료 뒤 재조회 · [저장하러 가기]
   * 최신 미리보기 장벽). 「재렌더링 중…」 안내는 번역문 [확인] 저장(reason 'translation')에만 보인다.
   */
  rerenderTaskByBlock: ReadonlyMap<number, N5RerenderTask>;
  setRerenderTask: (blockId: number, taskId: number | null, reason: N5RerenderReason) => void;
  /** 실행 취소·다시 실행이 409 로 막힌 블록의 서버 최신값. 편집기의 기존 충돌 표시로 보여 준다 */
  historyConflicts: ReadonlyMap<number, ApiTextBlock>;
  clearHistoryConflict: (blockId: number) => void;
  /** 번역문 저장을 시작해도 되면 true 를 돌려주고 진행 중으로 센다. 끝나면 endServerEdit 을 부른다 */
  beginServerEdit: () => boolean;
  endServerEdit: () => void;
  commitTranslation: (blockId: number, before: string, after: string) => void;
  /** 서버 저장(번역문·섹션·배치)이나 서버 실행 취소·다시 실행이 진행 중 — N5 확정(confirm) 전에 모두 끝나야 한다 */
  hasPendingServerEdits: boolean;
  /** 같은 값을 ref 로 바로 읽는다(같은 tick 의 연속 클릭·강제 이벤트 방어용) */
  isServerEditPending: () => boolean;
  /** 저장하지 않은 수정(서버값과 다른 번역 초안 · 배치 미저장)이 있는 블록 — 화면 블록 순서 */
  listUnsavedBlockIds: () => number[];
  /** 배치 초안만(확정 전 저장 대상) */
  listUnsavedLayoutBlockIds: () => number[];
  /** 저장하지 않은 번역문 초안만(확정 때 저장하지 않는다 — 확인창 「저장되지 않은 번역문」) */
  listUnsavedTranslationBlockIds: () => number[];
  /**
   * [저장하러 가기] 한 블록 저장 — 번역 초안만이면 saveTranslation, 배치만이면 PATCH { trans1(서버 현재 값), revision, layoutAdjust },
   * 둘 다면 PATCH { trans1(초안), revision, layoutAdjust } 한 번. 이미 [확인]으로 저장한 번역문은 다시 보내지 않는다.
   * 실패하면 local 초안(번역문·배치)을 그대로 둔다.
   */
  saveBlockForConfirm: (blockId: number) => Promise<TranslationSaveResult>;
  /**
   * 번역문 한 칸 저장 — PATCH { trans1, revision(실행 시점 최신) }. 칸의 [확인]과 [저장하러 가기]의 미저장 초안 저장이 같은 경로를 쓴다.
   * 성공하면 초안 정리·재렌더 task 기록·이력 1단계, 실패하면 초안을 남기고 실패 표시(409 는 충돌 최신값).
   * 다른 서버 저장이 진행 중이면 시작하지 않는다(started=false).
   */
  saveTranslation: (blockId: number, text: string) => Promise<TranslationSaveResult>;
}

export type TranslationSaveResult =
  | { started: false }
  | { started: true; ok: true; revision: number | null; rerenderTaskId: number | null; /** 서버 정본(PATCH 응답 block). 보낼 것이 없어 PATCH 하지 않았으면 null */ block: ApiTextBlock | null }
  | { started: true; ok: false; conflict: ApiTextBlock | null; error: unknown };

export function useN5EditSession({
  jobId,
  blocks,
  sections,
  viewMode,
  isFontReady,
  onSelectBlock,
  onSelectSection,
  onSectionExcluded,
}: {
  jobId: string;
  blocks: BlockViewModel[];
  sections: PreviewSectionViewModel[];
  viewMode: N5ViewMode;
  /** 서버 style 글꼴 준비 여부 */
  isFontReady: TypesetFontGate;
  onSelectBlock: (block: BlockViewModel) => void;
  onSelectSection: (sectionId: number) => void;
  onSectionExcluded: (sectionId: number) => void;
}): N5EditSessionApi {
  const queryClient = useQueryClient();
  const { mutateAsync: patchBlock } = usePatchN5BlockMutation(jobId);
  const { mutateAsync: patchSectionBucket } = useUpdateSectionBucketMutation(jobId);

  const [session, setSession] = useState<N5EditSession>(INITIAL_N5_EDIT_SESSION);
  const sessionRef = useRef(session);
  const dispatch = useCallback((event: N5EditEvent) => {
    sessionRef.current = reduceN5EditSession(sessionRef.current, event);
    setSession(sessionRef.current);
  }, []);

  const [pendingEdits, setPendingEdits] = useState(0);
  const pendingEditsRef = useRef(0);
  const beginServerEdit = useCallback(() => {
    if (!canStartSave(sessionRef.current)) return false;
    pendingEditsRef.current += 1;
    setPendingEdits(pendingEditsRef.current);
    return true;
  }, []);
  const endServerEdit = useCallback(() => {
    pendingEditsRef.current -= 1;
    setPendingEdits(pendingEditsRef.current);
  }, []);

  // ── 응답을 받지 못한 저장(F-CFM-03) ─ 서버가 이미 반영했을 수 있다(네트워크 끊김·시간 초과 — ApiRequestError 가 아니다).
  // 서버 상태(/blocks · /preview)를 다시 받아 결과를 확인할 때까지 호출부의 저장 흐름이 끝나지 않는다 — 그동안 호출부가 잡은 저장 잠금
  // (pendingEdits · inFlight)이 그대로라 추가 저장·확정·실행 취소·다시 실행·섹션 제외가 시작되지 않는다.
  // 다시 받기는 한 번에 상한(N5_UNCERTAIN_SAVE_RECONCILE_LIMIT_MS)까지만 기다린다. 넘거나 실패하면 「확인하지 못함」으로 두고 잠금은 풀지 않는다 —
  // 사용자가 [서버 상태 다시 확인](retryServerCheck)으로 다시 받는다. 확인되면 judgeUncertainSave 로 반영 여부를 정해 호출부가 초안·이력을 맞춘다.
  // HTTP 응답이 있는 실패(409·4xx·5xx)는 결과가 분명하므로 여기서 기다리지 않는다(null)
  const [uncertainSave, setUncertainSave] = useState<{ status: 'checking' | 'unconfirmed' } | null>(null);
  const uncertainRetryRef = useRef<(() => void) | null>(null);

  const refetchServerState = useCallback(async (): Promise<UncertainRefetchResult> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<UncertainRefetchResult>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), N5_UNCERTAIN_SAVE_RECONCILE_LIMIT_MS);
    });
    const work = Promise.all([
      queryClient.refetchQueries({ queryKey: pixlateKeys.n5Blocks(jobId), exact: true, type: 'all' }, { throwOnError: true }),
      queryClient.refetchQueries({ queryKey: pixlateKeys.n5Preview(jobId), exact: true, type: 'all' }, { throwOnError: true }),
    ]).then(
      (): UncertainRefetchResult => 'ok',
      (): UncertainRefetchResult => 'failed',
    );
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }, [jobId, queryClient]);

  const resolveUncertainSave = useCallback(
    async (err: unknown, check: UncertainSaveCheck | null): Promise<UncertainSaveOutcome | null> => {
      if (err instanceof ApiRequestError) return null;
      for (;;) {
        setUncertainSave({ status: 'checking' });
        if (nextUncertainSaveStatus(await refetchServerState()) === 'confirmed') break;
        // 확인하지 못했다 — 잠금은 그대로 두고 사용자가 다시 확인을 누를 때까지 기다린다
        setUncertainSave({ status: 'unconfirmed' });
        await new Promise<void>((resolve) => {
          uncertainRetryRef.current = resolve;
        });
      }
      uncertainRetryRef.current = null;
      setUncertainSave(null);
      if (!check) return 'not-applied';
      const preview = queryClient.getQueryData<{ sections?: { id?: number | null; bucket?: string | null }[] }>(pixlateKeys.n5Preview(jobId));
      return judgeUncertainSave(check, {
        blocks: queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId)) ?? [],
        sections: preview?.sections ?? [],
      });
    },
    [jobId, queryClient, refetchServerState],
  );

  /** [서버 상태 다시 확인] — 확인하지 못한 저장의 결과를 다시 받는다(잠금은 확인될 때까지 그대로) */
  const retryServerCheck = useCallback(() => {
    const resume = uncertainRetryRef.current;
    uncertainRetryRef.current = null;
    resume?.();
  }, []);

  // [저장하러 가기] 최종 저장 잠금 — 사용자 편집 handler 가 같은 tick 에도 바로 읽도록 ref 로 둔다(UI disabled 만 믿지 않는다)
  const finalizingRef = useRef(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const beginFinalizationLock = useCallback(() => {
    if (finalizingRef.current) return false;
    finalizingRef.current = true;
    setIsFinalizing(true);
    return true;
  }, []);
  const endFinalizationLock = useCallback(() => {
    finalizingRef.current = false;
    setIsFinalizing(false);
  }, []);
  const isFinalizationLocked = useCallback(() => finalizingRef.current, []);


  // ── 박스·글자 배율 local 초안 ─ 재조회·보기 전환으로 지우지 않는다. 서버에서 블록·섹션이 사라지면 그 초안만 정리한다
  const [bboxDrafts, setBboxDrafts] = useState<ReadonlyMap<number, BoundingBox>>(() => new Map());
  const [fontScaleDrafts, setFontScaleDrafts] = useState<ReadonlyMap<number, number>>(() => new Map());
  // 사용자가 세로 높이를 직접 정한 block(세션 local). 이동·가로 조절은 이 상태를 바꾸지 않는다
  const [manualHeightIds, setManualHeightIds] = useState<ReadonlySet<number>>(() => new Set());
  const manualHeightRef = useRef<ReadonlySet<number>>(manualHeightIds);
  const setManualHeight = useCallback((blockId: number, manual: boolean) => {
    const current = manualHeightRef.current;
    if (current.has(blockId) === manual) return;
    const next = new Set(current);
    if (manual) next.add(blockId);
    else next.delete(blockId);
    manualHeightRef.current = next;
    setManualHeightIds(next);
  }, []);
  /** 박스 조작 이력마다 조작 전·후의 manual height 여부 — 실행 취소·다시 실행이 숫자 박스와 함께 이 상태도 되돌린다 */
  const manualHeightByCommandRef = useRef(new WeakMap<N5EditCommand, { before: boolean; after: boolean }>());
  if (bboxDrafts.size > 0 || fontScaleDrafts.size > 0) {
    const sectionIds = new Set(sections.map((section) => section.id));
    const validBlockIds = new Set(blocks.filter((block) => sectionIds.has(block.sectionId)).map((block) => block.id));
    let prunedBoxes = pruneBlockDrafts(bboxDrafts, validBlockIds);
    // 서버 박스와 같아진 사용자 박스(저장된 배치가 재조회로 서버 박스가 됨·원본으로 되돌림)는 초안이 아니다 — 지워서 그 위에
    // Auto Height 표시가 다시 적용되게 한다. 이력의 「조작 전」 값(논리 배치)도 그래야 서버 박스가 된다
    for (const block of blocks) {
      const draft = prunedBoxes.get(block.id);
      const base = draft ? getTranslatedBaseBox(block) : null;
      if (draft && base && isSameBox(draft, base)) {
        const next = new Map(prunedBoxes);
        next.delete(block.id);
        prunedBoxes = next;
      }
    }
    if (prunedBoxes !== bboxDrafts) setBboxDrafts(prunedBoxes);
    const prunedScales = pruneBlockDrafts(fontScaleDrafts, validBlockIds);
    if (prunedScales !== fontScaleDrafts) setFontScaleDrafts(prunedScales);
  }
  const [translationDrafts, setTranslationDrafts] = useState<ReadonlyMap<number, TranslationDraft>>(() => new Map());
  // 저장 응답을 기다린 뒤에도 최신 화면 값을 보도록 ref 로 읽는다
  const latestRef = useRef({ blocks, sections, translationDrafts, bboxDrafts, fontScaleDrafts, onSelectBlock, onSelectSection });
  useEffect(() => {
    latestRef.current = { blocks, sections, translationDrafts, bboxDrafts, fontScaleDrafts, onSelectBlock, onSelectSection };
  });

  const layoutDraggingRef = useRef(false);
  /** 끌기 시작 순간의 사용자 초안·높이 모드 — 손을 놓을 때 이력의 「조작 전」(논리 박스·모드)으로 쓴다(끄는 동안 초안이 바뀐다) */
  const dragStartRef = useRef<{ drafts: ReadonlyMap<number, BoundingBox>; manual: ReadonlySet<number> } | null>(null);
  const setLayoutDragging = useCallback((dragging: boolean) => {
    if (dragging && finalizingRef.current) return;
    if (dragging && !layoutDraggingRef.current) dragStartRef.current = { drafts: latestRef.current.bboxDrafts, manual: manualHeightRef.current };
    layoutDraggingRef.current = dragging;
  }, []);

  // 측정기는 세션 동안 하나만 연다(폰트 확인·DOM 생성은 한 번). 폰트가 늦게 오면 로딩이 끝날 때 다시 시도한다
  const [measurer, setMeasurer] = useState<TypesetMeasurer | null>(null);
  useEffect(() => {
    let cancelled = false;
    let opened: TypesetMeasurer | null = null;
    const tryOpen = async () => {
      const result = await openTypesetMeasurer();
      if (!result.ok) return;
      if (cancelled || opened) {
        if (result.measurer !== opened) result.measurer.dispose();
        return;
      }
      opened = result.measurer;
      setMeasurer(opened);
      document.fonts.removeEventListener('loadingdone', tryOpen);
    };
    document.fonts.addEventListener('loadingdone', tryOpen);
    void tryOpen();
    return () => {
      cancelled = true;
      document.fonts.removeEventListener('loadingdone', tryOpen);
      opened?.dispose();
    };
  }, []);

  /** 주어진 글·박스·배율로 Auto Height 를 계산한다. 잴 수 없으면 null */
  const fitForText = useCallback(
    (block: BlockViewModel, text: string, box: BoundingBox, fontScale: number, section: PreviewSectionViewModel | undefined) => {
      const serverStyle = block.renderBinding?.style ?? null;
      if (!measurer || !section || !isTypesetRole(block.role)) return null;
      if (serverStyle && !isFontReady(serverStyle)) return null;
      const needed = measurer.measureTextHeight({
        text,
        role: block.role,
        sourceImageWidth: section.width,
        userFontScale: fontScale,
        bbox: box,
        textAlign: block.textAlign,
        serverStyle,
      });
      return needed === null ? null : fitBoxToTextHeight(box, needed, section);
    },
    [measurer, isFontReady],
  );

  const fitAutoHeight = useCallback(
    (block: BlockViewModel, box: BoundingBox) =>
      fitForText(
        block,
        translationDrafts.get(block.id)?.draft ?? block.translatedText,
        box,
        fontScaleDrafts.get(block.id) ?? getBaseFontScale(block),
        sections.find((section) => section.id === block.sectionId),
      ),
    [fitForText, fontScaleDrafts, sections, translationDrafts],
  );

  // ── Auto Height · 높이 모드 ─ block 마다 개념상 세 박스가 있다:
  //   ① 서버 기준 박스 getTranslatedBaseBox(renderInput 적용 > 저장 layoutAdjust > 원본) — FE 가 바꾸지 않는다
  //   ② 사용자 배치 초안 bboxDrafts — 사용자가 실제로 박스를 조작했을 때만 있다(이동·가로·세로·글자 배율)
  //   ③ Auto Height 표시 박스 autoFitBoxes — 논리 박스(② ?? ①)의 x·y·폭에서 지금 글·배율·서버 style 로 잰 높이(파생값)
  // 높이 모드는 manualHeightIds 로 따로 둔다(없으면 auto). 사용자 배치가 있어도 auto 면 Auto Height 를 계속 적용하고,
  // 세로를 직접 정한 block(manual)만 논리 박스를 그대로 그린다. ③ 은 이력·commitBoxEdit·PATCH·revision 을 만들지 않는다.
  // 측정은 편집 중 선택 block 의 fitAutoHeight 와 같이 렌더 중에 한다(측정기는 이미 열린 숨은 DOM 이라 화면을 바꾸지 않는다).
  // 측정기·서버 글꼴이 준비되지 않았으면(fitForText null) 논리 박스를 그대로 두고, 준비 뒤 다시 잰다.
  const autoFitBoxes = useMemo(() => {
    const boxes = new Map<number, BoundingBox>();
    if (viewMode !== 'translated' || !measurer) return boxes;
    for (const block of blocks) {
      if (manualHeightIds.has(block.id)) continue; // 사용자가 높이를 정했다
      const section = sections.find((candidate) => candidate.id === block.sectionId);
      if (!section || section.bucket === 'exclude' || !block.editable) continue;
      const logical = bboxDrafts.get(block.id) ?? getTranslatedBaseBox(block);
      const text = translationDrafts.get(block.id)?.draft ?? block.translatedText;
      if (!logical || text.trim() === '') continue;
      // 역할·측정기·서버 글꼴 준비 판정은 fitForText 가 한다. 못 재면 논리 박스를 그대로 둔다
      const fitted = fitForText(block, text, logical, fontScaleDrafts.get(block.id) ?? getBaseFontScale(block), section);
      if (fitted && fitted.box !== logical) boxes.set(block.id, fitted.box);
    }
    return boxes;
  }, [viewMode, measurer, blocks, sections, bboxDrafts, manualHeightIds, fontScaleDrafts, translationDrafts, fitForText]);

  /** 「번역 후」 화면 박스 = manual ? 논리 박스 : Auto Height(논리 박스). 항목이 없으면 서버 기준 박스다 */
  const layoutBoxes = useMemo(() => {
    if (bboxDrafts.size === 0) return autoFitBoxes;
    const merged = new Map(bboxDrafts);
    for (const [id, box] of autoFitBoxes) merged.set(id, box);
    return merged;
  }, [autoFitBoxes, bboxDrafts]);
  const autoFitBoxesRef = useRef(autoFitBoxes);
  useEffect(() => {
    autoFitBoxesRef.current = autoFitBoxes;
  });

  /** 사용자 조작 전의 논리 배치 — 사용자 초안이 없으면 서버 박스·배율이다(Auto Height 표시 박스가 아니다) */
  const logicalLayoutOf = useCallback((blockId: number): { bbox: BoundingBox; fontScale: number } | null => {
    const { blocks: latestBlocks, bboxDrafts: boxes, fontScaleDrafts: scales } = latestRef.current;
    const block = latestBlocks.find((candidate) => candidate.id === blockId);
    if (!block) return null;
    const bbox = boxes.get(blockId) ?? getTranslatedBaseBox(block);
    return bbox ? { bbox, fontScale: scales.get(blockId) ?? getBaseFontScale(block) } : null;
  }, []);

  /**
   * 박스 위치·크기·글자 배율을 조정할 수 있는 블록 — 읽기 전용(editable=false, 번역 제외)은 조정하지 않는다.
   * 화면에서 조정 UI 를 숨기는 것과 별개로 handler 에서도 막는다(박스·배율 초안·배치 미저장·이력을 만들지 않는다)
   */
  const isLayoutEditableBlock = useCallback(
    (blockId: number) => latestRef.current.blocks.find((candidate) => candidate.id === blockId)?.editable === true,
    [],
  );

  /** 사용자 박스 초안을 바꾼다. 서버 박스와 같으면(논리적으로 조정 없음) 초안을 지워 Auto Height 표시로 돌아간다 */
  const setUserBox = useCallback((blockId: number, next: BoundingBox) => {
    const block = latestRef.current.blocks.find((candidate) => candidate.id === blockId);
    const base = block ? getTranslatedBaseBox(block) : null;
    setBboxDrafts((drafts) => {
      if (base && isSameBox(base, next)) {
        if (!drafts.has(blockId)) return drafts;
        const pruned = new Map(drafts);
        pruned.delete(blockId);
        return pruned;
      }
      return new Map(drafts).set(blockId, next);
    });
  }, []);
  /** 끄는 동안의 화면 박스 — Auto Height 표시 박스와 같으면 사용자 초안을 만들지 않는다 */
  const setDragBox = useCallback(
    (blockId: number, next: BoundingBox) => {
      if (finalizingRef.current || !isLayoutEditableBlock(blockId)) return;
      const auto = autoFitBoxesRef.current.get(blockId);
      if (auto && isSameBox(auto, next) && !latestRef.current.bboxDrafts.has(blockId)) return;
      setUserBox(blockId, next);
    },
    [isLayoutEditableBlock, setUserBox],
  );

  // ── 번역문 ─ 초안·재렌더 task·충돌을 여기 두어 패널의 저장과 실행 취소가 같은 값을 본다
  const updateTranslationDraft = useCallback(
    (blockId: number, update: (prev: TranslationDraft | undefined) => TranslationDraft | undefined) => {
      setTranslationDrafts((drafts) => updateTranslationDrafts(drafts, blockId, update));
    },
    [],
  );
  /** 사용자 입력 경로 — 최종 저장 중에는 새 초안을 만들지 않는다(저장 결과 반영은 위 updateTranslationDraft 를 쓴다) */
  const updateTranslationDraftByUser = useCallback(
    (blockId: number, update: (prev: TranslationDraft | undefined) => TranslationDraft | undefined) => {
      if (finalizingRef.current) return;
      updateTranslationDraft(blockId, update);
    },
    [updateTranslationDraft],
  );
  // 사용자 편집(초안) · 서버 저장(PATCH 진행 중 = pendingEdits) · 미리보기 재렌더(이 task)는 서로 다른 상태다
  const [rerenderTaskByBlock, setRerenderTaskByBlock] = useState<ReadonlyMap<number, N5RerenderTask>>(() => new Map());
  const setRerenderTask = useCallback((blockId: number, taskId: number | null, reason: N5RerenderReason) => {
    setRerenderTaskByBlock((tasks) => new Map(tasks).set(blockId, { taskId, reason }));
  }, []);
  const [historyConflicts, setHistoryConflicts] = useState<ReadonlyMap<number, ApiTextBlock>>(() => new Map());
  const clearHistoryConflict = useCallback((blockId: number) => {
    setHistoryConflicts((conflicts) => {
      if (!conflicts.has(blockId)) return conflicts;
      const next = new Map(conflicts);
      next.delete(blockId);
      return next;
    });
  }, []);
  // ── 배치(layoutAdjust) ─ 조작은 local 초안만. 서버 저장은 [저장하러 가기]에서 한 번(saveBlockForConfirm) ──
  /** 배치를 조작했지만 아직 서버에 저장하지 않은 블록 */
  const layoutDirtyRef = useRef(new Set<number>());
  const setLayoutDirty = useCallback((blockId: number, dirty: boolean) => {
    if (dirty) layoutDirtyRef.current.add(blockId);
    else layoutDirtyRef.current.delete(blockId);
  }, []);

  /**
   * 저장할 배치 — 사용자 박스 초안(box)·배율 초안(fontScale) 중 있는 것만. 초안이 서버 값과 같아 지워졌으면 그 키는 싣지 않는다(서버 값 유지).
   * 렌더 대상이 아닌 블록(라벨·로고·빈 원문·빈 번역문 — 409 not_render_target)은 보내지 않는다.
   */
  const pendingLayoutPatch = useCallback((blockId: number): ApiLayoutAdjustPatch | null => {
    if (!layoutDirtyRef.current.has(blockId)) return null;
    const { blocks: latestBlocks, bboxDrafts: boxes, fontScaleDrafts: scales } = latestRef.current;
    const block = latestBlocks.find((candidate) => candidate.id === blockId);
    if (!block || !isLayoutRenderTarget(block)) return null;
    const patch: ApiLayoutAdjustPatch = {};
    const box = boxes.get(blockId);
    if (box) patch.box = toLayoutBox(box);
    const fontScale = scales.get(blockId);
    if (fontScale !== undefined) patch.fontScale = fontScale;
    return Object.keys(patch).length > 0 ? patch : null;
  }, []);

  /** 배치 값을 화면에 둔다. 서버 박스·배율과 같으면(조정 없음) 사용자 초안을 지운다 — 그때는 Auto Height 표시 박스가 보인다 */
  const applyLayoutDraft = useCallback(
    (blockId: number, value: { bbox: BoundingBox; fontScale?: number }) => {
      const { fontScale } = value;
      const block = latestRef.current.blocks.find((candidate) => candidate.id === blockId);
      if (fontScale !== undefined && block && fontScale === getBaseFontScale(block)) {
        setFontScaleDrafts((drafts) => {
          if (!drafts.has(blockId)) return drafts;
          const next = new Map(drafts);
          next.delete(blockId);
          return next;
        });
      } else if (fontScale !== undefined) {
        setFontScaleDrafts((drafts) => new Map(drafts).set(blockId, fontScale));
      }
      setUserBox(blockId, value.bbox);
    },
    [setUserBox],
  );

  const commitBoxEdit = useCallback(
    (kind: 'box-move' | 'box-resize', blockId: number, before: BoundingBox, after: BoundingBox, manualHeight = false) => {
      if (isSameBox(before, after) || finalizingRef.current || !isLayoutEditableBlock(blockId)) return;
      // 높이 모드 — 세로를 직접 정한 조작이면 manual 로, 이미 manual 이면 이동·가로 조절에도 유지한다(이동·가로는 auto 를 유지)
      const start = dragStartRef.current;
      const wasManual = (start?.manual ?? manualHeightRef.current).has(blockId);
      const isManual = wasManual || manualHeight;
      // 이력의 이전 값은 화면 박스가 아니라 끌기 시작 때의 논리 박스(사용자 초안 ?? 서버 박스)다 — 실행 취소가 「조작 전」으로
      // 돌아가고(그 위에 Auto Height 가 다시 적용된다), 서버도 원본과 같으면 layoutAdjust null 로 정규화할 수 있다
      const block = latestRef.current.blocks.find((candidate) => candidate.id === blockId);
      const base = block ? getTranslatedBaseBox(block) : null;
      const logicalBefore = (start?.drafts ?? latestRef.current.bboxDrafts).get(blockId) ?? base ?? before;
      const command: N5EditCommand = { kind, target: { type: 'block', id: blockId }, before: logicalBefore, after };
      manualHeightByCommandRef.current.set(command, { before: wasManual, after: isManual });
      setManualHeight(blockId, isManual);
      // 서버에는 보내지 않는다 — [저장하러 가기]에서 저장한다
      setLayoutDirty(blockId, true);
      dispatch({ type: 'edit-succeeded', command });
    },
    [dispatch, isLayoutEditableBlock, setLayoutDirty, setManualHeight],
  );

  const changeFontScale = useCallback(
    (block: BlockViewModel, direction: 'increase' | 'decrease') => {
      if (!canStartSave(sessionRef.current) || finalizingRef.current || !isLayoutEditableBlock(block.id)) return;
      const section = sections.find((candidate) => candidate.id === block.sectionId);
      // 단계 계산은 화면 박스(Auto Height 표시 포함)에서, 이력의 이전 값은 논리 배치(사용자 초안 없으면 서버 박스)로
      const bbox = layoutBoxes.get(block.id) ?? getTranslatedBaseBox(block);
      const logical = logicalLayoutOf(block.id);
      if (!section || !bbox || !logical) return;
      const before: N5FontScaleValue = logical;
      // [+][-] 는 영역 중심 기준(PRD v3.6.4 F-CFM-15) — 글자 정렬과 무관하다
      const stepped = stepFontScale({ bbox, fontScale: logical.fontScale }, direction, section);
      if (!stepped) return;
      // 폭은 배율 규칙을 따르고, 높이는 새 글자 크기로 다시 줄바꿈한 결과가 정본이다. 세로도 영역 중심을 유지한다(섹션 안으로만 민다)
      const text = translationDrafts.get(block.id)?.draft ?? block.translatedText;
      // 중심은 화면에 그려진 영역(사용자 초안 ?? 서버 박스 = 논리 박스) 기준이다 — 측정용 Auto Height 박스와 높이가 다를 수 있다
      const centerY = logical.bbox.y + logical.bbox.height / 2;
      const recenterY = (box: BoundingBox): BoundingBox => ({
        ...box,
        y: Math.min(Math.max(centerY - box.height / 2, 0), Math.max(section.height - box.height, 0)),
      });
      // 사용자가 높이를 정한 block 은 폭·기준점만 배율 규칙을 따르고 높이는 그대로 둔다(Auto Height 로 다시 정하지 않는다) — 높이가 같으니 중심도 그대로다
      const isManual = manualHeightRef.current.has(block.id);
      const fitted = isManual ? null : fitForText(block, text, stepped.bbox, stepped.fontScale, section);
      const after: N5FontScaleValue = isManual
        ? { bbox: { ...stepped.bbox, y: bbox.y, height: bbox.height }, fontScale: stepped.fontScale }
        : fitted
          ? { bbox: recenterY(fitted.box), fontScale: stepped.fontScale }
          : stepped;
      applyLayoutDraft(block.id, after);
      const command: N5EditCommand = { kind: 'font-scale', target: { type: 'block', id: block.id }, before, after };
      // 서버에는 보내지 않는다 — [저장하러 가기]에서 저장한다
      setLayoutDirty(block.id, true);
      dispatch({ type: 'edit-succeeded', command });
    },
    [applyLayoutDraft, dispatch, fitForText, isLayoutEditableBlock, layoutBoxes, logicalLayoutOf, sections, setLayoutDirty, translationDrafts],
  );

  const commitTranslation = useCallback(
    (blockId: number, beforeText: string, afterText: string) => {
      if (beforeText === afterText) return;
      // 사용자 박스가 있으면 저장한 글로 다시 줄바꿈해 그 박스 높이를 맞춘다(서버에는 보내지 않고, 글과 박스를 한 단계로 되돌린다).
      // 사용자 박스가 없으면 사용자 배치를 만들지 않는다 — Auto Height 표시 박스가 새 글로 다시 잰다
      const { blocks: latestBlocks, sections: latestSections, bboxDrafts: boxes, fontScaleDrafts: scales } = latestRef.current;
      const block = latestBlocks.find((candidate) => candidate.id === blockId);
      const beforeBox = boxes.get(blockId) ?? null;
      // 사용자가 높이를 정한 block 은 글이 바뀌어도 그 높이를 다시 덮지 않는다
      const fitted =
        block && beforeBox && !manualHeightRef.current.has(blockId)
          ? fitForText(block, afterText, beforeBox, scales.get(blockId) ?? getBaseFontScale(block), latestSections.find((s) => s.id === block.sectionId))
          : null;
      const afterBox = fitted && beforeBox && !isSameBox(fitted.box, beforeBox) ? fitted.box : beforeBox;
      if (afterBox) setBboxDrafts((drafts) => new Map(drafts).set(blockId, afterBox));
      const before: N5TranslationValue = { text: beforeText, bbox: beforeBox };
      const after: N5TranslationValue = { text: afterText, bbox: afterBox };
      dispatch({ type: 'edit-succeeded', command: { kind: 'translation', target: { type: 'block', id: blockId }, before, after } });
    },
    [dispatch, fitForText],
  );

  const saveTranslationImpl = useCallback(
    async (blockId: number, text: string): Promise<TranslationSaveResult> => {
      const latest = queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId))?.find((b) => b.id === blockId);
      if (latest?.revision == null || !beginServerEdit()) return { started: false };
      clearHistoryConflict(blockId);
      const textBeforeSave = latest.trans1 ?? '';
      try {
        const response = await patchBlock({ blockId, payload: { trans1: text, revision: latest.revision } });
        const rerenderTaskId = getRerenderTaskId(response);
        setRerenderTask(blockId, rerenderTaskId, 'translation');
        updateTranslationDraft(blockId, (prev) => resolveTranslationSaveSucceeded(prev, text));
        commitTranslation(blockId, textBeforeSave, response.block?.trans1 ?? text);
        return { started: true, ok: true, revision: response.block?.revision ?? null, rerenderTaskId, block: response.block ?? null };
      } catch (err) {
        // 응답이 없었으면 서버 상태를 확인할 때까지 기다린다. 이미 반영됐으면 성공과 같이 초안·이력을 맞춘다(이번 응답 task 는 알 수 없다)
        const uncertain = await resolveUncertainSave(err, { kind: 'translation', blockId, text, sentRevision: latest.revision });
        if (uncertain === 'applied') {
          const server = queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId))?.find((b) => b.id === blockId) ?? null;
          updateTranslationDraft(blockId, (prev) => resolveTranslationSaveSucceeded(prev, text));
          commitTranslation(blockId, textBeforeSave, text);
          return { started: true, ok: true, revision: server?.revision ?? null, rerenderTaskId: null, block: server };
        }
        // 초안은 그대로 두고 실패 표시만 켠다(번역문 저장 실패는 입력 유지) — 409 는 기존 충돌 표시로 넘긴다
        updateTranslationDraft(blockId, resolveTranslationSaveFailed);
        let conflict: ApiTextBlock | null = null;
        if (err instanceof ApiRequestError && err.status === 409) {
          const parsed = parseApiError(err.body);
          conflict = parsed && isRevisionConflict(parsed) ? getRevisionConflictLatestBlock(parsed) : null;
          if (conflict) setHistoryConflicts((conflicts) => new Map(conflicts).set(blockId, conflict!));
        }
        return { started: true, ok: false, conflict, error: err };
      } finally {
        endServerEdit();
      }
    },
    [beginServerEdit, clearHistoryConflict, commitTranslation, endServerEdit, jobId, patchBlock, queryClient, resolveUncertainSave, setRerenderTask, updateTranslationDraft],
  );
  /** 칸의 [확인] — 최종 저장 중에는 시작하지 않는다(최종 저장 자체는 saveBlockForConfirm 이 같은 경로를 쓴다) */
  const saveTranslation = useCallback(
    async (blockId: number, text: string): Promise<TranslationSaveResult> =>
      finalizingRef.current ? { started: false } : saveTranslationImpl(blockId, text),
    [saveTranslationImpl],
  );

  // ── 섹션 제외·되돌리기(SEC-03) ─ 저장이 끝난 뒤에 반영한다. 제외 여부의 정본은 프리뷰의 bucket/excludedStage 다
  const [pendingSectionIds, setPendingSectionIds] = useState<ReadonlySet<number>>(() => new Set());
  // 같은 tick 의 연속 클릭은 state 갱신 전에 들어오므로 ref 로 한 번 더 막는다
  const pendingSectionIdsRef = useRef(new Set<number>());
  const [failedSectionId, setFailedSectionId] = useState<number | null>(null);

  const saveSectionBucket = useCallback(
    (sectionId: number, bucket: SectionBucket) => {
      if (finalizingRef.current || pendingSectionIdsRef.current.has(sectionId) || !beginServerEdit()) return;
      pendingSectionIdsRef.current.add(sectionId);
      setPendingSectionIds(new Set(pendingSectionIdsRef.current));
      setFailedSectionId((prev) => (prev === sectionId ? null : prev));
      void (async () => {
        try {
          // mutateAsync — 섹션마다 따로 끝을 기다린다(mutate 의 호출별 콜백은 마지막 호출에만 불린다)
          await patchSectionBucket({ sectionId, bucket });
          dispatch({
            type: 'edit-succeeded',
            command: {
              kind: bucket === 'exclude' ? 'section-exclude' : 'section-restore',
              target: { type: 'section', id: sectionId },
              before: bucket === 'exclude' ? 'include' : 'exclude',
              after: bucket,
            },
          });
          if (bucket === 'exclude') onSectionExcluded(sectionId);
        } catch (err) {
          const uncertain = await resolveUncertainSave(err, { kind: 'section', sectionId, bucket });
          if (uncertain === 'applied') {
            // 서버가 이미 바꿨다 — 성공과 같이 이력 1단계(화면은 다시 받은 /preview 가 정본)
            dispatch({
              type: 'edit-succeeded',
              command: {
                kind: bucket === 'exclude' ? 'section-exclude' : 'section-restore',
                target: { type: 'section', id: sectionId },
                before: bucket === 'exclude' ? 'include' : 'exclude',
                after: bucket,
              },
            });
            if (bucket === 'exclude') onSectionExcluded(sectionId);
          } else {
            setFailedSectionId(sectionId);
          }
        } finally {
          pendingSectionIdsRef.current.delete(sectionId);
          setPendingSectionIds(new Set(pendingSectionIdsRef.current));
          endServerEdit();
        }
      })();
    },
    [beginServerEdit, dispatch, endServerEdit, onSectionExcluded, patchSectionBucket, resolveUncertainSave],
  );

  // ── 실행 취소·다시 실행
  const revealBlock = useCallback((blockId: number) => {
    const { blocks: latestBlocks, onSelectBlock: select } = latestRef.current;
    const block = latestBlocks.find((candidate) => candidate.id === blockId);
    if (block) select(block);
  }, []);

  const settle = useCallback(
    (direction: HistoryDirection, command: N5EditCommand | null) => {
      if (!command) dispatch({ type: direction === 'undo' ? 'undo-failed' : 'redo-failed' });
      else dispatch({ type: direction === 'undo' ? 'undo-succeeded' : 'redo-succeeded', command });
    },
    [dispatch],
  );

  const runTranslationCommand = useCallback(
    async (direction: HistoryDirection, command: N5EditCommand, value: N5TranslationValue) => {
      const blockId = command.target.id;
      revealBlock(blockId);
      // 저장하지 않은 초안이 있으면 서버값만 바뀌어 화면과 어긋난다 — 초안을 지키고 시도하지 않는다
      if (latestRef.current.translationDrafts.has(blockId)) {
        settle(direction, null);
        return;
      }
      dispatch({ type: 'save-started', operation: direction });
      clearHistoryConflict(blockId);
      // 실행 시점의 최신 revision 을 쓴다. 이력에는 revision 을 담지 않는다
      const latest = queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId))?.find((b) => b.id === blockId);
      if (latest?.revision == null) {
        settle(direction, null);
        return;
      }
      try {
        const response = await patchBlock({ blockId, payload: { trans1: value.text, revision: latest.revision } });
        setRerenderTask(blockId, getRerenderTaskId(response), 'history');
        // 저장에 성공한 뒤에만 그 글의 박스로 돌아간다. 초안이 없던 때로 돌아가면 서버 박스를 다시 쓴다
        setBboxDrafts((drafts) => {
          const next = new Map(drafts);
          if (value.bbox) next.set(blockId, value.bbox);
          else next.delete(blockId);
          return next;
        });
        settle(direction, command);
      } catch (err) {
        // 409 — 서버값으로 덮어쓰지 않고 기존 충돌 표시로 넘긴다. 사용자가 [최신 값 불러오기]를 고를 때만 바뀐다
        if (err instanceof ApiRequestError && err.status === 409) {
          const parsed = parseApiError(err.body);
          const conflict = parsed && isRevisionConflict(parsed) ? getRevisionConflictLatestBlock(parsed) : null;
          if (conflict) setHistoryConflicts((conflicts) => new Map(conflicts).set(blockId, conflict));
        }
        // 응답이 없었으면 서버 상태를 확인할 때까지 이력 위치·잠금을 그대로 둔다. 이미 반영됐으면 이력도 그 방향으로 옮긴다
        const uncertain = await resolveUncertainSave(err, { kind: 'translation', blockId, text: value.text, sentRevision: latest.revision });
        if (uncertain === 'applied') {
          setBboxDrafts((drafts) => {
            const next = new Map(drafts);
            if (value.bbox) next.set(blockId, value.bbox);
            else next.delete(blockId);
            return next;
          });
          settle(direction, command);
          return;
        }
        settle(direction, null);
      }
    },
    [clearHistoryConflict, dispatch, jobId, patchBlock, queryClient, resolveUncertainSave, revealBlock, setRerenderTask, settle],
  );

  const runSectionCommand = useCallback(
    async (direction: HistoryDirection, command: N5EditCommand, bucket: SectionBucket) => {
      const sectionId = command.target.id;
      const section = latestRef.current.sections.find((candidate) => candidate.id === sectionId);
      // 서버가 거절하는 조건(N3 제외 섹션 복구)은 실행 취소라도 시도하지 않는다
      if (!section || (bucket === 'include' && section.render.status === 'excluded' && !canRestoreSectionInN5(section))) {
        settle(direction, null);
        return;
      }
      dispatch({ type: 'save-started', operation: direction });
      try {
        await patchSectionBucket({ sectionId, bucket });
        setFailedSectionId((prev) => (prev === sectionId ? null : prev));
        latestRef.current.onSelectSection(sectionId);
        settle(direction, command);
      } catch (err) {
        const uncertain = await resolveUncertainSave(err, { kind: 'section', sectionId, bucket });
        if (uncertain === 'applied') {
          setFailedSectionId((prev) => (prev === sectionId ? null : prev));
          latestRef.current.onSelectSection(sectionId);
          settle(direction, command);
          return;
        }
        settle(direction, null);
      }
    },
    [dispatch, patchSectionBucket, resolveUncertainSave, settle],
  );

  /** 박스 이력의 manual height 여부를 그 방향(실행 취소 = 조작 전, 다시 실행 = 조작 후)으로 되돌린다 */
  const applyManualHeightFor = useCallback(
    (command: N5EditCommand, direction: HistoryDirection) => {
      const manual = manualHeightByCommandRef.current.get(command);
      if (manual) setManualHeight(command.target.id, direction === 'undo' ? manual.before : manual.after);
    },
    [setManualHeight],
  );

  // 「번역 전」에는 조정 UI가 없고 원본 bbox를 보이므로 되돌려도 보이지 않는다 — 「번역 후」에서만 동작한다
  const isHistoryAvailable = viewMode === 'translated';

  const runHistory = useCallback(
    (direction: HistoryDirection) => {
      if (!isHistoryAvailable || layoutDraggingRef.current || finalizingRef.current) return;
      if (!canStartSave(sessionRef.current) || pendingEditsRef.current > 0) return;
      const { history } = sessionRef.current;
      const command = direction === 'undo' ? peekUndo(history) : peekRedo(history);
      if (!command) return;
      const value = direction === 'undo' ? command.before : command.after;
      switch (command.kind) {
        case 'translation':
          void runTranslationCommand(direction, command, value as N5TranslationValue);
          return;
        case 'section-exclude':
        case 'section-restore':
          void runSectionCommand(direction, command, value as SectionBucket);
          return;
        // 배치 실행 취소·다시 실행도 local 초안만 바꾼다 — 서버 저장은 [저장하러 가기]
        case 'box-move':
        case 'box-resize':
          applyLayoutDraft(command.target.id, { bbox: value as BoundingBox });
          setLayoutDirty(command.target.id, true);
          applyManualHeightFor(command, direction);
          revealBlock(command.target.id);
          settle(direction, command);
          return;
        case 'font-scale': {
          const { bbox, fontScale } = value as N5FontScaleValue;
          applyLayoutDraft(command.target.id, { bbox, fontScale });
          setLayoutDirty(command.target.id, true);
          revealBlock(command.target.id);
          settle(direction, command);
          return;
        }
      }
    },
    [applyLayoutDraft, applyManualHeightFor, isHistoryAvailable, revealBlock, runSectionCommand, runTranslationCommand, setLayoutDirty, settle],
  );

  const undo = useCallback(() => runHistory('undo'), [runHistory]);
  const redo = useCallback(() => runHistory('redo'), [runHistory]);

  // 단축키 — 입력칸의 글자 실행 취소와 열린 확인창은 가로채지 않는다(F-CFM-03)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redo, undo]);

  /** [저장하러 가기] 대상 — 서버값과 다른 번역 초안 · 배치 미저장(보낼 값이 있는 것). 화면 블록 순서 */
  /** [저장하러 가기]가 저장할 배치(layoutAdjust) 초안이 있는 블록 */
  const listUnsavedLayoutBlockIds = useCallback(
    (): number[] => latestRef.current.blocks.filter((block) => pendingLayoutPatch(block.id) != null).map((block) => block.id),
    [pendingLayoutPatch],
  );
  /** [확인]으로 저장하지 않은 번역문 초안(서버값과 다름)이 있는 블록 — 확정 때 저장하지 않고 확인창 항목으로만 알린다 */
  const listUnsavedTranslationBlockIds = useCallback((): number[] => {
    const { blocks: latestBlocks, translationDrafts: drafts } = latestRef.current;
    const serverText = new Map((queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId)) ?? []).map((b) => [b.id, b.trans1 ?? '']));
    return latestBlocks
      .filter((block) => {
        const draft = drafts.get(block.id);
        return draft != null && serverText.has(block.id) && draft.draft !== serverText.get(block.id);
      })
      .map((block) => block.id);
  }, [jobId, queryClient]);

  const listUnsavedBlockIds = useCallback((): number[] => {
    const { blocks: latestBlocks, translationDrafts: drafts } = latestRef.current;
    const serverText = new Map((queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId)) ?? []).map((b) => [b.id, b.trans1 ?? '']));
    return latestBlocks
      .filter((block) => {
        const draft = drafts.get(block.id);
        const textChanged = draft != null && serverText.has(block.id) && draft.draft !== serverText.get(block.id);
        return textChanged || pendingLayoutPatch(block.id) != null;
      })
      .map((block) => block.id);
  }, [jobId, pendingLayoutPatch, queryClient]);

  const saveBlockForConfirm = useCallback(
    async (blockId: number): Promise<TranslationSaveResult> => {
      const latest = queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId))?.find((b) => b.id === blockId);
      if (latest?.revision == null) return { started: false };
      // PRD v3.6.4 F-CFM-09 — [확인]을 누르지 않은 번역문 초안은 자동 저장하지 않는다(그 칸은 서버에 저장된 이전 문장으로 확정 · 확인창 항목).
      // 여기서는 배치(layoutAdjust)만 보내고 trans1 은 서버 현재 값 그대로다(같은 값은 번역문 변경 없음 — blockPatch no-op 규칙)
      const text: string | null = null;
      const layoutAdjust = pendingLayoutPatch(blockId);
      if (layoutAdjust == null) {
        setLayoutDirty(blockId, false); // 보낼 배치가 없다(서버 값과 같거나 렌더 대상 아님)
        return { started: true, ok: true, revision: latest.revision, rerenderTaskId: null, block: null };
      }
      if (!beginServerEdit()) return { started: false };
      clearHistoryConflict(blockId);
      try {
        // 번역 초안과 배치를 한 요청으로 — revision 은 실행 시점 최신, 저장(revision +1)·재렌더도 한 번
        const response = await patchBlock({
          blockId,
          payload: { trans1: text ?? latest.trans1 ?? '', revision: latest.revision, layoutAdjust },
          idempotencyKey: createIdempotencyKey(),
        });
        const rerenderTaskId = getRerenderTaskId(response);
        setRerenderTask(blockId, rerenderTaskId, text != null ? 'translation' : 'layout');
        if (text != null) updateTranslationDraft(blockId, (prev) => resolveTranslationSaveSucceeded(prev, text));
        setLayoutDirty(blockId, false);
        return { started: true, ok: true, revision: response.block?.revision ?? null, rerenderTaskId, block: response.block ?? null };
      } catch (err) {
        // local 초안(번역문·배치)은 그대로 — 확정하지 않고 N5 에 남는다. 409 는 기존 충돌 표시로
        if (text != null) updateTranslationDraft(blockId, resolveTranslationSaveFailed);
        let conflict: ApiTextBlock | null = null;
        if (err instanceof ApiRequestError && err.status === 409) {
          const parsed = parseApiError(err.body);
          conflict = parsed && isRevisionConflict(parsed) ? getRevisionConflictLatestBlock(parsed) : null;
          if (conflict) setHistoryConflicts((conflicts) => new Map(conflicts).set(blockId, conflict!));
        }
        // 응답이 없었으면 서버 상태를 확인할 때까지 기다린 뒤 실패로 둔다(확정하지 않음). 다음 [저장하러 가기]는 다시 받은 최신 revision 으로
        // 같은 배치를 보낸다 — 이미 반영됐다면 같은 값이라 no-op 이다(blockPatch). 409 를 가정하지 않는다
        await resolveUncertainSave(err, null);
        return { started: true, ok: false, conflict, error: err };
      } finally {
        endServerEdit();
      }
    },
    [beginServerEdit, clearHistoryConflict, endServerEdit, jobId, patchBlock, pendingLayoutPatch, queryClient, resolveUncertainSave, setLayoutDirty, setRerenderTask, updateTranslationDraft],
  );

  const isIdle = session.inFlight === null && pendingEdits === 0;
  const hasPendingServerEdits = !isIdle;
  const isServerEditPending = useCallback(() => sessionRef.current.inFlight !== null || pendingEditsRef.current > 0, []);

  return {
    canUndo: isHistoryAvailable && isIdle && !isFinalizing && canUndo(session.history),
    canRedo: isHistoryAvailable && isIdle && !isFinalizing && canRedo(session.history),
    undo,
    redo,
    notice: session.notice,
    isEditLocked: session.inFlight !== null || isFinalizing || uncertainSave !== null,
    uncertainSave,
    retryServerCheck,
    isFinalizing,
    beginFinalizationLock,
    endFinalizationLock,
    isFinalizationLocked,
    bboxDrafts,
    layoutBoxes,
    setBboxDraft: setDragBox,
    commitBoxEdit,
    manualHeightIds,
    fitAutoHeight,
    fontScaleDrafts,
    changeFontScale,
    setLayoutDragging,
    pendingSectionIds,
    failedSectionId,
    saveSectionBucket,
    translationDrafts,
    updateTranslationDraft: updateTranslationDraftByUser,
    rerenderTaskByBlock,
    setRerenderTask,
    historyConflicts,
    clearHistoryConflict,
    beginServerEdit,
    endServerEdit,
    commitTranslation,
    hasPendingServerEdits,
    isServerEditPending,
    listUnsavedBlockIds,
    listUnsavedLayoutBlockIds,
    listUnsavedTranslationBlockIds,
    saveBlockForConfirm,
    saveTranslation,
  };
}
