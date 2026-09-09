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

console.log('\n[1] zoom clamp — 25% ~ 400%');
{
  check('MIN_ZOOM === 0.25', MIN_ZOOM === 0.25, `got ${MIN_ZOOM}`);
  check('MAX_ZOOM === 4', MAX_ZOOM === 4, `got ${MAX_ZOOM}`);
  check('범위 안 값은 그대로', clampZoom(1) === 1);
  check('최소값 미만은 clamp', clampZoom(0.01) === MIN_ZOOM, `got ${clampZoom(0.01)}`);
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

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
