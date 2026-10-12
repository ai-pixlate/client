/**
 * M1 보관함 화면 로직(lib/library/view.ts) 자동 검증 — 검색·국가 필터·최신순·선택·날짜 포맷.
 *
 * 순수 함수라 Node에서 바로 불러와 확인한다 (scripts/verify-library-adapter.mjs와 같은 패턴).
 *
 * 실행:  npm run verify:library-view
 */

import {
  filterLibraryCards,
  formatSavedDate,
  getCodeLabel,
  getCountryFilterCodes,
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

// 전체선택 범위(전체 library vs 현재 필터 결과)는 PM 미확정이라 여기서 고정하지 않는다 —
// 주어진 대상 목록에 대한 토글 동작만 확인한다.
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
  check('전체선택 -> 주어진 대상 전부', ids([...selected].map((jobId) => ({ jobId }))) === '1,2,3');
  check('전체선택 상태', isAllSelected(selected, visible));
  selected = toggleSelectAll(selected, visible);
  check('전체선택 해제 -> 0건', selected.size === 0);
  check('대상 0건이면 전체선택 아님', !isAllSelected(new Set(), []));

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

console.log(`\n총 ${pass + fail}건 — PASS ${pass} / FAIL ${fail}`);
if (fail > 0) {
  process.exit(1);
}
