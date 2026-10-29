/**
 * N5 배치 영역 편집 순수 계산(lib/n5/layout-edit.ts) 자동 검증.
 *
 * 실행:  npm run verify:n5-layout-edit
 */

import {
  canDecreaseScale,
  canIncreaseScale,
  clampBoxToSection,
  effectiveFontSize,
  moveBoxWithinSection,
  nextUserScale,
  resizeBoxWithinSection,
  scaleBoxAndFont,
  snapBoxToSectionCenter,
} from '../lib/n5/layout-edit.ts';

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

const near = (a, b) => Math.abs(a - b) < 1e-9;
const sameBox = (a, b) => a && b && near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
const show = (b) => JSON.stringify(b);
const SECTION = { width: 400, height: 300 };
const BOX = { x: 100, y: 100, width: 80, height: 40 };
// 이 계산은 step 을 인자로 받는다 — 아래 0.05 는 시험용 값이지 제품 상수가 아니다
const STEP = 0.05;

console.log('\n[1] move — 위치만 섹션 안으로');
{
  check('정상 이동', sameBox(moveBoxWithinSection(BOX, { x: 150, y: 120 }, SECTION), { ...BOX, x: 150, y: 120 }));
  check('왼쪽 초과 → x=0', sameBox(moveBoxWithinSection(BOX, { x: -30, y: 120 }, SECTION), { ...BOX, x: 0, y: 120 }));
  check('오른쪽 초과 → x=W−w', sameBox(moveBoxWithinSection(BOX, { x: 390, y: 120 }, SECTION), { ...BOX, x: 320, y: 120 }));
  check('위 초과 → y=0', sameBox(moveBoxWithinSection(BOX, { x: 150, y: -5 }, SECTION), { ...BOX, x: 150, y: 0 }));
  check('아래 초과 → y=H−h', sameBox(moveBoxWithinSection(BOX, { x: 150, y: 299 }, SECTION), { ...BOX, x: 150, y: 260 }));
  const frac = moveBoxWithinSection({ x: 0, y: 0, width: 80.25, height: 40.5 }, { x: 12.345, y: 67.891 }, SECTION);
  check('소수 좌표를 반올림하지 않는다', frac.x === 12.345 && frac.y === 67.891, show(frac));
  const fracEdge = moveBoxWithinSection({ x: 0, y: 0, width: 80.25, height: 40.5 }, { x: 999, y: 999 }, { width: 400.5, height: 300.75 });
  check('소수 섹션 경계 그대로(x=320.25, y=260.25)', fracEdge.x === 320.25 && fracEdge.y === 260.25, show(fracEdge));
  check('크기는 바꾸지 않는다', moveBoxWithinSection(BOX, { x: 999, y: 999 }, SECTION).width === 80);
  const big = clampBoxToSection({ x: 50, y: 10, width: 500, height: 40 }, SECTION);
  check('섹션보다 큰 기존 박스는 크기를 줄이지 않고 왼쪽에 붙인다', big.x === 0 && big.width === 500, show(big));
}

console.log('\n[2] resize — 손잡이 변만 움직이고 섹션 안, 0 크기는 거부');
{
  check('se 내부 확대', sameBox(resizeBoxWithinSection(BOX, 'se', { x: 20, y: 10 }, SECTION), { x: 100, y: 100, width: 100, height: 50 }));
  check('nw 내부 축소(반대 변 고정)', sameBox(resizeBoxWithinSection(BOX, 'nw', { x: 10, y: 5 }, SECTION), { x: 110, y: 105, width: 70, height: 35 }));
  check('e 섹션 밖으로 → 오른쪽 경계에서 멈춤', sameBox(resizeBoxWithinSection(BOX, 'e', { x: 500, y: 0 }, SECTION), { x: 100, y: 100, width: 300, height: 40 }));
  check('w 섹션 밖으로 → 왼쪽 경계에서 멈춤', sameBox(resizeBoxWithinSection(BOX, 'w', { x: -500, y: 0 }, SECTION), { x: 0, y: 100, width: 180, height: 40 }));
  check('n 섹션 밖으로 → 위 경계', sameBox(resizeBoxWithinSection(BOX, 'n', { x: 0, y: -500 }, SECTION), { x: 100, y: 0, width: 80, height: 140 }));
  check('s 섹션 밖으로 → 아래 경계', sameBox(resizeBoxWithinSection(BOX, 's', { x: 0, y: 500 }, SECTION), { x: 100, y: 100, width: 80, height: 200 }));
  check('e 가 반대 변에 붙으면(폭 0) null', resizeBoxWithinSection(BOX, 'e', { x: -80, y: 0 }, SECTION) === null);
  check('e 가 반대 변을 넘으면 null', resizeBoxWithinSection(BOX, 'e', { x: -200, y: 0 }, SECTION) === null);
  check('n 이 높이 0 이 되면 null', resizeBoxWithinSection(BOX, 'n', { x: 0, y: 40 }, SECTION) === null);
  const tiny = resizeBoxWithinSection(BOX, 'e', { x: -79.999, y: 0 }, SECTION);
  check('아주 작아도 0 보다 크면 허용(제품 최소 크기 없음)', tiny !== null && tiny.width > 0 && tiny.width < 0.01, show(tiny));
  // 다른 블록이 바로 옆에 있어도 계산에 들어가지 않는다 — 함수가 다른 블록을 받지 않는다
  check('다른 박스와 겹침은 무시(인자에 다른 블록 없음, 섹션 경계까지 확대)', resizeBoxWithinSection.length === 4 &&
    sameBox(resizeBoxWithinSection(BOX, 'se', { x: 1000, y: 1000 }, SECTION), { x: 100, y: 100, width: 300, height: 200 }));
}

console.log('\n[3] [+][-] — 배율과 박스를 같은 비율로, 중심 유지 · 경계 안쪽으로 밀기');
{
  check('적용 크기 = 기준 × 배율(16 × 1.1 = 17.6)', near(effectiveFontSize(16, 1.1), 17.6));
  check('nextUserScale 덧셈 오차 제거(1.1 + 0.05 = 1.15)', nextUserScale(1.1, STEP, 'increase') === 1.15);
  check('nextUserScale 축소(1 − 0.05 = 0.95)', nextUserScale(1, STEP, 'decrease') === 0.95);
  check('step 은 인자 — 0.1 이면 1.2', nextUserScale(1.1, 0.1, 'increase') === 1.2);

  const centered = scaleBoxAndFont({ box: { x: 160, y: 130, width: 80, height: 40 }, currentScale: 1, nextScale: 1.05, section: SECTION });
  check('확대 시 중심 유지', near(centered.x + centered.width / 2, 200) && near(centered.y + centered.height / 2, 150), show(centered));
  check('확대 크기 ×1.05', near(centered.width, 84) && near(centered.height, 42));

  const ratio = scaleBoxAndFont({ box: BOX, currentScale: 1.1, nextScale: 1.15, section: SECTION });
  check('비율 = next/current (1.15/1.1)', near(ratio.width, 80 * (1.15 / 1.1)), show(ratio));

  const right = scaleBoxAndFont({ box: { x: 320, y: 100, width: 80, height: 40 }, currentScale: 1, nextScale: 1.5, section: SECTION });
  check('오른쪽 경계 → 크기 유지하고 안쪽으로(x = W − w)', near(right.x, 400 - 120) && near(right.width, 120), show(right));
  const left = scaleBoxAndFont({ box: { x: 0, y: 100, width: 80, height: 40 }, currentScale: 1, nextScale: 1.5, section: SECTION });
  check('왼쪽 경계 → x = 0', near(left.x, 0) && near(left.width, 120), show(left));
  const top = scaleBoxAndFont({ box: { x: 100, y: 0, width: 80, height: 40 }, currentScale: 1, nextScale: 1.5, section: SECTION });
  check('위 경계 → y = 0', near(top.y, 0) && near(top.height, 60), show(top));
  const bottom = scaleBoxAndFont({ box: { x: 100, y: 260, width: 80, height: 40 }, currentScale: 1, nextScale: 1.5, section: SECTION });
  check('아래 경계 → y = H − h', near(bottom.y, 300 - 60), show(bottom));

  check('후보가 섹션 폭보다 크면 null', scaleBoxAndFont({ box: { x: 0, y: 0, width: 390, height: 40 }, currentScale: 1, nextScale: 1.05, section: SECTION }) === null);
  check('후보가 섹션 높이보다 크면 null', scaleBoxAndFont({ box: { x: 0, y: 0, width: 40, height: 290 }, currentScale: 1, nextScale: 1.05, section: SECTION }) === null);
  const exact = scaleBoxAndFont({ box: { x: 10, y: 10, width: 200, height: 40 }, currentScale: 1, nextScale: 2, section: SECTION });
  check('후보가 섹션 폭과 정확히 같으면 허용(x = 0)', exact !== null && near(exact.width, 400) && near(exact.x, 0), show(exact));

  const up = scaleBoxAndFont({ box: { x: 160, y: 130, width: 80, height: 40 }, currentScale: 1, nextScale: 1.05, section: SECTION });
  const back = scaleBoxAndFont({ box: up, currentScale: 1.05, nextScale: 1, section: SECTION });
  check('경계에 안 닿으면 확대 후 축소 시 원래 값 복원', sameBox(back, { x: 160, y: 130, width: 80, height: 40 }), show(back));
  const s1 = nextUserScale(1, STEP, 'increase');
  const s2 = nextUserScale(s1, STEP, 'decrease');
  check('배율 +step 후 −step 은 정확히 원래 배율', s2 === 1, String(s2));

  const fracScale = scaleBoxAndFont({ box: { x: 100.5, y: 50.25, width: 33.3, height: 12.7 }, currentScale: 0.85, nextScale: 0.9, section: SECTION });
  check('소수 배율·좌표 계산(반올림 없음)', near(fracScale.width, 33.3 * (0.9 / 0.85)) && near(fracScale.x + fracScale.width / 2, 100.5 + 33.3 / 2), show(fracScale));
  check('배율 0 이하는 null', scaleBoxAndFont({ box: BOX, currentScale: 0.05, nextScale: 0, section: SECTION }) === null);

  check('canIncrease: 여유 있음 → true', canIncreaseScale({ box: BOX, currentScale: 1, step: STEP, section: SECTION }));
  check('canIncrease: 이미 섹션 폭과 같음 → false', !canIncreaseScale({ box: { x: 0, y: 0, width: 400, height: 40 }, currentScale: 1, step: STEP, section: SECTION }));
  check('canIncrease: 후보가 높이를 넘음 → false', !canIncreaseScale({ box: { x: 0, y: 0, width: 40, height: 290 }, currentScale: 1, step: STEP, section: SECTION }));
  check('canDecrease: 1.0 → true', canDecreaseScale({ box: BOX, currentScale: 1, step: STEP, section: SECTION }));
  check('canDecrease: 배율 0.05 에서 0.05 빼면 0 → false', !canDecreaseScale({ box: BOX, currentScale: 0.05, step: STEP, section: SECTION }));
  check('canDecrease: 0.1 → 0.05 는 가능(최소 크기 규칙 없음)', canDecreaseScale({ box: BOX, currentScale: 0.1, step: STEP, section: SECTION }));
  let s = 1;
  let n = 0;
  while (canDecreaseScale({ box: BOX, currentScale: s, step: STEP, section: SECTION }) && n < 1000) {
    s = nextUserScale(s, STEP, 'decrease');
    n += 1;
  }
  check('[-] 를 계속 누르면 유한 번(19번) 뒤 비활성', n === 19 && near(s, 0.05), `n=${n} s=${s}`);
}

console.log('\n[4] snap — 섹션 중앙선만, tolerance 는 인자');
{
  const xOnly = snapBoxToSectionCenter({ x: 158, y: 20, width: 80, height: 40 }, SECTION, 3);
  check('x 만 snap(중심 198 → 200)', xOnly.snappedX && !xOnly.snappedY && near(xOnly.box.x, 160) && xOnly.box.y === 20, show(xOnly));
  const yOnly = snapBoxToSectionCenter({ x: 10, y: 128, width: 80, height: 40 }, SECTION, 3);
  check('y 만 snap(중심 148 → 150)', !yOnly.snappedX && yOnly.snappedY && near(yOnly.box.y, 130), show(yOnly));
  const both = snapBoxToSectionCenter({ x: 161, y: 131, width: 80, height: 40 }, SECTION, 3);
  check('x·y 모두 snap', both.snappedX && both.snappedY && near(both.box.x, 160) && near(both.box.y, 130), show(both));
  const out = snapBoxToSectionCenter({ x: 150, y: 120, width: 80, height: 40 }, SECTION, 3);
  check('tolerance 밖이면 그대로', !out.snappedX && !out.snappedY && out.box.x === 150 && out.box.y === 120, show(out));
  const edge = snapBoxToSectionCenter({ x: 157, y: 0, width: 80, height: 40 }, SECTION, 3);
  check('경계와 tolerance 가 같으면 snap(|197−200| = 3)', edge.snappedX, show(edge));
  const fracSec = snapBoxToSectionCenter({ x: 100, y: 0, width: 50, height: 10 }, { width: 250.5, height: 99.5 }, 1);
  check('소수 섹션 중앙(125.25)', fracSec.snappedX && near(fracSec.box.x + 25, 125.25), show(fracSec));
  const wide = snapBoxToSectionCenter({ x: 0, y: 0, width: 500, height: 40 }, SECTION, 1000);
  check('섹션보다 큰 축은 snap 하지 않는다', !wide.snappedX && wide.box.x === 0, show(wide));
  check('크기는 바꾸지 않는다', both.box.width === 80 && both.box.height === 40);
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
