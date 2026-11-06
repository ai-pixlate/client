'use client';

import { useEffect, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';

import type { PreviewViewModel, SectionInputSync } from '@/lib/n5/adapter';
import { diagnosePreviewSection } from '@/lib/n5/preview-state';
import { n5TaskStatusQueryOptions, pixlateKeys } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// N5 /preview 재조회 계기(reviewPreview 「렌더 입력과 시도·결과」·ReviewPreview 설명)를 한 곳에서 맡는다.
// ① render.attempt 가 pending·running 이면 그 taskId 를 /tasks 로 추적하고 끝나면 /preview·/blocks 를 다시 받는다.
//    저장 응답 rerenderTaskId 와 같은 query key 를 써서 같은 task 를 두 번 polling 하지 않는다.
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
) {
  const queryClient = useQueryClient();
  const sections = preview?.sections ?? [];

  // ① 진행 중인 시도 추적
  const activeTaskIds = [
    ...new Set(
      sections.flatMap((section) => {
        const attempt = section.renderState.attempt;
        return attempt && (attempt.status === 'pending' || attempt.status === 'running') ? [attempt.taskId] : [];
      }),
    ),
  ].sort((a, b) => a - b);
  const taskResults = useQueries({
    queries: activeTaskIds.map((taskId) => n5TaskStatusQueryOptions(jobId, taskId)),
  });
  const finishedTaskIds = activeTaskIds.filter((taskId, i) => {
    const item = taskResults[i]?.data?.items?.find((candidate) => candidate.taskId === taskId);
    return item != null && TERMINAL.has(item.status ?? '');
  });
  const finishedKey = finishedTaskIds.join(',');
  const handledTasksRef = useRef(new Set<number>());
  useEffect(() => {
    const fresh = finishedTaskIds.filter((taskId) => !handledTasksRef.current.has(taskId));
    if (fresh.length === 0) return;
    for (const taskId of fresh) handledTasksRef.current.add(taskId);
    void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Preview(jobId) });
    void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Blocks(jobId) });
    void queryClient.invalidateQueries({ queryKey: pixlateKeys.tasks(jobId) });
    // finishedKey 가 바뀔 때만 다시 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedKey, jobId, queryClient]);

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
    void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Preview(jobId) });
    if (fresh.some((sig) => sig.startsWith('ab:'))) void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Blocks(jobId) });
    // onceKey 가 바뀔 때만 다시 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onceKey, jobId, queryClient]);

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
      void queryClient.invalidateQueries({ queryKey: pixlateKeys.n5Preview(jobId) });
    }, LIMITED_REFETCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [limitedKey, jobId, queryClient]);

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
