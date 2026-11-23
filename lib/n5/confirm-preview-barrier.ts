/**
 * N5 [저장하러 가기] 미리보기 장벽 — 저장으로 영향을 받은 섹션의 「현재」 미리보기가 현재 저장 입력 기준으로 끝났는지 본다.
 *
 * 정본은 서버 /preview 다(resolvePreviewInputState · resolvePreviewRenderState 의 판정을 그대로 쓴다).
 * PATCH 응답으로 받은 rerenderTaskId 의 생명주기는 보지 않는다 — 같은 섹션을 이어서 저장하면 서버는 앞선 시도를
 * 취소(superseded)하고 /tasks 에서 내릴 수 있다. 과거 task 가 없거나 취소됐다는 사실은 성공도 실패도 아니다.
 * 가장 큰 taskId · 마지막 PATCH 응답 taskId 로 최신 시도를 추정하지 않는다.
 * 저장한 block 이 있으면 「현재 미리보기」에 더해 「그 미리보기·현재 서버 block 이 이번 저장 revision 을 그대로 담는가」까지 본다
 * (judgeConfirmSaveBarrier — 아래 「저장 revision 정합」).
 *
 * 순수 모듈이다(React·브라우저 API 없음, scripts/verify-n5-confirm-preview-barrier.mjs 로 Node 에서 검증).
 */

import { compareFingerprintsAB, deriveSectionFingerprintA, type PreviewInputState, type PreviewRenderState } from './preview-state.ts';

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

/* ------------------------------------------------------------------ *
 * 저장 revision 정합 — 「현재 미리보기」가 「이번에 저장한 모든 block revision」을 반영했는가
 *
 * BE release/1.1.0(8aef7c7) 확인:
 * - PATCH 는 번역문·배치가 실제로 바뀔 때만 revision 을 1 올린다(같은 값이면 그대로·rerenderTaskId=null). revision 은 줄지 않는다.
 * - /preview renderInput.blocks[].revision 은 조회 시점 DB 의 block revision 이고 입력 지문(inputFingerprint)에 들어간다.
 * - 렌더 입력 대상 = is_excluded === false · 원문(source_ko) · 번역문(trans_1) 이 모두 공백이 아닌 block
 *   (downstream._render_inputs). 빈 번역으로 저장한 block 은 renderInput 에서 빠지는 것이 정상이다.
 * - include 섹션은 render 를 항상 객체로 낸다(render=null 은 제외 섹션만). /preview 는 한 조회 시점(REPEATABLE READ) 값이다.
 * - confirm 은 기대 revision 을 받지 않는다 — 판정 뒤 ~ confirm 트랜잭션 사이의 다른 저장은 FE 가 막을 수 없다(서버 계약 필요).
 *
 * 섹션 입력 지문 A=B — revision 정합에 더하는 조건(대체하지 않는다)
 * - A = 이번 장벽 조회의 /blocks sectionInputFingerprint(그 섹션 block 들의 값, deriveSectionFingerprintA)
 * - B = 같은 회차 /preview sections[].inputFingerprint
 * - A·B 가 모두 값이고 같을 때만 완료다. 다르면 두 조회가 다른 입력을 본 것이라 다시 조회한다(bounded polling).
 *   어느 한쪽이라도 null(A=null·B=null 포함)이거나 같은 섹션의 A 가 서로 다르면 비교할 수 없어 완료로 보지 않는다.
 * ------------------------------------------------------------------ */

/** 이번 [저장하러 가기]에서 PATCH 성공 응답(block)으로 확인한 서버 정본 */
export interface ExpectedSavedBlock {
  blockId: number;
  sectionId: number;
  /** PATCH 응답 block.revision — FE 가 +1 로 추측하지 않는다 */
  revision: number;
  savedTrans1: string;
  /** 서버 렌더 입력 규칙(위)으로 본 renderInput 포함 여부 — 응답 block 값으로 정한다 */
  renderExpectation: 'present' | 'absent';
}

/** PATCH 응답 block 에서 기대값을 만든다. 식별·revision 이 없으면 null(정본으로 쓸 수 없다) */
export function toExpectedSavedBlock(block: {
  id?: number | null;
  sectionId?: number | null;
  revision?: number | null;
  trans1?: string | null;
  sourceKo?: string | null;
  isExcluded?: boolean | null;
}): ExpectedSavedBlock | null {
  if (typeof block.id !== 'number' || typeof block.sectionId !== 'number' || typeof block.revision !== 'number') return null;
  const savedTrans1 = block.trans1 ?? '';
  const isTarget = block.isExcluded === false && (block.sourceKo ?? '').trim() !== '' && savedTrans1.trim() !== '';
  return { blockId: block.id, sectionId: block.sectionId, revision: block.revision, savedTrans1, renderExpectation: isTarget ? 'present' : 'absent' };
}

/** 섹션별로 묶는다(같은 block 을 다시 저장했으면 나중 응답이 정본) */
export function groupExpectedBySection(expected: Iterable<ExpectedSavedBlock>): Map<number, Map<number, ExpectedSavedBlock>> {
  const out = new Map<number, Map<number, ExpectedSavedBlock>>();
  for (const item of expected) {
    const bySection = out.get(item.sectionId) ?? new Map<number, ExpectedSavedBlock>();
    bySection.set(item.blockId, item);
    out.set(item.sectionId, bySection);
  }
  return out;
}

/**
 * complete         = 현재 미리보기(isCurrent) + 저장한 모든 block 의 /blocks·renderInput revision 이 기대값과 같다
 * waiting-preview  = 미리보기가 아직 최신이 아니다(진행·채택 직후·입력 준비 등)
 * waiting-revision = 서버가 아직 이전 revision 을 보여 준다(기대값보다 작다) — 다시 조회한다
 * waiting-fingerprint = revision·isCurrent 는 맞지만 /blocks 지문 A 와 /preview 지문 B 가 같지 않다(다름·null·A 불일치) — 다시 조회한다
 * conflict         = 내 저장 뒤 다른 변경(기대값보다 큰 revision · 저장값과 다른 번역문 · 섹션이 제외됨)
 * failed · invalid = 기존 판정(현재 시도 실패·입력 오류 / 응답 누락·계약 밖·기대와 모순)
 */
export type ConfirmSavedSectionVerdict =
  | 'complete'
  | 'waiting-preview'
  | 'waiting-revision'
  | 'waiting-fingerprint'
  | 'conflict'
  | 'failed'
  | 'invalid';

export interface ConfirmLatestBlock {
  id: number;
  revision: number | null;
  trans1: string | null;
  sectionId: number | null;
  /** 지문 A — /blocks sectionInputFingerprint(없거나 null 이면 null) */
  sectionInputFingerprint: string | null;
}

export interface ConfirmSavedSectionInput extends ConfirmPreviewSectionInput {
  /** renderInput.blocks — adapter 의 renderBlocks(입력 준비일 때만 값) */
  renderBlocks: readonly { blockId: number; revision: number }[];
}

/** revision 비교 — 서버 revision 은 줄지 않으므로 작으면 아직 이전 값, 크면 다른 저장이다 */
function compareRevision(actual: number, expected: number): 'equal' | 'older' | 'newer' {
  return actual === expected ? 'equal' : actual < expected ? 'older' : 'newer';
}

export function judgeConfirmSavedSection(
  section: ConfirmSavedSectionInput | undefined,
  expected: readonly ExpectedSavedBlock[],
  latestBlocksById: ReadonlyMap<number, ConfirmLatestBlock>,
  /** 같은 회차 /blocks 에서 이 섹션 block 들의 지문 A 값 */
  sectionFingerprintsA: readonly (string | null)[] = [],
): ConfirmSavedSectionVerdict {
  // ① 현재 서버 block(/blocks) — 다른 저장이 있었는지를 미리보기보다 먼저 본다
  let blocksOlder = false;
  for (const item of expected) {
    const latest = latestBlocksById.get(item.blockId);
    if (!latest || typeof latest.revision !== 'number') return 'invalid';
    const order = compareRevision(latest.revision, item.revision);
    if (order === 'newer') return 'conflict';
    if (order === 'older') blocksOlder = true;
    else if ((latest.trans1 ?? '') !== item.savedTrans1) return 'conflict';
  }
  // ② 미리보기 — 기존 판정을 그대로(서버 isCurrent 가 정본)
  const preview = judgeConfirmPreviewSection(section);
  if (preview === 'excluded') return expected.length > 0 ? 'conflict' : 'complete';
  if (preview === 'invalid' || preview === 'failed') return preview;
  if (blocksOlder) return 'waiting-revision';
  if (preview === 'waiting') return 'waiting-preview';
  // ③ current — renderInput 이 이번 저장 revision 을 담고 있는가(isCurrent 에 더하는 조건)
  const renderRevision = new Map((section?.renderBlocks ?? []).map((block) => [block.blockId, block.revision]));
  let renderOlder = false;
  for (const item of expected) {
    const revision = renderRevision.get(item.blockId);
    if (revision === undefined) {
      // 빈 번역 등 렌더 대상이 아닌 저장은 빠져 있어야 정상. 대상이어야 하는데 없으면 기대와 모순
      if (item.renderExpectation === 'present') return 'invalid';
      continue;
    }
    const order = compareRevision(revision, item.revision);
    if (order === 'newer') return 'conflict';
    if (order === 'older') renderOlder = true;
    else if (item.renderExpectation === 'absent') return 'invalid';
  }
  if (renderOlder) return 'waiting-revision';
  // ④ 지문 A(/blocks) = B(/preview) — 값이 둘 다 있고 같을 때만 완료. null·다름·A 불일치는 다시 조회한다
  const match = compareFingerprintsAB(deriveSectionFingerprintA(sectionFingerprintsA), section?.input.fingerprint ?? null);
  return match === 'match' ? 'complete' : 'waiting-fingerprint';
}

export type ConfirmSaveBarrierState = 'complete' | 'waiting' | 'conflict' | 'failed' | 'invalid';

export interface ConfirmSaveBarrierResult {
  state: ConfirmSaveBarrierState;
  verdicts: Map<number, ConfirmSavedSectionVerdict>;
  /** conflict 섹션의 block 중 서버가 달라진 것(화면 선택용) */
  conflictBlockIds: number[];
}

/**
 * 저장 장벽 전체 — 저장한 섹션(기대 revision 있음)과 앞선 저장으로 미리보기만 기다리는 섹션(기대 없음)을 함께 본다.
 * 우선순위 invalid > conflict > failed > waiting > complete.
 */
export function judgeConfirmSaveBarrier(options: {
  sections: readonly ConfirmSavedSectionInput[];
  expectedBySection: ReadonlyMap<number, ReadonlyMap<number, ExpectedSavedBlock>>;
  /** 기대 revision 없이 현재 미리보기만 기다리는 섹션 */
  previewOnlySectionIds?: Iterable<number>;
  latestBlocks: readonly ConfirmLatestBlock[];
}): ConfirmSaveBarrierResult {
  const byId = new Map(options.sections.map((section) => [section.id, section]));
  const latestById = new Map(options.latestBlocks.map((block) => [block.id, block]));
  const fingerprintsBySection = new Map<number, (string | null)[]>();
  for (const block of options.latestBlocks) {
    if (block.sectionId == null) continue;
    const list = fingerprintsBySection.get(block.sectionId) ?? [];
    list.push(block.sectionInputFingerprint);
    fingerprintsBySection.set(block.sectionId, list);
  }
  const verdicts = new Map<number, ConfirmSavedSectionVerdict>();
  const conflictBlockIds: number[] = [];
  for (const [sectionId, expectedMap] of options.expectedBySection) {
    const expected = [...expectedMap.values()];
    const verdict = judgeConfirmSavedSection(byId.get(sectionId), expected, latestById, fingerprintsBySection.get(sectionId) ?? []);
    verdicts.set(sectionId, verdict);
    if (verdict === 'conflict') {
      for (const item of expected) {
        const latest = latestById.get(item.blockId);
        if (latest && (latest.revision !== item.revision || (latest.trans1 ?? '') !== item.savedTrans1)) conflictBlockIds.push(item.blockId);
      }
    }
  }
  for (const sectionId of options.previewOnlySectionIds ?? []) {
    if (verdicts.has(sectionId)) continue;
    const preview = judgeConfirmPreviewSection(byId.get(sectionId));
    verdicts.set(sectionId, preview === 'excluded' || preview === 'complete' ? 'complete' : preview === 'waiting' ? 'waiting-preview' : preview);
  }
  const values = [...verdicts.values()];
  const state: ConfirmSaveBarrierState = values.includes('invalid')
    ? 'invalid'
    : values.includes('conflict')
      ? 'conflict'
      : values.includes('failed')
        ? 'failed'
        : values.some((value) => value === 'waiting-preview' || value === 'waiting-revision' || value === 'waiting-fingerprint')
          ? 'waiting'
          : 'complete';
  return { state, verdicts, conflictBlockIds };
}
