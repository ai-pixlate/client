// N5 [저장하러 가기] 미리보기 장벽 판정 검증 (lib/n5/confirm-preview-barrier.ts)
// 실행: npm run verify:n5-confirm-barrier
//
// /preview 를 adapter(toPreviewViewModel) 로 바꾼 뒤 장벽 판정을 본다 — 화면과 같은 판정(preview-state.ts)을 쓰는지 확인한다.

import { toPreviewViewModel } from '../lib/n5/adapter.ts';
import {
  groupExpectedBySection,
  isConfirmPreviewSettling,
  judgeConfirmPreviewBarrier,
  judgeConfirmPreviewSection,
  judgeConfirmSaveBarrier,
  toExpectedSavedBlock,
} from '../lib/n5/confirm-preview-barrier.ts';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
}

const FP_NEW = 'b'.repeat(64);
const FP_OLD = 'c'.repeat(64);
const RENDERER = { rendererId: 'pillow-typeset/2+pillow-11.0.0', bundleId: null };
const STYLE = { fontFamily: 'Pretendard', fontWeight: 600, fontSizePx: 40, fontScale: 1, fontColor: '#1A2B3C', align: 'center', letterSpacingEm: -0.03, lineHeightRatio: 1.2 };
const renderInput = (id) => ({
  section: { id, width: 1000, height: 500, background: { url: '/bg.png', source: 'inpaint', sha256: null } },
  blocks: [{ blockId: id * 10, revision: 3, text: 'Hello', box: { x: 10, y: 20, w: 300, h: 60 }, style: STYLE }],
});
const result = (taskId, fp, overflow = null) => ({ taskId, inputFingerprint: fp, rendererId: RENDERER.rendererId, overflow });
const attempt = (taskId, status) => ({ taskId, status, errorCode: status === 'failed' ? 'PREVIEW_FAILED' : null, retryable: status === 'failed' });

function section(id, over = {}) {
  return {
    id,
    sectionOrder: id,
    bucket: 'include',
    excludedStage: null,
    sourceImageId: id,
    width: 1000,
    height: 500,
    displayTop: 0,
    originalUrl: '/o.png',
    renderedUrl: '/r.png',
    renderInput: renderInput(id),
    inputFingerprint: FP_NEW,
    inputError: null,
    render: { attempt: attempt(135, 'done'), result: result(135, FP_NEW, { [id * 10]: false }), isCurrent: true },
    signals: [],
    revision: 1,
    ...over,
  };
}
const vm = (...sections) => toPreviewViewModel({ maxOriginalWidth: 1000, previewWidth: 500, scale: 0.5, renderer: RENDERER, sections }).sections;
const one = (over) => judgeConfirmPreviewSection(vm(section(501, over))[0]);

console.log('\n[섹션 판정]');
check('current(isCurrent=true · 입력 준비) → complete', one({}) === 'complete');
// 실 BE 재현 — 133·134 는 대체돼 어디에도 없고 135 만 현재 시도·결과다. 과거 task 를 보지 않으므로 그대로 complete
check('대체된 과거 task 와 무관하게 현재 135 done+current → complete', one({ render: { attempt: attempt(135, 'done'), result: result(135, FP_NEW, { 5010: false }), isCurrent: true } }) === 'complete');
check('pending → waiting', one({ render: { attempt: attempt(135, 'pending'), result: result(81, FP_OLD), isCurrent: false } }) === 'waiting');
check('running → waiting', one({ render: { attempt: attempt(135, 'running'), result: result(81, FP_OLD), isCurrent: false } }) === 'waiting');
check('done 직후 채택 전(result 없음·taskId 불일치) → waiting(adoption-pending)', one({ render: { attempt: attempt(135, 'done'), result: result(81, FP_OLD), isCurrent: false } }) === 'waiting');
check('done 직후 결과 없음 → waiting', one({ render: { attempt: attempt(135, 'done'), result: null, isCurrent: false } }) === 'waiting');
check('입력이 바뀌었는데 새 시도 없음(stale input-changed) → waiting', one({ render: { attempt: null, result: result(81, FP_OLD), isCurrent: false } }) === 'waiting');
check('현재 시도 failed · 이전 성공 결과 있음 → failed(최신 아님)', one({ render: { attempt: attempt(135, 'failed'), result: result(81, FP_OLD), isCurrent: false } }) === 'failed');
check('입력 준비 중 + 이전 시도 실패 → waiting(새 입력 뒤 새 시도)', one({ renderInput: null, inputFingerprint: null, render: { attempt: attempt(81, 'failed'), result: null, isCurrent: false } }) === 'waiting');
check('입력 오류 → failed', one({ renderInput: null, inputFingerprint: null, inputError: { code: 'STYLE_RESULT_INVALID', blockIds: [5010] }, render: { attempt: null, result: null, isCurrent: false } }) === 'failed');
check('기다리는 사이 제외 → excluded(최신 성공으로 바꾸지 않는다)', one({ bucket: 'exclude', excludedStage: 'N5', renderInput: null, inputFingerprint: null, render: null }) === 'excluded');
check('isCurrent=true 인데 overflow 없음(계약 밖) → invalid', one({ render: { attempt: attempt(135, 'done'), result: result(135, FP_NEW, null), isCurrent: true } }) === 'invalid');
check('응답에 섹션 없음 → invalid', judgeConfirmPreviewSection(undefined) === 'invalid');
// isCurrent 가 정본 — 결과 지문이 다른 섹션도 FE 가 최신이라고 덮어쓰지 않는다
check('isCurrent=false 이면 결과 지문이 입력과 같아도 complete 아님', one({ render: { attempt: null, result: result(135, FP_NEW), isCurrent: false } }) !== 'complete');

console.log('\n[장벽 전체]');
const multi = vm(
  section(501),
  section(502, { render: { attempt: attempt(136, 'running'), result: result(82, FP_OLD), isCurrent: false } }),
  section(503, { render: { attempt: attempt(137, 'failed'), result: result(83, FP_OLD), isCurrent: false } }),
);
check('501 current · 502 running → waiting', judgeConfirmPreviewBarrier(multi, [501, 502]).state === 'waiting');
check('501 current 만 → complete', judgeConfirmPreviewBarrier(multi, [501]).state === 'complete');
check('실패가 있으면 진행 중보다 failed 가 먼저', judgeConfirmPreviewBarrier(multi, [501, 502, 503]).state === 'failed');
check('없는 섹션이 섞이면 invalid', judgeConfirmPreviewBarrier(multi, [501, 999]).state === 'invalid');
check('대상 없음 → complete(기다리지 않는다)', judgeConfirmPreviewBarrier(multi, []).state === 'complete');
const excludedMix = vm(section(501), section(504, { bucket: 'exclude', excludedStage: 'N5', renderInput: null, inputFingerprint: null, render: null }));
const mixed = judgeConfirmPreviewBarrier(excludedMix, [501, 504]);
check('제외된 섹션은 기다리지 않는다 · 판정은 excluded 로 남는다', mixed.state === 'complete' && mixed.verdicts.get(504) === 'excluded');

console.log('\n[앞선 저장 섹션 — 클릭 시점에 진행 중일 때만 포함]');
const earlier = vm(
  section(501, { render: { attempt: attempt(140, 'running'), result: result(81, FP_OLD), isCurrent: false } }),
  section(502, { render: { attempt: attempt(141, 'done'), result: result(82, FP_OLD), isCurrent: false } }),
  section(503, { render: { attempt: null, result: result(83, FP_OLD), isCurrent: false } }),
  section(504, { render: { attempt: attempt(142, 'failed'), result: result(84, FP_OLD), isCurrent: false } }),
  section(505),
);
const settling = (id) => isConfirmPreviewSettling(earlier.find((s) => s.id === id));
check('running → 포함', settling(501));
check('done 채택 직후 → 포함', settling(502));
check('새 시도 없는 이전 결과(stale input-changed) → 미포함', !settling(503));
check('이미 실패 → 미포함(기존 실패 표시가 맡는다)', !settling(504));
check('current → 미포함', !settling(505));

console.log('\n[저장 revision 정합 — 기대값 만들기]');
const savedA = toExpectedSavedBlock({ id: 11, sectionId: 501, revision: 12, trans1: 'Hello A', sourceKo: '원문', isExcluded: false });
check('PATCH 응답 block 그대로(revision 12 · present)', savedA?.revision === 12 && savedA.renderExpectation === 'present' && savedA.savedTrans1 === 'Hello A');
check('빈 번역 저장 → absent', toExpectedSavedBlock({ id: 12, sectionId: 501, revision: 14, trans1: '', sourceKo: '원문', isExcluded: false })?.renderExpectation === 'absent');
check('공백만 있는 번역 → absent(BE trim 규칙)', toExpectedSavedBlock({ id: 12, sectionId: 501, revision: 14, trans1: '   ', sourceKo: '원문', isExcluded: false })?.renderExpectation === 'absent');
check('라벨·로고(isExcluded=true) → absent', toExpectedSavedBlock({ id: 13, sectionId: 501, revision: 2, trans1: 'x', sourceKo: '원문', isExcluded: true })?.renderExpectation === 'absent');
check('isExcluded=null → absent(BE: is_excluded is False 만 대상)', toExpectedSavedBlock({ id: 13, sectionId: 501, revision: 2, trans1: 'x', sourceKo: '원문', isExcluded: null })?.renderExpectation === 'absent');
check('빈 원문 → absent', toExpectedSavedBlock({ id: 13, sectionId: 501, revision: 2, trans1: 'x', sourceKo: ' ', isExcluded: false })?.renderExpectation === 'absent');
check('revision 없음 → null(정본으로 쓰지 않는다)', toExpectedSavedBlock({ id: 13, sectionId: 501, revision: null, trans1: 'x', sourceKo: '원문', isExcluded: false }) === null);

console.log('\n[저장 revision 정합 — 판정]');
const STYLE_OK = STYLE;
const rblock = (blockId, revision) => ({ blockId, revision, text: 'T', box: { x: 10, y: 20, w: 300, h: 60 }, style: STYLE_OK });
function savedSection(id, blocks, over = {}) {
  return section(id, {
    renderInput: { section: { id, width: 1000, height: 500, background: { url: '/bg.png', source: 'inpaint', sha256: null } }, blocks },
    render: { attempt: attempt(135, 'done'), result: result(135, FP_NEW, Object.fromEntries(blocks.map((b) => [b.blockId, false]))), isCurrent: true },
    ...over,
  });
}
const exp = (blockId, sectionId, revision, renderExpectation = 'present', savedTrans1 = `t${blockId}`) => ({ blockId, sectionId, revision, savedTrans1, renderExpectation });
const latest = (...rows) => rows.map(([id, revision, trans1]) => ({ id, revision, trans1: trans1 ?? `t${id}` }));
const judge = (sections, expectedList, latestBlocks, previewOnly = []) =>
  judgeConfirmSaveBarrier({ sections, expectedBySection: groupExpectedBySection(expectedList), previewOnlySectionIds: previewOnly, latestBlocks });

const s3 = vm(savedSection(501, [rblock(11, 12), rblock(12, 7), rblock(13, 19)]));
const e3 = [exp(11, 501, 12), exp(12, 501, 7), exp(13, 501, 19)];
check('같은 섹션 3 block 모두 일치 → complete', judge(s3, e3, latest([11, 12], [12, 7], [13, 19])).state === 'complete');
check('마지막 C 만 맞고 A 가 이전 revision(renderInput 11) → waiting', judge(vm(savedSection(501, [rblock(11, 11), rblock(12, 7), rblock(13, 19)])), e3, latest([11, 12], [12, 7], [13, 19])).state === 'waiting');
check('/blocks 가 아직 이전 revision → waiting', judge(s3, e3, latest([11, 11], [12, 7], [13, 19])).state === 'waiting');
const newer = judge(vm(savedSection(501, [rblock(11, 13), rblock(12, 7), rblock(13, 19)])), e3, latest([11, 13], [12, 7], [13, 19]));
check('다른 탭 저장(/blocks·renderInput 13 > 기대 12) → conflict · 그 block 표시', newer.state === 'conflict' && newer.conflictBlockIds.includes(11));
check('renderInput 만 더 큰 revision → conflict', judge(vm(savedSection(501, [rblock(11, 13), rblock(12, 7), rblock(13, 19)])), e3, latest([11, 12], [12, 7], [13, 19])).state === 'conflict');
check('같은 revision 인데 번역문이 저장값과 다름 → conflict', judge(s3, e3, latest([11, 12, 'other'], [12, 7], [13, 19])).state === 'conflict');
check('isCurrent=false 이면 revision 이 맞아도 complete 아님(waiting)', judge(vm(savedSection(501, [rblock(11, 12), rblock(12, 7), rblock(13, 19)], { render: { attempt: attempt(136, 'running'), result: result(81, FP_OLD), isCurrent: false } })), e3, latest([11, 12], [12, 7], [13, 19])).state === 'waiting');
const blank = [exp(11, 501, 12), exp(12, 501, 14, 'absent', '')];
check('빈 번역(absent) 이 renderInput 에 없고 revision·번역문 일치 → complete', judge(vm(savedSection(501, [rblock(11, 12)])), blank, latest([11, 12], [12, 14, ''])).state === 'complete');
check('빈 번역도 /blocks revision 검증은 한다(15 → conflict)', judge(vm(savedSection(501, [rblock(11, 12)])), blank, latest([11, 12], [12, 15, ''])).state === 'conflict');
check('렌더 대상(present)인데 renderInput 에 없음 → invalid', judge(vm(savedSection(501, [rblock(12, 7), rblock(13, 19)])), e3, latest([11, 12], [12, 7], [13, 19])).state === 'invalid');
check('absent 인데 같은 revision 으로 renderInput 에 있음 → invalid', judge(vm(savedSection(501, [rblock(11, 12), rblock(12, 14)])), blank, latest([11, 12], [12, 14, ''])).state === 'invalid');
check('/blocks 에 저장한 block 이 없음 → invalid', judge(s3, e3, latest([11, 12], [12, 7])).state === 'invalid');
check('inputError → failed', judge(vm(savedSection(501, [], { renderInput: null, inputFingerprint: null, inputError: { code: 'RENDER_INPUT_INVALID', blockIds: [11] }, render: { attempt: null, result: null, isCurrent: false } })), e3, latest([11, 12], [12, 7], [13, 19])).state === 'failed');
check('현재 시도 failed(이전 결과 있음) → failed', judge(vm(savedSection(501, [rblock(11, 12), rblock(12, 7), rblock(13, 19)], { render: { attempt: attempt(136, 'failed'), result: result(81, FP_OLD), isCurrent: false } })), e3, latest([11, 12], [12, 7], [13, 19])).state === 'failed');
check('include 섹션 render=null → invalid', judge(vm(savedSection(501, [rblock(11, 12)], { render: null })), [exp(11, 501, 12)], latest([11, 12])).state === 'invalid');
check('저장한 섹션이 그사이 제외됨 → conflict(최신 성공으로 보지 않는다)', judge(vm(section(501, { bucket: 'exclude', excludedStage: 'N5', renderInput: null, inputFingerprint: null, render: null })), [exp(11, 501, 12)], latest([11, 12])).state === 'conflict');
const two = vm(savedSection(501, [rblock(11, 12)]), savedSection(502, [rblock(21, 4)], { render: { attempt: attempt(140, 'running'), result: result(82, FP_OLD), isCurrent: false } }));
check('여러 섹션 — 501 완료 · 502 진행 중 → waiting', judge(two, [exp(11, 501, 12), exp(21, 502, 4)], latest([11, 12], [21, 4])).state === 'waiting');
const twoDone = vm(savedSection(501, [rblock(11, 12)]), savedSection(502, [rblock(21, 4)]));
check('여러 섹션 — 둘 다 완료 → complete', judge(twoDone, [exp(11, 501, 12), exp(21, 502, 4)], latest([11, 12], [21, 4])).state === 'complete');
check('기대 없는 앞선 저장 섹션(preview only) 진행 중 → waiting', judge(two, [exp(11, 501, 12)], latest([11, 12]), [502]).state === 'waiting');
check('기대·대상 없음 → complete', judge(twoDone, [], []).state === 'complete');
check('같은 block 을 다시 저장하면 나중 응답이 정본', groupExpectedBySection([exp(11, 501, 12), exp(11, 501, 13)]).get(501).get(11).revision === 13);

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
