/**
 * N5 캔버스형 viewport(zoom/pan/fit) 순수 계산 자동 검증.
 *
 * lib/n5/viewport.ts 는 React 도 브라우저 API 도 쓰지 않기 때문에
 * Node 에서 그대로 불러와 확인할 수 있다. (scripts/verify-n5-coordinates.mjs와 같은 패턴)
 *
 * 실행:  npm run verify:n5-viewport
 */

import {
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  computeWheelZoomFactor,
  computeZoomAroundPoint,
  computeUsableViewportSize,
  computeFitWidthScale,
  computeFitHeightScale,
  computeCenteredPan,
  clampPan,
  parseZoomPercentInput,
} from '../lib/n5/viewport.ts';

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

console.log('\n[1] zoom clamp — 1% ~ 400%');
{
  // 11일차: 25%였던 하한을 1%로 낮췄다 — 초장축 이미지의 Fit Height 배율이
  // 25% 밑으로 내려가는 경우(예: preview 500x18868)에도 clamp 때문에
  // 이미지가 잘리지 않게 하기 위함이다.
  check('MIN_ZOOM === 0.01', MIN_ZOOM === 0.01, `got ${MIN_ZOOM}`);
  check('MAX_ZOOM === 4', MAX_ZOOM === 4, `got ${MAX_ZOOM}`);
  check('범위 안 값은 그대로', clampZoom(1) === 1);
  check('최소값 미만은 clamp', clampZoom(0.001) === MIN_ZOOM, `got ${clampZoom(0.001)}`);
  check('최대값 초과는 clamp', clampZoom(100) === MAX_ZOOM, `got ${clampZoom(100)}`);
}

console.log('\n[2] wheel zoom factor — 위로 굴리면(deltaY<0) 확대, 아래로 굴리면(deltaY>0) 축소');
{
  check('deltaY<0 -> factor>1', computeWheelZoomFactor(-100) > 1);
  check('deltaY>0 -> factor<1', computeWheelZoomFactor(100) < 1);
  check('deltaY=0 -> factor=1', computeWheelZoomFactor(0) === 1);
}

console.log('\n[3] pointer-centered zoom — pointer 아래 canvas 좌표가 확대 후에도 같은 화면 위치에 남는다');
{
  // zoom=1, pan={0,0}일 때 pointer(300,200) 아래는 canvas-space (300,200)이다.
  const r1 = computeZoomAroundPoint(1, { x: 0, y: 0 }, { x: 300, y: 200 }, 2);
  check('zoom 1 -> 2', r1.zoom === 2, `got ${r1.zoom}`);
  // 새 pan에서 같은 pointer 아래 canvas-space 좌표를 역산해서 원래 값과 같은지 확인
  const contentX1 = (300 - r1.pan.x) / r1.zoom;
  const contentY1 = (200 - r1.pan.y) / r1.zoom;
  check('확대 후에도 pointer 아래 canvas 좌표 불변(X)', Math.abs(contentX1 - 300) < 1e-9, `got ${contentX1}`);
  check('확대 후에도 pointer 아래 canvas 좌표 불변(Y)', Math.abs(contentY1 - 200) < 1e-9, `got ${contentY1}`);

  // pan이 이미 있는 상태(스크롤/이전 zoom 결과)에서도 같은 성질이 성립해야 한다.
  const r2 = computeZoomAroundPoint(2, { x: -150, y: -400 }, { x: 500, y: 350 }, 1);
  const contentX2 = (500 - (-150)) / 2;
  const contentY2 = (350 - (-400)) / 2;
  const contentX2After = (500 - r2.pan.x) / r2.zoom;
  const contentY2After = (350 - r2.pan.y) / r2.zoom;
  check('기존 pan이 있어도 축소 후 canvas 좌표 불변(X)', Math.abs(contentX2After - contentX2) < 1e-9);
  check('기존 pan이 있어도 축소 후 canvas 좌표 불변(Y)', Math.abs(contentY2After - contentY2) < 1e-9);

  // clamp된 목표 zoom으로도 pan이 정상 계산되는지 (400% 초과 요청 -> 400%로 clamp)
  const r3 = computeZoomAroundPoint(1, { x: 0, y: 0 }, { x: 100, y: 100 }, 999);
  check('zoom 목표가 범위를 넘으면 clamp된 값 사용', r3.zoom === MAX_ZOOM, `got ${r3.zoom}`);

  // 목표 zoom이 현재와 같으면(= clamp 후 변화 없음) pan도 그대로 유지된다
  const r4 = computeZoomAroundPoint(MAX_ZOOM, { x: 10, y: 20 }, { x: 300, y: 300 }, 999);
  check('zoom 변화 없으면 pan도 그대로', r4.pan.x === 10 && r4.pan.y === 20, JSON.stringify(r4.pan));
}

console.log('\n[4] usable viewport size — padding 제외');
{
  const size = computeUsableViewportSize(800, 600, { left: 16, right: 16, top: 8, bottom: 8 });
  check('width = clientWidth - left - right', size.width === 768, `got ${size.width}`);
  check('height = clientHeight - top - bottom', size.height === 584, `got ${size.height}`);

  const negative = computeUsableViewportSize(10, 10, { left: 20, right: 20, top: 0, bottom: 0 });
  check('padding이 clientWidth보다 크면 0으로 바닥', negative.width === 0, `got ${negative.width}`);
}

console.log('\n[5] fit width / fit height — 원본 canvas size와 viewport size로만 계산');
{
  // viewport(800x600) 안에 canvas(400x1200) 전체 폭/높이를 맞춘다.
  // (fitHeight 비교값이 MIN_ZOOM~MAX_ZOOM 안에 들어오도록 clamp가 개입하지 않는 크기로 고른다)
  const viewport = { width: 800, height: 600 };
  const canvas = { width: 400, height: 1200 };
  const fitWidth = computeFitWidthScale(viewport, canvas);
  check('fitWidthScale = viewportWidth / canvasWidth', fitWidth === 2, `got ${fitWidth}`);

  const fitHeight = computeFitHeightScale(viewport, canvas);
  check(
    'fitHeightScale = viewportHeight / canvasHeight',
    Math.abs(fitHeight - 600 / 1200) < 1e-12,
    `got ${fitHeight}`,
  );

  // 이미 확대된 상태에서 다시 fit을 눌러도(= 현재 zoom과 무관하게) 같은 결과가 나와야 한다 —
  // canvas/viewport 크기가 그대로면 fit 결과도 항상 같다(누적 오차 없음의 핵심 성질).
  const fitWidthAgain = computeFitWidthScale(viewport, canvas);
  check('같은 입력이면 여러 번 계산해도 항상 같은 결과', fitWidthAgain === fitWidth);

  // canvas가 매우 작아 fit이 400%를 넘으면 clamp된다
  const tinyCanvas = { width: 10, height: 10 };
  check('fit 결과도 MAX_ZOOM으로 clamp', computeFitWidthScale(viewport, tinyCanvas) === MAX_ZOOM);

  // canvas가 매우 커서 fit이 25% 밑으로 내려가면 clamp된다
  const hugeCanvas = { width: 100_000, height: 100_000 };
  check('fit 결과도 MIN_ZOOM으로 clamp', computeFitHeightScale(viewport, hugeCanvas) === MIN_ZOOM);
}

// [6] hasMissingRenderedPreview(구 PreviewSourceImage[] 기준)는 5단계에서
// lib/n5/viewport.ts와 함께 제거했다 — 같은 판단은 이제 n5-view.tsx가
// PreviewViewModel.sections의 render.status로 직접 계산한다.

console.log('\n[7] computeCenteredPan — Fit Width/Height 적용 후 캔버스를 viewport 정중앙에 둔다');
{
  const usable = { width: 800, height: 600 };

  // Fit Height 직후: 세로는 정확히 맞춰졌고(스케일된 높이 === usable 높이),
  // 가로가 usable보다 좁은 경우(600×18868 같은 세로로 긴 원본이 아니라,
  // 여기서는 단순 산술 검증을 위해 canvas 500×2000, zoom 0.3을 쓴다 — 스케일된
  // 크기 150×600).
  const canvas = { width: 500, height: 2000 };
  const zoom = 0.3; // scaled = 150 x 600 (세로가 usable.height와 정확히 일치)
  const pan = computeCenteredPan(canvas, zoom, usable);
  check('세로(맞춘 축) pan.y = 0 (usable.height - scaledHeight = 0)', pan.y === 0, `got ${pan.y}`);
  check(
    '가로(남는 축)는 가운데 정렬 — pan.x = (usable.width - scaledWidth) / 2',
    pan.x === (usable.width - canvas.width * zoom) / 2,
    `got ${pan.x}`,
  );

  // 초장축 stress 케이스(500x18868, scale 0.5는 /preview 계약값이고 여기서는
  // "Fit Height를 눌렀을 때"를 흉내내 임의의 fitZoom을 대입한다) — 세로가
  // usable보다 훨씬 큰 원본 캔버스를 Fit Height로 맞추면 두 축 다 유한한 pan이
  // 나와야 한다(NaN/Infinity 없음).
  const tallCanvas = { width: 500, height: 18868 };
  const fitHeightZoom = usable.height / tallCanvas.height; // 정확히 세로를 채우는 배율
  const tallPan = computeCenteredPan(tallCanvas, fitHeightZoom, usable);
  check('초장축 Fit Height 후 pan.y가 유한하다(NaN/Infinity 아님)', Number.isFinite(tallPan.y));
  check('초장축 Fit Height 후 pan.y ≈ 0(세로를 정확히 채움)', Math.abs(tallPan.y) < 1e-9, `got ${tallPan.y}`);
}

console.log('\n[8] clampPan — pan 경계(빈 공간이 viewport 중앙보다 넓게 보이지 않음)');
{
  const usable = { width: 800, height: 600 };

  // 8-1) 캔버스가 usable보다 작은 축은 pan을 허용하지 않고 항상 가운데 고정.
  const smallCanvas = { width: 400, height: 300 };
  const smallZoom = 1; // scaled 400x300, 둘 다 usable보다 작다
  const centeredSmall = { x: (800 - 400) / 2, y: (600 - 300) / 2 };
  check(
    '작은 이미지는 pan을 아무리 줘도 가운데로 고정된다(x)',
    clampPan({ x: 9999, y: 9999 }, smallCanvas, smallZoom, usable).x === centeredSmall.x,
  );
  check(
    '작은 이미지는 pan을 아무리 줘도 가운데로 고정된다(y)',
    clampPan({ x: 9999, y: 9999 }, smallCanvas, smallZoom, usable).y === centeredSmall.y,
  );
  check(
    '음수로 줘도 마찬가지로 가운데 고정',
    clampPan({ x: -9999, y: -9999 }, smallCanvas, smallZoom, usable).x === centeredSmall.x,
  );

  // 8-2) 캔버스가 usable보다 큰 축은 [usable/2 - scaled, usable/2] 범위로 clamp.
  //      scaled = 500*2 = 1000 (usable.width=800보다 큼)
  const bigCanvas = { width: 500, height: 2000 };
  const bigZoom = 2; // scaled 1000 x 4000
  const scaledW = bigCanvas.width * bigZoom;
  const scaledH = bigCanvas.height * bigZoom;

  // pan을 아주 크게(이미지를 오른쪽/아래로 한참 밀어도) upper bound(usable/2)를 못 넘는다
  const pushedFarPositive = clampPan({ x: 999_999, y: 999_999 }, bigCanvas, bigZoom, usable);
  check('이미지 좌측 끝이 viewport 가로 중앙보다 오른쪽으로 못 감', pushedFarPositive.x === usable.width / 2);
  check('이미지 최상단이 viewport 세로 중앙보다 아래로 못 감', pushedFarPositive.y === usable.height / 2);

  // pan을 아주 작게(이미지를 왼쪽/위로 한참 밀어도) lower bound(usable/2 - scaled)를 못 벗어난다
  const pushedFarNegative = clampPan({ x: -999_999, y: -999_999 }, bigCanvas, bigZoom, usable);
  check(
    '이미지 우측 끝이 viewport 가로 중앙보다 왼쪽으로 못 감',
    pushedFarNegative.x === usable.width / 2 - scaledW,
  );
  check(
    '이미지 최하단이 viewport 세로 중앙보다 위로 못 감',
    pushedFarNegative.y === usable.height / 2 - scaledH,
  );

  // 범위 안의 pan은 그대로 통과한다(clamp가 불필요하게 값을 바꾸지 않음)
  const insideRange = { x: usable.width / 2 - scaledW / 2, y: usable.height / 2 - scaledH / 2 };
  const untouched = clampPan(insideRange, bigCanvas, bigZoom, usable);
  check('경계 안 pan은 그대로 유지된다(x)', untouched.x === insideRange.x, `got ${untouched.x}`);
  check('경계 안 pan은 그대로 유지된다(y)', untouched.y === insideRange.y, `got ${untouched.y}`);
}

console.log('\n[9] parseZoomPercentInput — 배율 직접 입력 파싱/보정');
{
  check('"100" -> 1', parseZoomPercentInput('100') === 1);
  check('"4" -> 0.04(4%)', Math.abs(parseZoomPercentInput('4') - 0.04) < 1e-9);
  check('"4%" -> 0.04(% 접미사 허용)', Math.abs(parseZoomPercentInput('4%') - 0.04) < 1e-9);
  check('"125" -> 1.25', Math.abs(parseZoomPercentInput('125') - 1.25) < 1e-9);
  check('공백 포함 "  50  " -> 0.5', Math.abs(parseZoomPercentInput('  50  ') - 0.5) < 1e-9);

  // 0/음수/NaN/빈 문자열 — "입력 자체가 무효"이므로 null을 반환한다. 호출부가
  // 이걸 현재 zoom 유지 신호로 쓴다 — MIN_ZOOM으로 강제 이동시키지 않는다.
  check('"0" -> null(현재 zoom 유지)', parseZoomPercentInput('0') === null);
  check('"-10" -> null(현재 zoom 유지)', parseZoomPercentInput('-10') === null);
  check('잘못된 문자열 "abc" -> null(현재 zoom 유지)', parseZoomPercentInput('abc') === null);
  check('빈 문자열 "" -> null(현재 zoom 유지)', parseZoomPercentInput('') === null);

  // 양수지만 MIN_ZOOM 미만 — "입력은 유효, 범위만 벗어남"이므로 위 null과는
  // 다르게 MIN_ZOOM으로 clamp한다(강제 이동이 아니라 정상적인 범위 clamp).
  check('"0.5"(0.5%, 양수지만 최소 미만) -> MIN_ZOOM으로 clamp', parseZoomPercentInput('0.5') === MIN_ZOOM);

  check('최대값 초과 "10000" -> MAX_ZOOM으로 clamp', parseZoomPercentInput('10000') === MAX_ZOOM);
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
