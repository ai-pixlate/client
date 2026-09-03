/**
 * 좌표 변환 자동 검증.
 *
 * 왜 필요한가:
 *   "확대·축소해도 좌표가 어긋나지 않는다"(F-CRP-01a 수용기준 ③)를
 *   눈으로만 확인하면 놓칩니다. 브라우저 없이 계산만 돌려서 확인합니다.
 *
 * lib/spike/coordinates.ts 는 React 도 브라우저 API 도 쓰지 않기 때문에
 * Node 에서 그대로 불러올 수 있습니다. (그렇게 만든 이유가 이것입니다)
 *
 * 실행:  npm run verify:coords
 */

// Node 22 의 내장 타입 스트리핑으로 .ts 를 그대로 불러옵니다.
// 별도 패키지(ts-node, tsx) 설치가 필요 없습니다.
// package.json 의 verify:coords 스크립트가 --experimental-strip-types 를 붙여 실행합니다.
import {
  buildCropFromDrag,
  getDisplayScale,
  isValidScale,
  measureRoundTripDrift,
  sourceRectToDisplay,
} from '../lib/spike/coordinates.ts';

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

const IMAGE = { originalWidth: 1000, originalHeight: 10000 };
const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const PREVIEWS = [1, 0.5, 0.333333, 0.25];

console.log('\n[1] displayScale = previewScale x zoomScale');
for (const p of PREVIEWS) {
  for (const z of ZOOMS) {
    check(
      `previewScale=${p} zoom=${z}`,
      Math.abs(getDisplayScale(p, z) - p * z) < 1e-12,
    );
  }
}

console.log('\n[2] 저장된 source 좌표는 zoom 을 바꿔도 변하지 않는다 (drift = 0)');
const FIXED = { sourceX: 120, sourceY: 240, sourceWidth: 400, sourceHeight: 600 };
for (const p of PREVIEWS) {
  for (const z of ZOOMS) {
    const scale = getDisplayScale(p, z);
    const drift = measureRoundTripDrift(FIXED, scale);
    check(`previewScale=${p} zoom=${z} drift=${drift}`, drift < 1e-9, `drift=${drift}`);
  }
}

console.log('\n[3] zoom 을 100번 왔다갔다 해도 저장값이 그대로다 (누적 오차 없음)');
{
  let rect = { ...FIXED };
  for (let i = 0; i < 100; i += 1) {
    const z = ZOOMS[i % ZOOMS.length];
    // 실제 화면과 같은 동작: source -> display 만 하고 되돌려 쓰지 않는다
    sourceRectToDisplay(rect, getDisplayScale(0.5, z));
  }
  check(
    '100회 줌 변경 후 값 동일',
    JSON.stringify(rect) === JSON.stringify(FIXED),
    JSON.stringify(rect),
  );
  rect = null;
}

console.log('\n[4] 같은 화면 위치를 드래그하면 zoom 과 무관하게 같은 source 좌표가 나온다');
{
  // 원본 기준 (100,500)~(500,1100) 을 가리키는 화면 좌표를 zoom 별로 만들어 본다
  const target = { x1: 100, y1: 500, x2: 500, y2: 1100 };
  const results = [];
  for (const z of ZOOMS) {
    const scale = getDisplayScale(0.5, z);
    const r = buildCropFromDrag(
      { displayX: target.x1 * scale, displayY: target.y1 * scale },
      { displayX: target.x2 * scale, displayY: target.y2 * scale },
      scale,
      IMAGE,
      4,
    );
    results.push(r.ok ? JSON.stringify(r.rect) : `ERR:${r.reason}`);
  }
  const first = results[0];
  check(
    '전 zoom 에서 동일한 source 사각형',
    results.every((r) => r === first),
    results.join(' | '),
  );
  console.log(`        => ${first}`);
}

console.log('\n[5] 역방향 드래그(오른쪽아래 -> 왼쪽위)도 같은 결과');
{
  const scale = getDisplayScale(1, 1);
  const fwd = buildCropFromDrag(
    { displayX: 100, displayY: 200 },
    { displayX: 400, displayY: 800 },
    scale, IMAGE, 4,
  );
  const rev = buildCropFromDrag(
    { displayX: 400, displayY: 800 },
    { displayX: 100, displayY: 200 },
    scale, IMAGE, 4,
  );
  check(
    '정방향 == 역방향',
    fwd.ok && rev.ok && JSON.stringify(fwd.rect) === JSON.stringify(rev.rect),
  );
}

console.log('\n[6] 에러 케이스');
{
  const s = getDisplayScale(1, 1);
  check('previewScale = 0 → 무효', !isValidScale(0));
  check('previewScale 음수 → 무효', !isValidScale(-1));
  check('previewScale NaN → 무효', !isValidScale(NaN));
  check('previewScale undefined → 무효', !isValidScale(undefined));
  check('previewScale Infinity → 무효', !isValidScale(Infinity));

  check(
    'displayScale=0 으로 crop → INVALID_SCALE',
    buildCropFromDrag({ displayX: 0, displayY: 0 }, { displayX: 10, displayY: 10 }, 0, IMAGE, 4)
      .reason === 'INVALID_SCALE',
  );
  check(
    '같은 점 클릭 → ZERO_SIZE',
    buildCropFromDrag({ displayX: 50, displayY: 50 }, { displayX: 50, displayY: 50 }, s, IMAGE, 4)
      .reason === 'ZERO_SIZE',
  );
  check(
    '2px 짜리 → TOO_SMALL',
    buildCropFromDrag({ displayX: 50, displayY: 50 }, { displayX: 52, displayY: 52 }, s, IMAGE, 4)
      .reason === 'TOO_SMALL',
  );
  check(
    '이미지 완전 바깥 → OUT_OF_BOUNDS',
    buildCropFromDrag(
      { displayX: 2000, displayY: 50 }, { displayX: 2500, displayY: 500 }, s, IMAGE, 4,
    ).reason === 'OUT_OF_BOUNDS',
  );
  check(
    '음수 좌표에서 시작 → 0 으로 clamp',
    (() => {
      const r = buildCropFromDrag(
        { displayX: -300, displayY: -300 }, { displayX: 400, displayY: 400 }, s, IMAGE, 4,
      );
      return r.ok && r.rect.sourceX === 0 && r.rect.sourceY === 0 && r.clamped === true;
    })(),
  );
  check(
    '오른쪽·아래 경계 초과 → 이미지 크기로 clamp',
    (() => {
      const r = buildCropFromDrag(
        { displayX: 800, displayY: 9800 }, { displayX: 5000, displayY: 99999 }, s, IMAGE, 4,
      );
      return (
        r.ok &&
        r.rect.sourceX + r.rect.sourceWidth === IMAGE.originalWidth &&
        r.rect.sourceY + r.rect.sourceHeight === IMAGE.originalHeight
      );
    })(),
  );
}

console.log('\n[7] 반올림 정책 — left+width 가 right 와 정확히 일치한다');
{
  // 소수점이 나오도록 일부러 애매한 배율을 쓴다
  const scale = getDisplayScale(0.333333, 1.5);
  let ok = true;
  for (let i = 0; i < 500; i += 1) {
    const x1 = Math.random() * 400;
    const y1 = Math.random() * 4000;
    const x2 = x1 + 20 + Math.random() * 300;
    const y2 = y1 + 20 + Math.random() * 2000;
    const r = buildCropFromDrag(
      { displayX: x1, displayY: y1 }, { displayX: x2, displayY: y2 }, scale, IMAGE, 4,
    );
    if (!r.ok) continue;
    if (!Number.isInteger(r.rect.sourceX) || !Number.isInteger(r.rect.sourceWidth)) ok = false;
    if (r.rect.sourceX + r.rect.sourceWidth > IMAGE.originalWidth) ok = false;
    if (r.rect.sourceY + r.rect.sourceHeight > IMAGE.originalHeight) ok = false;
  }
  check('무작위 500건 모두 정수이며 경계를 넘지 않음', ok);
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
