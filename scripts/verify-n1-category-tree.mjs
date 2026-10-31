/**
 * N1 카테고리 트리·[다음] 진행 조건 순수 함수 검증.
 *
 * app/jobs/new/_lib/category-tree.ts(GET /master/categories → 트리, leaf 판정)와
 * app/jobs/new/_lib/n1-readiness.ts(isN1Ready)는 React를 쓰지 않아 Node에서 실제 함수를 그대로 import한다.
 * fixture는 OpenAPI Category shape(id · parentId · name · amazonNode · isLeaf · path)만 쓴다.
 *
 * 실행: npm run verify:n1-category
 */

import { buildCategoryTree, findCategoryPath, formatCategoryPath, isCategoryLeaf } from '../app/jobs/new/_lib/category-tree.ts';
import { isN1Ready } from '../app/jobs/new/_lib/n1-readiness.ts';

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
};
check('필수값이 모두 있으면 진행 가능', isN1Ready(ready));
check('잘모름(unknown)도 유효', isN1Ready({ ...ready, regulatoryClass: 'unknown' }));
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
