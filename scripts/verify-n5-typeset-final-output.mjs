/**
 * 최종 출력 좌표·조판 평가(lib/n5/typeset-final-output.ts)와 렌더 모델 변환 순수 함수 검증.
 *
 * 실행: npm run verify:n5-final-output
 */

import {
  buildFinalSectionOffsets,
  evaluateFinalImageBoundary,
  evaluateTypesetBlock,
  toFinalOutputY,
} from '../lib/n5/typeset-final-output.ts';
import { toTypesetMeasureInput } from '../lib/n5/typeset-render-model.ts';
import { inkOverflowSides, resolveFinalFontPx } from '../lib/n5/typeset-rules.ts';

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

const section = (id, height, bucket = 'include', sectionOrder = id) => ({ id, sectionOrder, height, bucket });
const offsetsOf = (sections) => Object.fromEntries(buildFinalSectionOffsets(sections).offsets);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function offsetCase(name, sections, expected, height) {
  const layout = buildFinalSectionOffsets(sections);
  const actual = Object.fromEntries(layout.offsets);
  check(name, same(actual, expected) && layout.totalHeight === height, `${JSON.stringify(actual)} / ${layout.totalHeight}`);
}

console.log('\n[1] finalOutputOffset — sectionOrder 순서, include 만 누적');
offsetCase('모두 include', [section(1, 500), section(2, 300), section(3, 400)], { 1: 0, 2: 500, 3: 800 }, 1200);
offsetCase('중간 exclude → S3 = 500(800 아님)', [section(1, 500), section(2, 300, 'exclude'), section(3, 400)], { 1: 0, 3: 500 }, 900);
offsetCase('첫 section exclude', [section(1, 500, 'exclude'), section(2, 300), section(3, 400)], { 2: 0, 3: 300 }, 700);
offsetCase('마지막 section exclude', [section(1, 500), section(2, 300), section(3, 400, 'exclude')], { 1: 0, 2: 500 }, 800);
offsetCase('연속 exclude', [section(1, 500), section(2, 300, 'exclude'), section(3, 400, 'exclude'), section(4, 100)], { 1: 0, 4: 500 }, 600);
offsetCase('모두 exclude', [section(1, 500, 'exclude'), section(2, 300, 'exclude')], {}, 0);
offsetCase('빈 입력', [], {}, 0);
offsetCase('소수 height 를 반올림하지 않는다', [section(1, 500.5), section(2, 300.25), section(3, 400.125)], { 1: 0, 2: 500.5, 3: 800.75 }, 1200.875);

const restore = [section(1, 500), section(2, 300, 'exclude'), section(3, 400)];
const before = offsetsOf(restore);
const after = offsetsOf(restore.map((s) => (s.id === 2 ? { ...s, bucket: 'include' } : s)));
check('exclude → restore 하면 원래 offset 으로 돌아온다', before[3] === 500 && after[3] === 800 && after[2] === 500);

const orderedInput = [section(30, 400, 'include', 3), section(10, 500, 'include', 1), section(20, 300, 'exclude', 2)];
const inputCopy = JSON.stringify(orderedInput);
check('입력 순서가 뒤섞여도 sectionOrder 기준', same(offsetsOf(orderedInput), { 10: 0, 30: 500 }));
check('입력 배열을 바꾸지 않는다', JSON.stringify(orderedInput) === inputCopy);

for (const [name, sections] of [
  ['height NaN', [section(1, Number.NaN)]],
  ['height 음수', [section(1, -1)]],
  ['id 중복', [section(1, 10, 'include', 1), section(1, 10, 'include', 2)]],
  ['sectionOrder 중복', [section(1, 10, 'include', 1), section(2, 10, 'include', 1)]],
]) {
  let thrown = false;
  try {
    buildFinalSectionOffsets(sections);
  } catch {
    thrown = true;
  }
  check(`${name} → 좌표를 추측하지 않고 던진다`, thrown);
}

console.log('\n[2] 최종 블록 Y — topOffset 중복 가산 없음');
const midExcluded = buildFinalSectionOffsets(restore);
check('S3 로컬 12.5 → 512.5', toFinalOutputY(12.5, midExcluded.offsets.get(3)) === 512.5);

console.log('\n[3] 최종 이미지 경계 — 기존 imageBoundaryViolation 연결');
const image = { width: 375, height: midExcluded.totalHeight };
const s3Offset = midExcluded.offsets.get(3);
const exactInk = { left: 0, top: 0, right: 375, bottom: 400 };
const exact = evaluateFinalImageBoundary(exactInk, s3Offset, image);
check('이미지 경계와 정확히 같음 → 정상', !exact.any && exact.inkInImage.bottom === 900, JSON.stringify(exact));
check('bottom +0.115px → bottom', evaluateFinalImageBoundary({ ...exactInk, bottom: 400.115 }, s3Offset, image).bottom);
check('right +0.115px → right', evaluateFinalImageBoundary({ ...exactInk, right: 375.115 }, s3Offset, image).right);
check('left -0.115px → left', evaluateFinalImageBoundary({ ...exactInk, left: -0.115 }, s3Offset, image).left);
const s1Offset = midExcluded.offsets.get(1);
check('top -0.115px → top', evaluateFinalImageBoundary({ ...exactInk, top: -0.115 }, s1Offset, image).top);
check('ink 없음 → 정상', !evaluateFinalImageBoundary(null, s3Offset, image).any);
const allIncluded = buildFinalSectionOffsets([section(1, 500), section(2, 300), section(3, 400)]);
const s1Crossing = { left: 24, top: 490, right: 200, bottom: 507 };
check('S1 경계를 넘어도 뒤 섹션이 있으면 이미지 안', !evaluateFinalImageBoundary(s1Crossing, allIncluded.offsets.get(1), { width: 375, height: 1200 }).any);
const s1Only = buildFinalSectionOffsets([section(1, 500), section(2, 300, 'exclude'), section(3, 400, 'exclude')]);
check('뒤 섹션을 모두 제외하면 같은 ink 가 bottom 이탈', evaluateFinalImageBoundary(s1Crossing, s1Only.offsets.get(1), { width: 375, height: 500 }).bottom);

console.log('\n[4] 평가 — 블록 넘침과 이미지 이탈은 독립');
const evaluate = (ink, bbox, sectionId, layout, height, excluded = false) =>
  evaluateTypesetBlock({ bbox, ink, overflow: inkOverflowSides(ink, bbox) }, { sectionId, excluded }, layout, { width: 375, height });
const wideBox = { x: 24, y: 100, width: 300, height: 40 };
const fits = evaluate({ left: 30, top: 105, right: 100, bottom: 125 }, wideBox, 3, midExcluded, 900);
check('둘 다 정상', !fits.blockOverflow.any && !fits.imageBoundaryViolation.any && fits.finalOutputState === 'in-output');
check('finalBlockY = 로컬 100 + 500', fits.finalBlockY === 600);
const onlyBlock = evaluate({ left: 30, top: 105, right: 340, bottom: 125 }, wideBox, 3, midExcluded, 900);
check('블록만 넘침(right) / 이미지 정상', onlyBlock.blockOverflow.right && !onlyBlock.imageBoundaryViolation.any);
const lastBox = { x: 24, y: 390, width: 300, height: 40 };
const onlyImage = evaluate({ left: 30, top: 392, right: 100, bottom: 407 }, lastBox, 3, midExcluded, 900);
check('블록 정상 / 이미지만 이탈(bottom)', !onlyImage.blockOverflow.any && onlyImage.imageBoundaryViolation.bottom && onlyImage.inkInImage.bottom === 907);
const bothBox = { x: 24, y: 390, width: 300, height: 5 };
const both = evaluate({ left: 30, top: 392, right: 100, bottom: 407 }, bothBox, 3, midExcluded, 900);
check('둘 다 넘침', both.blockOverflow.bottom && both.imageBoundaryViolation.bottom);
const sectionOut = evaluate({ left: 30, top: 392, right: 100, bottom: 407 }, bothBox, 2, midExcluded, 900);
check('제외 섹션 → section-excluded, 이미지 판정 없음, 블록 판정은 유지',
  sectionOut.finalOutputState === 'section-excluded' && !sectionOut.imageBoundaryViolation.any && sectionOut.finalBlockY === null && sectionOut.blockOverflow.bottom);
const blockOut = evaluate({ left: 30, top: 392, right: 100, bottom: 407 }, bothBox, 3, midExcluded, 900, true);
check('제외 블록 → block-excluded, 이미지 판정 없음', blockOut.finalOutputState === 'block-excluded' && !blockOut.imageBoundaryViolation.any);

console.log('\n[5] 렌더 모델 → 측정 입력');
const originalBBox = { x: 10.125, y: 20.375, width: 100.5, height: 40.0625 };
const adjustedBBox = { x: 12.875, y: 18.625, width: 98.3125, height: 41.75 };
const model = { blockId: 1, sectionId: 1, text: 'a\nb', role: 'body', originalBBox, sourceImageWidth: 750, userFontScale: 1.25, excluded: false };
check('adjusted 없음 → original', toTypesetMeasureInput(model).bbox === originalBBox);
check('adjusted null → original', toTypesetMeasureInput({ ...model, adjustedBBox: null }).bbox === originalBBox);
check('adjusted 있음 → adjusted, original 유지', toTypesetMeasureInput({ ...model, adjustedBBox }).bbox === adjustedBBox && originalBBox.x === 10.125);
check('textAlign 없으면 비워 둔다(left fallback 은 규칙이 담당)', toTypesetMeasureInput(model).textAlign === undefined);
check('textAlign 명시는 그대로', toTypesetMeasureInput({ ...model, textAlign: 'right' }).textAlign === 'right');
const scaled = toTypesetMeasureInput(model);
check('배율은 그대로 전달 — base × scale', resolveFinalFontPx(scaled.role, scaled.sourceImageWidth, scaled.userFontScale) === 40, String(scaled.userFontScale));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
