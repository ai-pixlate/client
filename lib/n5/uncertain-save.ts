/**
 * N5 응답을 받지 못한 저장(네트워크 끊김·시간 초과)의 결과 판정 — 순수 함수(scripts/verify-n5-history.mjs 에서 검증).
 *
 * 응답이 없으면 서버가 이미 반영했는지 알 수 없다(F-CFM-03). 서버 상태(/blocks · /preview)를 다시 받은 뒤에만 이 함수로 판정한다 —
 * 다시 받지 못한 동안은 판정하지 않고 저장 잠금을 유지한다(시간이 지났다는 이유로 풀지 않는다 · 다음 저장이 409 를 돌려준다고 가정하지 않는다).
 *
 * - translation: 그 블록의 서버 번역문이 보낸 글과 같고 revision 이 보낼 때보다 커졌으면 반영됨.
 *   (같은 글이어도 revision 이 그대로면 이 요청이 반영된 것이 아니다 — 원래 같은 값이었던 경우)
 * - section: 그 섹션의 서버 bucket 이 요청한 값과 같으면 반영됨(섹션 PATCH 는 bucket 이 실제로 바뀔 때만 revision 을 올린다)
 */

export type UncertainSaveCheck =
  | { kind: 'translation'; blockId: number; text: string; sentRevision: number }
  | { kind: 'section'; sectionId: number; bucket: 'include' | 'exclude' };

export interface UncertainSaveServerSnapshot {
  blocks: readonly { id?: number | null; trans1?: string | null; revision?: number | null }[];
  sections: readonly { id?: number | null; bucket?: string | null }[];
}

export type UncertainSaveOutcome = 'applied' | 'not-applied';

export function judgeUncertainSave(check: UncertainSaveCheck, server: UncertainSaveServerSnapshot): UncertainSaveOutcome {
  if (check.kind === 'translation') {
    const block = server.blocks.find((candidate) => candidate.id === check.blockId);
    if (!block || block.revision == null) return 'not-applied';
    return (block.trans1 ?? '') === check.text && block.revision > check.sentRevision ? 'applied' : 'not-applied';
  }
  const section = server.sections.find((candidate) => candidate.id === check.sectionId);
  return section?.bucket === check.bucket ? 'applied' : 'not-applied';
}

/**
 * 서버 상태 다시 받기 한 번의 결과에 따른 다음 단계.
 * - confirmed: 다시 받았다 → 판정하고 잠금을 푼다
 * - unconfirmed: 실패했거나 상한(시간)을 넘었다 → 잠금을 그대로 두고 사용자가 [서버 상태 다시 확인]을 누를 때까지 기다린다
 */
export type UncertainRefetchResult = 'ok' | 'failed' | 'timeout';

export function nextUncertainSaveStatus(result: UncertainRefetchResult): 'confirmed' | 'unconfirmed' {
  return result === 'ok' ? 'confirmed' : 'unconfirmed';
}
