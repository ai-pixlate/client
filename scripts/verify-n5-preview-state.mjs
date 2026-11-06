// N5 /preview 렌더 입력·시도·결과 판정 검증 (lib/n5/preview-state.ts · adapter syncPreviewWithBlocks · typeset 서버 style)
// 실행: npm run verify:n5-preview-state

import {
  compareFingerprintsAB,
  deriveSectionFingerprintA,
  diagnosePreviewSection,
  resolvePreviewInputState,
  resolvePreviewRenderState,
  resolvePreviewSectionDisplay,
  resolvePreviewSectionLabels,
  toTypesetServerStyle,
} from '../lib/n5/preview-state.ts';
import { getServerOverflow, syncPreviewWithBlocks, toBlockViewModel, toPreviewViewModel } from '../lib/n5/adapter.ts';
import { resolveServerFontPx, typesetBlockStyle } from '../lib/n5/typeset-rules.ts';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
}

const FP_B = 'b'.repeat(64);
const FP_OLD = 'c'.repeat(64);
const RENDERER = { rendererId: 'pillow-typeset/2+pillow-11.0.0', bundleId: null };
const STYLE = {
  fontFamily: 'Pretendard',
  fontWeight: 600,
  fontSizePx: 40,
  fontScale: 1,
  fontColor: '#1A2B3C',
  align: 'center',
  letterSpacingEm: -0.03,
  lineHeightRatio: 1.2,
};
const RENDER_INPUT = {
  section: { id: 1, width: 1000, height: 500, background: { url: '/bg.png', source: 'inpaint', sha256: null } },
  blocks: [{ blockId: 11, revision: 3, text: 'Hello', box: { x: 10, y: 20, w: 300, h: 60 }, style: STYLE }],
};
const result = (fp, overflow, rendererId = RENDERER.rendererId, taskId = 7) => ({ taskId, inputFingerprint: fp, rendererId, overflow });
const attempt = (status, taskId = 7, retryable = false) => ({ taskId, status, errorCode: status === 'failed' ? 'PREVIEW_FAILED' : null, retryable });

function section(over = {}) {
  return {
    id: 1,
    sectionOrder: 1,
    bucket: 'include',
    excludedStage: null,
    sourceImageId: 1,
    width: 1000,
    displayTop: 0,
    height: 500,
    originalUrl: '/o.png',
    renderedUrl: '/r.png',
    renderInput: RENDER_INPUT,
    inputFingerprint: FP_B,
    inputError: null,
    render: { attempt: attempt('done'), result: result(FP_B, { 11: true }), isCurrent: true },
    signals: [],
    revision: 4,
    ...over,
  };
}
const renderOf = (s) => resolvePreviewRenderState(s, RENDERER, resolvePreviewInputState(s).kind);

console.log('\n[입력 상태] renderInput · inputFingerprint · inputError 세 필드의 조합');
{
  check('ready — 값·값·null', resolvePreviewInputState(section()).kind === 'ready');
  check('ready 의 지문 B 는 inputFingerprint', resolvePreviewInputState(section()).fingerprint === FP_B);
  check('preparing — null·null·null', resolvePreviewInputState(section({ renderInput: null, inputFingerprint: null })).kind === 'preparing');
  const err = resolvePreviewInputState(section({ renderInput: null, inputFingerprint: null, inputError: { code: 'STYLE_RESULT_INVALID', blockIds: [11] } }));
  check('error — null·null·값, 원래 코드를 보존', err.kind === 'error' && err.errorCode === 'STYLE_RESULT_INVALID' && err.errorBlockIds[0] === 11);
  check('excluded — bucket=exclude', resolvePreviewInputState(section({ bucket: 'exclude', render: null, renderInput: null, inputFingerprint: null })).kind === 'excluded');
  check('invalid — renderInput 만 있고 지문 null', resolvePreviewInputState(section({ inputFingerprint: null })).kind === 'invalid-contract');
  check('invalid — 지문만 있고 renderInput null', resolvePreviewInputState(section({ renderInput: null })).kind === 'invalid-contract');
  check('invalid — 정상 입력인데 inputError 도 있음', resolvePreviewInputState(section({ inputError: { code: 'X', blockIds: [] } })).kind === 'invalid-contract');
  const legacy = section();
  delete legacy.renderInput;
  delete legacy.render;
  const legacyState = resolvePreviewInputState(legacy);
  check('키가 빠진 응답(배포 전 서버)은 정상으로 해석하지 않는다', legacyState.kind === 'invalid-contract' && /missing keys/.test(legacyState.problem));
}

console.log('\n[렌더 상태] attempt · result · isCurrent');
{
  const current = renderOf(section());
  check('a isCurrent=true → current', current.kind === 'current');
  check('current 의 overflow 는 블록 ID Map', current.overflowByBlockId?.get(11) === true && current.overflowByBlockId.size === 1);
  check('current 인데 overflow null 이면 계약 밖', renderOf(section({ render: { attempt: attempt('done'), result: result(FP_B, null), isCurrent: true } })).kind === 'invalid-contract');
  check('b pending → waiting', renderOf(section({ render: { attempt: attempt('pending', 8), result: null, isCurrent: false } })).kind === 'waiting');
  const running = renderOf(section({ render: { attempt: attempt('running', 8), result: result(FP_OLD, null), isCurrent: false } }));
  check('b running → running, 이전 결과는 남지만 넘침 없음', running.kind === 'running' && running.result?.taskId === 7 && running.overflowByBlockId === null);
  const failed = renderOf(section({ render: { attempt: attempt('failed', 8, true), result: null, isCurrent: false } }));
  check('c failed → failed, retryable 보존', failed.kind === 'failed' && failed.attempt.retryable === true && failed.refetch === 'none');
  const adopting = renderOf(section({ render: { attempt: attempt('done', 8), result: result(FP_OLD, null), isCurrent: false } }));
  check('d done 인데 result.taskId 가 다르다 → 한 번 재조회', adopting.kind === 'stale' && adopting.refetch === 'once' && adopting.staleReason === 'adoption-pending');
  const adoptingNone = renderOf(section({ render: { attempt: attempt('done', 8), result: null, isCurrent: false } }));
  check('d done 인데 result 없음 → missing·한 번 재조회', adoptingNone.kind === 'missing' && adoptingNone.refetch === 'once');
  const rendererChanged = renderOf(section({ render: { attempt: null, result: result(FP_OLD, null, 'pillow-typeset/1+old'), isCurrent: false } }));
  check('g 렌더러가 다름 → stale·제한 재조회', rendererChanged.kind === 'stale' && rendererChanged.refetch === 'limited');
  const inputChanged = renderOf(section({ render: { attempt: attempt('done'), result: result(FP_OLD, null), isCurrent: false } }));
  check('e① 같은 task·입력만 바뀜 → stale·한 번 재조회', inputChanged.kind === 'stale' && inputChanged.refetch === 'once' && inputChanged.staleReason === 'input-changed');
  const missing = renderOf(section({ render: { attempt: null, result: null, isCurrent: false } }));
  check('e② 정상 입력인데 시도·결과 없음 → missing·한 번 재조회', missing.kind === 'missing' && missing.refetch === 'once');
  check(
    'e② 입력 준비 중이면 재조회하지 않는다',
    renderOf(section({ renderInput: null, inputFingerprint: null, render: { attempt: null, result: null, isCurrent: false } })).refetch === 'none',
  );
  check('포함 섹션의 render=null 은 계약 밖', renderOf(section({ render: null })).kind === 'invalid-contract');
  check('제외 섹션은 렌더 상태를 판정하지 않는다', renderOf(section({ bucket: 'exclude', excludedStage: 'N5', render: null })).kind === 'excluded');
  check('rendererId 는 파싱하지 않는다 — 같은 문자열이면 같은 렌더러', renderOf(section({ render: { attempt: null, result: result(FP_OLD, null), isCurrent: false } })).staleReason === 'input-changed');
}

console.log('\n[입력 준비 중 ≠ 렌더 실패] 두 사실을 함께 가진다');
{
  const s = section({ renderInput: null, inputFingerprint: null, render: { attempt: attempt('failed', 9, true), result: null, isCurrent: false } });
  const input = resolvePreviewInputState(s);
  const render = renderOf(s);
  check('입력 = preparing', input.kind === 'preparing');
  check('렌더 = failed', render.kind === 'failed');
  const labels = resolvePreviewSectionLabels(input, render, 'incomparable');
  check('「렌더 대기 중」으로 뭉개지 않고 실패로 표시', labels.renderFailed === true && labels.progressLabel === null);
  check('입력 오류 문구는 내지 않는다', labels.notice === null);
  check('화면 = 원본(결과 없음)', resolvePreviewSectionDisplay({ input, render, match: 'incomparable', canTypeset: true }).kind === 'original');
}

console.log('\n[입력 오류] 렌더 실패와 다른 상태 · 다시 시도 대상 아님');
{
  const s = section({ renderInput: null, inputFingerprint: null, inputError: { code: 'RENDER_INPUT_INVALID', blockIds: [] }, render: { attempt: null, result: null, isCurrent: false } });
  const input = resolvePreviewInputState(s);
  const render = renderOf(s);
  const labels = resolvePreviewSectionLabels(input, render, 'incomparable');
  check('입력 오류 안내', labels.notice === '미리보기 입력 오류');
  check('렌더 실패가 아니다(다시 시도 행 없음)', labels.renderFailed === false);
  const withPrevious = section({ renderInput: null, inputFingerprint: null, inputError: { code: 'X', blockIds: [] }, render: { attempt: null, result: result(FP_OLD, null), isCurrent: false } });
  const d = resolvePreviewSectionDisplay({ input: resolvePreviewInputState(withPrevious), render: renderOf(withPrevious), match: 'incomparable', canTypeset: true });
  check('이전 결과가 있으면 이미지를 보이되 최신이 아니다', d.kind === 'image' && d.isLatest === false);
}

console.log('\n[표시 규칙] 결과가 없을 때 · 이전 결과 · 최신 결과');
{
  const disp = (s, match = 'match', canTypeset = true) =>
    resolvePreviewSectionDisplay({ input: resolvePreviewInputState(s), render: renderOf(s), match, canTypeset });
  check('정상·A=B·최신·그릴 수 있음 → HTML 조판', disp(section()).kind === 'typeset');
  check('A≠B 면 조판하지 않고 최신 결과 이미지', disp(section(), 'mismatch').kind === 'image' && disp(section(), 'mismatch').isLatest === true);
  check('A·B 비교 불가(null)도 조판하지 않는다', disp(section(), 'incomparable').kind === 'image');
  check('글꼴 미준비 등으로 그릴 수 없으면 서버 이미지', disp(section(), 'match', false).kind === 'image');
  check('pending·결과 없음 → 빈 면 + 대기 문구', disp(section({ render: { attempt: attempt('pending'), result: null, isCurrent: false } })).kind === 'pending');
  check('failed·결과 없음 → 원본', disp(section({ render: { attempt: attempt('failed'), result: null, isCurrent: false } })).kind === 'original');
  check('시도 없음·결과 없음 → 원본', disp(section({ render: { attempt: null, result: null, isCurrent: false } })).kind === 'original');
  const stale = disp(section({ render: { attempt: attempt('running', 8), result: result(FP_OLD, null), isCurrent: false } }));
  check('진행 중 + 이전 결과 → 이전 이미지(최신 아님)', stale.kind === 'image' && stale.isLatest === false);
  check('입력 준비 중 + 이전 결과 → 이전 이미지', disp(section({ renderInput: null, inputFingerprint: null, render: { attempt: null, result: result(FP_OLD, null), isCurrent: false } })).kind === 'image');
  const prep = section({ renderInput: null, inputFingerprint: null, render: { attempt: null, result: null, isCurrent: false } });
  check('입력 준비 중 + 결과 없음 → 원본', disp(prep).kind === 'original');
  check('… 문구는 렌더 대기 중', resolvePreviewSectionLabels(resolvePreviewInputState(prep), renderOf(prep), 'incomparable').progressLabel === '렌더 대기 중');
  const legacy = section();
  delete legacy.render;
  check('키가 빠진 응답은 기존 표시(legacy)', disp(legacy).kind === 'legacy');
}

console.log('\n[문구] 진행 · 안내');
{
  const labels = (s, match = 'match') => resolvePreviewSectionLabels(resolvePreviewInputState(s), renderOf(s), match);
  check('최신 → 문구 없음', labels(section()).progressLabel === null && labels(section()).notice === null);
  check('running + 이전 결과 → 렌더링 중 · 최신 미리보기 아님', (() => {
    const l = labels(section({ render: { attempt: attempt('running', 8), result: result(FP_OLD, null), isCurrent: false } }));
    return l.progressLabel === '렌더링 중' && l.notice === '최신 미리보기 아님';
  })());
  check('pending → 렌더 대기 중', labels(section({ render: { attempt: attempt('pending'), result: null, isCurrent: false } })).progressLabel === '렌더 대기 중');
  check('missing → 미리보기 없음', labels(section({ render: { attempt: null, result: null, isCurrent: false } })).notice === '미리보기 없음');
  check('A≠B → 최신 내용을 불러오는 중', labels(section(), 'mismatch').notice === '최신 내용을 불러오는 중');
}

console.log('\n[지문 A/B] null 은 비교하지 않는다');
{
  check('A 값 하나', deriveSectionFingerprintA(['a', 'a', null]).kind === 'value');
  check('A 모두 null → none', deriveSectionFingerprintA([null, undefined]).kind === 'none');
  check('같은 섹션에서 값이 다르면 inconsistent(하나를 고르지 않는다)', deriveSectionFingerprintA(['a', 'b']).kind === 'inconsistent');
  check('A=B → match', compareFingerprintsAB({ kind: 'value', value: FP_B }, FP_B) === 'match');
  check('A≠B → mismatch', compareFingerprintsAB({ kind: 'value', value: FP_OLD }, FP_B) === 'mismatch');
  check('null === null 을 일치로 보지 않는다', compareFingerprintsAB({ kind: 'none' }, null) === 'incomparable');
  check('B 만 null → incomparable', compareFingerprintsAB({ kind: 'value', value: FP_B }, null) === 'incomparable');
  check('inconsistent 는 그대로 전달', compareFingerprintsAB({ kind: 'inconsistent', values: ['a', 'b'] }, FP_B) === 'inconsistent');
}

console.log('\n[C 와 isCurrent] FE 는 서버 값을 따른다 — 어긋나면 진단만');
{
  const s = section({ render: { attempt: attempt('done'), result: result(FP_OLD, {}), isCurrent: true } });
  const input = resolvePreviewInputState(s);
  const render = renderOf(s);
  check('isCurrent=true 이면 current 로 둔다(FE 가 덮지 않는다)', render.kind === 'current');
  check('C≠B 를 계약 위반으로 진단', diagnosePreviewSection(input, render).some((p) => /isCurrent=true but/.test(p)));
  check('정상 응답은 진단 없음', diagnosePreviewSection(resolvePreviewInputState(section()), renderOf(section())).length === 0);
}

console.log('\n[서버 style] 8키 그대로 · 글자 크기는 한 번만 곱한다');
{
  const style = toTypesetServerStyle(STYLE);
  check('색은 받은 문자열 그대로(소문자화·alpha 없음)', style?.fontColor === '#1A2B3C');
  check('align 보존', style?.align === 'center');
  check('align 이 계약 밖이면 null', toTypesetServerStyle({ ...STYLE, align: 'justify' }) === null);
  check('색 형식이 계약 밖이면 null', toTypesetServerStyle({ ...STYLE, fontColor: '#123' }) === null);
  check('fontSizePx × 서버 fontScale', resolveServerFontPx({ ...style, fontScale: 1.25 }) === 50);
  check('세션 배율이 있으면 fontSizePx × 세션 절대 배율(서버 배율과 곱하지 않는다)', resolveServerFontPx({ ...style, fontScale: 1.25 }, 1.1) === 44);
  const css = typesetBlockStyle({ role: 'body', sourceImageWidth: 1000, bbox: { x: 1, y: 2, width: 3, height: 4 }, serverStyle: { ...style, fontScale: 1.5 } });
  check('CSS 글꼴은 서버 fontFamily', css?.fontFamily === '"Pretendard"');
  check('CSS 크기 = 40 × 1.5', css?.fontSize === '60px', css?.fontSize);
  check('CSS 굵기·자간·행간·색·정렬', css?.fontWeight === '600' && css.letterSpacing === '-0.03em' && css.lineHeight === '1.2' && css.color === '#1A2B3C' && css.textAlign === 'center');
  const roleCss = typesetBlockStyle({ role: 'body', sourceImageWidth: 1000, bbox: { x: 0, y: 0, width: 1, height: 1 } });
  check('서버 style 이 없으면 역할 기본값(Mock·QA)', roleCss?.fontSize === `${(16 * 1000) / 375}px`);
  const lh = typesetBlockStyle({ role: 'body', sourceImageWidth: 1000, bbox: { x: 0, y: 0, width: 1, height: 1 }, serverStyle: { ...style, lineHeightRatio: 1.35 } });
  check('행간을 1.2 로 고정하지 않는다', lh?.lineHeight === '1.35');
}

console.log('\n[연결] 지문 A=B 인 섹션만 renderInput 을 블록에 잇는다');
{
  const preview = (over) =>
    toPreviewViewModel({
      maxOriginalWidth: 1000,
      originalHeight: 500,
      previewWidth: 500,
      previewHeight: 250,
      scale: 0.5,
      align: 'left',
      renderer: RENDERER,
      sections: [section(over)],
    });
  const block = (fp) =>
    toBlockViewModel({ id: 11, sectionId: 1, role: 'title', revision: 3, trans1: 'Hello', bbox: { x: 0, y: 0, w: 1, h: 1 }, sectionInputFingerprint: fp });
  const matched = syncPreviewWithBlocks([block(FP_B)], preview());
  check('A=B → bound', matched.syncBySection.get(1).bound === true);
  check('블록 정렬 = style.align', matched.blocks[0].textAlign === 'center');
  check('적용 박스 = renderInput box', matched.blocks[0].renderBinding?.box.width === 300);
  check('최신 결과 넘침 = true', matched.blocks[0].serverOverflow === true);
  const mismatched = syncPreviewWithBlocks([block(FP_OLD)], preview());
  check('A≠B → 잇지 않는다(정렬 추측 없음)', mismatched.syncBySection.get(1).match === 'mismatch' && mismatched.blocks[0].renderBinding === null && mismatched.blocks[0].textAlign === undefined);
  const nulls = syncPreviewWithBlocks([block(null)], preview({ renderInput: null, inputFingerprint: null }));
  check('A·B 모두 null → incomparable·잇지 않는다', nulls.syncBySection.get(1).match === 'incomparable' && nulls.blocks[0].renderBinding === null);
  const stale = syncPreviewWithBlocks([block(FP_B)], preview({ render: { attempt: attempt('running', 8), result: result(FP_OLD, null), isCurrent: false } }));
  check('이전 결과의 넘침은 쓰지 않는다(null)', stale.blocks[0].serverOverflow === null);
  const pv = preview();
  check('section revision 보존', pv.sections[0].revision === 4);
  check('background source 보존', pv.sections[0].background?.source === 'inpaint');
  check('renderer 는 opaque 문자열 그대로', pv.renderer?.rendererId === RENDERER.rendererId && pv.renderer.bundleId === null);
  const legacy = section();
  delete legacy.render;
  delete legacy.renderInput;
  delete legacy.inputFingerprint;
  delete legacy.inputError;
  const legacyPreview = toPreviewViewModel({ maxOriginalWidth: 1000, originalHeight: 500, previewWidth: 500, previewHeight: 250, scale: 0.5, align: 'left', sections: [legacy] });
  check('키가 없는 응답의 넘침은 기존 signal 표시(legacy)', getServerOverflow(legacyPreview.sections[0], 11) === 'legacy');
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
