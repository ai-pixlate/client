/**
 * H 홈 화면 로직(lib/home/view.ts) 자동 검증 — 사용자 상태별 뷰 판정 · 최근 작업 행.
 *
 * 실행:  npm run verify:home-view
 */

import { formatRecentChangedAt, HOME_RECENT_LIMIT, resolveHomeEntry, resolveHomeView, toHomeRecentRows } from '../lib/home/view.ts';

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

console.log('\n[1] resolveHomeEntry — 확인 중 · 미인증 · 인증 · 확인 실패');
{
  const e = (authStatus, { devLogin = false, probeFailed = false } = {}) => resolveHomeEntry({ authStatus, devLogin, probeFailed });
  check('unknown → checking(랜딩도 H0 도 그리지 않음)', e('unknown') === 'checking');
  check('unknown + 확인 실패 → check-failed(로그아웃으로 보지 않음)', e('unknown', { probeFailed: true }) === 'check-failed');
  check('signed-out → signed-out(랜딩)', e('signed-out') === 'signed-out');
  check('authenticated → authenticated', e('authenticated') === 'authenticated');
  check('recovery-stopped → check-failed', e('recovery-stopped') === 'check-failed');
  check('dev-login → authenticated(앱 시작 때 세션을 만들었다)', e('unknown', { devLogin: true }) === 'authenticated');
}

console.log('\n[2] resolveHomeView');
{
  const v = (entry, status, count = 0) => resolveHomeView({ entry, brands: { status, count } });
  check('checking → checking', v('checking', 'pending') === 'checking');
  check('check-failed → check-failed', v('check-failed', 'pending') === 'check-failed');
  check('signed-out → landing(브랜드 조회 결과와 무관)', v('signed-out', 'success', 3) === 'landing');
  check('authenticated + pending → loading', v('authenticated', 'pending') === 'loading');
  check('authenticated + error → error(빈 목록으로 보지 않는다)', v('authenticated', 'error') === 'error');
  check('authenticated + 0개 → new', v('authenticated', 'success', 0) === 'new');
  check('authenticated + 2개 → returning', v('authenticated', 'success', 2) === 'returning');
}

const card = (jobId, savedAt, overrides = {}) => ({
  jobId,
  productName: `상품${jobId}`,
  brandName: '아누아',
  targetCountry: 'US',
  targetLanguage: 'en',
  specType: 'original',
  thumbnailUrl: null,
  savedAt,
  ...overrides,
});

console.log('\n[3] toHomeRecentRows — savedAt 내림차순 · 상위 4건 · 상태 「완료」');
{
  const rows = toHomeRecentRows([
    card(1, '2026-11-16T00:12:00Z'),
    card(2, null),
    card(3, '2026-11-17T05:20:00Z'),
    card(4, '2026-11-17T04:47:00Z'),
    card(5, '2026-11-15T00:00:00Z'),
    card(6, '2026-11-14T00:00:00Z'),
  ]);
  check(`최대 ${HOME_RECENT_LIMIT}건`, rows.length === HOME_RECENT_LIMIT);
  check('순서 3 · 4 · 1 · 5', rows.map((r) => r.jobId).join() === '3,4,1,5', rows.map((r) => r.jobId).join());
  check('상태는 모두 완료', rows.every((r) => r.statusLabel === '완료'));
  check('null 상품명·브랜드명은 빈 문자열', toHomeRecentRows([card(9, null, { productName: null, brandName: null })])[0].productName === '');
  check('0건 → 빈 배열', toHomeRecentRows([]).length === 0);
}

console.log('\n[4] formatRecentChangedAt — 「YYYY.MM.DD  HH:mm」(로컬 시각, 공백 2칸)');
{
  const d = new Date(2026, 10, 17, 14, 20);
  check('형식', formatRecentChangedAt(d.toISOString()) === '2026.11.17  14:20', formatRecentChangedAt(d.toISOString()));
  check('null → null', formatRecentChangedAt(null) === null);
  check('파싱 불가 → null', formatRecentChangedAt('x') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
