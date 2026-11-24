/**
 * M1 보관함 Adapter(lib/library/adapter.ts) 자동 검증 — F-LST-02 상품 카드 표시.
 *
 * 순수 함수라 Node에서 바로 불러와 확인한다 (scripts/verify-n5-adapter.mjs와 같은 패턴).
 * MSW fixture(lib/mock-api/library-fixtures.ts)도 함께 불러와 "저장된 job 1건 = 카드 1장"
 * 계약이 fixture에서 유지되는지 본다.
 *
 * 실행:  npm run verify:library-adapter
 */

import { toLibraryCardViewModel, toLibraryCardViewModels } from '../lib/library/adapter.ts';
import { mockLibraryCards } from '../lib/mock-api/library-fixtures.ts';

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

console.log('\n[1] toLibraryCardViewModel — 완료 카드 필드(상품명/국가/언어/규격) 전달');
{
  const vm = toLibraryCardViewModel({
    jobId: 1,
    productName: '비타민C 세럼',
    brandName: '브랜드',
    targetCountry: 'US',
    targetLanguage: 'en',
    specType: 'original',
    thumbnailUrl: 'https://example.com/thumb.png',
    savedAt: '2026-10-01T09:00:00Z',
  });
  check('jobId 그대로', vm.jobId === 1);
  check('productName 그대로', vm.productName === '비타민C 세럼');
  check('targetCountry 코드값 그대로', vm.targetCountry === 'US');
  check('targetLanguage 코드값 그대로', vm.targetLanguage === 'en');
  check('specType 코드값 그대로', vm.specType === 'original');
  check('thumbnailUrl/savedAt 그대로', vm.thumbnailUrl === 'https://example.com/thumb.png' && vm.savedAt === '2026-10-01T09:00:00Z');
}

console.log('\n[2] nullable/optional 필드 — 값을 지어내지 않고 null로 둔다');
{
  const vm = toLibraryCardViewModel({ jobId: 2 });
  check(
    '없는 필드는 전부 null',
    vm.productName === null &&
      vm.brandName === null &&
      vm.targetCountry === null &&
      vm.targetLanguage === null &&
      vm.specType === null &&
      vm.thumbnailUrl === null &&
      vm.savedAt === null,
    JSON.stringify(vm),
  );

  let threw = false;
  try {
    toLibraryCardViewModel({ productName: 'x' });
  } catch {
    threw = true;
  }
  check('jobId 없음 -> throw(배열 index 등으로 대체하지 않는다)', threw);
}

console.log('\n[3] toLibraryCardViewModels — job 1건 = 카드 1장, 순서 유지, 병합 없음');
{
  const vms = toLibraryCardViewModels(mockLibraryCards);
  check('fixture 개수 그대로', vms.length === mockLibraryCards.length, `got ${vms.length}`);
  check(
    '서버 응답 순서 유지',
    vms.map((v) => v.jobId).join(',') === mockLibraryCards.map((c) => c.jobId).join(','),
  );
  check('jobId 중복 없음', new Set(vms.map((v) => v.jobId)).size === vms.length);

  const sameProduct = vms.filter((v) => v.productName === '비타민C 세럼');
  check('같은 상품명 카드가 병합되지 않는다(3장)', sameProduct.length === 3, `got ${sameProduct.length}`);
  const combos = new Set(sameProduct.map((v) => `${v.targetCountry}|${v.targetLanguage}|${v.specType}`));
  check('같은 상품명 카드끼리 국가·언어·규격 조합이 모두 다르다', combos.size === sameProduct.length);

  check('빈 목록 -> 빈 배열', toLibraryCardViewModels([]).length === 0);
}

console.log(`\n총 ${pass + fail}건 — PASS ${pass} / FAIL ${fail}`);
if (fail > 0) {
  process.exit(1);
}
