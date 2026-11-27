/**
 * N6 렌더 진행·실패 중 미리보기(lib/n6/interim-preview.ts) 자동 검증.
 *
 * 실행:  npm run verify:n6-interim-preview
 */

import { toN6InterimPreview } from '../lib/n6/interim-preview.ts';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

const result = (taskId = 1) => ({ taskId, inputFingerprint: 'a'.repeat(64), rendererId: 'r', overflow: null });
const section = (id, order, over = {}) => ({
  id,
  sectionOrder: order,
  bucket: 'include',
  excludedStage: null,
  width: 860,
  height: 1200,
  renderedUrl: `https://s3.example/${id}.png`,
  render: { attempt: null, result: result(id), isCurrent: true },
  ...over,
});

console.log('\nN6 렌더 중 미리보기');
check('응답 없음(null) → null(빈 상태)', toN6InterimPreview(null) === null);
check('섹션 배열 없음 → null', toN6InterimPreview({}) === null);
{
  const p = toN6InterimPreview({ sections: [section(2, 2), section(1, 1)] });
  check('포함 섹션을 sectionOrder 순서로', p?.items.map((i) => i.sectionId).join() === '1,2');
  check('모두 최신 → 이전 미리보기 안내 없음', p?.hasStale === false && p?.hasMissing === false);
}
{
  const p = toN6InterimPreview({
    sections: [section(1, 1), section(2, 2, { bucket: 'exclude', excludedStage: 'N5', render: null }), section(3, 3, { bucket: 'exclude', excludedStage: 'N3', render: null })],
  });
  check('N5 · N3 제외 섹션은 최종 결과에 들어가지 않음(그리지 않음)', p?.items.length === 1 && p.items[0].sectionId === 1);
}
{
  const p = toN6InterimPreview({ sections: [section(1, 1, { render: { attempt: { taskId: 9, status: 'running' }, result: result(), isCurrent: false } }), section(2, 2)] });
  check('isCurrent=false 이미지 → 이전 미리보기 안내', p?.hasStale === true && p.items[0].url != null && p.items[0].isCurrent === false);
}
{
  const p = toN6InterimPreview({ sections: [section(1, 1), section(2, 2, { renderedUrl: null, render: { attempt: { status: 'failed' }, result: null, isCurrent: false } })] });
  check('renderedUrl 없음 → 그 섹션은 미리보기 없음 자리(임의 이미지 없음)', p?.hasMissing === true && p.items[1].url === null);
}
{
  const p = toN6InterimPreview({ sections: [section(1, 1, { render: { attempt: null, result: null, isCurrent: false } })] });
  check('renderedUrl 이 있어도 근거(render.result) 없으면 쓰지 않음 → 보일 것 없음 = null', p === null);
}
check('빈 문자열 url → 없음', toN6InterimPreview({ sections: [section(1, 1, { renderedUrl: '  ' })] }) === null);
check('isCurrent=true 여도 최종 완료 표시가 아니다(값은 미리보기 항목일 뿐)', toN6InterimPreview({ sections: [section(1, 1)] })?.items[0].isCurrent === true);

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
