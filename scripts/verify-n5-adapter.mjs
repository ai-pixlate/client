/**
 * N5 Adapter(lib/n5/adapter.ts) 자동 검증.
 *
 * OpenAPI DTO → ViewModel 변환은 React도 브라우저 API도 쓰지 않는 순수 함수이므로
 * Node에서 바로 불러와 확인한다 (scripts/verify-n5-coordinates.mjs와 같은 패턴).
 *
 * 실행:  npm run verify:n5-adapter
 */

import {
  areAllSectionsExcluded,
  buildAcknowledgedWarnings,
  buildSectionStatus,
  canRestoreSectionInN5,
  getBlockTaskFailures,
  getInvalidStateWarnings,
  getPreviewContainerWidth,
  getRerenderTaskId,
  getSectionCanvasHeaderHeight,
  getSectionStatusRowCount,
  getRevisionConflictLatestBlock,
  getSignalRows,
  getSignalTone,
  getTranslationFailure,
  hasSectionStatus,
  hasWidthOverflowSignal,
  isAllSectionsExcludedError,
  isInvalidStateError,
  isRevisionConflict,
  parseApiError,
  resolveSectionRenderState,
  toAutoAdjustViewModel,
  toBlockViewModel,
  toPreviewViewModel,
  toSignalBadges,
  toJobMetaViewModel,
} from '../lib/n5/adapter.ts';

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

console.log('\n[1] toBlockViewModel — 정상 블록 변환');
{
  const dto = {
    id: 101,
    sectionId: 9,
    displayTop: 500,
    blockOrder: 1,
    role: 'caution',
    isExcluded: false,
    sourceKo: '원문',
    trans1: '번역문',
    blockStatus: 'machine',
    bbox: { x: 1, y: 2, w: 3, h: 4 },
    charCount: 4,
    charLimit: null,
    overflow: false,
    autoAdjust: null,
    signals: [{ code: 'width_overflow', reason: '길다' }],
    alternativeExpression: null,
    revision: 3,
  };
  const vm = toBlockViewModel(dto);
  check('id/sectionId 그대로 전달', vm.id === 101 && vm.sectionId === 9);
  check('roleLabel이 BLOCK_ROLE_LABELS를 거친다', vm.roleLabel === '주의문구', `got ${vm.roleLabel}`);
  check('sourceText <- sourceKo', vm.sourceText === '원문');
  check('translatedText <- trans1', vm.translatedText === '번역문');
  check('editable = !isExcluded (false)', vm.editable === true);
  check('revision 그대로 전달', vm.revision === 3);
  check('badges 길이 1', vm.badges.length === 1, `got ${vm.badges.length}`);
  check('autoAdjust null -> applied:false 기본값', vm.autoAdjust.applied === false);
  check(
    'bbox {x,y,w,h} -> {x,y,width,height} 단일 경계 변환',
    vm.bbox?.x === 1 && vm.bbox?.y === 2 && vm.bbox?.width === 3 && vm.bbox?.height === 4,
    `got ${JSON.stringify(vm.bbox)}`,
  );
}

console.log('\n[2] toBlockViewModel — isExcluded=true → editable=false, null 필드 fallback');
{
  const dto = {
    id: 5,
    sectionId: 1,
    role: 'product_label',
    isExcluded: true,
    sourceKo: null,
    trans1: null,
    revision: 1,
  };
  const vm = toBlockViewModel(dto);
  check('editable = !isExcluded (true)', vm.editable === false);
  check('sourceText null -> 빈 문자열', vm.sourceText === '');
  check('translatedText null -> 빈 문자열', vm.translatedText === '');
  check('bbox 없으면 null', vm.bbox === null);
  check('displayTop 없으면 null', vm.displayTop === null);
}

console.log('\n[3] toBlockViewModel — 핵심 식별 필드 누락 시 조용히 기본값으로 채우지 않고 throw');
{
  const cases = [
    ['id 없음', { sectionId: 1, role: 'body', revision: 1 }],
    ['sectionId 없음', { id: 1, role: 'body', revision: 1 }],
    ['role 없음', { id: 1, sectionId: 1, revision: 1 }],
    ['revision 없음', { id: 1, sectionId: 1, role: 'body' }],
  ];
  for (const [label, dto] of cases) {
    let threw = false;
    try {
      toBlockViewModel(dto);
    } catch {
      threw = true;
    }
    check(`${label} -> throw`, threw);
  }
}

console.log('\n[4] toAutoAdjustViewModel — API는 camelCase(fontScale/lineBreakApplied, 6단계 재확인)로 응답한다');
{
  const none = toAutoAdjustViewModel(null);
  check('null -> applied:false, fontScale:1', none.applied === false && none.fontScale === 1);

  const scaled = toAutoAdjustViewModel({ fontScale: 0.8, lineBreakApplied: false });
  check('fontScale!==1 -> applied:true', scaled.applied === true && scaled.fontScale === 0.8);

  const broken = toAutoAdjustViewModel({ fontScale: 1, lineBreakApplied: true });
  check('lineBreakApplied -> applied:true', broken.applied === true && broken.lineBreakApplied === true);

  const noop = toAutoAdjustViewModel({ fontScale: 1, lineBreakApplied: false });
  check('fontScale===1 && !lineBreakApplied -> applied:false', noop.applied === false);
}

console.log('\n[5] toSignalBadges — admin 전용 필드 없이도 undefined signals는 빈 배열');
{
  check('undefined -> []', toSignalBadges(undefined).length === 0);
  const badges = toSignalBadges([
    { code: 'translation_failed', taskId: 77, retryable: true },
  ]);
  check('taskId/retryable 보존', badges[0].taskId === 77 && badges[0].retryable === true);
  check('reason 없으면 null', badges[0].reason === null);
  check('label이 raw code 대신 한글 라벨', badges[0].label === '번역 실패', `got ${badges[0].label}`);
}

console.log('\n[6] getPreviewContainerWidth — previewWidth 격리');
{
  const withWidth = getPreviewContainerWidth({ previewWidth: 800, maxOriginalWidth: 2000, scale: 0.5 });
  check('previewWidth 있으면 그대로 사용', withWidth === 800, `got ${withWidth}`);

  const withoutWidth = getPreviewContainerWidth({ maxOriginalWidth: 2000, scale: 0.5 });
  check('previewWidth 없으면 maxOriginalWidth*scale로 대체', withoutWidth === 1000, `got ${withoutWidth}`);
}

console.log('\n[7] resolveSectionRenderState — null을 실패로 단정하지 않는다');
{
  check(
    'bucket=exclude -> excluded',
    resolveSectionRenderState({ bucket: 'exclude', renderedUrl: null }).status === 'excluded',
  );
  check(
    'excludedStage=N5 -> excluded',
    resolveSectionRenderState({ bucket: 'include', excludedStage: 'N5', renderedUrl: null }).status === 'excluded',
  );
  const ready = resolveSectionRenderState({ bucket: 'include', renderedUrl: 'https://example.com/a.png' });
  check('renderedUrl 있으면 ready + url 보존', ready.status === 'ready' && ready.url === 'https://example.com/a.png');
  check(
    '제외 아님 + renderedUrl null -> unresolved(실패 단정 안 함)',
    resolveSectionRenderState({ bucket: 'include', renderedUrl: null }).status === 'unresolved',
  );
}

console.log('\n[8] parseApiError / isRevisionConflict / getRevisionConflictLatestBlock');
{
  const body = {
    error: {
      code: 'REVISION_CONFLICT',
      message: '충돌',
      retryable: false,
      details: { current: { id: 1, sectionId: 1, role: 'body', revision: 5, trans1: '최신' } },
      traceId: 'trace-1',
    },
  };
  const parsed = parseApiError(body);
  check('parseApiError가 code/message/retryable/traceId를 그대로 보존', parsed?.code === 'REVISION_CONFLICT');
  check('error.code는 열린 string(임의 신규 코드도 파싱)', parseApiError({
    error: { code: 'SOME_FUTURE_CODE', message: 'm', retryable: true, traceId: 't' },
  })?.code === 'SOME_FUTURE_CODE');
  check('isRevisionConflict 판별', isRevisionConflict(parsed) === true);
  const latest = getRevisionConflictLatestBlock(parsed);
  check('details.current -> 최신 block 복구', latest?.revision === 5 && latest?.trans1 === '최신');

  check('형태가 다르면 parseApiError는 null', parseApiError({ notError: true }) === null);
  check('필수 필드 누락이면 null', parseApiError({ error: { code: 'X' } }) === null);
}

console.log('\n[9] getRerenderTaskId');
{
  check('rerenderTaskId 있으면 반환', getRerenderTaskId({ rerenderTaskId: 42 }) === 42);
  check('없으면 null(스펙상 optional)', getRerenderTaskId({}) === null);
}

console.log('\n[10] toPreviewViewModel — 컴포넌트가 ApiReviewPreview를 직접 보지 않아도 되게 정리');
{
  const preview = {
    maxOriginalWidth: 1000,
    previewWidth: 400,
    scale: 0.4,
    align: 'left',
    sections: [
      {
        id: 502,
        sectionOrder: 2,
        bucket: 'include',
        excludedStage: null,
        sourceImageId: 9001,
        width: 1000,
        height: 700,
        displayTop: 900,
        originalUrl: 'https://example.com/502-original.png',
        renderedUrl: 'https://example.com/502-translated.png',
        signals: [{ code: 'width_overflow' }],
      },
      {
        id: 501,
        sectionOrder: 1,
        bucket: 'include',
        sourceImageId: 9001,
        width: 1000,
        height: 900,
        displayTop: 0,
        renderedUrl: null,
      },
      {
        id: 503,
        sectionOrder: 3,
        bucket: 'exclude',
        excludedStage: 'N5',
        sourceImageId: 9001,
        width: 1000,
        height: 500,
        displayTop: 1600,
        renderedUrl: null,
      },
    ],
  };
  const vm = toPreviewViewModel(preview);
  check('containerWidth = previewWidth', vm.containerWidth === 400);
  check('scale 그대로 전달', vm.scale === 0.4);
  check(
    'sectionOrder 오름차순 정렬',
    vm.sections.map((s) => s.id).join(',') === '501,502,503',
    `got ${vm.sections.map((s) => s.id).join(',')}`,
  );
  check('제외 아님+renderedUrl null -> unresolved', vm.sections[0].render.status === 'unresolved');
  check('renderedUrl 있음 -> ready', vm.sections[1].render.status === 'ready');
  check('bucket=exclude -> excluded', vm.sections[2].render.status === 'excluded');
  check('section badges에 signals 반영', vm.sections[1].badges[0]?.code === 'width_overflow');
  check(
    'originalUrl 그대로 전달',
    vm.sections[1].originalUrl === 'https://example.com/502-original.png',
    `got ${vm.sections[1].originalUrl}`,
  );
}

console.log('\n[11] buildAcknowledgedWarnings — 현재 badge를 {blockId, code} 목록으로');
{
  const blocks = [
    {
      id: 9104,
      badges: [
        { code: 'width_overflow', label: '영역 초과' },
        { code: 'prohibited_expression', label: '금지 표현' },
      ],
    },
    { id: 9109, badges: [] },
    { id: 9110, badges: [{ code: 'mandatory_term_unapplied', label: '필수 문구 누락' }] },
  ];
  const warnings = buildAcknowledgedWarnings(blocks);
  check('badge 없는 block은 항목을 만들지 않는다', warnings.length === 3, `got ${warnings.length}`);
  check(
    '각 항목이 {blockId, code} 형태',
    warnings.every((w) => typeof w.blockId === 'number' && typeof w.code === 'string'),
  );
  check(
    '순서·내용 그대로 반영',
    JSON.stringify(warnings) ===
      JSON.stringify([
        { blockId: 9104, code: 'width_overflow' },
        { blockId: 9104, code: 'prohibited_expression' },
        { blockId: 9110, code: 'mandatory_term_unapplied' },
      ]),
  );
}

console.log('\n[12] areAllSectionsExcluded — 서버가 검사하는 것과 같은 규칙(최소 1개 include)');
{
  check('로드 전(빈 배열)이면 false — 전부 제외로 단정하지 않는다', areAllSectionsExcluded([]) === false);
  check(
    '하나라도 include면 false',
    areAllSectionsExcluded([{ bucket: 'exclude' }, { bucket: 'include' }]) === false,
  );
  check('전부 exclude면 true', areAllSectionsExcluded([{ bucket: 'exclude' }, { bucket: 'exclude' }]) === true);
}

console.log('\n[12-1] canRestoreSectionInN5 — SEC-03: N5 에서 excludedStage=N3 조작은 409');
{
  const excluded = { status: 'excluded' };
  check('N5 에서 제외한 섹션은 되돌릴 수 있다', canRestoreSectionInN5({ render: excluded, excludedStage: 'N5' }) === true);
  check('N3 에서 제외된 섹션은 N5 에서 되돌릴 수 없다', canRestoreSectionInN5({ render: excluded, excludedStage: 'N3' }) === false);
  check(
    '포함 상태 섹션은 되돌리기 대상이 아니다',
    canRestoreSectionInN5({ render: { status: 'ready', url: 'u' }, excludedStage: null }) === false,
  );
}

console.log('\n[13] confirm 에러 판별 — isAllSectionsExcludedError / isInvalidStateError / getInvalidStateWarnings');
{
  const allExcludedErr = parseApiError({
    error: { code: 'ALL_SECTIONS_EXCLUDED', message: '전 섹션 제외', retryable: false, traceId: 't1' },
  });
  check('ALL_SECTIONS_EXCLUDED 판별', isAllSectionsExcludedError(allExcludedErr) === true);
  check('ALL_SECTIONS_EXCLUDED는 INVALID_STATE가 아니다', isInvalidStateError(allExcludedErr) === false);

  const invalidStateErr = parseApiError({
    error: {
      code: 'INVALID_STATE',
      message: '확인하지 않은 경고가 있습니다',
      retryable: true,
      details: { warnings: [{ blockId: 9104, code: 'width_overflow' }] },
      traceId: 't2',
    },
  });
  check('INVALID_STATE 판별', isInvalidStateError(invalidStateErr) === true);
  const warnings = getInvalidStateWarnings(invalidStateErr);
  check(
    'details.warnings를 그대로 꺼낸다',
    Array.isArray(warnings) && warnings[0]?.blockId === 9104 && warnings[0]?.code === 'width_overflow',
  );
  check(
    'INVALID_STATE가 아니면 null(임의로 지어내지 않는다)',
    getInvalidStateWarnings(allExcludedErr) === null,
  );
  check(
    'details.warnings 형태가 아니면 null',
    getInvalidStateWarnings(
      parseApiError({ error: { code: 'INVALID_STATE', message: 'm', retryable: true, traceId: 't3' } }),
    ) === null,
  );
}

console.log('\ntoJobMetaViewModel');
{
  const labels = { cosmetic: '화장품' };
  const countries = [{ code: 'US', name: '미국' }];
  const categories = [{ id: 7, name: '선크림' }];
  const full = toJobMetaViewModel({ targetCountry: 'US', regulatoryClass: 'cosmetic', categoryId: 7 }, countries, categories, labels);
  check('실제 값을 표시 이름으로 바꾼다', full.countryLabel === '미국' && full.regulatoryClassLabel === '화장품' && full.categoryLabel === '선크림');
  const empty = toJobMetaViewModel({ targetCountry: 'JP', regulatoryClass: null, categoryId: null }, countries, categories, labels);
  check('없는 값은 지어내지 않는다', empty.countryLabel === null && empty.regulatoryClassLabel === null && empty.categoryLabel === null);
  const loading = toJobMetaViewModel({ targetCountry: 'US', regulatoryClass: 'cosmetic', categoryId: 7 }, [], [], labels);
  check('목록을 받기 전에는 해당 이름만 비운다', loading.countryLabel === null && loading.categoryLabel === null && loading.regulatoryClassLabel === '화장품');
}

console.log('\nN5 오류 상태');
{
  const badges = toSignalBadges([
    { code: 'prohibited_expression', reason: 'a' },
    { code: 'translation_failed', reason: 'b', taskId: 7, retryable: true },
    { code: 'width_overflow', reason: 'c' },
    { code: 'empty_block', reason: 'd' },
  ]);
  check('칸 실패 signal은 행에서 빠진다', getSignalRows(badges).map((b) => b.code).join() === 'prohibited_expression,empty_block');
  check('톤은 시각 매핑이다', getSignalTone('prohibited_expression') === 'warning' && getSignalTone('empty_block') === 'neutral');
  const t = getTranslationFailure(badges);
  check('번역 실패의 정본은 signal이고 task를 동봉한다', t?.retry?.taskId === 7 && t?.retry?.retryable === true);
  check('번역 실패 signal이 없으면 null', getTranslationFailure([]) === null);
  check('retryable 값이 없으면 재시도 불가로 본다', getTranslationFailure(toSignalBadges([{ code: 'translation_failed', taskId: 7 }]))?.retry?.retryable === false);
  check('넘침은 signal 기준', hasWidthOverflowSignal(badges) && !hasWidthOverflowSignal([]));

  const items = [
    { taskId: 1, taskType: 'render', unitType: 'section', unitId: 10, status: 'failed', retryable: true },
    { taskId: 2, taskType: 'inpaint', unitType: 'section', unitId: 10, status: 'failed', retryable: false },
    { taskId: 3, taskType: 'render', unitType: 'section', unitId: 20, status: 'running' },
    { taskId: 4, taskType: 'verify', unitType: 'text_block', unitId: 100, status: 'failed' },
    { taskId: 5, taskType: 'render', unitType: 'text_block', unitId: 100, status: 'failed', retryable: true },
    { taskId: 6, taskType: 'verify', unitType: 'job', unitId: 100, status: 'failed' },
  ];
  const blockFail = getBlockTaskFailures(items, 100);
  check('block 실패는 text_block 단위만 본다', blockFail.verifyFailed && blockFail.previewFailure?.taskId === 5);
  const other = getBlockTaskFailures(items, 200);
  check('다른 block은 실패가 없다', !other.verifyFailed && other.previewFailure === null);

  const status = buildSectionStatus(10, [], items, {
    exclusionReason: 'restored_by_user',
    warningBadge: 'quality_warning',
    verdicts: [{ verdictType: 'regulatory' }, { verdictType: 'regulatory' }, { verdictType: 'needs_fix' }],
  });
  check('실행 실패 단계', status.failedStages.join() === 'render,inpaint' && status.renderRetry?.taskId === 1);
  check('되살림·품질·판정 배지(중복 제거)', status.restoredInN3 && status.warningLabel === '품질 주의' && status.verdictLabels.join() === '규제 위반,현지 확인 필요');
  const running = buildSectionStatus(20, [], items, undefined);
  check('진행 중은 실패가 아니고, Section을 못 받아도 상태 없음이다', running.failedStages.length === 0 && !hasSectionStatus(running));
  check('행 3개면 이미지까지 134(Figma 1244:8444)', getSectionStatusRowCount(status) === 3 && getSectionCanvasHeaderHeight(status) === 134);
  check('상태가 없으면 공간도 없다', getSectionCanvasHeaderHeight(running) === 0 && getSectionCanvasHeaderHeight(undefined) === 0);
  check('signal만 있으면 canvas 공간을 쓰지 않는다', getSectionCanvasHeaderHeight(buildSectionStatus(40, toSignalBadges([{ code: 'empty_block' }]), [], undefined)) === 0);
  const label = (id, render, list = items) => buildSectionStatus(id, [], list, undefined, render).progressLabel;
  check('renderedUrl=null · task 없음 → 렌더 대기 중', label(50, 'unresolved') === '렌더 대기 중');
  check('renderedUrl=null · running → 렌더링 중', label(20, 'unresolved') === '렌더링 중');
  check('renderedUrl=null · failed → 진행 문구 없음(실패로 표시)', label(10, 'unresolved') === null && buildSectionStatus(10, [], items, undefined, 'unresolved').failedStages.includes('render'));
  check('제외 → 제외된 섹션', label(50, 'excluded') === '제외된 섹션');
  check('렌더 완료 → 없음', label(50, 'ready') === null);
  check('진행 문구는 canvas 공간을 쓰지 않는다', getSectionCanvasHeaderHeight(buildSectionStatus(50, [], [], undefined, 'unresolved')) === 0);
  check('warningBadge로 렌더 실패를 판별하지 않는다', buildSectionStatus(30, [], [], { warningBadge: 'processing_failed' }).failedStages.length === 0);
}

console.log(`\n총 ${pass + fail}건 — PASS ${pass} / FAIL ${fail}`);
if (fail > 0) {
  process.exit(1);
}
