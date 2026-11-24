/**
 * M1 보관함 화면 로직(lib/library/view.ts) 자동 검증 — 검색·국가 필터·최신순·선택·날짜 포맷.
 *
 * 순수 함수라 Node에서 바로 불러와 확인한다 (scripts/verify-library-adapter.mjs와 같은 패턴).
 *
 * 실행:  npm run verify:library-view
 */

import {
  clampPage,
  countHiddenSelected,
  countSelected,
  filterLibraryCards,
  formatSavedDate,
  getCodeLabel,
  getSelectionSummary,
  getCountryFilterCodes,
  getPageItems,
  getPaginationItems,
  getSpecTypeLabel,
  getTotalPages,
  LIBRARY_PAGE_SIZE,
  isAllSelected,
  sortLibraryCardsByNewest,
  toggleSelectAll,
  toggleSelection,
  toNameMap,
} from '../lib/library/view.ts';

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

function card(jobId, overrides = {}) {
  return {
    jobId,
    productName: '비타민C 세럼',
    brandName: null,
    targetCountry: 'US',
    targetLanguage: 'en',
    specType: 'original',
    thumbnailUrl: null,
    savedAt: '2026-10-01T09:00:00Z',
    ...overrides,
  };
}

const cards = [
  card(1, { savedAt: '2026-10-01T09:00:00Z' }),
  card(2, { targetCountry: 'JP', targetLanguage: 'ja', savedAt: '2026-10-02T09:00:00Z' }),
  card(3, { specType: 'site', savedAt: '2026-10-03T09:00:00Z' }),
  card(4, { productName: '히알루론산 토너', targetCountry: 'AE', targetLanguage: 'ar', savedAt: '2026-09-28T09:00:00Z' }),
];
const ids = (list) => list.map((c) => c.jobId).join(',');

console.log('\n[1] filterLibraryCards — 상품명 검색 + 국가 필터');
{
  check('빈 조건 -> 전부', ids(filterLibraryCards(cards, { query: '', country: '' })) === '1,2,3,4');
  check('상품명 부분 일치', ids(filterLibraryCards(cards, { query: '토너', country: '' })) === '4');
  check('앞뒤 공백 무시', ids(filterLibraryCards(cards, { query: '  세럼 ', country: '' })) === '1,2,3');
  check('영문 대소문자 무시', ids(filterLibraryCards(cards, { query: 'vitamin', country: '' })) === '' &&
    ids(filterLibraryCards([card(9, { productName: 'Vitamin C' })], { query: 'vitamin', country: '' })) === '9');
  check('국가 필터', ids(filterLibraryCards(cards, { query: '', country: 'US' })) === '1,3');
  check('검색 + 국가 동시 적용', ids(filterLibraryCards(cards, { query: '세럼', country: 'JP' })) === '2');
  check('일치 없음 -> 빈 배열', filterLibraryCards(cards, { query: '없는상품', country: '' }).length === 0);
  check('productName null은 검색어가 있으면 제외', filterLibraryCards([card(5, { productName: null })], { query: '세럼', country: '' }).length === 0);
}

console.log('\n[2] sortLibraryCardsByNewest — savedAt 내림차순');
{
  check('최신순', ids(sortLibraryCardsByNewest(cards)) === '3,2,1,4');
  check('원본 배열을 바꾸지 않는다', ids(cards) === '1,2,3,4');
  const withNull = [card(7, { savedAt: null }), card(8, { savedAt: '2026-01-01T00:00:00Z' }), card(9, { savedAt: 'invalid' })];
  check('savedAt 없음/파싱 불가는 뒤로, 서로는 원래 순서', ids(sortLibraryCardsByNewest(withNull)) === '8,7,9');
}

console.log('\n[3] getCountryFilterCodes / toNameMap');
{
  check('실제 카드의 국가만, 첫 등장 순서', getCountryFilterCodes(cards).join(',') === 'US,JP,AE');
  check('targetCountry null은 제외', getCountryFilterCodes([card(1, { targetCountry: null })]).length === 0);
  const map = toNameMap([{ code: 'US', name: '미국' }, { code: 'JP' }, { name: '이름만' }]);
  check('code·name 둘 다 있는 항목만', map.size === 1 && map.get('US') === '미국');
  check('undefined -> 빈 맵', toNameMap(undefined).size === 0);
}

console.log('\n[4] formatSavedDate — YYYY.MM.DD(로컬 날짜)');
{
  const iso = '2026-10-03T09:00:00Z';
  const d = new Date(iso);
  const expected = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  check('ISO -> YYYY.MM.DD', formatSavedDate(iso) === expected, `got ${formatSavedDate(iso)}`);
  check('null -> null', formatSavedDate(null) === null);
  check('파싱 불가 -> null', formatSavedDate('not-a-date') === null);
}

// 전체선택·해제의 대상은 현재 검색·필터 결과다(확정) — 여기서는 주어진 대상 목록에 대한 토글을 확인한다.
console.log('\n[5] 선택 — 개별 / 복수 / 전체선택·해제');
{
  let selected = new Set();
  selected = toggleSelection(selected, 1);
  check('개별 선택', selected.has(1) && selected.size === 1);
  selected = toggleSelection(selected, 3);
  check('복수 선택', selected.has(1) && selected.has(3) && selected.size === 2);
  selected = toggleSelection(selected, 1);
  check('다시 누르면 해제', !selected.has(1) && selected.size === 1);

  const visible = [1, 2, 3];
  check('일부만 선택 -> 전체선택 아님', !isAllSelected(selected, visible));
  selected = toggleSelectAll(selected, visible);
  check('전체선택 -> 주어진 대상 전부', [...selected].sort().join(',') === '1,2,3');
  check('전체선택 상태', isAllSelected(selected, visible));
  selected = toggleSelectAll(selected, visible);
  check('전체선택 해제 -> 0건', selected.size === 0);
  check('대상 0건이면 전체선택 아님', !isAllSelected(new Set(), []));

  // 선택 개수 — 현재 결과(대상) 안의 선택만 센다
  check('선택 개수 0', countSelected(new Set(), visible) === 0);
  check('선택 개수 = 대상 안 선택 수', countSelected(new Set([1, 3]), visible) === 2);
  check('대상 밖 선택은 세지 않음', countSelected(new Set([1, 9]), visible) === 1);
  const filtered = [1, 3];
  const afterSelectAll = toggleSelectAll(new Set(), filtered);
  check('필터 결과 전체선택 -> 결과 밖(2)은 선택 안 됨', !afterSelectAll.has(2) && afterSelectAll.size === 2);
  check('전체선택 후 개수 = 결과 수', countSelected(afterSelectAll, filtered) === filtered.length);

  // 전체선택·해제는 대상(현재 결과)에만 적용 — 대상 밖 선택(9)은 유지
  const withHidden = toggleSelectAll(new Set([9]), filtered);
  check('전체선택 -> 대상 밖 선택 유지', withHidden.has(9) && withHidden.has(1) && withHidden.has(3) && withHidden.size === 3);
  const clearedVisible = toggleSelectAll(withHidden, filtered);
  check('전체해제 -> 대상만 해제, 대상 밖 선택 유지', clearedVisible.has(9) && clearedVisible.size === 1);
  check('전체해제 후 대상 안 개수 0', countSelected(clearedVisible, filtered) === 0);

  // 결과 밖 선택 수 — 보관함 전체(all) 중 현재 결과(filtered) 밖 선택만, 보관함에 없는 id(99)는 제외
  const all = [1, 2, 3, 4, 9];
  check('결과 밖 선택 수', countHiddenSelected(new Set([1, 2, 9, 99]), all, filtered) === 2);
  check('결과 밖 선택 없음', countHiddenSelected(new Set([1, 3]), all, filtered) === 0);
  check('결과 = 전체면 결과 밖 0', countHiddenSelected(new Set([1, 2]), all, all) === 0);

  // 선택 개수 문구
  check('선택 없음 -> 숨김(null)', getSelectionSummary(0, 0) === null);
  const onlyVisible = getSelectionSummary(3, 0);
  check('현재 결과만 -> "3개 선택"', onlyVisible?.visible === '3개 선택' && onlyVisible.hidden === null);
  const both = getSelectionSummary(2, 12);
  check('둘 다 -> "2개 선택" + "다른 조건에서 12개 선택됨"', both?.visible === '2개 선택' && both.hidden === '다른 조건에서 12개 선택됨');
  const onlyHidden = getSelectionSummary(0, 14);
  check('결과 밖만 -> "다른 조건에서 14개 선택됨"', onlyHidden?.visible === null && onlyHidden.hidden === '다른 조건에서 14개 선택됨');

}

console.log('\n[6] getCodeLabel — master 이름 우선, 없으면 code(빈 문자열 금지)');
{
  const countries = toNameMap([{ code: 'US', name: '미국' }]);
  const languages = toNameMap([{ code: 'en', name: '영어' }]);
  check('master에 있으면 이름(US -> 미국)', getCodeLabel('US', countries) === '미국');
  check('master에 있으면 이름(en -> 영어)', getCodeLabel('en', languages) === '영어');

  // master 요청 실패·응답 전·빈 배열 = 빈 맵
  const emptyFromFailure = toNameMap(undefined);
  const emptyFromEmptyArray = toNameMap([]);
  check('C. countries 실패/응답 전 -> US', getCodeLabel('US', emptyFromFailure) === 'US');
  check('C. countries 빈 배열 -> US', getCodeLabel('US', emptyFromEmptyArray) === 'US');
  check('D. languages 실패/응답 전 -> en', getCodeLabel('en', emptyFromFailure) === 'en');
  check('D. languages 빈 배열 -> en', getCodeLabel('en', emptyFromEmptyArray) === 'en');
  check('master에 없는 code -> code', getCodeLabel('AE', countries) === 'AE');

  // 국가 filter option은 화면에서 getCountryFilterCodes → getCodeLabel 순서로 만든다
  const optionLabels = getCountryFilterCodes(cards).map((code) => getCodeLabel(code, emptyFromFailure));
  check('E. master 없을 때 filter option = code, 빈칸 없음', optionLabels.join(',') === 'US,JP,AE' && optionLabels.every((l) => l !== ''));
}

console.log('\n[7] getSpecTypeLabel — N1 규격 명칭');
{
  check('original -> 원본 유지', getSpecTypeLabel('original') === '원본 유지');
  check('site -> 판매처 맞춤', getSpecTypeLabel('site') === '판매처 맞춤');
  check('custom -> 커스텀', getSpecTypeLabel('custom') === '커스텀');
  check('null -> null(라벨 생략)', getSpecTypeLabel(null) === null);
  check('계약 밖 값 -> null', getSpecTypeLabel('unknown') === null);
}

console.log('\n[8] 페이지네이션 — 결과 카드 7장/페이지, 1페이지 이하는 숨김(LibraryView: totalPages > 1)');
{
  check('페이지 크기 7', LIBRARY_PAGE_SIZE === 7);
  const table = [[0, 0], [4, 1], [7, 1], [8, 2], [14, 2], [15, 3], [17, 3]];
  for (const [count, pages] of table) {
    check(`${count}건 -> ${pages}페이지, pagination ${pages > 1 ? '표시' : '숨김'}`, getTotalPages(count) === pages);
  }
  check('사라진 페이지 -> 마지막 페이지', clampPage(3, 2) === 2);
  check('0페이지 -> 1', clampPage(3, 0) === 1);
  check('범위 안은 그대로', clampPage(2, 3) === 2);
  check('0 이하 -> 1', clampPage(0, 3) === 1);
  const list = Array.from({ length: 17 }, (_, i) => i);
  check('1페이지 = 0~6', getPageItems(list, 1).join(',') === '0,1,2,3,4,5,6');
  check('3페이지 = 14~16', getPageItems(list, 3).join(',') === '14,15,16');
  const items = (c, t) => getPaginationItems(c, t).join(' ');
  check('3페이지 -> 1 2 3', items(1, 3) === '1 2 3');
  check('5페이지 -> 전부', items(4, 5) === '1 2 3 4 5');
  check('7페이지·현재 1 -> Figma 1 2 3 … 7', items(1, 7) === '1 2 3 more 7');
  check('8페이지·현재 3 -> 1 2 3 … 8', items(3, 8) === '1 2 3 more 8');
  check('8페이지·현재 4 -> 1 … 4 … 8', items(4, 8) === '1 more 4 more 8');
  check('8페이지·현재 6 -> 1 … 6 7 8', items(6, 8) === '1 more 6 7 8');
  check('8페이지·현재 8 -> 1 … 6 7 8', items(8, 8) === '1 more 6 7 8');
}

console.log(`\n총 ${pass + fail}건 — PASS ${pass} / FAIL ${fail}`);
if (fail > 0) {
  process.exit(1);
}
