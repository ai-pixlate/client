/**
 * N4 표시용 진행 상태(displayedProgress · presentation stage) 순수 계산 자동 검증.
 *
 * lib/processing/displayed-progress.ts 는 React 도 브라우저 API 도 쓰지 않기 때문에
 * Node 에서 그대로 불러와 확인할 수 있다. (scripts/verify-n5-viewport.mjs와 같은 패턴)
 * 아래 구간 값은 n4-processing-view.tsx 의 band 표와 같은 값이다.
 *
 * 실행:  npm run verify:displayed-progress
 */

import {
  computeDisplayedProgress,
  easeOutProgressRatio,
  pickFurtherStage,
  toServerPercent,
} from '../lib/processing/displayed-progress.ts';

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

const SECOND = 1000;
const N4_BANDS = [
  ['inpaint', { floor: 0, ceiling: 19 }],
  ['translate', { floor: 20, ceiling: 39 }],
  ['verify', { floor: 40, ceiling: 59 }],
  ['render_04', { floor: 60, ceiling: 79 }],
  ['render_05', { floor: 80, ceiling: 99 }],
];
const N4_DONE = { floor: 100, ceiling: 100 };
const N4_FILL_MS = 90 * SECOND;

console.log('\n[1] ease-out / 서버 progress 변환');
{
  check('경과 0 → 0', easeOutProgressRatio(0) === 0);
  check('경과 1 → 1', easeOutProgressRatio(1) === 1);
  check('경과가 1을 넘어도 1', easeOutProgressRatio(3) === 1);
  check('ease-out: 앞쪽 절반이 더 많이 움직인다', easeOutProgressRatio(0.5) > 0.5);
  check('server 0.43 → 43', toServerPercent(0.43) === 43);
  check('server null → 0', toServerPercent(null) === 0);
  check('server 1.2 → 100(범위 밖 값은 자른다)', toServerPercent(1.2) === 100);
}

console.log('\n[2] N4 — 5단계 구간');
{
  for (const [name, band] of N4_BANDS) {
    const atEntry = computeDisplayedProgress({
      band,
      serverPercent: 0,
      elapsedMs: 0,
      activeDurationMs: N4_FILL_MS,
      isFrozen: false,
      previousShown: 0,
    });
    const muchLater = computeDisplayedProgress({
      band,
      serverPercent: 0,
      elapsedMs: 3600 * SECOND,
      activeDurationMs: N4_FILL_MS,
      isFrozen: false,
      previousShown: 0,
    });
    const serverHigh = computeDisplayedProgress({
      band,
      serverPercent: 100,
      elapsedMs: 0,
      activeDurationMs: N4_FILL_MS,
      isFrozen: false,
      previousShown: 0,
    });
    check(`${name}: 진입 시 floor ${band.floor}`, atEntry === band.floor, `got ${atEntry}`);
    check(`${name}: 오래 지나도 ceiling ${band.ceiling}`, muchLater === band.ceiling, `got ${muchLater}`);
    check(`${name}: 서버 값이 커도 ceiling을 넘지 않는다`, serverHigh === band.ceiling, `got ${serverHigh}`);
  }

  const done = computeDisplayedProgress({
    band: N4_DONE,
    serverPercent: 100,
    elapsedMs: 0,
    activeDurationMs: null,
    isFrozen: false,
    previousShown: 87,
  });
  check('완료 시 100', done === 100);
}

console.log('\n[3] N4 — 단계 전환과 서버 progress 역행에도 감소 없음');
{
  // 실제 화면에서 본 문제를 흉내 낸다: stage가 바뀔 때 서버 global progress가 작아진다.
  const timeline = [
    ['inpaint', 10, 0],
    ['inpaint', 43, 20],
    ['translate', 12, 0],
    ['translate', 30, 30],
    ['verify', 5, 0],
    ['verify', 80, 40],
    ['render_04', 20, 0],
    ['render_04', 10, 60],
    ['render_05', 90, 0],
    ['render_05', 30, 200],
  ];
  const bandOf = new Map(N4_BANDS);
  let last = 0;
  let decreased = false;
  let outOfBand = false;
  const shown = [];
  for (const [stage, serverPercent, elapsedSec] of timeline) {
    const band = bandOf.get(stage);
    const value = computeDisplayedProgress({
      band,
      serverPercent,
      elapsedMs: elapsedSec * SECOND,
      activeDurationMs: N4_FILL_MS,
      isFrozen: false,
      previousShown: last,
    });
    if (value < last) decreased = true;
    if (value < band.floor || value > band.ceiling) outOfBand = true;
    shown.push(value);
    last = value;
  }
  check('01→02→03→04→05 동안 감소 없음', !decreased, shown.join(' → '));
  check('각 단계 숫자가 자기 구간 안에 있다', !outOfBand, shown.join(' → '));

  const frozen = computeDisplayedProgress({
    band: bandOf.get('verify'),
    serverPercent: 0,
    elapsedMs: 3600 * SECOND,
    activeDurationMs: N4_FILL_MS,
    isFrozen: true,
    previousShown: 45,
  });
  check('N4 실패 시 시간 기반 증가 멈춤', frozen === 45, `got ${frozen}`);
}

console.log('\n[4] N4 — 화면 단계(presentation stage)도 뒤로 가지 않는다');
{
  const ORDER = ['inpaint', 'translate', 'verify', 'render_04', 'render_05', 'done'];
  check('앞으로는 그대로 이동', pickFurtherStage(ORDER, 'render_04', 'render_05') === 'render_05');
  // 서버 progress 가 0.875 아래로 내려가 render 04/05 분리가 04 를 돌려줘도 05 를 유지한다
  check('05까지 갔다가 낮은 progress로 04가 와도 05 유지', pickFurtherStage(ORDER, 'render_05', 'render_04') === 'render_05');
  check('verify 이후 inpaint 가 와도 verify 유지', pickFurtherStage(ORDER, 'verify', 'inpaint') === 'verify');
  check('같은 단계는 그대로', pickFurtherStage(ORDER, 'translate', 'translate') === 'translate');
  check('done 이후 render_05 가 와도 done 유지', pickFurtherStage(ORDER, 'done', 'render_05') === 'done');

  // 05 에서 85 까지 보여 준 뒤 서버가 낮은 progress(0.8 → render_04)를 보내는 순간
  const stage = pickFurtherStage(ORDER, 'render_05', 'render_04');
  const band = new Map(N4_BANDS).get(stage);
  const value = computeDisplayedProgress({
    band,
    serverPercent: 80,
    elapsedMs: 0,
    activeDurationMs: N4_FILL_MS,
    isFrozen: false,
    previousShown: 85,
  });
  check('그때 숫자도 05 구간(80~99) 안에서 85 유지', value === 85, `got ${value}`);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
