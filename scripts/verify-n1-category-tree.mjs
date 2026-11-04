/**
 * N1 카테고리 트리·[다음] 진행 조건 순수 함수 검증.
 *
 * app/jobs/new/_lib/category-tree.ts(GET /master/categories → 트리, leaf 판정)와
 * app/jobs/new/_lib/n1-readiness.ts(isN1Ready)는 React를 쓰지 않아 Node에서 실제 함수를 그대로 import한다.
 * fixture는 OpenAPI Category shape(id · parentId · name · amazonNode · isLeaf · path)만 쓴다.
 *
 * 실행: npm run verify:n1-category
 */

import { buildCategoryTree, filterCategoryTree, findCategoryPath, firstBranchPath, formatCategoryPath, isCategoryLeaf } from '../app/jobs/new/_lib/category-tree.ts';
import { isImeComposingKeyEvent } from '../app/jobs/new/_lib/ime.ts';
import { N1_SIZE_CHANGE_BLOCK_LINES, getN1MissingFields, getN1SubmitBlockMessages, isN1Ready, resolveN1BrandId } from '../app/jobs/new/_lib/n1-readiness.ts';
import { INITIAL_SIZE_SELECTION, sanitizeSizeInput, sizeSelectionReducer } from '../app/jobs/new/_lib/size-selection.ts';

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

// 대분류(10) ├ 중분류(11) └ leaf(12)
//            └ 하위 없는 중분류(13)
// 대분류(20) — 하위 없음(루트 leaf)
const categories = [
  { id: 10, parentId: null, name: '스킨케어', amazonNode: null, isLeaf: false, path: '스킨케어' },
  { id: 11, parentId: 10, name: '크림', amazonNode: null, isLeaf: false, path: '스킨케어 > 크림' },
  { id: 12, parentId: 11, name: '아이크림', amazonNode: null, isLeaf: true, path: '스킨케어 > 크림 > 아이크림' },
  { id: 13, parentId: 10, name: '스킨/토너', amazonNode: null, isLeaf: true, path: '스킨케어 > 스킨/토너' },
  { id: 20, parentId: null, name: '기타', amazonNode: null, isLeaf: true, path: '기타' },
];

console.log('\ncategory-tree');
const tree = buildCategoryTree(categories);
check('루트는 parentId null 노드 2개, 서버 순서 유지', tree.map((n) => n.id).join() === '10,20');
check('형제 순서 유지(크림 → 스킨/토너)', tree[0].children.map((n) => n.id).join() === '11,13');
check('하위 있는 대분류는 leaf 아님', !isCategoryLeaf(tree[0]));
check('하위 있는 중분류는 leaf 아님', !isCategoryLeaf(tree[0].children[0]));
check('소분류는 leaf', isCategoryLeaf(tree[0].children[0].children[0]));
check('하위 없는 중분류는 leaf', isCategoryLeaf(tree[0].children[1]));
check('하위 없는 대분류도 leaf', isCategoryLeaf(tree[1]));

const path = findCategoryPath(tree, 12);
check('경로 탐색', path?.map((n) => n.id).join() === '10,11,12');
check('표시 문구는 이름 경로(id 미노출)', path && formatCategoryPath(path) === '스킨케어 > 크림 > 아이크림');
check('없는 id는 null', findCategoryPath(tree, 999) === null);

// isLeaf 플래그가 실제 하위와 어긋나도 하위 노드 유무가 기준이다
const mismatched = buildCategoryTree([
  { id: 1, parentId: null, name: 'A', isLeaf: true },
  { id: 2, parentId: 1, name: 'B', isLeaf: false },
]);
check('isLeaf=true여도 하위가 있으면 leaf 아님', !isCategoryLeaf(mismatched[0]));
check('isLeaf=false여도 하위가 없으면 leaf', isCategoryLeaf(mismatched[0].children[0]));

const broken = buildCategoryTree([
  { id: 1, parentId: null, name: 'A' },
  { id: 2, parentId: 99, name: '부모 없음' },
  { parentId: null, name: 'id 없음' },
  { id: 3, parentId: null },
  { id: 4, parentId: 4, name: '자기 순환' },
]);
check('부모 없는·id/name 없는·순환 노드는 트리에 넣지 않는다', broken.length === 1 && broken[0].children.length === 0);

console.log('\nn1-readiness');
const ready = {
  brandId: '1',
  productName: '상품',
  targetCountry: 'US',
  targetLanguage: 'en',
  regulatoryClass: 'cosmetic',
  otcType: null,
  categoryId: 12,
  hasAcceptedResponsibility: true,
  imageCount: 1,
  sizeTab: 'original',
};
check('필수값이 모두 있으면 진행 가능', isN1Ready(ready));
check('잘 모름(unknown)도 유효', isN1Ready({ ...ready, regulatoryClass: 'unknown' }));
check('공백만 있는 상품명은 빈 값', !isN1Ready({ ...ready, productName: '   ' }));
check('카테고리 미선택이면 불가', !isN1Ready({ ...ready, categoryId: null }));
check('규제 분류 미선택이면 불가', !isN1Ready({ ...ready, regulatoryClass: '' }));
check('국가 미선택이면 불가', !isN1Ready({ ...ready, targetCountry: '' }));
check('도착어 미선택이면 불가', !isN1Ready({ ...ready, targetLanguage: '' }));
check('동의 미체크면 불가', !isN1Ready({ ...ready, hasAcceptedResponsibility: false }));
check('이미지 없으면 불가', !isN1Ready({ ...ready, imageCount: 0 }));
check('brandId 없으면 불가', !isN1Ready({ ...ready, brandId: '' }));
check('OTC는 OTC 종류(화면 게이트)가 있어야 진행', !isN1Ready({ ...ready, regulatoryClass: 'otc' }));
check('OTC + OTC 종류면 진행', isN1Ready({ ...ready, regulatoryClass: 'combination', otcType: 'M020' }));

check('빠진 항목 이름을 화면 표기로 알려 준다', getN1MissingFields({ ...ready, targetCountry: '', imageCount: 0 }).join() === '국가,이미지');
check('필수값이 모두 있으면 빠진 항목이 없다', getN1MissingFields(ready).length === 0);
check('숨겨진 brandId가 없어도 이유를 알려 준다', getN1MissingFields({ ...ready, brandId: '' }).join() === '브랜드 정보');

console.log('\nresolveN1BrandId');
check('URL 쿼리가 우선한다', resolveN1BrandId('7', 'mock') === '7');
check('Mock은 쿼리가 없으면 fixture를 쓴다', resolveN1BrandId(null, 'mock') === 'mock');
check('빈 쿼리도 없는 것으로 본다', resolveN1BrandId('  ', 'mock') === 'mock');
check('실서버는 쿼리가 없으면 값을 만들지 않는다', resolveN1BrandId(null, null) === '');

check('사이즈 변경이면 필수값이 모두 있어도 진행 불가', !isN1Ready({ ...ready, sizeTab: 'change' }));
check('사이즈 변경은 입력 누락이 아니라 별도 안내로 알린다', getN1MissingFields({ ...ready, sizeTab: 'change' }).length === 0 && N1_SIZE_CHANGE_BLOCK_LINES.length === 2);

console.log('\ngetN1SubmitBlockMessages');
const idle = { ...ready, isSubmitting: false, isUploadBusy: false };
check('막는 이유가 없으면 빈 배열', getN1SubmitBlockMessages(idle).length === 0);
check('입력 누락을 알린다', getN1SubmitBlockMessages({ ...idle, targetCountry: '' })[0] === '입력이 필요해요: 국가');
check('사이즈 변경을 알린다', getN1SubmitBlockMessages({ ...idle, sizeTab: 'change' })[0] === N1_SIZE_CHANGE_BLOCK_LINES.join(' '));
check('입력이 다 있어도 업로드 처리 중을 알린다', getN1SubmitBlockMessages({ ...idle, isUploadBusy: true })[0].includes('이미지를 처리'));
check('제출 중을 알린다', getN1SubmitBlockMessages({ ...idle, isSubmitting: true, isUploadBusy: true }).join().includes('작업을 만들고'));
check('여러 이유를 함께 알린다', getN1SubmitBlockMessages({ ...idle, productName: '', sizeTab: 'change' }).length === 2);

console.log('\nisImeComposingKeyEvent');
check('isComposing이면 조합 중', isImeComposingKeyEvent({ isComposing: true, keyCode: 13 }));
check('keyCode 229면 조합 중', isImeComposingKeyEvent({ isComposing: false, keyCode: 229 }));
check('Chrome macOS 조합 확정 Enter', isImeComposingKeyEvent({ isComposing: true, keyCode: 229 }));
check('조합이 끝난 Enter는 일반 입력', !isImeComposingKeyEvent({ isComposing: false, keyCode: 13 }));

console.log('\nfilterCategoryTree');
const searchTree = buildCategoryTree([
  { id: 1, parentId: null, name: '스킨케어' },
  { id: 2, parentId: 1, name: '크림' },
  { id: 3, parentId: 2, name: '아이크림' },
  { id: 4, parentId: 2, name: '수분크림' },
  { id: 5, parentId: 1, name: 'Toner' },
  { id: 6, parentId: null, name: '선케어' },
  { id: 7, parentId: 6, name: '선크림' },
  { id: 8, parentId: null, name: '네일' },
]);
const leafNames = (nodes) => nodes.flatMap((n) => (n.children.length ? leafNames(n.children) : [n.name]));
check('검색어가 없으면 전체 트리', filterCategoryTree(searchTree, '') === searchTree);
check('공백만 있으면 전체 트리', filterCategoryTree(searchTree, '   ') === searchTree);
check('leaf 검색은 그 leaf까지의 경로만 남긴다', JSON.stringify(leafNames(filterCategoryTree(searchTree, '아이크림'))) === '["아이크림"]');
const eyeTree = filterCategoryTree(searchTree, '아이크림');
check('ancestor를 유지한다', eyeTree.length === 1 && eyeTree[0].name === '스킨케어' && eyeTree[0].children[0].name === '크림' && eyeTree[0].children[0].children[0].id === 3);
check('부분 문자열은 여러 대분류에서 찾는다', leafNames(filterCategoryTree(searchTree, '크림')).join() === '아이크림,수분크림,선크림');
check('상위 이름으로 찾으면 하위 leaf가 남는다', leafNames(filterCategoryTree(searchTree, '스킨케어')).join() === '아이크림,수분크림,Toner');
check('전체 경로 문구로도 찾는다', leafNames(filterCategoryTree(searchTree, '스킨케어 > 크림 > 아이크림')).join() === '아이크림');
check('공백을 다듬는다', leafNames(filterCategoryTree(searchTree, '  아이크림  ')).join() === '아이크림');
check('대소문자를 구분하지 않는다', leafNames(filterCategoryTree(searchTree, 'tONER')).join() === 'Toner');
check('루트 leaf도 찾는다', filterCategoryTree(searchTree, '네일')[0].id === 8);
check('결과가 없으면 빈 배열', filterCategoryTree(searchTree, '없는말').length === 0);
check('필터가 원본 트리를 바꾸지 않는다', searchTree[0].children[0].children.length === 2);
check('첫 가지를 leaf 위까지만 펼친다', firstBranchPath(eyeTree).map((n) => n.name).join() === '스킨케어,크림');
check('루트 leaf뿐이면 펼칠 경로가 없다', firstBranchPath(filterCategoryTree(searchTree, '네일')).length === 0);

console.log('\nsizeSelectionReducer');
const changed = sizeSelectionReducer(INITIAL_SIZE_SELECTION, { type: 'selectTab', tab: 'change' });
check('기본은 원본 유지', INITIAL_SIZE_SELECTION.tab === 'original');
check('기본 사이즈 변경 방식은 판매처 맞춤', changed.tab === 'change' && changed.mode === 'site');
const custom = sizeSelectionReducer(changed, { type: 'selectMode', mode: 'custom' });
check('방식을 바꿔도 탭을 되돌리지 않는다', custom.tab === 'change' && custom.mode === 'custom');
const sized = sizeSelectionReducer(custom, { type: 'setCustomWidth', value: '12a0px' });
check('W는 숫자만 남긴다', sized.customWidth === '120');
check('H는 그대로 둔다', sized.customHeight === '80');
check('입력은 5자리로 자른다', sanitizeSizeInput('1234567') === '12345');
const specced = sizeSelectionReducer(sized, { type: 'selectSiteSpec', siteSpec: 'basic' });
const back = sizeSelectionReducer(specced, { type: 'selectTab', tab: 'original' });
check('원본 유지로 옮겨도 고른 값은 보존한다', back.tab === 'original' && back.siteSpec === 'basic' && back.customWidth === '120');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
