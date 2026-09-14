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

console.log('\n[1] displayTop + section-local bbox -> N5 표시 Y (v3.4.1, 단일 scale)');
{
  // section.displayTop=2500, block.bbox.y=120 -> N5 표시 Y(원본 픽셀) = 2620
  const bbox = { x: 100, y: 120, width: 800, height: 100 };
  const displayTop = 2500;
  const scale = 1; // 배율 없이 원본 픽셀 좌표만 우선 확인
  const rect = getBlockDisplayRect(bbox, displayTop, scale);
  check('previewY = displayTop + bbox.y (scale=1)', rect.top === 2620, `got ${rect.top}`);
  check('previewX = bbox.x (scale=1)', rect.left === 100, `got ${rect.left}`);

  // top_offset(원본 절대값)과는 다른 값이어야 한다 — 같은 bbox라도 displayTop만 써야 한다
  const topOffset = 9999; // 만약 실수로 topOffset을 썼다면 이 값이 섞여 나온다
  check(
    'topOffset을 계산에 섞지 않는다',
    rect.top !== topOffset + bbox.y,
    `rect.top=${rect.top}`,
  );

  // v3.4.1 백엔드 최종 확정 — scaleX/scaleY 두 축이 아니라 단일 scale 하나가
  // previewX/Y/W/H 전부에 그대로 곱해진다. displayTop도 원본 해상도 좌표이므로
  // bbox.y와 먼저 더한 뒤에 scale을 적용해야 한다(스케일을 먼저 걸고 더하면 안 된다).
  const scale2 = 0.4;
  const rect2 = getBlockDisplayRect(bbox, displayTop, scale2);
  check(
    'previewY = (displayTop + bbox.y) * scale (스케일 나중에 적용)',
    Math.abs(rect2.top - (displayTop + bbox.y) * scale2) < 1e-9,
    `got ${rect2.top}`,
  );
  check('previewX = bbox.x * scale', Math.abs(rect2.left - bbox.x * scale2) < 1e-9, `got ${rect2.left}`);
  check(
    'previewW = bbox.width * scale',
    Math.abs(rect2.width - bbox.width * scale2) < 1e-9,
    `got ${rect2.width}`,
  );
  check(
    'previewH = bbox.height * scale (가로/세로 같은 scale)',
    Math.abs(rect2.height - bbox.height * scale2) < 1e-9,
    `got ${rect2.height}`,
  );
}

console.log('\n[2] getPreviewScale — /review(ReviewPreview) 원시 크기 쌍으로부터 축별 비율을 구한다');
{
  // getPreviewScale/PreviewScale은 /preview의 단일 scale 계약과는 별개다 —
  // /review의 ReviewPreview(originalWidth/Height, previewWidth/Height)로부터
  // 축별 비율을 구하는 범용 유틸이고, mock 서버 응답 생성(lib/mock-api/fixtures.ts)
  // 에서만 쓰인다. 일부러 가로/세로 비율이 다른 preview로 두 축이 독립 계산됨을 검증한다.
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

console.log('\n[5] displayTop + bbox.y 결과는 viewMode(번역 전/번역 후)와 무관하다');
{
  // getBlockDisplayRect는 애초에 mode 파라미터를 받지 않는다 — 번역 전/번역 후
  // 전환은 image source만 바꿀 뿐, block 표시 좌표(section.displayTop + block.bbox.y)는
  // 같은 좌표계(originalUrl/renderedUrl이 공유하는 preview)를 그대로 쓰기 때문이다.
  // 같은 입력을 "번역 전 화면"/"번역 후 화면" 두 번 호출한 것처럼 반복 호출해도
  // 항상 같은 결과가 나와야 한다.
  const bbox = { x: 100, y: 120, width: 800, height: 100 };
  const displayTop = 2500;
  const scale = 0.4;

  const rectForOriginal = getBlockDisplayRect(bbox, displayTop, scale);
  const rectForTranslated = getBlockDisplayRect(bbox, displayTop, scale);

  check(
    '번역 전/번역 후 어느 모드에서 계산해도 top이 같다',
    rectForOriginal.top === rectForTranslated.top,
    `original=${rectForOriginal.top} translated=${rectForTranslated.top}`,
  );
  check(
    '번역 전/번역 후 어느 모드에서 계산해도 left/width/height가 같다',
    rectForOriginal.left === rectForTranslated.left &&
      rectForOriginal.width === rectForTranslated.width &&
      rectForOriginal.height === rectForTranslated.height,
  );
}

console.log('\n[6] 하단 section(큰 displayTop) + section-local bbox -> 최종 preview 좌표');
{
  // 실제 mock(lib/mock-api/fixtures.ts)의 SRC_B 마지막 section(sec_05,
  // displayTop=9900)과 그 안의 blk_06(bbox.y=150) 조합을 그대로 가져온다 —
  // job 후반부 section(큰 displayTop)에서도 같은 공식이 그대로 적용되는지,
  // 작은 값으로만 검증했던 [1]과 별개로 명시적으로 확인한다.
  const bbox = { x: 100, y: 150, width: 800, height: 80 }; // bbox.y ≠ 0
  const displayTop = 9900; // >= 9000
  const scale = 0.4; // ≠ 1 (SRC_B 실측 scale)

  const rect = getBlockDisplayRect(bbox, displayTop, scale);
  const expectedTop = (displayTop + bbox.y) * scale; // (9900+150)*0.4 = 4020
  check(
    'previewY = (displayTop + bbox.y) * scale — displayTop≥9000, bbox.y≠0, scale≠1',
    Math.abs(rect.top - expectedTop) < 1e-9,
    `expected ${expectedTop}, got ${rect.top}`,
  );
  check(
    'previewX = bbox.x * scale',
    Math.abs(rect.left - bbox.x * scale) < 1e-9,
    `got ${rect.left}`,
  );
  check(
    'previewW = bbox.width * scale',
    Math.abs(rect.width - bbox.width * scale) < 1e-9,
    `got ${rect.width}`,
  );
  check(
    'previewH = bbox.height * scale',
    Math.abs(rect.height - bbox.height * scale) < 1e-9,
    `got ${rect.height}`,
  );

  // getBlockDisplayRect는 topOffset을 아예 파라미터로 받지 않는다 — section의
  // topOffset(원본 crop 위치)이 아무리 커도 previewY 계산에는 절대 섞이지
  // 않아야 한다. 만약 실수로 displayTop 대신(또는 더해서) topOffset을 썼다면
  // 이 decoy 값이 결과에 나타난다.
  const decoyTopOffset = 9_999_999;
  check(
    'topOffset이 커도(9,999,999) previewY 계산에 섞이지 않는다',
    rect.top !== (decoyTopOffset + bbox.y) * scale,
    `rect.top=${rect.top}`,
  );

  // getBlockDisplayRect는 sourceImageId도 파라미터로 받지 않는다 — "이
  // section이 SRC_A 소속인지 SRC_B 소속인지"는 이 공식에 전혀 개입하지
  // 않는다는 뜻이다. 같은 displayTop/bbox/scale이면 어느 sourceImage
  // 소속이라고 가정하든 결과가 완전히 같아야 한다.
  const rectAsIfSrcA = getBlockDisplayRect(bbox, displayTop, scale);
  const rectAsIfSrcB = getBlockDisplayRect(bbox, displayTop, scale);
  check(
    'sourceImage가 달라도(SRC_A/SRC_B 어느 쪽이든) 같은 입력이면 같은 결과',
    rectAsIfSrcA.top === rectAsIfSrcB.top &&
      rectAsIfSrcA.left === rectAsIfSrcB.left &&
      rectAsIfSrcA.width === rectAsIfSrcB.width &&
      rectAsIfSrcA.height === rectAsIfSrcB.height,
  );
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
