/**
 * N5 검수 좌표 계산 자동 검증 (Pix/ate FE↔BE 구현 기준 v3.3.3).
 *
 * lib/n5/coordinates.ts 는 React 도 브라우저 API 도 쓰지 않기 때문에
 * Node 에서 그대로 불러와 확인할 수 있다. (scripts/verify-coordinates.mjs와 같은 패턴)
 *
 * 실행:  npm run verify:n5-coords
 */

import {
  computeSectionDisplayTops,
  getBlockDisplayRect,
  getPreviewScale,
} from '../lib/n5/coordinates.ts';

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

console.log('\n[1] displayTop + section-local bbox -> N5 표시 Y');
{
  // section.displayTop=2500, block.bbox.y=120 -> N5 표시 Y(원본 픽셀) = 2620
  const bbox = { x: 100, y: 120, width: 800, height: 100 };
  const displayTop = 2500;
  const scale = { scaleX: 1, scaleY: 1 }; // 배율 없이 원본 픽셀 좌표만 우선 확인
  const rect = getBlockDisplayRect(bbox, displayTop, scale);
  check('displayY = displayTop + bbox.y', rect.top === 2620, `got ${rect.top}`);
  check('displayX = bbox.x (scaleX=1)', rect.left === 100, `got ${rect.left}`);

  // top_offset(원본 절대값)과는 다른 값이어야 한다 — 같은 bbox라도 displayTop만 써야 한다
  const topOffset = 9999; // 만약 실수로 topOffset을 썼다면 이 값이 섞여 나온다
  check(
    'topOffset을 계산에 섞지 않는다',
    rect.top !== topOffset + bbox.y,
    `rect.top=${rect.top}`,
  );
}

console.log('\n[2] scaleX / scaleY — 두 축을 독립적으로 적용한다');
{
  // 일부러 가로/세로 비율이 다른 preview를 만든다 (실제로는 드물지만, 축을
  // 하나로 합치면 이런 경우 좌표가 깨지므로 독립 계산을 검증한다)
  const preview = {
    originalWidth: 1000,
    originalHeight: 8500,
    previewWidth: 400,
    previewHeight: 2000, // scaleY(0.235...) != scaleX(0.4)
  };
  const scale = getPreviewScale(preview);
  check('scaleX = previewWidth / originalWidth', scale.scaleX === 0.4, `got ${scale.scaleX}`);
  check(
    'scaleY = previewHeight / originalHeight',
    Math.abs(scale.scaleY - 2000 / 8500) < 1e-12,
    `got ${scale.scaleY}`,
  );
  check('scaleX와 scaleY가 다르게 유지된다', scale.scaleX !== scale.scaleY);

  const bbox = { x: 100, y: 200, width: 800, height: 120 };
  const rect = getBlockDisplayRect(bbox, 0, scale);
  check('displayWidth = bbox.width * scaleX', rect.width === 800 * scale.scaleX, `got ${rect.width}`);
  check(
    'displayHeight = bbox.height * scaleY',
    Math.abs(rect.height - 120 * scale.scaleY) < 1e-9,
    `got ${rect.height}`,
  );

  check(
    'originalWidth/Height가 0이면 에러',
    (() => {
      try {
        getPreviewScale({ ...preview, originalWidth: 0 });
        return false;
      } catch {
        return true;
      }
    })(),
  );
}

console.log('\n[3] exclude section은 displayTop 누적에서 제외된다');
{
  // include A(2500) -> exclude B -> include C 순서.
  // C.displayTop 은 B의 height와 무관하게 A.height 와 같아야 한다.
  const sections = [
    { bucket: 'include', height: 2500 }, // A
    { bucket: 'exclude', height: 1600 }, // B — N3/N5 무관하게 누적 안 함
    { bucket: 'include', height: 3200 }, // C
  ];
  const displayTops = computeSectionDisplayTops(sections);

  check('A.displayTop = 0', displayTops[0] === 0, `got ${displayTops[0]}`);
  check('B.displayTop = A.height (누적되지 않고 그 자리)', displayTops[1] === 2500, `got ${displayTops[1]}`);
  check(
    'C.displayTop = A.height (B의 height는 무시)',
    displayTops[2] === 2500,
    `got ${displayTops[2]}`,
  );

  // 연속으로 exclude가 와도 누적되지 않는다
  const sectionsConsecutiveExclude = [
    { bucket: 'include', height: 1000 },
    { bucket: 'exclude', height: 500 },
    { bucket: 'exclude', height: 700 },
    { bucket: 'include', height: 1000 },
  ];
  const tops2 = computeSectionDisplayTops(sectionsConsecutiveExclude);
  check('연속 exclude 2개도 모두 직전 누적값 그대로', tops2[1] === 1000 && tops2[2] === 1000);
  check('연속 exclude 뒤 include도 직전 누적값에서 이어짐', tops2[3] === 1000, `got ${tops2[3]}`);

  // 전부 exclude면 모든 displayTop이 0
  const allExcluded = [
    { bucket: 'exclude', height: 900 },
    { bucket: 'exclude', height: 400 },
  ];
  const tops3 = computeSectionDisplayTops(allExcluded);
  check('전부 exclude면 모든 displayTop = 0', tops3.every((t) => t === 0), tops3.join(','));
}

console.log('\n[4] 여러 sourceImage에 걸친 job 전체 stack — sourceImage가 바뀌어도 리셋하지 않는다');
{
  // 실제 N5 mock(lib/mock-api/fixtures.ts)과 동일한 구성: SRC_A 4개 section +
  // SRC_B 2개 section을 "한 배열"로 모아 한 번만 호출해야 한다. sourceImage별로
  // 나눠 여러 번 호출하면 그때마다 cursor가 0으로 리셋된 것처럼 보인다 — 그 회귀를
  // 여기서 잡는다.
  const jobSections = [
    { id: 'sec_01', sourceImageId: 'SRC_A', bucket: 'include', height: 2500 },
    { id: 'sec_02', sourceImageId: 'SRC_A', bucket: 'include', height: 3200 },
    { id: 'sec_07', sourceImageId: 'SRC_A', bucket: 'exclude', height: 1600 }, // N5 exclude
    { id: 'sec_03', sourceImageId: 'SRC_A', bucket: 'exclude', height: 1200 }, // N3 exclude
    { id: 'sec_04', sourceImageId: 'SRC_B', bucket: 'include', height: 4200 }, // 다른 sourceImage
    { id: 'sec_05', sourceImageId: 'SRC_B', bucket: 'include', height: 2800 },
  ];
  const tops = computeSectionDisplayTops(jobSections);
  const expected = [0, 2500, 5700, 5700, 5700, 9900];

  jobSections.forEach((s, i) => {
    check(`${s.id}.displayTop = ${expected[i]}`, tops[i] === expected[i], `got ${tops[i]}`);
  });

  const includeOnlyTotal = jobSections
    .filter((s) => s.bucket === 'include')
    .reduce((sum, s) => sum + s.height, 0);
  check('job 전체 include stack height = 12700', includeOnlyTotal === 12700, `got ${includeOnlyTotal}`);
  check(
    'SRC_B 첫 include(sec_04)가 0으로 리셋되지 않는다',
    tops[4] === 5700 && tops[4] !== 0,
    `got ${tops[4]}`,
  );

  // sourceImage별로 따로 호출하면(잘못된 예전 방식) sec_04가 0으로 리셋되는지도
  // 대조군으로 남겨 회귀를 명확히 구분한다.
  const srcBSections = jobSections.filter((s) => s.sourceImageId === 'SRC_B');
  const wrongTopsB = computeSectionDisplayTops(srcBSections);
  check(
    '(대조군) sourceImage별로 나눠 호출하면 리셋되어 버그와 동일하게 재현된다',
    wrongTopsB[0] === 0,
    `got ${wrongTopsB[0]}`,
  );
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
