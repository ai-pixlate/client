// N5 블록 배치 저장(layoutAdjust) 검증 — FE 요청 조립(lib/n5/layout-adjust.ts)·쓰기 허용(layout-adjust-capability.ts)·
// 서버값 → 편집 기준(adapter getTranslatedBaseBox·getBaseFontScale)·Mock 서버 계약 동작(lib/mock-api/n5-layout-adjust.ts)
// 실행: npm run verify:n5-layout-adjust

import {
  appliedLayoutFromBlock,
  buildLayoutAdjustPatch,
  buildLayoutAdjustReset,
  buildLayoutBlockPatch,
  isLayoutBoxInSection,
  isLayoutRenderTarget,
  isNotRenderTargetError,
  readStoredLayout,
  toLayoutBox,
} from '../lib/n5/layout-adjust.ts';
import { isLayoutAdjustWriteEnabled } from '../lib/n5/layout-adjust-capability.ts';
import { createIdempotencyKey } from '../lib/api/idempotency.ts';
import { getBaseFontScale, getTranslatedBaseBox, toBlockViewModel } from '../lib/n5/adapter.ts';
import {
  applyMockLayoutPatch,
  clearsMockLegacyBox,
  isSameMockLayout,
  parseMockLayoutPatch,
  withMockLegacyBox,
} from '../lib/mock-api/n5-layout-adjust.ts';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ORIGINAL = { x: 40, y: 300, w: 500, h: 80 };
const dto = (over = {}) => ({
  id: 1, sectionId: 10, role: 'body', revision: 7, sourceKo: '원문', trans1: 'Text', isExcluded: false, bbox: ORIGINAL, ...over,
});

console.log('\n[요청 조립] 섹션 로컬 원본 px · 소수 유지 · 바꾼 필드만');
{
  const box = { x: 10.5, y: 20, width: 200.25, height: 48 };
  check('toLayoutBox 는 반올림하지 않는다', eq(toLayoutBox(box), { x: 10.5, y: 20, w: 200.25, h: 48 }));
  check('끌기·손잡이 = box 만', eq(buildLayoutAdjustPatch({ kind: 'box', box }), { box: { x: 10.5, y: 20, w: 200.25, h: 48 } }));
  check('[+][−] = box + 절대 fontScale', eq(buildLayoutAdjustPatch({ kind: 'box-and-scale', box, fontScale: 1.1 }), { box: { x: 10.5, y: 20, w: 200.25, h: 48 }, fontScale: 1.1 }));
  check('전체 해제 = layoutAdjust null', buildLayoutAdjustReset('all') === null);
  check('부분 해제 box = { box: null }', eq(buildLayoutAdjustReset('box'), { box: null }));
  check('부분 해제 fontScale = { fontScale: null }', eq(buildLayoutAdjustReset('fontScale'), { fontScale: null }));
  const body = buildLayoutBlockPatch({ trans1: '서버 번역문', revision: 12 }, { box: { x: 1, y: 2, w: 3, h: 4 } });
  check('본문 = trans1(서버 현재 값) · revision · layoutAdjust', eq(body, { trans1: '서버 번역문', revision: 12, layoutAdjust: { box: { x: 1, y: 2, w: 3, h: 4 } } }));
  check('null 해제도 본문에 그대로', buildLayoutBlockPatch({ trans1: 'a', revision: 1 }, null).layoutAdjust === null);
  let threw = false;
  try {
    buildLayoutBlockPatch({ trans1: 'a', revision: 1 }, {});
  } catch {
    threw = true;
  }
  check('빈 객체 {} 는 만들지 않는다(throw)', threw);
}

console.log('\n[서버값 읽기] 키 없음(서버 구현 전)과 null(조정 없음)을 섞지 않는다');
{
  check('키 없음 → missing', readStoredLayout({}).kind === 'missing');
  check('null → none', readStoredLayout({ layoutAdjust: null }).kind === 'none');
  const v = readStoredLayout({ layoutAdjust: { box: { x: 1.5, y: 2, w: 3, h: 4 }, fontScale: null } });
  check('값 → box·fontScale', v.kind === 'value' && v.box.x === 1.5 && v.box.width === 3 && v.fontScale === null);
  check('응답 적용값: null → 원본 bbox · 1.0', eq(appliedLayoutFromBlock(dto({ layoutAdjust: null })), { bbox: { x: 40, y: 300, width: 500, height: 80 }, fontScale: 1 }));
  check('응답 적용값: 키 없음 → null(화면 값 유지)', appliedLayoutFromBlock(dto()) === null);
  check(
    '응답 적용값: box 만 → box · 1.0',
    eq(appliedLayoutFromBlock(dto({ layoutAdjust: { box: { x: 60, y: 300, w: 500, h: 80 }, fontScale: null } })), { bbox: { x: 60, y: 300, width: 500, height: 80 }, fontScale: 1 }),
  );
}

console.log('\n[편집 기준] renderInput 적용값 > /blocks layoutAdjust > 원본 bbox — 원본 bbox 는 덮지 않는다');
{
  const vm = toBlockViewModel(dto({ layoutAdjust: { box: { x: 60, y: 310, w: 480, h: 80 }, fontScale: 1.1 } }));
  check('VM 원본 bbox 그대로', eq(vm.bbox, { x: 40, y: 300, width: 500, height: 80 }));
  check('기준 박스 = layoutAdjust.box', eq(getTranslatedBaseBox(vm), { x: 60, y: 310, width: 480, height: 80 }));
  check('기준 배율 = layoutAdjust.fontScale', getBaseFontScale(vm) === 1.1);
  const bound = { ...vm, renderBinding: { box: { x: 1, y: 2, width: 3, height: 4 }, style: { fontScale: 1.3 } } };
  check('renderInput 이 연결되면 그 적용값이 먼저', getTranslatedBaseBox(bound).x === 1 && getBaseFontScale(bound) === 1.3);
  const none = toBlockViewModel(dto({ layoutAdjust: null }));
  check('null → 원본 bbox · 1.0', eq(getTranslatedBaseBox(none), none.bbox) && getBaseFontScale(none) === 1);
  const missing = toBlockViewModel(dto());
  check('키 없음 → storedLayout missing · 원본 bbox · 1.0(기존 동작)', missing.storedLayout.kind === 'missing' && getBaseFontScale(missing) === 1);
}

console.log('\n[렌더 대상] 라벨·로고·빈 원문·빈 번역문은 배치를 보내지 않는다');
{
  const vm = (over) => ({ editable: true, sourceText: '원문', translatedText: 'Text', ...over });
  check('정상 블록 → 대상', isLayoutRenderTarget(vm({})));
  check('isExcluded(라벨·로고) → 아님', !isLayoutRenderTarget(vm({ editable: false })));
  check('빈 원문 → 아님', !isLayoutRenderTarget(vm({ sourceText: ' ' })));
  check('빈 번역문 → 아님', !isLayoutRenderTarget(vm({ translatedText: '' })));
  check('409 INVALID_STATE not_render_target 구분', isNotRenderTargetError({ code: 'INVALID_STATE', details: { reason: 'not_render_target' } }));
  check('다른 INVALID_STATE 는 아님', !isNotRenderTargetError({ code: 'INVALID_STATE', details: { reason: 'job_not_editable' } }));
  check('범위: 경계 안(소수) 허용', isLayoutBoxInSection({ x: 0, y: 0, w: 1000, h: 700 }, { width: 1000, height: 700 }));
  check('범위: x+w 초과 거절(허용 오차 없음)', !isLayoutBoxInSection({ x: 900.5, y: 0, w: 100, h: 10 }, { width: 1000, height: 700 }));
}

console.log('\n[쓰기 허용] Mock 에서만 · 실서버(API 모드)는 차단');
{
  const prev = process.env.NEXT_PUBLIC_API_MOCKING;
  process.env.NEXT_PUBLIC_API_MOCKING = 'enabled';
  check('Mock → 허용', isLayoutAdjustWriteEnabled() === true);
  process.env.NEXT_PUBLIC_API_MOCKING = 'disabled';
  check('API 모드 → 차단', isLayoutAdjustWriteEnabled() === false);
  delete process.env.NEXT_PUBLIC_API_MOCKING;
  check('값 없음 → 차단', isLayoutAdjustWriteEnabled() === false);
  if (prev !== undefined) process.env.NEXT_PUBLIC_API_MOCKING = prev;
}

console.log('\n[Mock 서버] 형식 · 병합 · 정규화');
{
  check('null 허용', eq(parseMockLayoutPatch(null), { ok: true, patch: null }));
  for (const bad of [{}, { box: { x: 1, y: 2 } }, { fontScale: 0 }, { fontScale: -1 }, { other: 1 }, { box: { x: 1, y: 2, w: 3, h: 4, z: 5 } }]) {
    check(`422 ${JSON.stringify(bad)}`, parseMockLayoutPatch(bad).ok === false);
  }
  const moved = { x: 60.5, y: 300, w: 500, h: 80 };
  check('box 만 → 배율 유지', eq(applyMockLayoutPatch({ box: null, fontScale: 1.1 }, { box: moved }, ORIGINAL), { box: moved, fontScale: 1.1 }));
  check('fontScale 만 → box 유지', eq(applyMockLayoutPatch({ box: moved, fontScale: null }, { fontScale: 1.2 }, ORIGINAL), { box: moved, fontScale: 1.2 }));
  check('box null → 그 값만 해제', eq(applyMockLayoutPatch({ box: moved, fontScale: 1.2 }, { box: null }, ORIGINAL), { box: null, fontScale: 1.2 }));
  check('layoutAdjust null → 전부 해제', applyMockLayoutPatch({ box: moved, fontScale: 1.2 }, null, ORIGINAL) === null);
  check('원본 bbox 와 같은 box → null', eq(applyMockLayoutPatch(null, { box: ORIGINAL, fontScale: 1.1 }, ORIGINAL), { box: null, fontScale: 1.1 }));
  check('fontScale 1.0 → null', eq(applyMockLayoutPatch(null, { box: moved, fontScale: 1 }, ORIGINAL), { box: moved, fontScale: null }));
  check('둘 다 기본값 → layoutAdjust null', applyMockLayoutPatch({ box: moved, fontScale: 1.1 }, { box: ORIGINAL, fontScale: 1 }, ORIGINAL) === null);
  check('같은 배치 판정(null 끼리)', isSameMockLayout(null, undefined) && !isSameMockLayout(null, { box: null, fontScale: 1.1 }));
}

console.log('\n[legacy 적용 박스] server PR #116 대비 — layoutAdjust null 이어도 적용 박스는 renderInput 이 정본');
{
  const LEGACY = { x: 120, y: 340, w: 420, h: 80 };
  const legacyVm = { ...toBlockViewModel(dto({ layoutAdjust: null })), renderBinding: { box: { x: 120, y: 340, width: 420, height: 80 }, style: { fontScale: 1 } } };
  check('편집 시작값 = renderInput legacy box(원본 bbox 아님)', eq(getTranslatedBaseBox(legacyVm), { x: 120, y: 340, width: 420, height: 80 }));
  // reset 응답 null 은 이전 값과 비교하지 않고 원본 bbox 로 해석한다(null → null 이라도 no-op 으로 보지 않는다)
  check('reset 응답(layoutAdjust null) → 원본 bbox · 1.0', eq(appliedLayoutFromBlock(dto({ layoutAdjust: null, revision: 8 })), { bbox: { x: 40, y: 300, width: 500, height: 80 }, fontScale: 1 }));
  check('Undo 응답(seller box = 이전 legacy box) → 그 box', eq(appliedLayoutFromBlock(dto({ layoutAdjust: { box: LEGACY, fontScale: null } })).bbox, { x: 120, y: 340, width: 420, height: 80 }));
  check('Mock: 전부 해제는 legacy 를 지운다', clearsMockLegacyBox(null));
  check('Mock: box 지정은 legacy 를 지운다', clearsMockLegacyBox({ box: LEGACY }) && clearsMockLegacyBox({ box: null }));
  check('Mock: fontScale 만은 legacy 를 남긴다', !clearsMockLegacyBox({ fontScale: 1.1 }));
  check('Mock: 셀러 박스가 없으면 legacy 를 적용값으로', eq(withMockLegacyBox({ layoutAdjust: null }, LEGACY).layoutAdjust, { box: LEGACY, fontScale: null }));
  check('Mock: 셀러 박스가 있으면 그대로', eq(withMockLegacyBox({ layoutAdjust: { box: ORIGINAL, fontScale: 1.1 } }, LEGACY).layoutAdjust, { box: ORIGINAL, fontScale: 1.1 }));
  check('Mock: legacy 없으면 그대로', withMockLegacyBox({ layoutAdjust: null }, undefined).layoutAdjust === null);
}

console.log('\n[Idempotency-Key] 조작마다 새 UUID v4 · 만들 수 없으면 키 없이');
{
  const a = createIdempotencyKey();
  const b = createIdempotencyKey();
  const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  check('UUID v4 형식', v4.test(a ?? ''));
  check('계약 형식(공백 없는 ASCII 1~128자)', /^[!-~]{1,128}$/.test(a ?? ''));
  check('부를 때마다 다른 키', a !== b);
  const original = globalThis.crypto.randomUUID;
  try {
    globalThis.crypto.randomUUID = undefined;
    check('randomUUID 없음(secure context 아님) → null', createIdempotencyKey() === null);
  } finally {
    globalThis.crypto.randomUUID = original;
  }
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
