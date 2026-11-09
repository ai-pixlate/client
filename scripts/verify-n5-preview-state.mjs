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
  resolvePreviewSectionSemantic,
  toTypesetServerStyle,
} from '../lib/n5/preview-state.ts';
import { N5_PREVIEW_NOTICE_COPY, N5_PREVIEW_PROGRESS_COPY } from '../lib/n5/preview-copy.ts';
import {
  buildSectionStatus,
  getServerOverflow,
  syncPreviewWithBlocks,
  toBlockViewModel,
  toPreviewStatusInput,
  toPreviewViewModel,
} from '../lib/n5/adapter.ts';
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

const semOf = (s, match = 'match') => resolvePreviewSectionSemantic(resolvePreviewInputState(s), renderOf(s), match);
const labelsOf = (s, match = 'match') => resolvePreviewSectionLabels(semOf(s, match));
const disp = (s, match = 'match', canTypeset = true) =>
  resolvePreviewSectionDisplay({ input: resolvePreviewInputState(s), render: renderOf(s), match, canTypeset });
const PREP = { renderInput: null, inputFingerprint: null };
const ERR = { renderInput: null, inputFingerprint: null, inputError: { code: 'STYLE_RESULT_INVALID', blockIds: [11] } };
const prev = () => result(FP_OLD, null);

console.log('\n[표시 소스 · 의미 상태] 시나리오 A–J (N5 「번역 후」 뷰어 — N6 최종 렌더와 무관)');
{
  // A 최신
  const a = section();
  check('A current → local-typeset(배경 + HTML)', disp(a) === 'local-typeset');
  check('A 의미 상태 current · 문구 없음', semOf(a).render === 'current' && labelsOf(a).progressLabel === null && labelsOf(a).notice === null);

  // B N4 최초 생성 실패 — 이전 결과 없음 + 실패
  const b = section({ renderedUrl: null, render: { attempt: attempt('failed', 8, true), result: null, isCurrent: false } });
  check('B 최초 실패 → original-image(HTML 없음)', disp(b) === 'original-image');
  check('B 의미 상태 failed(update-failed 아님)', semOf(b).render === 'failed');
  check('B 기존 「실행 실패」 행 하나 · 진행 문구 없음', labelsOf(b).renderFailed === true && labelsOf(b).progressLabel === null);
  check('B 다시 시도 대상 = attempt.taskId·retryable', semOf(b).retry?.taskId === 8 && semOf(b).retry?.retryable === true);

  // C N5 수정 후 재렌더 진행 + 이전 결과
  for (const status of ['pending', 'running']) {
    const c = section({ render: { attempt: attempt(status, 8), result: prev(), isCurrent: false } });
    check(`C 재렌더 ${status} + 이전 결과 → previous-rendered-image`, disp(c) === 'previous-rendered-image');
    check(`C 의미 상태 updating(${status})`, semOf(c).render === 'updating' && semOf(c).attemptStatus === status && semOf(c).retry === null);
  }
  check('C A=B·그릴 수 있어도 새 번역문 HTML 을 얹지 않는다', disp(section({ render: { attempt: attempt('running', 8), result: prev(), isCurrent: false } }), 'match', true) !== 'local-typeset');

  // D N5 수정 후 재렌더 실패 + 이전 결과
  const d = section({ render: { attempt: attempt('failed', 8, true), result: prev(), isCurrent: false } });
  check('D 재렌더 실패 + 이전 결과 → previous-rendered-image', disp(d) === 'previous-rendered-image');
  check('D 의미 상태 update-failed(failed 와 구분)', semOf(d).render === 'update-failed');
  check('D retry 의미 = taskId·retryable', semOf(d).retry?.taskId === 8 && semOf(d).retry?.retryable === true);
  check('D 실패 행 유지', labelsOf(d).renderFailed === true);
  check('D retryable=false 도 그대로 전달(버튼 활성 여부는 서버 값)', semOf(section({ render: { attempt: attempt('failed', 8, false), result: prev(), isCurrent: false } })).retry?.retryable === false);

  // E 이전 결과 없는 pending/running
  for (const status of ['pending', 'running']) {
    const e = section({ renderedUrl: null, render: { attempt: attempt(status, 8), result: null, isCurrent: false } });
    check(`E ${status} · 이전 결과 없음 → original-image`, disp(e) === 'original-image');
    check(`E 의미 상태 ${status === 'pending' ? 'waiting' : 'running'}`, semOf(e).render === (status === 'pending' ? 'waiting' : 'running'));
  }

  // F 입력 오류 — 렌더 실패와 별개
  const f = section({ ...ERR, render: { attempt: null, result: null, isCurrent: false } });
  check('F 입력 오류 → input-error · render missing(실패 아님)', semOf(f, 'incomparable').input === 'input-error' && semOf(f, 'incomparable').render === 'missing');
  check('F 실패 행·다시 시도 없음', labelsOf(f, 'incomparable').renderFailed === false && semOf(f, 'incomparable').retry === null);
  check('F 결과 없으면 original-image', disp(f, 'incomparable') === 'original-image');
  check('F 이전 결과가 있으면 그대로(HTML 로 숨기지 않는다)', disp(section({ ...ERR, render: { attempt: null, result: prev(), isCurrent: false } }), 'incomparable') === 'previous-rendered-image');
  const fFailed = section({ ...ERR, render: { attempt: attempt('failed', 8, true), result: null, isCurrent: false } });
  check('F 입력 오류 + 시도 실패 — 두 사실을 함께 가진다', semOf(fFailed, 'incomparable').input === 'input-error' && semOf(fFailed, 'incomparable').render === 'failed');

  // G 결과 없음 + 시도 null/done
  for (const att of [null, attempt('done', 8)]) {
    const g = section({ renderedUrl: null, render: { attempt: att, result: null, isCurrent: false } });
    const label = att ? 'done' : 'null';
    check(`G attempt ${label} · 결과 없음 → missing(failed 아님)`, semOf(g).render === 'missing' && labelsOf(g).renderFailed === false);
    check(`G attempt ${label} → original-image · 미리보기 없음`, disp(g) === 'original-image' && labelsOf(g).notice === '미리보기 없음');
  }

  // H 입력 준비 중 + 시도 실패
  const h = section({ ...PREP, render: { attempt: attempt('failed', 9, true), result: null, isCurrent: false } });
  check('H preparing + failed — 두 상태를 함께', semOf(h, 'incomparable').input === 'preparing' && semOf(h, 'incomparable').render === 'failed');
  check('H 「렌더 대기 중」으로 뭉개지 않는다', labelsOf(h, 'incomparable').progressLabel === null && labelsOf(h, 'incomparable').renderFailed === true);
  check('H 화면 original-image', disp(h, 'incomparable') === 'original-image');
  const hPrev = section({ ...PREP, render: { attempt: attempt('failed', 9, true), result: prev(), isCurrent: false } });
  check('H preparing + 재렌더 실패 + 이전 결과 → update-failed · 이전 이미지', semOf(hPrev, 'incomparable').render === 'update-failed' && disp(hPrev, 'incomparable') === 'previous-rendered-image');
  const hOnly = section({ ...PREP, render: { attempt: null, result: null, isCurrent: false } });
  check('renderInput null 만으로 waiting 이 아니다 — render 는 missing, input 이 preparing', semOf(hOnly, 'incomparable').render === 'missing' && semOf(hOnly, 'incomparable').input === 'preparing');
  check('… 임시 진행 문구는 입력 준비(preparing) 키', labelsOf(hOnly, 'incomparable').progressLabel === '렌더 대기 중');

  // I 이전 결과(stale) — 넘침 없음
  const i = section({ render: { attempt: null, result: result(FP_OLD, { 11: true }), isCurrent: false } });
  check('I stale → previous-rendered-image · overflow 없음', disp(i) === 'previous-rendered-image' && renderOf(i).overflowByBlockId === null);
  check('I 의미 상태 stale · 최신 미리보기 아님', semOf(i).render === 'stale' && labelsOf(i).notice === '최신 미리보기 아님');
  check('I 진행 중 이전 결과도 overflow 없음', renderOf(section({ render: { attempt: attempt('running', 8), result: result(FP_OLD, { 11: true }), isCurrent: false } })).overflowByBlockId === null);

  // J 최신 — 서버 넘침
  check('J current → result.overflow 를 넘침 정본으로', renderOf(section()).overflowByBlockId?.get(11) === true);

  // 지문 A≠B
  const syncing = semOf(section(), 'mismatch');
  check('A≠B → syncing · 최신 이미지(조판 안 함)', syncing.syncing === true && disp(section(), 'mismatch') === 'current-rendered-image');
  check('A≠B 임시 문구', labelsOf(section(), 'mismatch').notice === '최신 내용을 불러오는 중');
  check('inconsistent 도 syncing', semOf(section(), 'inconsistent').syncing === true);
  check('null 비교 불가는 syncing 아님(조판도 안 함)', semOf(section(), 'incomparable').syncing === false && disp(section(), 'incomparable') === 'current-rendered-image');
  check('글꼴 미준비 → current-rendered-image', disp(section(), 'match', false) === 'current-rendered-image');

  // renderedUrl=null 만으로 실패가 아니다
  check('renderedUrl=null · 결과·시도 없음 → failed 가 아니다', semOf(section({ renderedUrl: null, render: { attempt: null, result: null, isCurrent: false } })).render !== 'failed');

  // 제외·계약 밖
  const legacy = section();
  delete legacy.render;
  check('키가 빠진 응답은 legacy · 의미 상태 null', disp(legacy) === 'legacy' && semOf(legacy) === null && labelsOf(legacy).notice === null);
  const excluded = section({ bucket: 'exclude', excludedStage: 'N5', render: null, renderInput: null, inputFingerprint: null });
  check('제외 섹션 → excluded · 의미 상태 null', disp(excluded) === 'excluded' && semOf(excluded) === null);
}

console.log('\n[문구 분리] 판정과 화면 문구가 1:1 로 묶이지 않는다');
{
  const keys = new Set(Object.keys(N5_PREVIEW_NOTICE_COPY).concat(Object.keys(N5_PREVIEW_PROGRESS_COPY)));
  check('문구 표는 preview-copy.ts 한 곳', ['input-error', 'syncing', 'previous-result', 'missing', 'waiting', 'running', 'preparing'].every((k) => keys.has(k)));
  check('stale·updating·update-failed 가 같은 임시 안내를 공유(의미 상태는 다르다)', [
    section({ render: { attempt: null, result: prev(), isCurrent: false } }),
    section({ render: { attempt: attempt('running', 8), result: prev(), isCurrent: false } }),
    section({ render: { attempt: attempt('failed', 8), result: prev(), isCurrent: false } }),
  ].every((x) => labelsOf(x).notice === N5_PREVIEW_NOTICE_COPY['previous-result']));
  check('running + 이전 결과 → 렌더링 중', labelsOf(section({ render: { attempt: attempt('running', 8), result: prev(), isCurrent: false } })).progressLabel === '렌더링 중');
  check('pending + 이전 결과 → 렌더 대기 중', labelsOf(section({ render: { attempt: attempt('pending', 8), result: prev(), isCurrent: false } })).progressLabel === '렌더 대기 중');
}

console.log('\n[ViewModel] buildSectionStatus 에 의미 상태·다시 시도 대상');
{
  const vmOf = (s, match = 'match') => {
    const pv = toPreviewViewModel({ maxOriginalWidth: 1000, renderer: RENDERER, sections: [s] }).sections[0];
    return buildSectionStatus(1, [], [], undefined, pv.render.status, toPreviewStatusInput(pv, match));
  };
  const d = vmOf(section({ render: { attempt: attempt('failed', 8, true), result: prev(), isCurrent: false } }));
  check('update-failed → previewState · renderRetry(taskId 8)', d.previewState?.render === 'update-failed' && d.renderRetry?.taskId === 8 && d.failedStages.includes('render'));
  const f = vmOf(section({ ...ERR, render: { attempt: null, result: null, isCurrent: false } }), 'incomparable');
  check('input-error → 실패 행·retry 없음', f.previewState?.input === 'input-error' && f.renderRetry === null && f.failedStages.length === 0);
  const legacy = section();
  delete legacy.render;
  check('legacy → previewState null', vmOf(legacy).previewState === null);
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
