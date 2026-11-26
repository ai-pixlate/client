/**
 * M0 브랜드 선택 화면 로직(lib/brand/m0-view.ts) 자동 검증 — 검색 · 최신순 · 대표 로고 · 워드마크 · 선택.
 *
 * 실행:  npm run verify:m0-view
 */

import {
  filterBrands,
  getBrandDisplayName,
  getBrandWordmark,
  isAllBrandsSelected,
  pickBrandLogoUrl,
  sortBrandsByNewest,
  toggleBrandSelection,
  toggleSelectAllBrands,
  toM0Brands,
} from '../lib/brand/m0-view.ts';

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

const brand = (id, overrides = {}) => ({ id, nameKo: `브랜드${id}`, nameEn: `Brand${id}`, overview: null, targetCustomer: null, ...overrides });

console.log('\n[1] toM0Brands — id 없는 항목은 뺀다');
{
  const result = toM0Brands([brand(1), { nameKo: 'x', nameEn: 'y' }, brand(2)]);
  check('id 있는 2건만', result.length === 2 && result[0].id === 1 && result[1].id === 2);
}

console.log('\n[2] filterBrands — 한글·영문 부분 일치, 대소문자·공백 무시');
{
  const list = [brand(1, { nameKo: '픽슬레이트', nameEn: 'Pixlate' }), brand(2, { nameKo: '아누아', nameEn: 'Anua' })];
  check('빈 검색어 → 전부', filterBrands(list, '  ').length === 2);
  check('한글 부분 일치', filterBrands(list, '슬레').map((b) => b.id).join() === '1');
  check('영문 대소문자 무시', filterBrands(list, ' ANU ').map((b) => b.id).join() === '2');
  check('없는 검색어 → 0건', filterBrands(list, 'zzz').length === 0);
}

console.log('\n[3] sortBrandsByNewest — updatedAt, 없으면 createdAt, 둘 다 없으면 뒤(서버 순서 유지)');
{
  const list = [
    brand(1, { updatedAt: '2026-11-01T00:00:00Z' }),
    brand(2),
    brand(3, { createdAt: '2026-11-20T00:00:00Z' }),
    brand(4, { updatedAt: 'not-a-date' }),
    brand(5, { updatedAt: '2026-11-10T00:00:00Z', createdAt: '2026-12-31T00:00:00Z' }),
  ];
  check('3 · 5 · 1 · 2 · 4', sortBrandsByNewest(list).map((b) => b.id).join() === '3,5,1,2,4', sortBrandsByNewest(list).map((b) => b.id).join());
  check('원본 배열은 그대로', list.map((b) => b.id).join() === '1,2,3,4,5');
}

console.log('\n[4] pickBrandLogoUrl — 서버 순서의 첫 로고, 없으면 null');
{
  check('undefined → null', pickBrandLogoUrl(undefined) === null);
  check('빈 목록 → null', pickBrandLogoUrl([]) === null);
  check('logoUrl 없는 항목은 건너뜀', pickBrandLogoUrl([{ id: 1 }, { id: 2, logoUrl: 'https://x/2.svg' }, { id: 3, logoUrl: 'https://x/3.svg' }]) === 'https://x/2.svg');
}

console.log('\n[5] 표시 이름 · 워드마크');
{
  check('표시 이름 = 한글명', getBrandDisplayName(brand(1, { nameKo: '구달', nameEn: 'goodal' })) === '구달');
  check('한글명 비면 영문명', getBrandDisplayName(brand(1, { nameKo: ' ', nameEn: 'goodal' })) === 'goodal');
  check('워드마크 = 영문명(대소문자 그대로)', getBrandWordmark(brand(1, { nameEn: 'Lumene' })) === 'Lumene');
  check('영문명 비면 한글명', getBrandWordmark(brand(1, { nameKo: '루메네', nameEn: '' })) === '루메네');
}

console.log('\n[6] 선택 — 개별 토글 · 전체선택은 현재 결과에만');
{
  let selected = toggleBrandSelection(new Set(), 1);
  check('토글 추가', selected.has(1));
  selected = toggleBrandSelection(selected, 1);
  check('토글 해제', !selected.has(1));
  const outside = new Set([9]);
  const all = toggleSelectAllBrands(outside, [1, 2]);
  check('전체선택 — 결과 전부 + 결과 밖 유지', all.has(1) && all.has(2) && all.has(9));
  check('isAllBrandsSelected', isAllBrandsSelected(all, [1, 2]));
  const cleared = toggleSelectAllBrands(all, [1, 2]);
  check('전체해제 — 결과만 해제, 결과 밖 유지', !cleared.has(1) && !cleared.has(2) && cleared.has(9));
  check('결과 0건이면 전체선택 아님', !isAllBrandsSelected(new Set([1]), []));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
