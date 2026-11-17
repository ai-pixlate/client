/**
 * N5 [저장하러 가기] 미리보기 장벽 — 저장으로 영향을 받은 섹션의 「현재」 미리보기가 현재 저장 입력 기준으로 끝났는지 본다.
 *
 * 정본은 서버 /preview 다(resolvePreviewInputState · resolvePreviewRenderState 의 판정을 그대로 쓴다).
 * PATCH 응답으로 받은 rerenderTaskId 의 생명주기는 보지 않는다 — 같은 섹션을 이어서 저장하면 서버는 앞선 시도를
 * 취소(superseded)하고 /tasks 에서 내릴 수 있다. 과거 task 가 없거나 취소됐다는 사실은 성공도 실패도 아니다.
 * 가장 큰 taskId · 마지막 PATCH 응답 taskId 로 최신 시도를 추정하지 않는다.
 *
 * 순수 모듈이다(React·브라우저 API 없음, scripts/verify-n5-confirm-preview-barrier.mjs 로 Node 에서 검증).
 */

import type { PreviewInputState, PreviewRenderState } from './preview-state';

/**
 * complete = 현재 입력 준비 + 서버 isCurrent=true
 * waiting  = 입력 준비 중 · 시도 대기/진행 · 채택 직후(adoption-pending) · 입력이 바뀌어 새 시도 대기(stale/missing) — 다시 조회한다
 * failed   = 현재 시도 실패 · 입력 오류. 이전 성공 결과가 있어도 최신이 아니다
 * invalid  = 응답에 그 섹션이 없거나 계약 밖 조합
 * excluded = 기다리는 사이 제외된 섹션 — 렌더 대상이 아니다(최신 성공으로 바꾸지 않는다)
 */
export type ConfirmPreviewSectionVerdict = 'complete' | 'waiting' | 'failed' | 'invalid' | 'excluded';

export interface ConfirmPreviewSectionInput {
  id: number;
  input: PreviewInputState;
  renderState: PreviewRenderState;
}

export function judgeConfirmPreviewSection(section: ConfirmPreviewSectionInput | undefined): ConfirmPreviewSectionVerdict {
  if (!section) return 'invalid';
  const { input, renderState } = section;
  if (input.kind === 'excluded' || renderState.kind === 'excluded') return 'excluded';
  if (input.kind === 'invalid-contract' || renderState.kind === 'invalid-contract') return 'invalid';
  if (input.kind === 'error') return 'failed';
  // 입력을 다시 만드는 중이면 그 뒤에 새 시도가 생긴다 — 이전 시도의 결과·실패로 판정하지 않는다
  if (input.kind === 'preparing') return 'waiting';
  if (renderState.kind === 'current') return 'complete';
  if (renderState.kind === 'failed') return 'failed';
  // waiting · running · stale(adoption-pending · input-changed · renderer-changed) · missing
  return 'waiting';
}

export type ConfirmPreviewBarrierState = 'complete' | 'waiting' | 'failed' | 'invalid';

export interface ConfirmPreviewBarrierResult {
  state: ConfirmPreviewBarrierState;
  verdicts: Map<number, ConfirmPreviewSectionVerdict>;
}

/** 대상 섹션 전체 판정 — invalid > failed > waiting > complete. 제외된 섹션은 기다리지 않는다 */
export function judgeConfirmPreviewBarrier(
  sections: readonly ConfirmPreviewSectionInput[],
  sectionIds: Iterable<number>,
): ConfirmPreviewBarrierResult {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const verdicts = new Map<number, ConfirmPreviewSectionVerdict>();
  for (const id of sectionIds) verdicts.set(id, judgeConfirmPreviewSection(byId.get(id)));
  const values = [...verdicts.values()];
  const state: ConfirmPreviewBarrierState = values.includes('invalid')
    ? 'invalid'
    : values.includes('failed')
      ? 'failed'
      : values.includes('waiting')
        ? 'waiting'
        : 'complete';
  return { state, verdicts };
}

/**
 * 앞선 저장([확인]·실행 취소 등)으로 미리보기가 아직 만들어지는 중인 섹션 — 클릭 시점 /preview 기준.
 * 시도가 대기·진행 중이거나 막 끝나 채택을 기다리는 섹션만 넣는다. 이미 끝났거나(최신·실패) 제외된 섹션,
 * 새 시도 없이 이전 결과만 남은 섹션은 넣지 않는다(실패는 기존 확인 항목·실패 표시가 맡는다).
 */
export function isConfirmPreviewSettling(section: ConfirmPreviewSectionInput | undefined): boolean {
  return isSectionPreviewInProgress(section);
}

/**
 * 섹션의 현재 미리보기 시도가 진행 중인지(대기·진행·채택 직후) — 번역문 칸의 「재렌더링 중…」이 자기 task 를 잃었을 때
 * (같은 섹션의 후속 저장이 대체해 /tasks 에서 사라지거나 cancelled) 섹션 현재 상태로 이어 보는 데도 쓴다.
 */
export function isSectionPreviewInProgress(section: ConfirmPreviewSectionInput | undefined): boolean {
  if (judgeConfirmPreviewSection(section) !== 'waiting' || !section) return false;
  const { renderState } = section;
  return renderState.kind === 'waiting' || renderState.kind === 'running' || renderState.staleReason === 'adoption-pending';
}
