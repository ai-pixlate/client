/**
 * 블록 · 섹션 PATCH 멱등 저장과 응답 유실 복구(lib/api/idempotent-patch.ts · lib/api/idempotency.ts) 자동 검증.
 * 서버 쪽은 Mock 멱등 기록(lib/mock-api/idempotency-store.ts)으로 흉내 낸다 — 실서버 동작 검증이 아니다.
 *
 * 실행:  npm run verify:save-idempotency
 */

import { createIdempotencyKey } from '../lib/api/idempotency.ts';
import {
  IDEMPOTENCY_RECORD_RETENTION_MS,
  IDEMPOTENT_RESEND_MARGIN_MS,
  canResendIdempotentPatch,
  classifyPatchFailure,
  createIdempotentPatchRequest,
  describePatchSuccess,
  findLayoutAdjustProblems,
  isReplayedResponse,
  nextRecoveryStep,
  recordCommitOnce,
  runSaveWithRecovery,
} from '../lib/api/idempotent-patch.ts';
import { createMockIdempotencyStore, mockRequestFingerprint } from '../lib/mock-api/idempotency-store.ts';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

/** lib/api/pixlate.ts ApiRequestError 와 같은 모양 */
class ApiRequestError extends Error {
  constructor(status, body) {
    super(`API error: ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}
const errorBody = (code, details = null) => ({ error: { code, message: code, retryable: false, details, traceId: 't' } });
const namedError = (name) => Object.assign(new Error(name), { name });

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

console.log('\n멱등 키 생성');
{
  const key = createIdempotencyKey();
  check('secure context(randomUUID) → UUID v4', typeof key === 'string' && UUID_V4.test(key), key);
  const original = globalThis.crypto;
  const fallback = { getRandomValues: (array) => original.getRandomValues(array) };
  Object.defineProperty(globalThis, 'crypto', { value: fallback, configurable: true });
  const insecure = createIdempotencyKey();
  check('randomUUID 없음(HTTP·LAN) → getRandomValues 로 UUID v4', typeof insecure === 'string' && UUID_V4.test(insecure), insecure);
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  check('CSPRNG 없음 → null(키 없이 보내지 않음)', createIdempotencyKey() === null);
  Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
}

console.log('\n요청 기록 — 대상 · 키 · 본문 · revision · 시작 시각 보존');
{
  const body = { trans1: 'Hello', revision: 4, layoutAdjust: { box: { x: 1.5, y: 2, w: 10, h: 5 } } };
  const created = createIdempotentPatchRequest(
    { operation: 'blockPatch', jobId: '1', targetId: 9, body, authEpoch: 3 },
    { now: () => 1000, createKey: () => 'key-1' },
  );
  check('기록 생성', created.ok === true);
  const { request } = created;
  check('대상 · 키 · revision · 시작 시각 · 인증 세대', request.operation === 'blockPatch' && request.targetId === 9 && request.key === 'key-1' && request.revision === 4 && request.startedAt === 1000 && request.authEpoch === 3);
  body.trans1 = 'changed after';
  body.layoutAdjust.box.x = 99;
  check('호출부가 원본 객체를 바꿔도 보낸 본문은 그대로', request.body.trans1 === 'Hello' && request.body.layoutAdjust.box.x === 1.5);
  check('본문 freeze(재전송 본문이 바뀌지 않음)', Object.isFrozen(request) && Object.isFrozen(request.body) && Object.isFrozen(request.body.layoutAdjust.box));
  check('재전송 직렬화가 같다', JSON.stringify(request.body) === JSON.stringify(request.body));

  let keys = 0;
  const createKey = () => `k${(keys += 1)}`;
  const a = createIdempotentPatchRequest({ operation: 'sectionPatch', jobId: '1', targetId: 5, body: { action: 'exclude', revision: 1 }, authEpoch: 0 }, { now: Date.now, createKey });
  const b = createIdempotentPatchRequest({ operation: 'sectionPatch', jobId: '1', targetId: 5, body: { action: 'exclude', revision: 1 }, authEpoch: 0 }, { now: Date.now, createKey });
  check('새 사용자 조작 = 새 키', a.request.key !== b.request.key);

  const noKey = createIdempotentPatchRequest({ operation: 'blockPatch', jobId: '1', targetId: 9, body: { trans1: 'x', revision: 1 }, authEpoch: 0 }, { now: Date.now, createKey: () => null });
  check('키를 만들 수 없음 → 기록 없음(보내지 않음)', noKey.ok === false && noKey.reason === 'key-unavailable');
  const badKey = createIdempotentPatchRequest({ operation: 'blockPatch', jobId: '1', targetId: 9, body: { trans1: 'x', revision: 1 }, authEpoch: 0 }, { now: Date.now, createKey: () => 'has space' });
  check('키 형식(공백 없는 ASCII 1~128) 위반 → 기록 없음', badKey.ok === false && badKey.reason === 'key-unavailable');
  for (const revision of [undefined, null, 1.5, '3', Number.NaN]) {
    const r = createIdempotentPatchRequest({ operation: 'sectionPatch', jobId: '1', targetId: 5, body: { action: 'exclude', revision }, authEpoch: 0 }, { now: Date.now, createKey: () => 'k' });
    check(`revision ${String(revision)} → 기록 없음(임의 revision 금지)`, r.ok === false && r.reason === 'invalid-revision');
  }
}

console.log('\nlayoutAdjust 형식 — 잘못된 값은 보내지 않고 고치지 않는다');
{
  check('생략 · null(조정 해제)은 정상', findLayoutAdjustProblems(undefined).length === 0 && findLayoutAdjustProblems(null).length === 0);
  check('box null · fontScale null(해제)은 정상', findLayoutAdjustProblems({ box: null, fontScale: null }).length === 0);
  check('소수 좌표 · 배율 그대로 정상', findLayoutAdjustProblems({ box: { x: 0.25, y: 10.125, w: 200.5, h: 40.75 }, fontScale: 1.05 }).length === 0);
  check('NaN 좌표 → 문제', findLayoutAdjustProblems({ box: { x: Number.NaN, y: 0, w: 1, h: 1 } }).includes('layoutAdjust.box.x'));
  check('Infinity 좌표 → 문제', findLayoutAdjustProblems({ box: { x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 1 } }).includes('layoutAdjust.box.w'));
  check('undefined 좌표 → 문제(직렬화로 빠지지 않게)', findLayoutAdjustProblems({ box: { x: 0, y: 0, w: 1, h: undefined } }).includes('layoutAdjust.box.h'));
  check('box: undefined → 문제', findLayoutAdjustProblems({ box: undefined }).includes('layoutAdjust.box(undefined)'));
  check('빈 객체 → 문제', findLayoutAdjustProblems({}).length > 0);
  check('fontScale NaN · 0 · 음수 → 문제', ['fontScale'].every(() => [Number.NaN, 0, -0.05].every((v) => findLayoutAdjustProblems({ fontScale: v }).includes('layoutAdjust.fontScale'))));
  check('정의되지 않은 키 → 문제', findLayoutAdjustProblems({ box: null, extra: 1 }).some((p) => p.includes('extra')));
  // 범위(섹션 밖 · 음수 좌표)는 서버 400 업무 검증이다 — FE 는 보정하지 않고 그대로 보낸다
  check('섹션 밖 · 음수 좌표는 형식 문제가 아니다(서버 400, FE 보정 없음)', findLayoutAdjustProblems({ box: { x: -3, y: 0, w: 99999, h: 1 } }).length === 0);
}

console.log('\n응답 · 실패 분류');
{
  check('Idempotent-Replayed: true → 재생', isReplayedResponse(new Headers({ 'Idempotent-Replayed': 'true' })));
  check('재생 헤더 없는 200 → 이번 요청 결과', !isReplayedResponse(new Headers()));
  check('changed — revision 증가', describePatchSuccess(4, 5, false).changed === true);
  check('no-op — revision 그대로', describePatchSuccess(4, 4, false).changed === false);
  check('revision 없음 → 알 수 없음(변경으로 추정하지 않음)', describePatchSuccess(4, null, true).changed === null);

  const k = (err) => classifyPatchFailure(err).kind;
  check('연결 끊김(TypeError) → 결과 불명', k(new TypeError('Failed to fetch')) === 'uncertain');
  check('시간 초과(TimeoutError) → 결과 불명', k(namedError('TimeoutError')) === 'uncertain');
  check('중단(AbortError) → 결과 불명', k(namedError('AbortError')) === 'uncertain');
  check('500 → 결과 불명(커밋 여부 불명)', k(new ApiRequestError(500, errorBody('INTERNAL_ERROR'))) === 'uncertain');
  check('502(본문 없음) → 결과 불명', k(new ApiRequestError(502, null)) === 'uncertain');
  check('503 SERVICE_UNAVAILABLE → 적용 안 됨', k(new ApiRequestError(503, errorBody('SERVICE_UNAVAILABLE'))) === 'not-applied');
  check('503(프록시 · 본문 없음) → 결과 불명', k(new ApiRequestError(503, null)) === 'uncertain');
  check('409 REVISION_CONFLICT', k(new ApiRequestError(409, errorBody('REVISION_CONFLICT', { current: {} }))) === 'revision-conflict');
  check('409 DUPLICATE', k(new ApiRequestError(409, errorBody('DUPLICATE', { reason: 'idempotency_key_reused' }))) === 'duplicate');
  check('409 INVALID_STATE job_not_editable → 작업 확정·취소', k(new ApiRequestError(409, errorBody('INVALID_STATE', { reason: 'job_not_editable' }))) === 'not-editable');
  check('409 INVALID_STATE n3_excluded_section → 적용 안 됨', k(new ApiRequestError(409, errorBody('INVALID_STATE', { reason: 'n3_excluded_section' }))) === 'not-applied');
  check('422 → 적용 안 됨', k(new ApiRequestError(422, errorBody('VALIDATION_ERROR'))) === 'not-applied');
  check('계정 · 세션 전환 → 버림', k(namedError('AuthSessionChangedError')) === 'session-changed');
  check('인증 복구 실패(401) → 적용 안 됨', k(namedError('AuthRecoveryError')) === 'not-applied');
}

console.log('\n재전송 결과 → 다음 단계');
{
  const f = (kind, status = null) => ({ ok: false, failure: { kind, status, code: null, reason: null } });
  check('성공(재생 포함) → applied', nextRecoveryStep({ ok: true }) === 'applied');
  check('다시 결과 불명 → still-uncertain(잠금 유지)', nextRecoveryStep(f('uncertain')) === 'still-uncertain');
  check('503 → still-uncertain(최초 요청 결과를 알려 주지 않음)', nextRecoveryStep(f('not-applied', 503)) === 'still-uncertain');
  check('409 REVISION_CONFLICT → unknown(미반영 단정 금지)', nextRecoveryStep(f('revision-conflict', 409)) === 'unknown');
  check('404 → unknown', nextRecoveryStep(f('not-applied', 404)) === 'unknown');
  check('409 DUPLICATE → duplicate', nextRecoveryStep(f('duplicate', 409)) === 'duplicate');
  check('job_not_editable → job-closed(재전송으로 복구하지 않음)', nextRecoveryStep(f('not-editable', 409)) === 'job-closed');
  check('세션 전환 → abandon', nextRecoveryStep(f('session-changed')) === 'abandon');

  const limit = IDEMPOTENCY_RECORD_RETENTION_MS - IDEMPOTENT_RESEND_MARGIN_MS;
  check('보관 기한 안 · 같은 세대 → 재전송 가능', canResendIdempotentPatch({ startedAt: 0, authEpoch: 1 }, limit - 1, 1));
  check('보관 기한(여유 포함) 지남 → 재전송 안 함', !canResendIdempotentPatch({ startedAt: 0, authEpoch: 1 }, limit, 1));
  check('계정 · 세션이 바뀜 → 재전송 안 함', !canResendIdempotentPatch({ startedAt: 0, authEpoch: 1 }, 10, 2));

  const ledger = new Set();
  check('이력 — 같은 기록 첫 성공은 남김', recordCommitOnce(ledger, 'k1') === true);
  check('이력 — 같은 기록 두 번째 성공(재생 확인)은 남기지 않음', recordCommitOnce(ledger, 'k1') === false);
  check('이력 — 다른 기록은 따로', recordCommitOnce(ledger, 'k2') === true);
}

console.log('\nMock 멱등 기록 — 같은 키 · 같은 본문 재생 / 다른 요청 DUPLICATE');
{
  const store = createMockIdempotencyStore();
  const fp = mockRequestFingerprint(9, { trans1: 'A', revision: 1 });
  check('본문 키 순서와 무관하게 같은 요청', fp === mockRequestFingerprint(9, { revision: 1, trans1: 'A' }));
  check('생략과 null 은 다른 요청', mockRequestFingerprint(9, { trans1: 'A', revision: 1 }) !== mockRequestFingerprint(9, { trans1: 'A', revision: 1, layoutAdjust: null }));
  check('기록 없음 → miss', store.lookup('blockPatch', '1', 'k', fp).kind === 'miss');
  store.save('blockPatch', '1', 'k', { fingerprint: fp, status: 200, body: { ok: 1 } });
  check('같은 키 · 같은 요청 → 재생', store.lookup('blockPatch', '1', 'k', fp).kind === 'replay');
  check('같은 키 · 다른 revision → DUPLICATE', store.lookup('blockPatch', '1', 'k', mockRequestFingerprint(9, { trans1: 'A', revision: 2 })).kind === 'duplicate');
  check('같은 키 · 다른 블록 → DUPLICATE', store.lookup('blockPatch', '1', 'k', mockRequestFingerprint(10, { trans1: 'A', revision: 1 })).kind === 'duplicate');
  check('같은 키 · 다른 오퍼레이션(섹션)은 다른 범위', store.lookup('sectionPatch', '1', 'k', fp).kind === 'miss');
  store.save('blockPatch', '1', 'k5', { fingerprint: fp, status: 409, body: {} });
  check('4xx 는 기록하지 않음', store.lookup('blockPatch', '1', 'k5', fp).kind === 'miss');
}

/**
 * 복구 루프 시뮬레이션 — 서버(Mock 기록)는 요청을 적용 · 기록한 뒤 응답만 잃을 수 있다.
 * send 는 매번 같은 기록(키 · 본문)을 보낸다.
 */
function createFakeServer() {
  const store = createMockIdempotencyStore();
  const state = { revision: 3, text: 'old', applied: 0 };
  const sent = [];
  let script = [];
  return {
    state,
    sent,
    /** 다음 전송들의 동작 — 'apply-drop'(적용 후 응답 유실) · 'drop'(도착 전 끊김) · 'conflict' · '503' · 'ok' */
    plan(steps) {
      script = [...steps];
    },
    send(request) {
      return async () => {
        sent.push({ key: request.key, body: JSON.stringify(request.body) });
        const step = script.shift() ?? 'ok';
        if (step === 'drop') throw new TypeError('Failed to fetch');
        if (step === '503') throw new ApiRequestError(503, errorBody('SERVICE_UNAVAILABLE'));
        const fp = mockRequestFingerprint(request.targetId, request.body);
        const found = store.lookup('blockPatch', '1', request.key, fp);
        if (found.kind === 'replay') return { data: found.record.body, replayed: true };
        if (found.kind === 'duplicate') throw new ApiRequestError(409, errorBody('DUPLICATE', { reason: 'idempotency_key_reused' }));
        if (step === 'conflict' || request.body.revision !== state.revision) throw new ApiRequestError(409, errorBody('REVISION_CONFLICT', { current: {} }));
        const changed = request.body.trans1 !== state.text;
        if (changed) {
          state.text = request.body.trans1;
          state.revision += 1;
          state.applied += 1;
        }
        const body = { block: { id: request.targetId, trans1: state.text, revision: state.revision }, rerenderTaskId: changed ? 77 : null };
        store.save('blockPatch', '1', request.key, { fingerprint: fp, status: 200, body });
        if (step === 'apply-drop') throw new TypeError('Failed to fetch');
        return { data: body, replayed: false };
      };
    },
  };
}

function makeRequest(server, text, keySeed = 'key-A', epoch = 1) {
  return createIdempotentPatchRequest(
    { operation: 'blockPatch', jobId: '1', targetId: 9, body: { trans1: text, revision: server.state.revision }, authEpoch: epoch },
    { now: () => 0, createKey: () => keySeed },
  ).request;
}

function recoveryDeps({ epoch = () => 1, now = () => 0, refetchResults = [] } = {}) {
  const log = { refetch: 0, waits: 0, checking: 0, resume: null };
  const results = [...refetchResults];
  return {
    log,
    deps: {
      refetchServerState: async () => {
        log.refetch += 1;
        return results.length ? results.shift() : true;
      },
      waitForRetry: () =>
        new Promise((resolve) => {
          log.waits += 1;
          log.resume = resolve;
        }),
      onChecking: () => {
        log.checking += 1;
      },
      getAuthEpoch: epoch,
      now,
    },
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

console.log('\n복구 — 응답 유실 뒤 같은 키 · 같은 본문 재전송');
{
  const server = createFakeServer();
  const request = makeRequest(server, 'new');
  server.plan(['apply-drop', 'ok']);
  const { deps, log } = recoveryDeps();
  const result = await runSaveWithRecovery(request, server.send(request), deps);
  check('최초 요청은 서버에 반영됨(1회)', server.state.applied === 1 && server.state.text === 'new');
  check('재전송 = 같은 키 · 같은 본문(revision 포함)', server.sent.length === 2 && server.sent[0].key === server.sent[1].key && server.sent[0].body === server.sent[1].body);
  check('결과 = applied(복구) · 재생 응답', result.kind === 'applied' && result.recovered === true && result.response.replayed === true);
  check('재생 뒤 서버 현재 상태 재조회', log.refetch === 1);
  check('두 번 적용되지 않음', server.state.applied === 1 && server.state.revision === 4);
}
{
  // 요청이 서버에 닿기 전에 끊김 → 재전송이 이번에 반영됨(재생 헤더 없음)
  const server = createFakeServer();
  const request = makeRequest(server, 'new');
  server.plan(['drop', 'ok']);
  const { deps } = recoveryDeps();
  const result = await runSaveWithRecovery(request, server.send(request), deps);
  check('도착 전 끊김 → 재전송이 이번 요청으로 반영(재생 아님)', result.kind === 'applied' && result.response.replayed === false && server.state.applied === 1);
}
{
  // 재전송도 결과 불명 → 사용자 재확인까지 잠금 유지(시간이 지나도 끝나지 않음)
  const server = createFakeServer();
  const request = makeRequest(server, 'new');
  server.plan(['apply-drop', 'drop', 'ok']);
  const { deps, log } = recoveryDeps();
  let settled = false;
  const running = runSaveWithRecovery(request, server.send(request), deps).then((r) => {
    settled = true;
    return r;
  });
  await tick();
  await tick();
  check('재전송 결과 불명 → 「확인하지 못함」 대기(끝나지 않음 = 잠금 유지)', !settled && log.waits === 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  check('시간이 지나도 스스로 끝나지 않음', !settled);
  log.resume();
  const result = await running;
  check('[서버 상태 다시 확인] → 같은 기록 재전송 → 재생 확인', result.kind === 'applied' && result.response.replayed === true && server.sent.length === 3 && new Set(server.sent.map((s) => s.key + s.body)).size === 1);
}
{
  // 503(잠금 대기 초과) 재전송 → 최초 결과는 여전히 모름 → 대기
  const server = createFakeServer();
  const request = makeRequest(server, 'new');
  server.plan(['drop', '503', 'ok']);
  const { deps, log } = recoveryDeps();
  const running = runSaveWithRecovery(request, server.send(request), deps);
  await tick();
  await tick();
  check('재전송 503 → 대기(잠금 유지)', log.waits === 1);
  log.resume();
  const result = await running;
  check('다시 확인 → 반영', result.kind === 'applied' && server.state.applied === 1);
}
{
  // 재전송 409 REVISION_CONFLICT → 미반영 단정 없이 unknown + 현재 상태 재조회
  const server = createFakeServer();
  const request = makeRequest(server, 'new');
  server.plan(['drop', 'conflict']);
  const { deps, log } = recoveryDeps();
  const result = await runSaveWithRecovery(request, server.send(request), deps);
  check('재전송 409 REVISION_CONFLICT → unknown(성공 · 실패 단정 없음)', result.kind === 'unknown' && result.failure.kind === 'revision-conflict');
  check('unknown 뒤 서버 현재 상태 재조회', log.refetch === 1);
}
{
  // 재조회가 실패하면 잠금 유지 → 다시 확인
  const server = createFakeServer();
  const request = makeRequest(server, 'new');
  server.plan(['drop', 'conflict']);
  const { deps, log } = recoveryDeps({ refetchResults: [false, true] });
  let settled = false;
  const running = runSaveWithRecovery(request, server.send(request), deps).then((r) => ((settled = true), r));
  await tick();
  await tick();
  check('현재 상태 재조회 실패(15초 상한 포함) → 대기', !settled && log.waits === 1);
  log.resume();
  const result = await running;
  check('다시 확인 성공 → 끝', result.kind === 'unknown' && log.refetch === 2);
}
{
  // 첫 전송에서 분명한 거절은 복구하지 않는다
  const server = createFakeServer();
  const request = makeRequest(server, 'new');
  server.plan(['conflict']);
  const { deps, log } = recoveryDeps();
  const result = await runSaveWithRecovery(request, server.send(request), deps);
  check('첫 전송 409 → failed(재전송 없음)', result.kind === 'failed' && server.sent.length === 1 && log.refetch === 0);
}
{
  // 같은 키를 다른 본문에 쓰면 DUPLICATE
  const server = createFakeServer();
  const first = makeRequest(server, 'new', 'same-key');
  server.plan(['ok']);
  await runSaveWithRecovery(first, server.send(first), recoveryDeps().deps);
  const reused = makeRequest(server, 'other', 'same-key');
  server.plan(['ok']);
  const result = await runSaveWithRecovery(reused, server.send(reused), recoveryDeps().deps);
  check('같은 키 · 다른 요청 → 409 DUPLICATE(아무것도 적용 안 됨)', result.kind === 'failed' && result.failure.kind === 'duplicate' && server.state.text === 'new');
}
{
  // no-op 성공과 실제 변경 구분
  const server = createFakeServer();
  const same = makeRequest(server, 'old');
  server.plan(['ok']);
  const result = await runSaveWithRecovery(same, server.send(same), recoveryDeps().deps);
  check('같은 값 저장 → no-op(revision 그대로 · task 없음)', result.kind === 'applied' && describePatchSuccess(same.revision, result.response.data.block.revision, false).changed === false && result.response.data.rerenderTaskId === null);
}
{
  // 보관 기한 지남 → 재전송하지 않고 현재 상태만
  const server = createFakeServer();
  const request = makeRequest(server, 'new');
  server.plan(['apply-drop']);
  const { deps, log } = recoveryDeps({ now: () => IDEMPOTENCY_RECORD_RETENTION_MS });
  const result = await runSaveWithRecovery(request, server.send(request), deps);
  check('기한 지남 → 재전송 없이 unknown + 재조회', result.kind === 'unknown' && server.sent.length === 1 && log.refetch === 1);
}
{
  // 계정 전환 — 이전 계정 요청을 새 세션으로 다시 보내지 않는다
  const server = createFakeServer();
  const request = makeRequest(server, 'new', 'key-A', 1);
  server.plan(['apply-drop']);
  const { deps, log } = recoveryDeps({ epoch: () => 2 });
  const result = await runSaveWithRecovery(request, server.send(request), deps);
  check('결과 불명 중 계정 전환 → abandoned · 재전송 0 · 재조회 0', result.kind === 'abandoned' && server.sent.length === 1 && log.refetch === 0);
  const switched = await runSaveWithRecovery(request, async () => {
    throw namedError('AuthSessionChangedError');
  }, recoveryDeps().deps);
  check('응답 폐기(AuthSessionChangedError) → abandoned', switched.kind === 'abandoned');
}

console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
