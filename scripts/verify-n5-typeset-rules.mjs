/**
 * N5 HTML/CSS 조판 확정 규칙(lib/n5/typeset-rules.ts) 순수 함수 검증.
 *
 * 역할별 기준 style · 원본 폭 배율 · 사용자 글자 배율(누적 곱 없음) · 박스 선택(소수 보존) ·
 * ink overflow 경계 비교(허용 오차 없음) · CSS 계약(pre-line · line-height 1.2 · kerning normal)을 확인한다.
 * layout-edit.ts 의 effectiveFontSize · nextUserScale(±0.05)과 같은 정의인지도 함께 본다.
 *
 * 실행: npm run verify:n5-typeset
 */

import {
  DEFAULT_USER_FONT_SCALE,
  ROLE_STYLE_DEFAULTS,
  TYPESET_COMMON,
  TYPESET_REFERENCE_WIDTH,
  isInkOverflow,
  isTypesetRole,
  resolveActiveBBox,
  resolveFinalFontPx,
  resolveRoleBaseFontPx,
  typesetTextStyle,
} from '../lib/n5/typeset-rules.ts';
import { N5_FONT_SCALE_STEP, effectiveFontSize, nextUserScale } from '../lib/n5/layout-edit.ts';

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

console.log('\n[1] 역할별 기준 style');
const expected = {
  title: [32, 600, -0.015],
  body: [16, 400, -0.03],
  caption: [14, 400, -0.01],
  price: [24, 600, -0.02],
  caution: [16, 400, -0.03],
};
for (const [role, [size, weight, spacing]] of Object.entries(expected)) {
  const s = ROLE_STYLE_DEFAULTS[role];
  check(`${role} ${size} / ${weight} / ${spacing}em`, s.fontSizePx === size && s.fontWeight === weight && s.letterSpacingEm === spacing,
    JSON.stringify(s));
}
check('역할은 5종뿐(product_label 제외)', Object.keys(ROLE_STYLE_DEFAULTS).sort().join() === 'body,caption,caution,price,title');
check('isTypesetRole: product_label·null은 false', !isTypesetRole('product_label') && !isTypesetRole(null) && isTypesetRole('title'));
check('공통: Pretendard · #222222 · left · 1.2 · pre-line · kerning normal',
  TYPESET_COMMON.fontFamily === 'Pretendard' && TYPESET_COMMON.color === '#222222' && TYPESET_COMMON.textAlignFallback === 'left' &&
  TYPESET_COMMON.lineHeight === 1.2 && TYPESET_COMMON.whiteSpace === 'pre-line' && TYPESET_COMMON.fontKerning === 'normal');

console.log('\n[2] 원본 폭 배율 — roleBasePx × sourceWidth / 375');
check('기준 폭 375', TYPESET_REFERENCE_WIDTH === 375);
check('375px → body 16 그대로', resolveRoleBaseFontPx('body', 375) === 16);
check('750px → title 64(2배)', resolveRoleBaseFontPx('title', 750) === 64);
check('860px → caption 14×860/375', resolveRoleBaseFontPx('caption', 860) === (14 * 860) / 375);
check('폭 0·음수·NaN·Infinity → null',
  [0, -375, Number.NaN, Number.POSITIVE_INFINITY].every((w) => resolveRoleBaseFontPx('body', w) === null));

console.log('\n[3] 사용자 글자 배율 — base × scale, 누적 곱 없음');
check('기본값 1.0', DEFAULT_USER_FONT_SCALE === 1);
check('배율 생략 = 기본 크기', resolveFinalFontPx('body', 750) === resolveRoleBaseFontPx('body', 750));
// base 20(=body 16 × 468.75/375), scale 1.1 → 22, 다시 계산해도 22
const base20 = resolveRoleBaseFontPx('body', 468.75);
check('base 20 확인', base20 === 20);
const first = resolveFinalFontPx('body', 468.75, 1.1);
const second = resolveFinalFontPx('body', 468.75, 1.1);
check('20 × 1.1 = 22 (반복 렌더도 22)', Math.abs(first - 22) < 1e-12 && first === second, `${first} / ${second}`);
check('직전 최종값에 다시 곱하지 않음(22 × 1.1 ≠ 결과)', Math.abs(second - 22 * 1.1) > 1);
check('layout-edit effectiveFontSize와 같은 정의', resolveFinalFontPx('price', 750, 1.15) === effectiveFontSize(48, 1.15));
const scaleAfterTwoSteps = nextUserScale(nextUserScale(1, N5_FONT_SCALE_STEP, 'increase'), N5_FONT_SCALE_STEP, 'increase');
check('±0.05 두 번 → 배율 1.1, 크기는 base × 1.1', scaleAfterTwoSteps === 1.1 &&
  resolveFinalFontPx('body', 375, scaleAfterTwoSteps) === 16 * 1.1);

console.log('\n[4] 박스 선택 — adjusted 있으면 adjusted, 없으면 original. 소수 보존');
const original = { x: 10.125, y: 20.375, width: 100.5, height: 40.0625 };
const adjusted = { x: 12.875, y: 18.625, width: 98.3125, height: 41.75 };
const originalCopy = { ...original };
check('adjusted 있음 → adjusted', resolveActiveBBox(original, adjusted) === adjusted);
check('adjusted null → original', resolveActiveBBox(original, null) === original);
check('adjusted undefined → original', resolveActiveBBox(original, undefined) === original);
const active = resolveActiveBBox(original, null);
check('소수 10.125 / 20.375 그대로', active.x === 10.125 && active.y === 20.375 && active.width === 100.5 && active.height === 40.0625);
check('원본 객체는 바뀌지 않음', JSON.stringify(original) === JSON.stringify(originalCopy));

console.log('\n[5] ink overflow — 경계 같으면 정상, 넘으면 overflow(허용 오차 없음)');
const box = { x: 10.125, y: 20.375, width: 100.5, height: 40.25 };
const edge = { left: 10.125, top: 20.375, right: 110.625, bottom: 60.625 };
check('경계 정확히 같음 → false', isInkOverflow(edge, box) === false);
check('안쪽 → false', isInkOverflow({ left: 11, top: 21, right: 100, bottom: 50 }, box) === false);
check('right +0.115px → true', isInkOverflow({ ...edge, right: edge.right + 0.115 }, box) === true);
check('left 초과 → true', isInkOverflow({ ...edge, left: edge.left - 0.001 }, box) === true);
check('right 초과 → true', isInkOverflow({ ...edge, right: edge.right + 0.001 }, box) === true);
check('top 초과 → true', isInkOverflow({ ...edge, top: edge.top - 0.001 }, box) === true);
check('bottom 초과 → true', isInkOverflow({ ...edge, bottom: edge.bottom + 0.001 }, box) === true);

console.log('\n[6] CSS 계약');
const style = typesetTextStyle('title', 750, 1.05);
check('white-space pre-line', style.whiteSpace === 'pre-line');
check('line-height 1.2', style.lineHeight === 1.2);
check('font-kerning normal', style.fontKerning === 'normal');
check('font-family Pretendard · color #222222 · text-align left',
  style.fontFamily === 'Pretendard' && style.color === '#222222' && style.textAlign === 'left');
check('title 750px × 1.05 → 67.2px · 600 · -0.015em',
  style.fontSize === `${64 * 1.05}px` && style.fontWeight === 600 && style.letterSpacing === '-0.015em', JSON.stringify(style));
const styleKeys = Object.keys(style).join(',');
check('말줄임·줄 수 제한·강제 분해 속성 없음', !/textOverflow|lineClamp|WebkitLineClamp|wordBreak|hyphens|overflowWrap|overflow/.test(styleKeys), styleKeys);
check('원본 폭이 잘못되면 style 없음', typesetTextStyle('body', 0) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
