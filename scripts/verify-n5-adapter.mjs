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
  getInvalidStateWarnings,
  getPreviewContainerWidth,
  getRerenderTaskId,
  getRevisionConflictLatestBlock,
  isAllSectionsExcludedError,
  isInvalidStateError,
  isRevisionConflict,
  parseApiError,
  resolveSectionRenderState,
  toAutoAdjustViewModel,
  toBlockViewModel,
  toPreviewViewModel,
  toSignalBadges,
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

console.log(`\n총 ${pass + fail}건 — PASS ${pass} / FAIL ${fail}`);
if (fail > 0) {
  process.exit(1);
}
