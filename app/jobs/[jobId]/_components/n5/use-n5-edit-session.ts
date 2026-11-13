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
  appliedLayoutFromBlock,
  readStoredLayout,
  buildLayoutAdjustPatch,
  buildLayoutBlockPatch,
  isLayoutRenderTarget,
  type N5LayoutChange,
} from '@/lib/n5/layout-adjust';
import { isLayoutAdjustWriteEnabled } from '@/lib/n5/layout-adjust-capability';
import { createIdempotencyKey } from '@/lib/api/idempotency';
import { openTypesetMeasurer, type TypesetMeasurer } from '@/lib/n5/typeset-measurement';
import { isTypesetRole } from '@/lib/n5/typeset-rules';
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
// - 박스 위치·크기·글자 배율(F-CFM-15 layoutAdjust — 계약 확정·서버 구현 대기): 조작 중에는 세션 local 초안에 곧바로 적용하고,
//   조작을 마쳤을 때(끌기·손잡이는 손을 놓을 때, [+][−] 는 한 번 누를 때) PATCH 1회로 저장한다. 성공한 뒤에만 이력에 넣고,
//   실패하면 마지막 저장 값으로 되돌린다. 같은 블록의 저장은 순서대로 하나씩 보낸다(실행 시점 최신 revision).
//   서버 쓰기는 Mock 에서만 켠다(lib/n5/layout-adjust-capability.ts) — 실서버에서는 지금처럼 세션 local 초안만 바꾼다.
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
  rerenderTaskByBlock: ReadonlyMap<number, number | null>;
  setRerenderTask: (blockId: number, taskId: number | null) => void;
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
  /**
   * 번역문 한 칸 저장 — PATCH { trans1, revision(실행 시점 최신) }. 칸의 [확인]과 [저장하러 가기]의 미저장 초안 저장이 같은 경로를 쓴다.
   * 성공하면 초안 정리·재렌더 task 기록·이력 1단계, 실패하면 초안을 남기고 실패 표시(409 는 충돌 최신값).
   * 다른 서버 저장이 진행 중이면 시작하지 않는다(started=false).
   */
  saveTranslation: (blockId: number, text: string) => Promise<TranslationSaveResult>;
}

export type TranslationSaveResult =
  | { started: false }
  | { started: true; ok: true; revision: number | null; rerenderTaskId: number | null }
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
  const clearUserLayout = useCallback((blockId: number) => {
    const drop = <T,>(drafts: ReadonlyMap<number, T>) => {
      if (!drafts.has(blockId)) return drafts;
      const next = new Map(drafts);
      next.delete(blockId);
      return next;
    };
    setBboxDrafts(drop);
    setFontScaleDrafts(drop);
  }, []);
  /** 끄는 동안의 화면 박스 — Auto Height 표시 박스와 같으면 사용자 초안을 만들지 않는다 */
  const setDragBox = useCallback(
    (blockId: number, next: BoundingBox) => {
      const auto = autoFitBoxesRef.current.get(blockId);
      if (auto && isSameBox(auto, next) && !latestRef.current.bboxDrafts.has(blockId)) return;
      setUserBox(blockId, next);
    },
    [setUserBox],
  );

  // ── 번역문 ─ 초안·재렌더 task·충돌을 여기 두어 패널의 저장과 실행 취소가 같은 값을 본다
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
  // ── 배치 저장(layoutAdjust) ─────────────────────────────────────
  const layoutWriteEnabled = isLayoutAdjustWriteEnabled();
  /** 블록마다 저장을 순서대로 — 앞 저장이 끝난 뒤 최신 revision 으로 보낸다 */
  const layoutQueueRef = useRef(new Map<number, Promise<void>>());
  /** 저장 실패로 화면을 되돌리면 올린다 — 그 뒤에 쌓인 조작은 보내지 않는다 */
  const layoutGenerationRef = useRef(new Map<number, number>());

  /** 서버에 배치를 저장할 블록인지 — 쓰기 허용(Mock) + 렌더 대상(라벨·로고·빈 원문·빈 번역문 아님) */
  const canPersistLayout = useCallback(
    (blockId: number) => {
      if (!layoutWriteEnabled) return false;
      const block = latestRef.current.blocks.find((candidate) => candidate.id === blockId);
      return block != null && isLayoutRenderTarget(block);
    },
    [layoutWriteEnabled],
  );

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

  /**
   * PATCH { trans1(서버 현재 값), revision(실행 시점 최신), layoutAdjust }. 응답 block(정규화된 저장값)을 정본으로 화면에 반영한다 —
   * 요청값을 성공값으로 보지 않는다. applyResponse=false 면(같은 블록 저장이 뒤에 더 쌓임) 화면은 그대로 둔다.
   * 409 REVISION_CONFLICT 는 기존 충돌 표시(historyConflicts)로 넘긴다.
   */
  const saveLayout = useCallback(
    async (blockId: number, layoutAdjust: ApiLayoutAdjustPatch | null, applyResponse: () => boolean): Promise<{ ok: boolean; applied: boolean }> => {
      const latest = queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId))?.find((b) => b.id === blockId);
      if (latest?.revision == null) return { ok: false, applied: false };
      try {
        // 이 호출 = 사용자 조작 1회(끌기·손잡이 1회 · [+][−] 1회 · 실행 취소·다시 실행 1회) — 조작마다 새 멱등 키
        const response = await patchBlock({ blockId, payload: buildLayoutBlockPatch(latest, layoutAdjust), idempotencyKey: createIdempotencyKey() });
        setRerenderTask(blockId, getRerenderTaskId(response));
        const applied = response.block ? appliedLayoutFromBlock(response.block) : null;
        if (applied && applyResponse()) {
          // 저장 조정이 없어졌으면(null 정규화) 사용자 배치도 없다 — 초안을 지워 서버 박스의 Auto Height 표시로 돌아간다
          if (readStoredLayout(response.block!).kind === 'none') clearUserLayout(blockId);
          else applyLayoutDraft(blockId, applied);
        }
        return { ok: true, applied: applied != null };
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 409) {
          const parsed = parseApiError(err.body);
          const conflict = parsed && isRevisionConflict(parsed) ? getRevisionConflictLatestBlock(parsed) : null;
          if (conflict) setHistoryConflicts((conflicts) => new Map(conflicts).set(blockId, conflict));
        }
        return { ok: false, applied: false };
      }
    },
    [applyLayoutDraft, clearUserLayout, jobId, patchBlock, queryClient, setRerenderTask],
  );

  /** 새 배치 조작 저장 — 화면은 이미 after 다. 성공하면 이력 1단계, 실패하면 before 로 되돌리고 안내 */
  const persistLayoutEdit = useCallback(
    (command: N5EditCommand, change: N5LayoutChange, rollback: { bbox: BoundingBox; fontScale?: number }, onRollback?: () => void) => {
      const blockId = command.target.id;
      if (!beginServerEdit()) {
        applyLayoutDraft(blockId, rollback);
        onRollback?.();
        return;
      }
      const generation = layoutGenerationRef.current.get(blockId) ?? 0;
      const previous = layoutQueueRef.current.get(blockId) ?? Promise.resolve();
      const run: Promise<void> = previous.then(async () => {
        try {
          if ((layoutGenerationRef.current.get(blockId) ?? 0) !== generation) return;
          const result = await saveLayout(blockId, buildLayoutAdjustPatch(change), () => layoutQueueRef.current.get(blockId) === run);
          if (result.ok) {
            dispatch({ type: 'edit-succeeded', command });
          } else {
            layoutGenerationRef.current.set(blockId, generation + 1);
            applyLayoutDraft(blockId, rollback);
            onRollback?.();
            dispatch({ type: 'edit-failed', kind: command.kind });
          }
        } finally {
          if (layoutQueueRef.current.get(blockId) === run) layoutQueueRef.current.delete(blockId);
          endServerEdit();
        }
      });
      layoutQueueRef.current.set(blockId, run);
    },
    [applyLayoutDraft, beginServerEdit, dispatch, endServerEdit, saveLayout],
  );

  const commitBoxEdit = useCallback(
    (kind: 'box-move' | 'box-resize', blockId: number, before: BoundingBox, after: BoundingBox, manualHeight = false) => {
      if (isSameBox(before, after)) return;
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
      if (!canPersistLayout(blockId)) {
        dispatch({ type: 'edit-succeeded', command });
        return;
      }
      // 끌기·손잡이 = box 만(배율은 그대로 — 안쪽 생략). 저장에 실패해 되돌리면 manual height 도 조작 전으로
      persistLayoutEdit(command, { kind: 'box', box: after }, { bbox: logicalBefore }, () => setManualHeight(blockId, wasManual));
    },
    [canPersistLayout, dispatch, persistLayoutEdit, setManualHeight],
  );

  const changeFontScale = useCallback(
    (block: BlockViewModel, direction: 'increase' | 'decrease') => {
      if (!canStartSave(sessionRef.current)) return;
      const section = sections.find((candidate) => candidate.id === block.sectionId);
      // 단계 계산은 화면 박스(Auto Height 표시 포함)에서, 이력의 이전 값은 논리 배치(사용자 초안 없으면 서버 박스)로
      const bbox = layoutBoxes.get(block.id) ?? getTranslatedBaseBox(block);
      const logical = logicalLayoutOf(block.id);
      if (!section || !bbox || !logical) return;
      const before: N5FontScaleValue = logical;
      const stepped = stepFontScale({ bbox, fontScale: logical.fontScale }, direction, section, block.textAlign ?? 'left');
      if (!stepped) return;
      // 폭·기준점은 배율 규칙을 따르고, 높이는 새 글자 크기로 다시 줄바꿈한 결과가 정본이다. 윗변은 그대로 둔다
      const text = translationDrafts.get(block.id)?.draft ?? block.translatedText;
      // 사용자가 높이를 정한 block 은 폭·기준점만 배율 규칙을 따르고 높이는 그대로 둔다(Auto Height 로 다시 정하지 않는다)
      const isManual = manualHeightRef.current.has(block.id);
      const fitted = isManual ? null : fitForText(block, text, { ...stepped.bbox, y: bbox.y }, stepped.fontScale, section);
      const after: N5FontScaleValue = isManual
        ? { bbox: { ...stepped.bbox, y: bbox.y, height: bbox.height }, fontScale: stepped.fontScale }
        : fitted
          ? { bbox: fitted.box, fontScale: stepped.fontScale }
          : stepped;
      applyLayoutDraft(block.id, after);
      const command: N5EditCommand = { kind: 'font-scale', target: { type: 'block', id: block.id }, before, after };
      if (!canPersistLayout(block.id)) {
        dispatch({ type: 'edit-succeeded', command });
        return;
      }
      // [+][−] 한 번 = 저장 1회 — 새 절대 배율과 그 박스를 한 요청으로
      persistLayoutEdit(command, { kind: 'box-and-scale', box: after.bbox, fontScale: after.fontScale }, before);
    },
    [applyLayoutDraft, canPersistLayout, dispatch, fitForText, layoutBoxes, logicalLayoutOf, persistLayoutEdit, sections, translationDrafts],
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

  const saveTranslation = useCallback(
    async (blockId: number, text: string): Promise<TranslationSaveResult> => {
      const latest = queryClient.getQueryData<ApiTextBlock[]>(pixlateKeys.n5Blocks(jobId))?.find((b) => b.id === blockId);
      if (latest?.revision == null || !beginServerEdit()) return { started: false };
      clearHistoryConflict(blockId);
      const textBeforeSave = latest.trans1 ?? '';
      try {
        const response = await patchBlock({ blockId, payload: { trans1: text, revision: latest.revision } });
        const rerenderTaskId = getRerenderTaskId(response);
        setRerenderTask(blockId, rerenderTaskId);
        updateTranslationDraft(blockId, (prev) => resolveTranslationSaveSucceeded(prev, text));
        commitTranslation(blockId, textBeforeSave, response.block?.trans1 ?? text);
        return { started: true, ok: true, revision: response.block?.revision ?? null, rerenderTaskId };
      } catch (err) {
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
    [beginServerEdit, clearHistoryConflict, commitTranslation, endServerEdit, jobId, patchBlock, queryClient, setRerenderTask, updateTranslationDraft],
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
        setRerenderTask(blockId, getRerenderTaskId(response));
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

  /** 박스 이력의 manual height 여부를 그 방향(실행 취소 = 조작 전, 다시 실행 = 조작 후)으로 되돌린다 */
  const applyManualHeightFor = useCallback(
    (command: N5EditCommand, direction: HistoryDirection) => {
      const manual = manualHeightByCommandRef.current.get(command);
      if (manual) setManualHeight(command.target.id, direction === 'undo' ? manual.before : manual.after);
    },
    [setManualHeight],
  );

  /** 배치 실행 취소·다시 실행 — 과거 값을 현재 revision 으로 다시 저장한다(전용 API 없음). 성공한 뒤에만 pointer 를 옮긴다 */
  const runLayoutCommand = useCallback(
    async (direction: HistoryDirection, command: N5EditCommand, change: N5LayoutChange) => {
      const blockId = command.target.id;
      revealBlock(blockId);
      dispatch({ type: 'save-started', operation: direction });
      clearHistoryConflict(blockId);
      const result = await saveLayout(blockId, buildLayoutAdjustPatch(change), () => true);
      // 응답에 저장 조정 키가 없으면(서버 구현 전 모양) 보낸 값을 화면에 둔다
      if (result.ok && !result.applied) {
        applyLayoutDraft(blockId, change.kind === 'box' ? { bbox: change.box } : { bbox: change.box, fontScale: change.fontScale });
      }
      if (result.ok) applyManualHeightFor(command, direction);
      settle(direction, result.ok ? command : null);
    },
    [applyLayoutDraft, applyManualHeightFor, clearHistoryConflict, dispatch, revealBlock, saveLayout, settle],
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
          void runTranslationCommand(direction, command, value as N5TranslationValue);
          return;
        case 'section-exclude':
        case 'section-restore':
          void runSectionCommand(direction, command, value as SectionBucket);
          return;
        case 'box-move':
        case 'box-resize':
          if (canPersistLayout(command.target.id)) {
            void runLayoutCommand(direction, command, { kind: 'box', box: value as BoundingBox });
            return;
          }
          applyLayoutDraft(command.target.id, { bbox: value as BoundingBox });
          applyManualHeightFor(command, direction);
          revealBlock(command.target.id);
          settle(direction, command);
          return;
        case 'font-scale': {
          const { bbox, fontScale } = value as N5FontScaleValue;
          if (canPersistLayout(command.target.id)) {
            void runLayoutCommand(direction, command, { kind: 'box-and-scale', box: bbox, fontScale });
            return;
          }
          applyLayoutDraft(command.target.id, { bbox, fontScale });
          revealBlock(command.target.id);
          settle(direction, command);
          return;
        }
      }
    },
    [applyLayoutDraft, applyManualHeightFor, canPersistLayout, isHistoryAvailable, revealBlock, runLayoutCommand, runSectionCommand, runTranslationCommand, settle],
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
  const hasPendingServerEdits = !isIdle;
  const isServerEditPending = useCallback(() => sessionRef.current.inFlight !== null || pendingEditsRef.current > 0, []);

  return {
    canUndo: isHistoryAvailable && isIdle && canUndo(session.history),
    canRedo: isHistoryAvailable && isIdle && canRedo(session.history),
    undo,
    redo,
    notice: session.notice,
    isEditLocked: session.inFlight !== null,
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
    updateTranslationDraft,
    rerenderTaskByBlock,
    setRerenderTask,
    historyConflicts,
    clearHistoryConflict,
    beginServerEdit,
    endServerEdit,
    commitTranslation,
    hasPendingServerEdits,
    isServerEditPending,
    saveTranslation,
  };
}
