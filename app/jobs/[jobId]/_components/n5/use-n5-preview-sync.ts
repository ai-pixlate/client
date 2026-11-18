'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';

import type { PreviewViewModel, SectionInputSync } from '@/lib/n5/adapter';
import { diagnosePreviewSection } from '@/lib/n5/preview-state';
import { n5TaskStatusQueryOptions, pixlateKeys, refreshN5Snapshot } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// N5 /preview 재조회 계기(reviewPreview 「렌더 입력과 시도·결과」·ReviewPreview 설명)를 한 곳에서 맡는다.
// ① render.attempt 가 pending·running 인 task 와 이 화면 저장(PATCH)이 만든 rerenderTaskId 를 /tasks 로 추적하고, 끝나면
//    /preview·/blocks 를 한 쌍으로 다시 받아 한 번에 넣는다(refreshN5Snapshot). 같은 task 는 같은 query key 라 두 번 polling 하지 않는다.
//    재렌더 완료 재조회는 여기 한 곳만 맡는다 — 번역문 칸(TranslationEditor)은 자기 표시만 바꾸고 다시 받지 않는다.
//    저장 task 가 /tasks 목록에서 내려갔거나 cancelled 면(같은 섹션 다음 저장이 대체) 끝난 것으로 보고 한 번 다시 받는다.
//    처리한 task 는 다시 처리하지 않는다 — 이 hook 은 N5 화면 동안 유지되므로 번역 전/후 전환으로 다시 받지 않는다.
// ② 판정 d·e — 같은 상태(서명)마다 한 번만 다시 받는다. 그대로면 그 응답으로 표시를 이어간다.
// ③ 판정 g — 5초 간격 최대 12회. 한도에 닿으면 멈춘다(서버 등록 실패로 확정하지 않는다).
// ④ 지문 A≠B — 같은 (A, B) 쌍마다 /blocks·/preview 를 한 번만 다시 받는다. 계속 다르면 연결하지 않은 채 둔다(무한 재조회 없음).
// 서버 최신성(render.isCurrent)을 FE 가 다시 계산하지 않는다.
// ─────────────────────────────────────────────────────────────────

const LIMITED_REFETCH_INTERVAL_MS = 5_000;
const LIMITED_REFETCH_MAX = 12;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export function useN5PreviewSync(
  jobId: string,
  preview: PreviewViewModel | null,
  syncBySection: ReadonlyMap<number, SectionInputSync> | null,
  /** 이 화면의 저장(PATCH)이 만든 재렌더 task — null(no-op 저장)은 넣지 않는다 */
  savedTaskIds: readonly number[] = [],
) {
  const queryClient = useQueryClient();
  const sections = preview?.sections ?? [];
  // 끝난 것으로 본 task — 다시 추적(polling)하지 않는다. 재조회는 아래 effect 가 task 마다 한 번만 한다(handledTasksRef)
  const [finishedTaskIds, setFinishedTaskIds] = useState<ReadonlySet<number>>(() => new Set());
  const handledTasksRef = useRef(new Set<number>());

  // /blocks·/preview 를 한 쌍으로 다시 받는다. 받지 못하면 기존처럼 각 query 를 무효화해 오류 표시·재시도를 query 에 맡긴다
  const resync = useCallback(() => {
    refreshN5Snapshot(queryClient, jobId).catch(() => {
      void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Preview(jobId) });
      void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Blocks(jobId) });
    });
  }, [jobId, queryClient]);

  // ① 진행 중인 시도 · 이 화면 저장의 재렌더 task 추적(이미 처리한 task 는 더 보지 않는다 — polling 도 멈춘다)
  const attemptTaskIds = new Set(
    sections.flatMap((section) => {
      const attempt = section.renderState.attempt;
      return attempt && (attempt.status === 'pending' || attempt.status === 'running') ? [attempt.taskId] : [];
    }),
  );
  const savedTaskIdSet = new Set(savedTaskIds);
  const activeTaskIds = [...new Set([...attemptTaskIds, ...savedTaskIdSet])]
    .filter((taskId) => !finishedTaskIds.has(taskId))
    .sort((a, b) => a - b);
  const taskResults = useQueries({
    queries: activeTaskIds.map((taskId) => n5TaskStatusQueryOptions(jobId, taskId)),
  });
  const newlyFinished = activeTaskIds.filter((taskId, i) => {
    const data = taskResults[i]?.data;
    const item = data?.items?.find((candidate) => candidate.taskId === taskId);
    if (item != null) return TERMINAL.has(item.status ?? '');
    // 저장 task 가 목록에 없다 — 대체(superseded)됐다(TranslationEditor 와 같은 기준). /preview 시도는 기존대로 목록에 뜰 때까지 기다린다
    return data != null && savedTaskIdSet.has(taskId) && !attemptTaskIds.has(taskId);
  });
  if (newlyFinished.length > 0) setFinishedTaskIds(new Set([...finishedTaskIds, ...newlyFinished]));
  const finishedKey = [...finishedTaskIds].join(',');
  useEffect(() => {
    const fresh = [...finishedTaskIds].filter((taskId) => !handledTasksRef.current.has(taskId));
    if (fresh.length === 0) return;
    for (const taskId of fresh) handledTasksRef.current.add(taskId);
    resync();
    void queryClient.invalidateQueries({ queryKey: pixlateKeys.tasks(jobId) }); // 이전 재렌더 실패 표시를 지운다
    // finishedKey 가 바뀔 때만 다시 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedKey, jobId, queryClient, resync]);

  // ② d·e 한 번 재조회 / ④ A≠B 한 번 재조회 — 상태 서명마다 한 번
  const onceSignatures = sections.flatMap((section) => {
    const { renderState, input } = section;
    const sigs: string[] = [];
    if (renderState.refetch === 'once') {
      sigs.push(
        `render:${section.id}:${renderState.kind}:${renderState.staleReason}:${renderState.attempt?.taskId}:${renderState.result?.taskId}:${input.fingerprint}`,
      );
    }
    const sync = syncBySection?.get(section.id);
    if (sync && input.kind === 'ready' && (sync.match === 'mismatch' || sync.match === 'inconsistent')) {
      sigs.push(`ab:${section.id}:${sync.a.kind === 'value' ? sync.a.value : sync.a.kind}:${input.fingerprint}`);
    }
    return sigs;
  });
  const onceKey = onceSignatures.join('|');
  const handledOnceRef = useRef(new Set<string>());
  useEffect(() => {
    const fresh = onceSignatures.filter((sig) => !handledOnceRef.current.has(sig));
    if (fresh.length === 0) return;
    for (const sig of fresh) handledOnceRef.current.add(sig);
    resync();
    // onceKey 가 바뀔 때만 다시 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onceKey, resync]);

  // ③ g 제한 재조회 — 같은 이전 결과(서명)마다 횟수를 센다
  const limitedKey = sections
    .filter((section) => section.renderState.refetch === 'limited')
    .map((section) => `${section.id}:${section.renderState.result?.taskId}:${section.renderState.result?.rendererId}`)
    .join('|');
  const limitedCountRef = useRef(new Map<string, number>());
  useEffect(() => {
    if (!limitedKey) return;
    const timer = window.setInterval(() => {
      const count = limitedCountRef.current.get(limitedKey) ?? 0;
      if (count >= LIMITED_REFETCH_MAX) {
        window.clearInterval(timer);
        return;
      }
      limitedCountRef.current.set(limitedKey, count + 1);
      resync();
    }, LIMITED_REFETCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [limitedKey, resync]);

  // 개발 진단 — 계약 밖 조합은 정상으로 복구하지 않고 경고만 남긴다
  const diagnosticKey = sections.map((section) => `${section.id}:${diagnosePreviewSection(section.input, section.renderState).join(';')}`).join('|');
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    for (const section of sections) {
      const problems = diagnosePreviewSection(section.input, section.renderState);
      const sync = syncBySection?.get(section.id);
      if (sync?.match === 'inconsistent') problems.push('blocks: same section has different sectionInputFingerprint');
      if (sync && !sync.stylesValid) problems.push('renderInput: style outside contract');
      if (problems.length > 0) console.warn(`[N5 preview] section ${section.id}`, problems);
    }
    // diagnosticKey 가 바뀔 때만 다시 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosticKey]);
}
