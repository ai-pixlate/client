/**
 * 처리 화면(N2·N4) 표시용 진행 %(displayedProgress) 순수 계산 자동 검증.
 *
 * lib/processing/displayed-progress.ts 는 React 도 브라우저 API 도 쓰지 않기 때문에
 * Node 에서 그대로 불러와 확인할 수 있다. (scripts/verify-n5-viewport.mjs와 같은 패턴)
 * 아래 상한 값은 n2-analysis-view.tsx · n4-processing-view.tsx 의 상한 표와 같은 값이다.
 *
 * 실행:  npm run verify:displayed-progress
 */

import {
  APPROACH_RATIO_PER_TICK,
  COMPLETION_ANIMATE_MS,
  COMPLETION_PRESENTATION_MS,
  DISPLAY_TICK_MS,
  MAX_STEP_PER_TICK,
  PROCESSING_MAX_PERCENT,
  clampProcessingCeiling,
  completionProgressAt,
  stepDisplayedProgress,
  toShownPercent,
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
const ticksOf = (ms) => Math.round(ms / DISPLAY_TICK_MS);

/**
 * [상한, 그 상한이 열려 있는 시간(ms)] 목록대로 tick 을 돌린다. 상한은 그 구간의 값 그대로다(hook 과 같다 —
 * 상한이 내려가도 숫자는 내려가지 않는다). 매 tick 의 화면 정수를 돌려준다.
 */
function simulate(phases, { start = 0, isFrozen = false } = {}) {
  let value = start;
  const shown = [toShownPercent(value, false)];
  for (const [ceiling, ms] of phases) {
    for (let i = 0; i < ticksOf(ms); i += 1) {
      value = stepDisplayedProgress(value, ceiling, isFrozen);
      shown.push(toShownPercent(value, false));
    }
  }
  return { value, shown };
}

const maxJump = (shown) => shown.reduce((max, v, i) => (i === 0 ? 0 : Math.max(max, v - shown[i - 1])), 0);
const neverDecreases = (shown) => shown.every((v, i) => i === 0 || v >= shown[i - 1]);

// 화면 상한 표와 같은 값
const N2 = { analyze: 69, finalize: 79, judge: 99 };
const N4 = { inpaint: 19, translate: 39, verify: 59, render: 99 };

console.log('\n[1] tick 한 번');
{
  check('상한 쪽으로 오른다', stepDisplayedProgress(10, 69, false) > 10);
  check('tick 당 최대 상승 폭을 넘지 않는다', stepDisplayedProgress(0, 99, false) <= MAX_STEP_PER_TICK);
  check('상한 근처에서는 남은 거리의 일부만큼만 오른다', stepDisplayedProgress(68, 69, false) - 68 <= APPROACH_RATIO_PER_TICK + 1e-9);
  check('상한을 넘지 않는다', stepDisplayedProgress(68.99, 69, false) <= 69);
  check('이미 상한보다 크면 그대로(내려가지 않는다)', stepDisplayedProgress(50, 19, false) === 50);
  check('실패(isFrozen)면 오르지 않는다', stepDisplayedProgress(42, 99, true) === 42);
  check('상한 100 이상도 처리 중 99 로 자른다', clampProcessingCeiling(100) === PROCESSING_MAX_PERCENT && clampProcessingCeiling(250) === 99);
  check('처리 중 화면 정수는 99 를 넘지 않는다', toShownPercent(99.99, false) === 99 && toShownPercent(120, false) === 99);
}

console.log('\n[2] 단계가 바뀌면 상한만 연다 — 하한으로 점프하지 않는다');
{
  // N2: analyze 중 30 근처에서 judge 로 바로 넘어간다
  const before = simulate([[N2.analyze, 6 * SECOND]]);
  const after = simulate([[N2.judge, DISPLAY_TICK_MS]], { start: before.value });
  check('N2 judge 진입 직후 한 tick 상승 ≤ 1', after.shown.at(-1) - before.shown.at(-1) <= 1, `${before.shown.at(-1)} → ${after.shown.at(-1)}`);
  // N4: inpaint → (translate·verify 를 보지 못하고) render
  const skip = simulate([
    [N4.inpaint, 2 * SECOND],
    [N4.render, 4 * SECOND],
  ]);
  check('N4 inpaint → render 건너뜀에서도 tick 당 점프 ≤ 1', maxJump(skip.shown) <= 1, `max ${maxJump(skip.shown)}`);
  const atRenderEntry = skip.shown[ticksOf(2 * SECOND) + 1];
  check('N4 render 에 들어가도 60 으로 뛰지 않는다', atRenderEntry < 60, String(atRenderEntry));
}

console.log('\n[3] 처리 중 타임라인 — 감소·점프·100 없음');
{
  const n2 = simulate([
    [N2.analyze, 8 * SECOND],
    [N2.finalize, 2 * SECOND],
    [N2.judge, 6 * SECOND],
  ]);
  check('N2 감소 없음', neverDecreases(n2.shown));
  check('N2 tick 당 점프 ≤ 1', maxJump(n2.shown) <= 1, `max ${maxJump(n2.shown)}`);
  check('N2 처리 중 100 없음', n2.shown.every((v) => v < 100));
  check('N2 짧은 처리(16초)에서도 눈에 띄게 움직인다(30 이상)', n2.shown.at(-1) >= 30, String(n2.shown.at(-1)));

  const n4 = simulate([
    [N4.inpaint, 4 * SECOND],
    [N4.translate, 4 * SECOND],
    [N4.verify, 4 * SECOND],
    [N4.render, 6 * SECOND],
  ]);
  check('N4 감소 없음', neverDecreases(n4.shown));
  check('N4 tick 당 점프 ≤ 1', maxJump(n4.shown) <= 1, `max ${maxJump(n4.shown)}`);
  check('N4 처리 중 100 없음', n4.shown.every((v) => v < 100));

  // 서버가 한 단계에 오래 머물면 상한 근처에서 느려지며 멈춘다
  const long = simulate([[N2.analyze, 10 * 60 * SECOND]]);
  check('같은 단계에 10분 머물러도 상한(69)을 넘지 않는다', long.shown.every((v) => v <= N2.analyze));
  check('같은 단계에 오래 머물면 상한 근처까지 간다', long.shown.at(-1) >= N2.analyze - 1, String(long.shown.at(-1)));
  const late = long.shown.slice(-ticksOf(10 * SECOND));
  check('상한 근처에서는 10초 동안 거의 움직이지 않는다(≤ 1)', late.at(-1) - late[0] <= 1);
  const render = simulate([[N4.render, 10 * 60 * SECOND]]);
  check('N4 render 에 10분 머물러도 99 를 넘지 않는다', render.shown.every((v) => v <= 99));
}

console.log('\n[3-1] N4 병렬 섹션 — 상한이 내려가면 숫자는 머문다');
{
  // inpaint·translate·verify running(상한 59) → translate running · render done(상한 39) → render running(99)
  const parallel = simulate([
    [N4.verify, 8 * SECOND],
    [N4.translate, 6 * SECOND],
  ]);
  const atDrop = parallel.shown[ticksOf(8 * SECOND)];
  const duringTranslate = parallel.shown.slice(ticksOf(8 * SECOND));
  check('상한이 내려가도 숫자는 줄지 않는다', neverDecreases(parallel.shown));
  check('render=done 은 상한을 열지 않는다 — translate 동안 39 또는 그때 값 이상으로 오르지 않는다', duringTranslate.every((v) => v <= Math.max(39, atDrop)), `${atDrop} → ${duringTranslate.at(-1)}`);
  const resumed = simulate([[N4.render, 2 * SECOND]], { start: parallel.value });
  check('render running 에서 다시 오른다', resumed.shown.at(-1) > parallel.shown.at(-1));
  check('render 진입 순간 60 으로 뛰지 않는다', resumed.shown[1] - parallel.shown.at(-1) <= 1);
}

console.log('\n[4] 실패면 멈춘다');
{
  const frozen = simulate([[N4.render, 5 * 60 * SECOND]], { start: 42, isFrozen: true });
  check('실패 동안 5분이 지나도 그대로', frozen.shown.every((v) => v === 42));
}

console.log('\n[5] 실제 완료 응답 뒤 완료 표시');
{
  check('완료 표시 시작은 현재 값', completionProgressAt(31, 0) === 31);
  check('COMPLETION_ANIMATE_MS 에 100', completionProgressAt(31, COMPLETION_ANIMATE_MS) === 100);
  check('그 뒤에도 100', completionProgressAt(31, COMPLETION_ANIMATE_MS * 3) === 100);
  const frames = Array.from({ length: 13 }, (_, i) => toShownPercent(completionProgressAt(31, (i * COMPLETION_ANIMATE_MS) / 12), true));
  check('완료 표시 동안 감소 없음', neverDecreases(frames), frames.join(','));
  check('완료 표시는 100 에서 끝난다', frames.at(-1) === 100);
  check('완료 표시 총 시간 600~900ms', COMPLETION_PRESENTATION_MS >= 600 && COMPLETION_PRESENTATION_MS <= 900, String(COMPLETION_PRESENTATION_MS));
  check('100% 를 확인할 유지 시간이 있다(≥ 200ms)', COMPLETION_PRESENTATION_MS - COMPLETION_ANIMATE_MS >= 200);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
