/**
 * N2·N4 [중단](API-JOB-07) 결과 판단과 기존 작업 N1 복원 초기값 — 순수 로직 자동 검증.
 *
 * lib/processing/abort-outcome.ts · app/jobs/new/_lib/n1-restore.ts 는 React 도 브라우저 API 도 쓰지 않아 Node 에서 그대로 불러온다.
 *
 * 실행:  npm run verify:processing-abort
 */

import {
  ABORT_NOTICE,
  ABORT_RETURN_STEP,
  abortRequestResultOf,
  resolveAbortOutcome,
} from '../lib/processing/abort-outcome.ts';
import { buildRestoredN1, parseRestoreJobId } from '../app/jobs/new/_lib/n1-restore.ts';

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

const status = (currentStep, isCancelled = false) => ({ kind: 'status', currentStep, isCancelled });

console.log('복귀 단계(계약)');
check('N2 → N1', ABORT_RETURN_STEP.N2 === 'N1');
check('N4 → N3', ABORT_RETURN_STEP.N4 === 'N3');

console.log('\n성공 판단은 재조회 currentStep 으로만');
check('200 + 재조회 N3 → returned', resolveAbortOutcome('N4', 'ok', status('N3')).kind === 'returned');
check('200 + 재조회 N1 → returned', resolveAbortOutcome('N2', 'ok', status('N1')).kind === 'returned');
{
  const o = resolveAbortOutcome('N4', 'ok', status('N4'));
  check('200 이어도 재조회가 N4 면 복귀로 보지 않는다', o.kind === 'stayed' && o.notice === ABORT_NOTICE.acceptedButStayed, JSON.stringify(o));
}
check('N2 중단인데 재조회가 N3 → 다른 단계(서버 상태 그대로)', resolveAbortOutcome('N2', 'ok', status('N3')).kind === 'server-moved');

console.log('\n409·응답 유실은 실패로 단정하지 않는다');
check('409 + 재조회 N3 → returned(이미 복귀)', resolveAbortOutcome('N4', 'invalid-state', status('N3')).kind === 'returned');
check('응답 유실 + 재조회 N1 → returned', resolveAbortOutcome('N2', 'unknown', status('N1')).kind === 'returned');
{
  const o = resolveAbortOutcome('N4', 'invalid-state', status('N4'));
  check('409 + 재조회 N4 → stayed · 상태 안내', o.kind === 'stayed' && o.notice === ABORT_NOTICE.invalidState, JSON.stringify(o));
}
{
  const o = resolveAbortOutcome('N4', 'unknown', status('N4'));
  check('응답 유실 + 재조회 N4 → stayed · 결과 미확인 안내', o.kind === 'stayed' && o.notice === ABORT_NOTICE.unknown, JSON.stringify(o));
}
{
  const o = resolveAbortOutcome('N2', 'server', status('N2'));
  check('5xx + 재조회 N2 → stayed · 실패 안내', o.kind === 'stayed' && o.notice === ABORT_NOTICE.server, JSON.stringify(o));
}
{
  const o = resolveAbortOutcome('N4', 'auth', status('N4'));
  check('인증 복구 실패 + 재조회 N4 → stayed · 로그인 안내', o.kind === 'stayed' && o.notice === ABORT_NOTICE.auth, JSON.stringify(o));
}
check('409 + 재조회 N5(이미 다음 단계) → server-moved', resolveAbortOutcome('N4', 'invalid-state', status('N5')).kind === 'server-moved');

console.log('\n재조회 실패·취소·없는 작업');
{
  const o = resolveAbortOutcome('N4', 'ok', { kind: 'failed' });
  check('200 + 재조회 실패 → unverified(복귀로 추정하지 않는다)', o.kind === 'unverified' && o.notice === ABORT_NOTICE.unverified, JSON.stringify(o));
}
check('재조회 404 → server-moved(없는 작업 화면)', resolveAbortOutcome('N4', 'not-found', { kind: 'not-found' }).kind === 'server-moved');
check('재조회가 취소된 작업 → server-moved(취소 안내)', resolveAbortOutcome('N4', 'ok', status('N3', true)).kind === 'server-moved');
check('재조회 currentStep 없음 → stayed(이동으로 보지 않는다)', resolveAbortOutcome('N4', 'ok', status(undefined)).kind === 'stayed');

console.log('\nHTTP status → 요청 결과');
check('204 → ok', abortRequestResultOf(204) === 'ok');
check('409 → invalid-state', abortRequestResultOf(409) === 'invalid-state');
check('404 → not-found', abortRequestResultOf(404) === 'not-found');
check('500 → server', abortRequestResultOf(500) === 'server');
check('응답 없음 → unknown', abortRequestResultOf(null) === 'unknown');

console.log('\nN1 복원 초기값 — 서버 값만 쓴다');
const options = { countries: ['US', 'JP'], languages: ['en', 'ja'] };
{
  const restored = buildRestoredN1(
    '42',
    {
      id: 42,
      brandId: 7,
      productName: '선크림',
      productCode: null,
      targetCountry: 'US',
      targetLanguage: 'en',
      regulatoryClass: 'otc',
      categoryId: 13,
      keywords: ['spf'],
    },
    [
      { id: 302, uploadOrder: 2, fileUrl: 'https://s3/b' },
      { id: 301, uploadOrder: 1, fileUrl: 'https://s3/a' },
      { uploadOrder: 3, fileUrl: 'https://s3/no-id' },
    ],
    options,
  );
  check('작업 id 유지', restored.jobId === '42');
  check('브랜드는 작업의 brandId', restored.brandId === '7');
  check('상품명·코드(null → 빈 값)', restored.productName === '선크림' && restored.productCode === '');
  check('국가·언어·규제 분류·카테고리·키워드', restored.targetCountry === 'US' && restored.targetLanguage === 'en' && restored.regulatoryClass === 'otc' && restored.categoryId === 13 && restored.keywords[0] === 'spf');
  check('원본은 uploadOrder 순 · id 없는 항목 제외', restored.sourceImages.map((i) => i.id).join(',') === '301,302', JSON.stringify(restored.sourceImages));
}
{
  const restored = buildRestoredN1('9', { regulatoryClass: 'medical', targetCountry: 'KR', targetLanguage: 'ko', keywords: undefined }, [], options);
  check('선택지에 없는 국가·언어·규제 분류는 비운다', restored.targetCountry === '' && restored.targetLanguage === '' && restored.regulatoryClass === '');
  check('없는 brandId·categoryId 는 null · 키워드 빈 배열', restored.brandId === null && restored.categoryId === null && restored.keywords.length === 0);
}
{
  const original = buildRestoredN1('1', { specType: 'original' }, [], options);
  const site = buildRestoredN1('1', { specType: 'site' }, [], options);
  check('specType=original → 원본 규격 탭', original.sizeSelection.tab === 'original');
  check('specType=site → 사이즈 변경 탭 · 판매처 방식(세부 규격은 화면 기본값)', site.sizeSelection.tab === 'change' && site.sizeSelection.mode === 'site');
}
check('주소 jobId 공백 → 복원 안 함', parseRestoreJobId('  ') === null && parseRestoreJobId(null) === null);
check('주소 jobId 값 → 그대로', parseRestoreJobId(' 12 ') === '12');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
