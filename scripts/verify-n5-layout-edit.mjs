/**
 * N5 배치 영역 편집 순수 계산(lib/n5/layout-edit.ts) 자동 검증.
 *
 * 실행:  npm run verify:n5-layout-edit
 */

import {
  N5_FONT_SCALE_STEP,
  N5_SNAP_ACQUIRE_SCREEN_PX,
  N5_SNAP_RELEASE_SCREEN_PX,
  NO_CENTER_SNAP,
  startCenterSnapLock,
  isSameBox,
  canDecreaseScale,
  canIncreaseScale,
  clampBoxToSection,
  effectiveFontSize,
  moveBoxWithCenterSnap,
  moveBoxWithinSection,
  nextUserScale,
  pruneBlockDrafts,
  resizeBoxWithinSection,
  scaleBoxAndFont,
  snapBoxToSectionCenter,
  stepFontScale,
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
// 계산 함수는 step 을 인자로 받는다 — 아래 [1]~[7] 은 인자 기반 시험, [8] 은 제품 상수(N5_FONT_SCALE_STEP) 시험
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

console.log('\n[8] 제품 step(N5_FONT_SCALE_STEP) — PM 확정 [+][-] 규칙');
{
  const P = N5_FONT_SCALE_STEP;
  check('제품 step 은 0.05', P === 0.05);
  check('1.00 → [+] → 1.05', nextUserScale(1, P, 'increase') === 1.05);
  check('1.05 → [+] → 1.10', nextUserScale(1.05, P, 'increase') === 1.1);
  check('1.10 → [-] → 1.05', nextUserScale(1.1, P, 'decrease') === 1.05);
  check('0.05 에서는 다음 [-] 불가(배율 0 이하)', !canDecreaseScale({ box: BOX, currentScale: 0.05, step: P, section: SECTION }));
  check('0.10 에서는 [-] 가능', canDecreaseScale({ box: BOX, currentScale: 0.1, step: P, section: SECTION }));

  const up = scaleBoxAndFont({ box: BOX, currentScale: 1, nextScale: nextUserScale(1, P, 'increase'), section: SECTION });
  check('박스도 1.05/1.00 비율로 확대 · 중심 유지', sameBox(up, { x: 98, y: 99, width: 84, height: 42 }), show(up));
  const down = up && scaleBoxAndFont({ box: up, currentScale: 1.05, nextScale: nextUserScale(1.05, P, 'decrease'), section: SECTION });
  check('확대 후 축소하면 원래 박스로 돌아온다', sameBox(down, BOX), show(down));

  const edge = { x: 320, y: 100, width: 80, height: 40 };
  const shifted = scaleBoxAndFont({ box: edge, currentScale: 1, nextScale: 1.05, section: SECTION });
  check('경계를 넘으면 크기는 유지하고 안쪽으로 민다', sameBox(shifted, { x: 316, y: 99, width: 84, height: 42 }), show(shifted));

  const wide = { x: 0, y: 0, width: 390, height: 100 };
  check('다음 확대가 섹션 폭을 넘으면 [+] 불가(390 × 1.05 = 409.5 > 400)', !canIncreaseScale({ box: wide, currentScale: 1, step: P, section: SECTION }));
  const fits = { x: 0, y: 0, width: 380, height: 100 };
  check('다음 확대가 섹션 안이면 [+] 가능(380 × 1.05 = 399)', canIncreaseScale({ box: fits, currentScale: 1, step: P, section: SECTION }));
  const tall = { x: 0, y: 0, width: 100, height: 290 };
  check('다음 확대가 섹션 높이를 넘으면 [+] 불가(290 × 1.05 = 304.5 > 300)', !canIncreaseScale({ box: tall, currentScale: 1, step: P, section: SECTION }));
}

console.log('\nmoveBoxWithCenterSnap (acquire·release)');
{
  const section = { width: 1000, height: 900 };
  const box = { x: 40, y: 200, width: 400, height: 100 };
  const d = { acquire: 10, release: 20 };
  const size = (r) => r.box.width === 400 && r.box.height === 100;
  const free = moveBoxWithCenterSnap(box, { x: 30, y: -40 }, section, d, NO_CENTER_SNAP);
  check('가까운 선이 없으면 끈 만큼 옮기고 크기는 그대로', free.box.x === 70 && free.box.y === 160 && size(free) && !free.snappedX && !free.snappedY);
  const x = moveBoxWithCenterSnap(box, { x: 265, y: 0 }, section, d, NO_CENTER_SNAP);
  check('세로 중앙선만 가까우면 X만 맞춘다', x.snappedX && !x.snappedY && x.box.x === 300 && x.box.y === 200 && size(x), JSON.stringify(x));
  const y = moveBoxWithCenterSnap(box, { x: 0, y: 195 }, section, d, NO_CENTER_SNAP);
  check('가로 중앙선만 가까우면 Y만 맞춘다', !y.snappedX && y.snappedY && y.box.y === 400 && y.box.x === 40, JSON.stringify(y));
  const both = moveBoxWithCenterSnap(box, { x: 265, y: 195 }, section, d, NO_CENTER_SNAP);
  check('둘 다 가까우면 정중앙', both.snappedX && both.snappedY && both.box.x === 300 && both.box.y === 400);
  const edgeOut = moveBoxWithCenterSnap(box, { x: 5000, y: -5000 }, section, d, NO_CENTER_SNAP);
  check('섹션 밖으로 끌면 가장자리에서 멈춘다', edgeOut.box.x === 600 && edgeOut.box.y === 0 && size(edgeOut));

  // 후보 x = 40 + dx, 중심 = x + 200. 세로 중앙선은 500 → dx = 260 이 정중앙
  const notYet = moveBoxWithCenterSnap(box, { x: 260 + 15, y: 0 }, section, d, NO_CENTER_SNAP);
  check('안 붙은 상태에서 acquire 밖(15)이면 붙지 않는다', !notYet.snappedX && notYet.box.x === 315);
  const held = moveBoxWithCenterSnap(box, { x: 260 + 15, y: 0 }, section, d, { snappedX: true, snappedY: false });
  check('붙은 상태면 같은 15에서도 유지된다', held.snappedX && held.box.x === 300);
  const released = moveBoxWithCenterSnap(box, { x: 260 + 21, y: 0 }, section, d, { snappedX: true, snappedY: false });
  check('release 밖(21)이면 풀리고 커서 위치로 돌아간다', !released.snappedX && released.box.x === 321);
  const xOutYIn = moveBoxWithCenterSnap(box, { x: 260 + 21, y: 200 + 15 }, section, d, { snappedX: true, snappedY: true });
  check('X만 풀려도 Y는 유지된다', !xOutYIn.snappedX && xOutYIn.snappedY && xOutYIn.box.y === 400);

  // 화면 기준 거리는 zoom과 무관하다(scale 0.4)
  for (const zoom of [0.5, 1, 2]) {
    const unit = 0.4 * zoom;
    const screen = { acquire: N5_SNAP_ACQUIRE_SCREEN_PX / unit, release: N5_SNAP_RELEASE_SCREEN_PX / unit };
    const at = (px, lock) => moveBoxWithCenterSnap(box, { x: 260 + px / unit, y: 0 }, section, screen, lock);
    const locked = { snappedX: true, snappedY: false };
    check(
      `zoom ${zoom} — 화면 11px 붙고 13px 안 붙고, 붙은 뒤 19px 유지 21px 해제`,
      at(11, NO_CENTER_SNAP).snappedX && !at(13, NO_CENTER_SNAP).snappedX && at(19, locked).snappedX && !at(21, locked).snappedX,
    );
  }
  // 한 번의 이동으로 acquire 구간을 건너뛰어도 선을 지났으면 붙는다
  const before = { x: 200, y: 200, width: 400, height: 100 }; // 중심 400(선 왼쪽)
  const jumped = moveBoxWithCenterSnap(box, { x: 260 + 15, y: 0 }, section, d, NO_CENTER_SNAP, before); // 중심 515(선 오른쪽)
  check('선을 지나면 release 안에서 붙는다', jumped.snappedX && jumped.box.x === 300);
  const far = moveBoxWithCenterSnap(box, { x: 260 + 30, y: 0 }, section, d, NO_CENTER_SNAP, before);
  check('선을 지나도 release 밖이면 붙지 않는다', !far.snappedX && far.box.x === 330);
  const wide = { x: 40, y: 200, width: 900, height: 100 };
  const atEdge = moveBoxWithCenterSnap(wide, { x: 60, y: 0 }, section, { acquire: 30, release: 75 }, { snappedX: true, snappedY: false });
  check('section 끝에 닿으면 붙어 있어도 빠져나온다(폭이 넓은 박스)', !atEdge.snappedX && atEdge.box.x === 100, JSON.stringify(atEdge.box));
  const nearCenter = moveBoxWithCenterSnap(wide, { x: 10, y: 0 }, section, { acquire: 30, release: 75 }, { snappedX: true, snappedY: false });
  check('끝에 닿기 전에는 유지된다', nearCenter.snappedX && nearCenter.box.x === 50);
  check('후보 위치를 함께 돌려준다', jumped.candidate.x === 315);
  // 폭이 넓은 박스 — 구간 안에서 시작하면 첫 이동에 묶이지 않는다
  const wideStart = { x: 40, y: 200, width: 900, height: 100 }; // 중심 490, 선까지 10
  const wideDistance = { acquire: 30, release: 50 };
  const startLock = startCenterSnapLock(wideStart, section, wideDistance.acquire);
  check('구간 안 시작 축은 아직 붙지 않고, 밖 축은 붙을 수 있다', startLock.armedX === false && startLock.armedY === true);
  const free1 = moveBoxWithCenterSnap(wideStart, { x: 20, y: 0 }, section, wideDistance, startLock, wideStart);
  check('구간 안 이동은 그대로 따라온다', !free1.snappedX && free1.box.x === 60, JSON.stringify(free1.box));
  const crossInside = moveBoxWithCenterSnap(wideStart, { x: 15, y: 0 }, section, wideDistance, startLock, wideStart);
  check('구간 안에서 중앙선을 지나도 붙지 않는다', !crossInside.snappedX && crossInside.box.x === 55);
  const left = moveBoxWithCenterSnap(wideStart, { x: 45, y: 0 }, section, wideDistance, startLock, free1.candidate);
  check('구간을 벗어나면 다시 붙을 수 있게 된다', left.armedX === true && !left.snappedX);
  const back = moveBoxWithCenterSnap(wideStart, { x: 15, y: 0 }, section, wideDistance, left, left.candidate);
  check('벗어난 뒤 돌아오면 정확히 붙는다', back.snappedX && back.box.x === 50, JSON.stringify(back.box));
  check('같은 박스 비교', isSameBox(box, { ...box }) && !isSameBox(box, { ...box, x: 41 }));
}

console.log('\n[글자 크기] [+][-] 한 번의 결과');
{
  const section = { width: 1000, height: 400 };
  const start = { bbox: { x: 40, y: 100, width: 500, height: 80 }, fontScale: 1 };
  const up1 = stepFontScale(start, 'increase', section);
  const up2 = stepFontScale(up1, 'increase', section);
  const down = stepFontScale(up2, 'decrease', section);
  check('1.00 → + → 1.05', up1.fontScale === 1.05, String(up1.fontScale));
  check('1.05 → + → 1.10', up2.fontScale === 1.1, String(up2.fontScale));
  check('1.10 → - → 1.05', down.fontScale === 1.05, String(down.fontScale));
  check('박스가 같은 비율로 바뀐다', near(up1.bbox.width, 525) && near(up1.bbox.height, 84));
  check('중심을 유지한다', near(up1.bbox.x + up1.bbox.width / 2, 290) && near(up1.bbox.y + up1.bbox.height / 2, 140));
  check('입력 값을 바꾸지 않는다', start.fontScale === 1 && start.bbox.width === 500);

  const nearEdge = { bbox: { x: 0, y: 0, width: 500, height: 80 }, fontScale: 1 };
  const clamped = stepFontScale(nearEdge, 'increase', section);
  check('섹션 밖으로 나가면 크기는 그대로 안쪽으로 민다', clamped.bbox.x === 0 && clamped.bbox.y === 0 && near(clamped.bbox.width, 525));

  check('섹션보다 커지면 [+] 불가', stepFontScale({ bbox: { x: 0, y: 0, width: 990, height: 80 }, fontScale: 1 }, 'increase', section) === null);
  check('섹션 크기와 같아지는 [+]는 허용', stepFontScale({ bbox: { x: 0, y: 0, width: 800, height: 80 }, fontScale: 1 }, 'increase', { width: 840, height: 400 }) !== null);
  check('배율이 0이 되는 [-] 불가', stepFontScale({ bbox: start.bbox, fontScale: 0.05 }, 'decrease', section) === null);
  check('배율 0.10 → - → 0.05 는 가능(제품 최소 없음)', stepFontScale({ bbox: start.bbox, fontScale: 0.1 }, 'decrease', section)?.fontScale === 0.05);
}

console.log('\n[글자 크기] local 초안 정리');
{
  const drafts = new Map([[1, 1.05], [2, 1.1]]);
  check('블록이 그대로면 같은 Map', pruneBlockDrafts(drafts, new Set([1, 2, 3])) === drafts);
  const pruned = pruneBlockDrafts(drafts, new Set([1]));
  check('사라진 블록만 지운다', pruned.size === 1 && pruned.get(1) === 1.05 && drafts.size === 2);
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
