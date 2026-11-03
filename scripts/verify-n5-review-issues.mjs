/**
 * N5 저장 전 확인 항목(lib/n5/review-issues.ts) · 겹침 진단(lib/n5/overlap.ts) 자동 검증.
 *
 * 실행:  npm run verify:n5-review-issues
 */

import { buildN5ReviewIssues, formatN5ReviewIssueLocation, groupN5ReviewIssues } from '../lib/n5/review-issues.ts';
import { computeBlockOverlaps, getBoxIntersection } from '../lib/n5/overlap.ts';

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

const sections = [
  { id: 1, sectionOrder: 1, bucket: 'include' },
  { id: 2, sectionOrder: 2, bucket: 'include' },
  { id: 3, sectionOrder: 3, bucket: 'exclude' },
];
const blocks = [
  { id: 10, sectionId: 1, translatedText: 'a', badges: [] },
  { id: 11, sectionId: 2, translatedText: 'b', badges: [{ code: 'prohibited_expression', reason: '금지' }, { code: 'mandatory_term_unapplied', reason: '용어' }] },
  { id: 12, sectionId: 2, translatedText: '', badges: [{ code: 'translation_failed', reason: 'x' }] },
  { id: 13, sectionId: 2, translatedText: '', badges: [] },
  { id: 14, sectionId: 3, translatedText: '', badges: [{ code: 'translation_failed' }, { code: 'prohibited_expression' }] },
];
const input = {
  sections,
  blocks,
  sectionStatusById: new Map([[1, { failedStages: ['render', 'inpaint'] }], [3, { failedStages: ['render'] }]]),
  blockTaskFailuresById: new Map([[10, { verifyFailed: true }], [14, { verifyFailed: true }]]),
  failedDraftBlockIds: new Set([10, 14]),
};
const issues = buildN5ReviewIssues(input);
const kinds = issues.map((i) => i.kind).sort().join();
check('확인 대상만 모은다', kinds === 'empty-translation,execution-failed,execution-failed,regulatory-warning,unsaved-translation,verification-failed', kinds);
check('제외 section은 세지 않는다', issues.every((i) => i.sectionId !== 3));
check('미적용 강제 용어는 세지 않는다', issues.filter((i) => i.blockId === 11).length === 1);
check('번역 실패 없이 빈 칸은 세지 않는다', issues.every((i) => i.blockId !== 13));
check('번역 실패여도 글이 있으면 세지 않는다', buildN5ReviewIssues({ ...input, blocks: [{ id: 12, sectionId: 2, translatedText: 'typed', badges: [{ code: 'translation_failed' }] }] }).filter((i) => i.kind === 'empty-translation').length === 0);
const groups = groupN5ReviewIssues(issues);
check('Figma 순서로 묶는다', groups.map((g) => g.title).join() === '규제 경고,검사실패,번역문 비어 있음,실행 실패,저장하지 못한 번역문', groups.map((g) => g.title).join());
check('규제 경고만 Warning', groups.filter((g) => g.isWarning).map((g) => g.kind).join() === 'regulatory-warning');
const reg = issues.find((i) => i.kind === 'regulatory-warning');
check('위치 — block', formatN5ReviewIssueLocation(reg) === 'Section 2 - Block 01', formatN5ReviewIssueLocation(reg));
const exec = issues.find((i) => i.kind === 'execution-failed');
check('위치 — section', formatN5ReviewIssueLocation(exec) === 'Section 1 렌더링');
check('항목 없으면 묶음도 없다', groupN5ReviewIssues([]).length === 0);

console.log('\noverlap');
const a = { x: 0, y: 0, width: 100, height: 50 };
const hit = getBoxIntersection(a, { x: 80, y: 20, width: 100, height: 100 });
check('겹친 영역', hit && hit.x === 80 && hit.y === 20 && hit.width === 20 && hit.height === 30, JSON.stringify(hit));
check('맞닿기만 하면 겹침이 아니다', getBoxIntersection(a, { x: 100, y: 0, width: 10, height: 10 }) === null);
const list = computeBlockOverlaps({ id: 1, bbox: a }, [{ id: 1, bbox: a }, { id: 2, bbox: { x: 90, y: 0, width: 10, height: 10 } }, { id: 3, bbox: null }, { id: 4, bbox: { x: 500, y: 0, width: 1, height: 1 } }]);
check('자기 자신·bbox 없음·떨어진 block은 뺀다', list.length === 1 && list[0].blockId === 2);

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
