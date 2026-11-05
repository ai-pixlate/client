'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/lib/api/pixlate';
import type { ApiTextBlock } from '@/lib/api/n5-schema';
import type { BoundingBox } from '@/lib/api/types';
import {
  canRestoreSectionInN5,
  getRerenderTaskId,
  getRevisionConflictLatestBlock,
  isRevisionConflict,
  parseApiError,
  type BlockViewModel,
  type PreviewSectionViewModel,
} from '@/lib/n5/adapter';
import { updateTranslationDrafts, type TranslationDraft } from '@/lib/n5/failed-drafts';
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
import { isSameBox, pruneBlockDrafts } from '@/lib/n5/layout-edit';
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
// - 박스 위치·크기: 저장 계약이 없어 세션 local 초안에 곧바로 적용한다. 서버 요청이 없다.
//
// 잠금
// - 서버 실행 취소·다시 실행이 진행 중이면(session.inFlight) 새 편집·실행 취소·다시 실행을 시작하지 않는다.
// - 일반 저장은 기존 정책대로 섹션·블록마다 따로 진행할 수 있어 개수(pendingEdits)로 센다. 하나라도 남아 있으면
//   실행 취소·다시 실행을 시작하지 않는다.
// - 같은 tick 의 연속 입력도 막도록 세션과 개수는 ref 를 정본으로 읽는다.
// ─────────────────────────────────────────────────────────────────

type SectionBucket = 'include' | 'exclude';
type HistoryDirection = 'undo' | 'redo';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export interface N5EditSessionApi {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  notice: N5SaveNotice | null;
  /** 서버 실행 취소·다시 실행 진행 중 — 새 편집을 시작하지 않는다 */
  isEditLocked: boolean;

  bboxDrafts: ReadonlyMap<number, BoundingBox>;
  setBboxDraft: (blockId: number, next: BoundingBox) => void;
  commitBoxEdit: (kind: 'box-move' | 'box-resize', blockId: number, before: BoundingBox, after: BoundingBox) => void;
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
  rerenderTaskByBlock: ReadonlyMap<number, number | null>;
  setRerenderTask: (blockId: number, taskId: number | null) => void;
  /** 실행 취소·다시 실행이 409 로 막힌 블록의 서버 최신값. 편집기의 기존 충돌 표시로 보여 준다 */
  historyConflicts: ReadonlyMap<number, ApiTextBlock>;
  clearHistoryConflict: (blockId: number) => void;
  /** 번역문 저장을 시작해도 되면 true 를 돌려주고 진행 중으로 센다. 끝나면 endServerEdit 을 부른다 */
  beginServerEdit: () => boolean;
  endServerEdit: () => void;
  commitTranslation: (blockId: number, before: string, after: string) => void;
}

export function useN5EditSession({
  jobId,
  blocks,
  sections,
  viewMode,
  onSelectBlock,
  onSelectSection,
  onSectionExcluded,
}: {
  jobId: string;
  blocks: BlockViewModel[];
  sections: PreviewSectionViewModel[];
  viewMode: N5ViewMode;
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

  const layoutDraggingRef = useRef(false);
  const setLayoutDragging = useCallback((dragging: boolean) => {
    layoutDraggingRef.current = dragging;
  }, []);

  // ── 박스 local 초안 ─ 재조회·보기 전환으로 지우지 않는다. 서버에서 블록·섹션이 사라지면 그 초안만 정리한다
  const [bboxDrafts, setBboxDrafts] = useState<ReadonlyMap<number, BoundingBox>>(() => new Map());
  if (bboxDrafts.size > 0) {
    const sectionIds = new Set(sections.map((section) => section.id));
    const validBlockIds = new Set(blocks.filter((block) => sectionIds.has(block.sectionId)).map((block) => block.id));
    const pruned = pruneBlockDrafts(bboxDrafts, validBlockIds);
    if (pruned !== bboxDrafts) setBboxDrafts(pruned);
  }
  const setBboxDraft = useCallback((blockId: number, next: BoundingBox) => {
    setBboxDrafts((drafts) => new Map(drafts).set(blockId, next));
  }, []);
  const commitBoxEdit = useCallback(
    (kind: 'box-move' | 'box-resize', blockId: number, before: BoundingBox, after: BoundingBox) => {
      if (isSameBox(before, after)) return;
      dispatch({ type: 'edit-succeeded', command: { kind, target: { type: 'block', id: blockId }, before, after } });
    },
    [dispatch],
  );

  // ── 번역문 ─ 초안·재렌더 task·충돌을 여기 두어 패널의 저장과 실행 취소가 같은 값을 본다
  const [translationDrafts, setTranslationDrafts] = useState<ReadonlyMap<number, TranslationDraft>>(() => new Map());
  const updateTranslationDraft = useCallback(
    (blockId: number, update: (prev: TranslationDraft | undefined) => TranslationDraft | undefined) => {
      setTranslationDrafts((drafts) => updateTranslationDrafts(drafts, blockId, update));
    },
    [],
  );
  const [rerenderTaskByBlock, setRerenderTaskByBlock] = useState<ReadonlyMap<number, number | null>>(() => new Map());
  const setRerenderTask = useCallback((blockId: number, taskId: number | null) => {
    setRerenderTaskByBlock((tasks) => new Map(tasks).set(blockId, taskId));
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
  const commitTranslation = useCallback(
    (blockId: number, before: string, after: string) => {
      if (before === after) return;
      dispatch({
        type: 'edit-succeeded',
        command: { kind: 'translation', target: { type: 'block', id: blockId }, before, after },
      });
    },
    [dispatch],
  );

  // ── 섹션 제외·되돌리기(SEC-03) ─ 저장이 끝난 뒤에 반영한다. 제외 여부의 정본은 프리뷰의 bucket/excludedStage 다
  const [pendingSectionIds, setPendingSectionIds] = useState<ReadonlySet<number>>(() => new Set());
  // 같은 tick 의 연속 클릭은 state 갱신 전에 들어오므로 ref 로 한 번 더 막는다
  const pendingSectionIdsRef = useRef(new Set<number>());
  const [failedSectionId, setFailedSectionId] = useState<number | null>(null);

  const saveSectionBucket = useCallback(
    (sectionId: number, bucket: SectionBucket) => {
      if (pendingSectionIdsRef.current.has(sectionId) || !beginServerEdit()) return;
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
        } catch {
          setFailedSectionId(sectionId);
        } finally {
          pendingSectionIdsRef.current.delete(sectionId);
          setPendingSectionIds(new Set(pendingSectionIdsRef.current));
          endServerEdit();
        }
      })();
    },
    [beginServerEdit, dispatch, endServerEdit, onSectionExcluded, patchSectionBucket],
  );

  // ── 실행 취소·다시 실행 ─ 저장 응답을 기다린 뒤에도 최신 화면 값을 보도록 ref 로 읽는다
  const latestRef = useRef({ blocks, sections, translationDrafts, onSelectBlock, onSelectSection });
  useEffect(() => {
    latestRef.current = { blocks, sections, translationDrafts, onSelectBlock, onSelectSection };
  });

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
    async (direction: HistoryDirection, command: N5EditCommand, text: string) => {
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
        const response = await patchBlock({ blockId, payload: { trans1: text, revision: latest.revision } });
        setRerenderTask(blockId, getRerenderTaskId(response));
        settle(direction, command);
      } catch (err) {
        // 409 — 서버값으로 덮어쓰지 않고 기존 충돌 표시로 넘긴다. 사용자가 [최신 값 불러오기]를 고를 때만 바뀐다
        if (err instanceof ApiRequestError && err.status === 409) {
          const parsed = parseApiError(err.body);
          const conflict = parsed && isRevisionConflict(parsed) ? getRevisionConflictLatestBlock(parsed) : null;
          if (conflict) setHistoryConflicts((conflicts) => new Map(conflicts).set(blockId, conflict));
        }
        settle(direction, null);
      }
    },
    [clearHistoryConflict, dispatch, jobId, patchBlock, queryClient, revealBlock, setRerenderTask, settle],
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
      } catch {
        settle(direction, null);
      }
    },
    [dispatch, patchSectionBucket, settle],
  );

  // 「번역 전」에는 조정 UI가 없고 원본 bbox를 보이므로 되돌려도 보이지 않는다 — 「번역 후」에서만 동작한다
  const isHistoryAvailable = viewMode === 'translated';

  const runHistory = useCallback(
    (direction: HistoryDirection) => {
      if (!isHistoryAvailable || layoutDraggingRef.current) return;
      if (!canStartSave(sessionRef.current) || pendingEditsRef.current > 0) return;
      const { history } = sessionRef.current;
      const command = direction === 'undo' ? peekUndo(history) : peekRedo(history);
      if (!command) return;
      const value = direction === 'undo' ? command.before : command.after;
      switch (command.kind) {
        case 'translation':
          void runTranslationCommand(direction, command, value as string);
          return;
        case 'section-exclude':
        case 'section-restore':
          void runSectionCommand(direction, command, value as SectionBucket);
          return;
        case 'box-move':
        case 'box-resize':
          setBboxDraft(command.target.id, value as BoundingBox);
          revealBlock(command.target.id);
          settle(direction, command);
          return;
        case 'font-scale':
          return;
      }
    },
    [isHistoryAvailable, revealBlock, runSectionCommand, runTranslationCommand, setBboxDraft, settle],
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

  const isIdle = session.inFlight === null && pendingEdits === 0;

  return {
    canUndo: isHistoryAvailable && isIdle && canUndo(session.history),
    canRedo: isHistoryAvailable && isIdle && canRedo(session.history),
    undo,
    redo,
    notice: session.notice,
    isEditLocked: session.inFlight !== null,
    bboxDrafts,
    setBboxDraft,
    commitBoxEdit,
    setLayoutDragging,
    pendingSectionIds,
    failedSectionId,
    saveSectionBucket,
    translationDrafts,
    updateTranslationDraft,
    rerenderTaskByBlock,
    setRerenderTask,
    historyConflicts,
    clearHistoryConflict,
    beginServerEdit,
    endServerEdit,
    commitTranslation,
  };
}
