/**
 * 인증 세션 FE 선행 구현 검증 — refresh single-flight·계정 확인·탭 사이 알림·소셜 시작/완료·로그아웃.
 *
 * lib/auth/* 는 React·Next 를 쓰지 않아 Node 에서 실제 함수를 그대로 import 한다. 서버는 fetch 대역, 탭 사이 채널은
 * BroadcastChannel 대역(같은 프로세스 안 여러 「탭」)으로 바꾼다. 실제 서버·브라우저 인증을 검증하지 않는다.
 *
 * 실행: npm run verify:auth-session
 */

import { fetchWithSessionRecovery, AuthSessionChangedError } from '../lib/auth/authorized-request.ts';
import { AUTH_REFRESH_MAX_ATTEMPTS, AUTH_ORIGINAL_REQUEST_MAX_RETRIES, AUTH_REFRESH_EVENT_WAIT_MS, AUTH_REFRESH_LOCK_WAIT_MS } from '../lib/auth/constants.ts';
import { createAuthChannel, toWireEvent } from '../lib/auth/cross-tab.ts';
import { logout, resumePendingLogout, retryPendingLogout } from '../lib/auth/logout.ts';
import { isLogoutPending, markLogoutPending, setLogoutPendingStorageForTest } from '../lib/auth/logout-pending.ts';
import { configureAuthRuntimeForTest, handleAuthTabEvent, recoverSession } from '../lib/auth/runtime.ts';
import { getAccessToken, getAuthSnapshot, resetAuthStoreForTest, setAuthenticated } from '../lib/auth/session-store.ts';
import { completeSocialLogin, resetSocialLoginForTest, startSocialLogin } from '../lib/auth/social-login.ts';
import { AuthLockTimeoutError, createAuthLock } from '../lib/auth/tab-lock.ts';
import { isSessionRestoreSuppressed, readCallbackState, setCallbackStateStorageForTest } from '../lib/auth/callback-state.ts';
import { getAuthMode, isAccountLogoutEnabled, isLocalAuthTestMode, isLogoutPendingRetryEnabled, isSocialLoginEnabled } from '../lib/auth/capability.ts';

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SELLER_1 = { id: 1, email: 'a@pixlate.mock' };
const SELLER_2 = { id: 2, email: 'b@pixlate.mock' };

// ── 대역: 탭 사이 채널 ─────────────────────────
/** 모든 탭이 보낸 메시지를 기록한다 — 토큰이 섞이지 않았는지 마지막에 확인한다 */
const wireLog = [];
function createBus() {
  const members = new Set();
  return {
    channel() {
      const listeners = new Set();
      const member = {
        postMessage(message) {
          wireLog.push(JSON.stringify(message));
          for (const other of members) if (other !== member) other.deliver(structuredClone(message));
        },
        addEventListener(_type, listener) {
          listeners.add(listener);
        },
        removeEventListener(_type, listener) {
          listeners.delete(listener);
        },
        close() {
          members.delete(member);
        },
        deliver(data) {
          queueMicrotask(() => listeners.forEach((listener) => listener({ data })));
        },
      };
      members.add(member);
      return member;
    },
  };
}

// ── 대역: 서버(fetch) ──────────────────────────
function json(status, body) {
  return new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function authError(status, code, reason) {
  return json(status, { error: { code, message: 'x', retryable: status === 503, details: reason ? { reason } : null, traceId: 't' } });
}

/** routes[key] = 응답 함수 배열(요청마다 앞에서 하나씩, 마지막 것은 반복) */
function createServer(routes) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(routes).map(([key, list]) => [key, [...list]]));
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    const headers = new Headers(init.headers);
    calls.push({ key, headers, body: init.body ?? null, credentials: init.credentials });
    const queue = queues[key];
    if (!queue) return json(404, { error: { code: 'NOT_FOUND' } });
    const handler = queue.length > 1 ? queue.shift() : queue[0];
    return handler({ headers, body: init.body });
  };
  return {
    calls,
    count: (key) => calls.filter((call) => call.key === key).length,
    last: (key) => calls.filter((call) => call.key === key).at(-1),
  };
}

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
};

/** 한 「탭」 준비 — 상태 초기화 + 채널·잠금·이동 기록 */
function setupTab({ bus = createBus(), path = '/jobs/1', eventWaitMs = 40, lock } = {}) {
  resetAuthStoreForTest();
  resetSocialLoginForTest();
  const storage = memoryStorage();
  setLogoutPendingStorageForTest(storage);
  const callbackStorage = memoryStorage();
  setCallbackStateStorageForTest(callbackStorage);
  const navigations = [];
  let cleared = 0;
  const channel = createAuthChannel(() => bus.channel());
  configureAuthRuntimeForTest({
    hooks: { navigate: (p) => navigations.push(p), currentPath: () => path, clearClientData: () => (cleared += 1) },
    channel,
    lock: lock ?? ((task) => task()),
    recoveryDeps: { eventWaitMs },
  });
  return { bus, channel, navigations, storage, callbackStorage, cleared: () => cleared };
}

async function tabMarkUnconfirmed() {
  const { markCallbackUnconfirmed } = await import('../lib/auth/callback-state.ts');
  markCallbackUnconfirmed();
}

/** 원 요청 대역: 처음 n 번은 401, 그 뒤 200 */
function originalRequest(fail401Times) {
  const state = { sends: 0, auth: [] };
  state.send = async () => {
    state.sends += 1;
    state.auth.push(getAccessToken());
    return state.sends <= fail401Times ? authError(401, 'TOKEN_EXPIRED', null) : json(200, { ok: true });
  };
  return state;
}

const okRefresh = (token, delay = 0) => async () => {
  if (delay) await sleep(delay);
  return json(200, { accessToken: token });
};
const meReturns = (seller) => async () => json(200, seller);

// ── 상수 ──────────────────────────────────────
console.log('\n[상수]');
check('refresh 알림 대기 2초', AUTH_REFRESH_EVENT_WAIT_MS === 2000);
check('잠금 대기 10초', AUTH_REFRESH_LOCK_WAIT_MS === 10000);
check('사건당 refresh 최대 2회', AUTH_REFRESH_MAX_ATTEMPTS === 2);
check('원 요청 재시도 최대 1회', AUTH_ORIGINAL_REQUEST_MAX_RETRIES === 1);

// ── 인증 기능 gate(capability) ───────────────
console.log('\n[capability — 실서버 session 인증 opt-in 스위치]');
{
  const ENV_KEYS = ['NODE_ENV', 'NEXT_PUBLIC_API_MOCKING', 'NEXT_PUBLIC_AUTH_MODE'];
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const withEnv = (env, read) => {
    for (const key of ENV_KEYS) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    try {
      return read();
    } finally {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  };
  const snapshot = () => ({ mode: getAuthMode(), social: isSocialLoginEnabled(), pending: isLogoutPendingRetryEnabled() });
  const same = (a, b) => a.mode === b.mode && a.social === b.social && a.pending === b.pending;
  const SESSION = { mode: 'session', social: true, pending: true };
  const DEV_LOGIN = { mode: 'dev-login', social: false, pending: false };

  const mock = withEnv({ NODE_ENV: 'development', NEXT_PUBLIC_API_MOCKING: 'enabled' }, snapshot);
  check('Mock(MSW) → session·social·logoutPending 재시도 유지', same(mock, SESSION), JSON.stringify(mock));
  const mockProd = withEnv({ NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'enabled' }, snapshot);
  check('Mock(MSW) + production → 기존처럼 session', same(mockProd, SESSION), JSON.stringify(mockProd));
  const devNoSwitch = withEnv({ NODE_ENV: 'development' }, snapshot);
  check('실서버 + next dev + 스위치 없음 → dev-login·social 꺼짐', same(devNoSwitch, DEV_LOGIN), JSON.stringify(devNoSwitch));
  const devOtherValue = withEnv({ NODE_ENV: 'development', NEXT_PUBLIC_AUTH_MODE: 'dev-login' }, snapshot);
  check('실서버 + next dev + 스위치 값이 session 이 아니면 → dev-login', same(devOtherValue, DEV_LOGIN), JSON.stringify(devOtherValue));
  const devSwitch = withEnv({ NODE_ENV: 'development', NEXT_PUBLIC_AUTH_MODE: 'session' }, snapshot);
  check('실서버 + next dev + NEXT_PUBLIC_AUTH_MODE=session → session·social·logoutPending 재시도', same(devSwitch, SESSION), JSON.stringify(devSwitch));
  const prodNoSwitch = withEnv({ NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'disabled' }, snapshot);
  check('production + 실서버 + 스위치 없음 → 기본 dev-login·social 꺼짐', same(prodNoSwitch, DEV_LOGIN), JSON.stringify(prodNoSwitch));
  const prodOtherValue = withEnv({ NODE_ENV: 'production', NEXT_PUBLIC_AUTH_MODE: 'Session' }, snapshot);
  check('production + 스위치 값이 정확히 session 이 아니면 → dev-login', same(prodOtherValue, DEV_LOGIN), JSON.stringify(prodOtherValue));
  const prodSwitch = withEnv({ NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'disabled', NEXT_PUBLIC_AUTH_MODE: 'session' }, snapshot);
  check('production + 실서버 + NEXT_PUBLIC_AUTH_MODE=session → session·social·logoutPending 재시도(명시적 opt-in)', same(prodSwitch, SESSION), JSON.stringify(prodSwitch));
  const prodMockSwitch = withEnv({ NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'enabled', NEXT_PUBLIC_AUTH_MODE: 'session' }, snapshot);
  check('production + Mock + session 스위치 → Mock 정책과 충돌 없이 session', same(prodMockSwitch, SESSION), JSON.stringify(prodMockSwitch));
  const testSwitch = withEnv({ NODE_ENV: 'test', NEXT_PUBLIC_AUTH_MODE: 'session' }, snapshot);
  check('test 환경 + NEXT_PUBLIC_AUTH_MODE=session → NODE_ENV 와 관계없이 session', same(testSwitch, SESSION), JSON.stringify(testSwitch));

  // 로컬 실서버 인증 시험용 임시 로그아웃 진입점 노출 기준 — next dev + session 스위치 + Mock 꺼짐에서만
  const testMode = (env) => withEnv(env, isLocalAuthTestMode);
  check('임시 로그아웃 진입점: next dev + session + Mock 꺼짐 → 보임', testMode({ NODE_ENV: 'development', NEXT_PUBLIC_AUTH_MODE: 'session' }) === true);
  check('임시 로그아웃 진입점: next dev + session + Mock 켜짐 → 숨김', testMode({ NODE_ENV: 'development', NEXT_PUBLIC_AUTH_MODE: 'session', NEXT_PUBLIC_API_MOCKING: 'enabled' }) === false);
  check('임시 로그아웃 진입점: 일반 Mock 개발 → 숨김', testMode({ NODE_ENV: 'development', NEXT_PUBLIC_API_MOCKING: 'enabled' }) === false);
  check('임시 로그아웃 진입점: 스위치 없는 실서버 dev → 숨김', testMode({ NODE_ENV: 'development' }) === false);
  check('임시 로그아웃 진입점: production + session + Mock 꺼짐 → 숨김', testMode({ NODE_ENV: 'production', NEXT_PUBLIC_AUTH_MODE: 'session' }) === false);
  check('임시 로그아웃 진입점: test + session → 숨김', testMode({ NODE_ENV: 'test', NEXT_PUBLIC_AUTH_MODE: 'session' }) === false);
  check('임시 로그아웃 진입점: production + 스위치 없음 → 숨김', testMode({ NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'disabled' }) === false);
  check('임시 로그아웃 진입점: production + Mock → 숨김', testMode({ NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'enabled', NEXT_PUBLIC_AUTH_MODE: 'session' }) === false);

  // 세션 사용자용 정식 로그아웃 버튼 노출 기준 — session 모드이고 로컬 시험 모드가 아닐 때. 임시 버튼과 동시에 보이지 않는다
  const accountLogout = (env) => withEnv(env, isAccountLogoutEnabled);
  const bothShown = (env) => withEnv(env, () => isAccountLogoutEnabled() && isLocalAuthTestMode());
  const LOGOUT_ENVS = [
    ['production + session + Mock 꺼짐 → 보임', { NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'disabled', NEXT_PUBLIC_AUTH_MODE: 'session' }, true],
    ['production + 스위치 없음(dev-login) → 숨김', { NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'disabled' }, false],
    ['production + 스위치 값이 Session → 숨김', { NODE_ENV: 'production', NEXT_PUBLIC_AUTH_MODE: 'Session' }, false],
    ['next dev + session + Mock 꺼짐(로컬 시험 모드) → 숨김', { NODE_ENV: 'development', NEXT_PUBLIC_AUTH_MODE: 'session' }, false],
    ['스위치 없는 실서버 dev → 숨김', { NODE_ENV: 'development' }, false],
    ['일반 Mock 개발 → 보임', { NODE_ENV: 'development', NEXT_PUBLIC_API_MOCKING: 'enabled' }, true],
    ['next dev + session + Mock → 보임', { NODE_ENV: 'development', NEXT_PUBLIC_AUTH_MODE: 'session', NEXT_PUBLIC_API_MOCKING: 'enabled' }, true],
    ['production + Mock → 보임', { NODE_ENV: 'production', NEXT_PUBLIC_API_MOCKING: 'enabled' }, true],
  ];
  for (const [label, env, expected] of LOGOUT_ENVS) {
    check(`정식 로그아웃: ${label}`, accountLogout(env) === expected);
    check(`정식·임시 로그아웃 동시 노출 없음: ${label}`, bothShown(env) === false);
  }
}

// ── refresh ───────────────────────────────────
console.log('\n[refresh — single-flight·계정 확인]');
{
  const tab = setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/refresh': [okRefresh('t2', 30)], 'GET /auth/me': [meReturns(SELLER_1)] });
  const requests = [originalRequest(1), originalRequest(1), originalRequest(1)];
  const responses = await Promise.all(requests.map((r) => fetchWithSessionRecovery(r.send)));
  check('동시에 401 3건 → refresh 1회', server.count('POST /auth/refresh') === 1, `refresh=${server.count('POST /auth/refresh')}`);
  check('refresh 성공 → /auth/me 1회', server.count('GET /auth/me') === 1);
  check('/auth/me 는 새 access 로 확인', server.last('GET /auth/me').headers.get('Authorization') === 'Bearer t2');
  check('같은 계정 → 원 요청마다 1회 재시도(각 2번 전송)', requests.every((r) => r.sends === 2));
  check('재시도는 새 access 로 보냄', requests.every((r) => r.auth[1] === 't2'));
  check('재시도 응답 200', responses.every((res) => res.status === 200));
  const refreshCall = server.last('POST /auth/refresh');
  check('refresh 는 X-Requested-With·credentials include', refreshCall.headers.get('X-Requested-With') === 'XMLHttpRequest' && refreshCall.credentials === 'include');
  check('refresh 본문 없음', refreshCall.body === null);
  check('같은 계정이면 이동 없음', tab.navigations.length === 0);
  check('access 는 메모리 값', getAccessToken() === 't2');
}
{
  setupTab();
  setAuthenticated('t1', SELLER_1);
  const order = [];
  createServer({
    'POST /auth/refresh': [async () => (order.push('refresh'), json(200, { accessToken: 't2' }))],
    'GET /auth/me': [async () => (order.push('me'), json(200, SELLER_1))],
  });
  const r = originalRequest(1);
  const wrapped = async () => (order.push(`send${r.sends + 1}`), r.send());
  await fetchWithSessionRecovery(wrapped);
  check('순서: 원 요청 → refresh → /auth/me → 재시도', order.join(',') === 'send1,refresh,me,send2', order.join(','));
}
{
  const tab = setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/refresh': [okRefresh('t2')], 'GET /auth/me': [meReturns(SELLER_2)] });
  const r = originalRequest(1);
  let thrown = null;
  try {
    await fetchWithSessionRecovery(r.send);
  } catch (error) {
    thrown = error;
  }
  check('다른 계정 → 원 요청 재시도 안 함', r.sends === 1);
  check('다른 계정 → 이전 계정 응답 버림(AuthSessionChangedError)', thrown instanceof AuthSessionChangedError);
  check('다른 계정 → M1 이동', tab.navigations.join() === '/');
  check('다른 계정 → 이전 계정 데이터 정리', tab.cleared() === 1);
  const snap = getAuthSnapshot();
  check('다른 계정 → 새 계정 반영·안내', snap.seller?.id === 2 && snap.notice === 'account-changed' && snap.status === 'authenticated');
  check('다른 계정 → 다른 탭에 account-changed', wireLog.at(-1) === JSON.stringify({ type: 'account-changed', sellerId: 2 }));
  check('/auth/me 1회', server.count('GET /auth/me') === 1);
}
{
  const tab = setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/refresh': [async () => authError(503, 'SERVICE_UNAVAILABLE', null)] });
  const r = originalRequest(5);
  const res = await fetchWithSessionRecovery(r.send).catch((error) => ({ status: `thrown ${error.name}` }));
  const snap = getAuthSnapshot();
  check('refresh 503 → 세션 상태 유지', snap.status === 'authenticated' && snap.seller?.id === 1, `${snap.status}`);
  check('refresh 503 → 자동 반복 없음(refresh 1회·원 요청 1회)', server.count('POST /auth/refresh') === 1 && r.sends === 1);
  check('refresh 503 → G1 이동·로그아웃 알림 없음', tab.navigations.length === 0 && !wireLog.at(-1)?.includes('logout'));
  check('refresh 503 → 일시 오류 안내', snap.notice === 'auth-unavailable');
  check('refresh 503 → 원 응답 401 그대로 돌려줌', res.status === 401);
}
for (const reason of ['refresh_invalid', 'refresh_reused']) {
  const tab = setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/refresh': [async () => authError(401, 'UNAUTHORIZED', reason)] });
  const r = originalRequest(1);
  let thrown = null;
  try {
    await fetchWithSessionRecovery(r.send);
  } catch (error) {
    thrown = error;
  }
  const snap = getAuthSnapshot();
  check(`${reason} → G1 이동`, tab.navigations.join() === '/login');
  check(`${reason} → access·계정 제거`, getAccessToken() === null && snap.seller === null && snap.status === 'signed-out');
  check(`${reason} → 다른 탭 logout 알림`, wireLog.at(-1) === JSON.stringify({ type: 'logout' }));
  check(`${reason} → refresh 1회·재시도 없음`, server.count('POST /auth/refresh') === 1 && r.sends === 1 && thrown instanceof AuthSessionChangedError);
}

console.log('\n[refresh — refresh_rotated 복구]');
{
  const bus = createBus();
  const tab = setupTab({ bus, eventWaitMs: 1000 });
  const otherTab = createAuthChannel(() => bus.channel());
  setAuthenticated('t1', SELLER_1);
  const server = createServer({
    'POST /auth/refresh': [
      async () => {
        setTimeout(() => otherTab.post({ type: 'refresh-complete' }), 20);
        return authError(401, 'UNAUTHORIZED', 'refresh_rotated');
      },
      okRefresh('t3'),
    ],
    'GET /auth/me': [meReturns(SELLER_1)],
  });
  const started = Date.now();
  const r = originalRequest(1);
  const res = await fetchWithSessionRecovery(r.send);
  const elapsed = Date.now() - started;
  check('rotated → 다른 탭 refresh-complete 를 기다린 뒤 다시 refresh', server.count('POST /auth/refresh') === 2 && res.status === 200);
  check('알림을 받으면 대기 시간 전에 바로 재시도', elapsed < 500, `${elapsed}ms`);
  check('rotated 복구 뒤 원 요청 1회 재시도', r.sends === 2 && r.auth[1] === 't3');
  check('rotated 복구 뒤 이동 없음', tab.navigations.length === 0);
  otherTab.close();
}
{
  setupTab({ eventWaitMs: 60 });
  setAuthenticated('t1', SELLER_1);
  const server = createServer({
    'POST /auth/refresh': [async () => authError(401, 'UNAUTHORIZED', 'refresh_rotated'), okRefresh('t3')],
    'GET /auth/me': [meReturns(SELLER_1)],
  });
  const started = Date.now();
  const res = await fetchWithSessionRecovery(originalRequest(1).send);
  const elapsed = Date.now() - started;
  check('알림이 없어도 대기 뒤 refresh 1회 더(총 2회)', server.count('POST /auth/refresh') === 2 && res.status === 200);
  check('알림이 없으면 대기 시간만큼 기다림', elapsed >= 55, `${elapsed}ms`);
}
{
  const tab = setupTab({ eventWaitMs: 20 });
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/refresh': [async () => authError(401, 'UNAUTHORIZED', 'refresh_rotated')] });
  const before = wireLog.length;
  const r = originalRequest(5);
  const res = await fetchWithSessionRecovery(r.send);
  const snap = getAuthSnapshot();
  check('계속 rotated → 사건당 refresh 최대 2회', server.count('POST /auth/refresh') === 2);
  check('계속 rotated → 자동 복구 중단 상태(recovery-stopped)', snap.status === 'recovery-stopped' && snap.notice === 'recovery-stopped');
  check('계속 rotated → 서버 세션 폐기로 단정하지 않음(logout 알림·G1 강제 이동 없음)', !wireLog.slice(before).some((m) => m.includes('logout')) && tab.navigations.length === 0);
  check('계속 rotated → 원 요청 재시도 없음', r.sends === 1 && res.status === 401);
}
{
  setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/refresh': [okRefresh('t2')], 'GET /auth/me': [meReturns(SELLER_1)] });
  const r = originalRequest(10);
  const res = await fetchWithSessionRecovery(r.send);
  check('재시도도 401 → 원 요청 재시도 최대 1회(무한 반복 없음)', r.sends === 2 && server.count('POST /auth/refresh') === 1 && res.status === 401);
}
{
  const tab = setupTab();
  setAuthenticated('t1', SELLER_1);
  markLogoutPending();
  const server = createServer({ 'POST /auth/refresh': [okRefresh('t2')] });
  const outcome = await recoverSession();
  check('서버 로그아웃 미완료 기록이 있으면 refresh 로 되살리지 않음', server.count('POST /auth/refresh') === 0 && outcome.kind === 'session-ended');
  check('그때 G1 로 이동', tab.navigations.join() === '/login');
}
{
  setupTab({ lock: createAuthLock({ request: (_name, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) }, 30) });
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/refresh': [okRefresh('t2')] });
  const outcome = await recoverSession();
  check('탭 잠금을 대기 시간 안에 얻지 못하면 일시 오류(세션 유지)', outcome.kind === 'unavailable' && getAuthSnapshot().status === 'authenticated' && server.count('POST /auth/refresh') === 0);
}
{
  // 두 탭이 같은 잠금을 쓰면 refresh 가 겹치지 않는다(Web Locks 대역)
  let active = 0;
  let maxActive = 0;
  let tail = Promise.resolve();
  const locks = {
    request(_name, _options, callback) {
      const run = tail.then(() => callback());
      tail = run.catch(() => {});
      return run;
    },
  };
  const lock = createAuthLock(locks, 1000);
  const task = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(15);
    active -= 1;
  };
  await Promise.all([lock(task), lock(task), lock(task)]);
  check('탭 잠금 안에서는 한 번에 하나만 실행', maxActive === 1);
  const noLocks = createAuthLock(null);
  check('Web Locks 가 없으면 잠금 없이 실행', (await noLocks(async () => 'ran')) === 'ran');
  check('잠금 시간 초과 오류 이름', new AuthLockTimeoutError().name === 'AuthLockTimeoutError');
}

// ── 탭 사이 알림 ───────────────────────────────
console.log('\n[cross-tab]');
{
  const bus = createBus();
  const a = createAuthChannel(() => bus.channel());
  const b = createAuthChannel(() => bus.channel());
  const received = [];
  b.subscribe((event) => received.push(event));
  a.post({ type: 'refresh-complete' });
  a.post({ type: 'login-complete', sellerId: 1 });
  a.post({ type: 'logout' });
  a.post({ type: 'account-changed', sellerId: 2 });
  await sleep(5);
  check('refresh-complete 전달', received.some((e) => e.type === 'refresh-complete'));
  check('login-complete 전달(sellerId)', received.some((e) => e.type === 'login-complete' && e.sellerId === 1));
  check('logout 전달', received.some((e) => e.type === 'logout'));
  check('account-changed 전달(sellerId)', received.some((e) => e.type === 'account-changed' && e.sellerId === 2));
  const wire = toWireEvent({ type: 'login-complete', sellerId: 1, accessToken: 'secret', seller: SELLER_1 });
  check('채널로 나가는 값은 허용 필드만(토큰·계정 정보 제거)', JSON.stringify(wire) === JSON.stringify({ type: 'login-complete', sellerId: 1 }));
  const before = wireLog.length;
  a.post({ type: 'refresh-complete', accessToken: 'secret' });
  check('post 에 토큰을 넘겨도 채널에 실리지 않음', !wireLog.slice(before).join().includes('secret'));
  const waited = b.waitFor('refresh-complete', 500);
  a.post({ type: 'refresh-complete' });
  check('waitFor 는 알림을 받으면 true', (await waited) === true);
  check('waitFor 는 알림이 없으면 시간 초과 false', (await b.waitFor('logout', 20)) === false);
  const silent = createAuthChannel(null);
  check('BroadcastChannel 이 없으면 알림 없이 동작', (await silent.waitFor('refresh-complete', 10)) === false);
  a.close();
  b.close();
}
{
  const tab = setupTab({ path: '/jobs/1' });
  setAuthenticated('t1', SELLER_1);
  handleAuthTabEvent({ type: 'logout' });
  check('다른 탭 logout → 인증 정리 + G1', getAccessToken() === null && getAuthSnapshot().status === 'signed-out' && tab.navigations.join() === '/login');
}
{
  const tab = setupTab({ path: '/jobs/1' });
  setAuthenticated('t1', SELLER_1);
  const epoch = getAuthSnapshot().epoch;
  handleAuthTabEvent({ type: 'login-complete', sellerId: 2 });
  const snap = getAuthSnapshot();
  check('다른 탭이 다른 계정으로 로그인 → 이전 계정 정리·M1·안내', tab.navigations.join() === '/' && tab.cleared() === 1 && snap.notice === 'account-changed' && snap.epoch === epoch + 1);
  check('다른 탭 계정 전환 → 이 탭 access 는 버리고 다음 요청에서 refresh', getAccessToken() === null);
}
{
  const tab = setupTab({ path: '/jobs/1' });
  setAuthenticated('t1', SELLER_1);
  handleAuthTabEvent({ type: 'account-changed', sellerId: 1 });
  check('같은 계정 알림은 무시', tab.navigations.length === 0 && getAccessToken() === 't1');
}
{
  const tab = setupTab({ path: '/login' });
  handleAuthTabEvent({ type: 'logout' });
  tab.navigations.length = 0;
  handleAuthTabEvent({ type: 'login-complete', sellerId: 1 });
  check('로그아웃 뒤 G1 탭은 다른 탭 로그인을 따라 M1', tab.navigations.join() === '/');
}

// ── 소셜 로그인 시작 ───────────────────────────
console.log('\n[social start]');
for (const provider of ['kakao', 'google']) {
  setupTab({ path: '/login' });
  const redirects = [];
  const server = createServer({ [`POST /auth/social/${provider}/start`]: [async () => json(200, { authorizeUrl: `https://provider.example/${provider}?state=s` })] });
  const result = await startSocialLogin(provider, { start: (p) => import('../lib/api/auth.ts').then((m) => m.postSocialStart(p)), redirect: (url) => redirects.push(url) });
  const call = server.last(`POST /auth/social/${provider}/start`);
  check(`${provider} → POST /auth/social/${provider}/start`, server.count(`POST /auth/social/${provider}/start`) === 1);
  check(`${provider} start 는 본문 없음·X-Requested-With·credentials include`, call.body === null && call.headers.get('X-Requested-With') === 'XMLHttpRequest' && call.credentials === 'include');
  check(`${provider} → authorizeUrl 로 이동`, result.kind === 'redirecting' && redirects.join() === `https://provider.example/${provider}?state=s`);
}
{
  setupTab({ path: '/login' });
  const { postSocialStart } = await import('../lib/api/auth.ts');
  const server = createServer({ 'POST /auth/social/kakao/start': [async () => (await sleep(20), json(200, { authorizeUrl: '/x' }))] });
  const deps = { start: postSocialStart, redirect: () => {} };
  const results = await Promise.all([startSocialLogin('kakao', deps), startSocialLogin('kakao', deps), startSocialLogin('google', deps)]);
  check('중복 클릭(같은·다른 버튼) → 시작 요청 1회', server.calls.length === 1 && results.filter((r) => r.kind === 'busy').length === 2);
}
for (const [label, response, expected] of [
  ['404', () => authError(404, 'NOT_FOUND', null), 'not-available'],
  ['503', () => authError(503, 'SERVICE_UNAVAILABLE', null), 'unavailable'],
  ['401 origin_not_allowed', () => authError(401, 'UNAUTHORIZED', 'origin_not_allowed'), 'failed'],
]) {
  setupTab({ path: '/login' });
  const { postSocialStart } = await import('../lib/api/auth.ts');
  const server = createServer({ 'POST /auth/social/kakao/start': [async () => response()] });
  const redirects = [];
  const deps = { start: postSocialStart, redirect: (u) => redirects.push(u) };
  const result = await startSocialLogin('kakao', deps);
  check(`start ${label} → ${expected}·이동 없음`, result.kind === 'error' && result.error === expected && redirects.length === 0);
  check(`start ${label} → 자동 재시도 없음`, server.calls.length === 1);
  const again = await startSocialLogin('kakao', deps);
  check(`start ${label} 뒤 다시 누르면 새로 시작 가능(잠금 해제)`, again.kind === 'error' && server.calls.length === 2);
}

// ── 소셜 로그인 완료(콜백) ─────────────────────
console.log('\n[callback]');
function completeDeps() {
  return import('../lib/api/auth.ts').then((m) => ({ complete: m.postSocialComplete }));
}
const params = { provider: 'kakao', code: 'code-1', state: 'state-1' };
{
  setupTab({ path: '/login/callback/kakao' });
  const server = createServer({ 'POST /auth/social': [async () => (await sleep(20), json(200, { accessToken: 'social-t', seller: SELLER_1 }))] });
  const deps = await completeDeps();
  const before = wireLog.length;
  // 같은 document 안에서 같은 effect 가 두 번 실행돼도(Strict Mode) 요청은 1회
  const [first, second] = await Promise.all([completeSocialLogin(params, deps), completeSocialLogin(params, deps)]);
  const third = await completeSocialLogin(params, deps);
  const call = server.last('POST /auth/social');
  check('같은 document: 콜백 완료 POST 정확히 1회(이중 실행·재호출 포함)', server.count('POST /auth/social') === 1);
  check('같은 document: 이중 실행은 같은 결과를 공유', first === second && second === third);
  check('완료 body = { provider, code, state }', call.body === JSON.stringify(params));
  check('완료 요청 X-Requested-With·credentials include', call.headers.get('X-Requested-With') === 'XMLHttpRequest' && call.credentials === 'include');
  check('성공 → access 메모리·seller 반영', first.kind === 'success' && getAccessToken() === 'social-t' && getAuthSnapshot().seller?.id === 1);
  check('성공 → 다른 탭 login-complete(sellerId 만)', wireLog.slice(before).includes(JSON.stringify({ type: 'login-complete', sellerId: 1 })));
}
{
  setupTab({ path: '/login/callback/kakao' });
  markLogoutPending();
  createServer({ 'POST /auth/social': [async () => json(200, { accessToken: 'social-t', seller: SELLER_1 })] });
  await completeSocialLogin(params, await completeDeps());
  check('새 로그인 성공 → 서버 로그아웃 미완료 기록 해제', !isLogoutPending());
}
for (const [label, response, expected] of [
  ['state_invalid', () => authError(401, 'UNAUTHORIZED', 'state_invalid'), 'state-invalid'],
  ['provider_auth_failed', () => authError(401, 'UNAUTHORIZED', 'provider_auth_failed'), 'provider-auth-failed'],
  ['503 provider_unavailable', () => authError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable'), 'provider-unavailable'],
]) {
  setupTab({ path: '/login/callback/kakao' });
  const server = createServer({ 'POST /auth/social': [async () => response()] });
  const result = await completeSocialLogin(params, await completeDeps());
  check(`${label} → ${expected}`, result.kind === 'error' && result.error === expected);
  check(`${label} → 완료 요청 자동 반복 없음·로그인 안 됨`, server.count('POST /auth/social') === 1 && getAccessToken() === null);
}

console.log('\n[callback — 새로고침(새 document) · 확정 계약 B]');
{
  // 같은 document: Strict Mode 두 번째 실행은 기록을 보고 「새로고침」으로 오해하지 않는다
  setupTab({ path: '/login/callback/kakao' });
  const server = createServer({ 'POST /auth/social': [async () => (await sleep(20), json(200, { accessToken: 'social-t', seller: SELLER_1 }))] });
  const deps = await completeDeps();
  const first = completeSocialLogin(params, deps);
  check('완료 요청 시작 시 callback 상태 in-flight 기록', readCallbackState() === 'in-flight');
  const second = completeSocialLogin(params, deps);
  const [a, b] = await Promise.all([first, second]);
  check('같은 document 재실행은 같은 Promise(성공)·POST 1회', a === b && a.kind === 'success' && server.count('POST /auth/social') === 1);
  check('성공 → callback 상태 기록 삭제', readCallbackState() === null);
}
{
  // 이전 Kakao 세션이 있는 브라우저에서 Google callback 중 새로고침
  const tab = setupTab({ path: '/login/callback/google' });
  const gParams = { provider: 'google', code: 'code-g', state: 'state-g' };
  const server = createServer({
    'POST /auth/social': [() => new Promise(() => {}), async () => json(200, { accessToken: 'social-g', seller: SELLER_2 })],
    'POST /auth/refresh': [okRefresh('old-kakao-session-t')],
    'GET /auth/me': [meReturns(SELLER_1)],
  });
  const deps = await completeDeps();
  void completeSocialLogin(gParams, deps); // 응답 전에 document 가 사라짐
  await sleep(5);
  resetSocialLoginForTest(); // 새 document — Promise 없음, sessionStorage 기록만 남음
  const before = wireLog.length;
  const result = await completeSocialLogin(gParams, deps);
  check('새 document: 같은 /auth/social 재전송 0회', server.count('POST /auth/social') === 1);
  check('새 document: 「로그인 완료 여부 확인 불가」로 끝남', result.kind === 'error' && result.error === 'callback-unconfirmed' && readCallbackState() === 'unconfirmed');
  check('새 document: refresh·/auth/me 로 성공 추측 0회', server.count('POST /auth/refresh') === 0 && server.count('GET /auth/me') === 0);
  check('새 document: 로그인 상태가 되지 않음', getAccessToken() === null && getAuthSnapshot().seller === null);
  // G1 로 돌아간 뒤 첫 401 이 나도 이전 Kakao 세션으로 복원하지 않는다
  const outcome = await recoverSession();
  check('불확정 동안 세션 자동 복원 차단(refresh 0회)', outcome.kind === 'restore-suppressed' && server.count('POST /auth/refresh') === 0 && isSessionRestoreSuppressed());
  check('불확정 → 이 탭만 G1, 다른 탭에 logout 알림 없음', tab.navigations.join() === '/login' && !wireLog.slice(before).some((m) => m.includes('logout')));
  check('이전 Kakao 계정(seller 1)으로 로그인되지 않음', getAuthSnapshot().seller?.id !== 1 && getAccessToken() === null);
  const r = originalRequest(1);
  const res = await fetchWithSessionRecovery(r.send).catch(() => ({ status: 'changed' }));
  check('불확정 동안 일반 API 401 → 원 요청 재시도·refresh 없음', r.sends === 1 && server.count('POST /auth/refresh') === 0 && res.status !== 200);
  // 새 start 성공 → 차단 해제
  const { postSocialStart } = await import('../lib/api/auth.ts');
  createServer({ 'POST /auth/social/google/start': [async () => json(200, { authorizeUrl: '/x' })] });
  await startSocialLogin('google', { start: postSocialStart, redirect: () => {} });
  check('새 start 성공 → 차단 해제', readCallbackState() === null && !isSessionRestoreSuppressed());
}
{
  setupTab({ path: '/login' });
  const { postSocialStart } = await import('../lib/api/auth.ts');
  await tabMarkUnconfirmed();
  createServer({ 'POST /auth/social/kakao/start': [async () => authError(503, 'SERVICE_UNAVAILABLE', null)] });
  await startSocialLogin('kakao', { start: postSocialStart, redirect: () => {} });
  check('start 가 실패하면 차단 유지(새 로그인이 시작되지 않음)', readCallbackState() === 'unconfirmed');
}
{
  setupTab({ path: '/login/callback/kakao' });
  const server = createServer({ 'POST /auth/social': [async () => authError(409, 'DUPLICATE', 'login_in_progress')], 'POST /auth/refresh': [okRefresh('old-session-t')], 'GET /auth/me': [meReturns(SELLER_1)] });
  const result = await completeSocialLogin(params, await completeDeps());
  check('login_in_progress → 불확정(처음부터 다시)·차단', result.kind === 'error' && result.error === 'callback-unconfirmed' && readCallbackState() === 'unconfirmed');
  check('login_in_progress → polling·refresh·재POST 없음', server.count('POST /auth/social') === 1 && server.count('POST /auth/refresh') === 0 && server.count('GET /auth/me') === 0);
}
{
  setupTab({ path: '/login/callback/kakao' });
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const result = await completeSocialLogin(params, await completeDeps());
  check('완료 요청 네트워크 끊김(결과 모름) → 불확정·차단', result.kind === 'error' && result.error === 'callback-unconfirmed' && readCallbackState() === 'unconfirmed');
}
{
  setupTab({ path: '/login/callback/kakao' });
  createServer({ 'POST /auth/social': [async () => authError(401, 'UNAUTHORIZED', 'state_invalid')] });
  const result = await completeSocialLogin(params, await completeDeps());
  check('서버가 거절(state_invalid — 로그인 안 됨 확정) → 차단하지 않음', result.kind === 'error' && result.error === 'state-invalid' && readCallbackState() === null);
}
{
  const tab = setupTab({ path: '/login' });
  await tabMarkUnconfirmed();
  handleAuthTabEvent({ type: 'logout' });
  handleAuthTabEvent({ type: 'login-complete', sellerId: 2 });
  check('다른 탭의 새 로그인 완료 → 이 탭 차단 해제', readCallbackState() === null && tab.navigations.at(-1) === '/');
}
{
  setupTab({ path: '/' });
  await tabMarkUnconfirmed();
  markLogoutPending();
  const server = createServer({ 'POST /auth/refresh': [okRefresh('x')] });
  const outcome = await recoverSession();
  check('logoutPending 과 함께 있으면 logoutPending 우선(세션 종료)·refresh 없음', outcome.kind === 'session-ended' && server.count('POST /auth/refresh') === 0);
}

// ── 로그아웃 ───────────────────────────────────
console.log('\n[logout]');
const logoutCalls = (server) => server.calls.filter((c) => c.key === 'POST /auth/logout');
{
  const tab = setupTab();
  setAuthenticated('t1', SELLER_1);
  markLogoutPending();
  const server = createServer({ 'POST /auth/logout': [async () => json(204, null)] });
  const before = wireLog.length;
  const result = await logout();
  const call = server.last('POST /auth/logout');
  check('204 → 완료(서버 로그아웃 확인)', result.kind === 'done' && result.serverConfirmed === true);
  check('logout 은 X-Requested-With·credentials include·현재 access 를 Bearer 로', call.headers.get('X-Requested-With') === 'XMLHttpRequest' && call.credentials === 'include' && call.headers.get('Authorization') === 'Bearer t1');
  check('204 → 인증 정리·G1·모든 탭 logout', getAccessToken() === null && getAuthSnapshot().status === 'signed-out' && tab.navigations.join() === '/login' && wireLog.slice(before).includes(JSON.stringify({ type: 'logout' })));
  check('204 → logoutPending 제거', !isLogoutPending());
}
{
  setupTab();
  const server = createServer({ 'POST /auth/logout': [async () => json(204, null)] });
  const result = await logout();
  check('access 가 없으면 쿠키만으로 보내고 204 → 완료', result.kind === 'done' && server.last('POST /auth/logout').headers.get('Authorization') === null);
}
{
  setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/logout': [async () => authError(401, 'UNAUTHORIZED', 'invalid_token'), async () => json(204, null)], 'POST /auth/refresh': [okRefresh('never')] });
  const result = await logout();
  const calls = logoutCalls(server);
  check('logout 은 공통 인증 복구를 거치지 않음(refresh 0회)', server.count('POST /auth/refresh') === 0);
  check('invalid_token → Authorization 없이 정확히 1회 재시도', calls.length === 2 && calls[0].headers.get('Authorization') === 'Bearer t1' && calls[1].headers.get('Authorization') === null);
  check('invalid_token → 쿠키만 204 → 완료', result.kind === 'done' && result.serverConfirmed === true && !isLogoutPending());
}
{
  setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/logout': [async () => authError(401, 'UNAUTHORIZED', 'invalid_token')] });
  const result = await logout();
  check('invalid_token 이 반복돼도 재시도는 1회뿐', server.count('POST /auth/logout') === 2);
  check('invalid_token 반복은 완료로 보지 않음(횟수로 대기 해제 금지) → pending 유지', result.kind === 'pending' && isLogoutPending());
}
{
  const tab = setupTab();
  setAuthenticated('t1', SELLER_1);
  markLogoutPending();
  const server = createServer({ 'POST /auth/logout': [async () => authError(401, 'UNAUTHORIZED', 'invalid_token'), async () => authError(401, 'UNAUTHORIZED', 'refresh_invalid')] });
  const result = await logout();
  check('invalid_token → 쿠키만 → refresh_invalid → FE 로그아웃 완료·대기 해제', result.kind === 'done' && !isLogoutPending() && tab.navigations.join() === '/login');
  check('refresh_invalid → 서버 세션 폐기 미확인(serverConfirmed=false)', result.kind === 'done' && result.serverConfirmed === false && result.reason === 'refresh_invalid');
  check('refresh_invalid 뒤 추가 요청 없음(총 2회)', server.count('POST /auth/logout') === 2);
}
{
  setupTab();
  markLogoutPending();
  const server = createServer({ 'POST /auth/logout': [async () => json(422, { error: { code: 'VALIDATION_ERROR', details: { reason: 'refresh_invalid' } } })] });
  const result = await retryPendingLogout();
  check('reason 만 refresh_invalid 이고 code 가 UNAUTHORIZED 가 아니면 대기 유지(계약 기준만 사용)', result.kind === 'pending' && isLogoutPending() && server.count('POST /auth/logout') === 1);
}
{
  setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/logout': [async () => authError(401, 'UNAUTHORIZED', null)] });
  const result = await logout();
  check('사유 없는 401 은 완료로 보지 않음 → pending', result.kind === 'pending' && isLogoutPending() && server.count('POST /auth/logout') === 1);
}
for (const [label, response] of [
  ['503', () => authError(503, 'SERVICE_UNAVAILABLE', null)],
  ['401 origin_not_allowed', () => authError(401, 'UNAUTHORIZED', 'origin_not_allowed')],
  ['422', () => authError(422, 'VALIDATION_ERROR', null)],
]) {
  const tab = setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/logout': [async () => response()] });
  const before = wireLog.length;
  const result = await logout();
  check(`${label} → 화면은 로그아웃·G1·모든 탭 logout`, getAuthSnapshot().status === 'signed-out' && tab.navigations.join() === '/login' && wireLog.slice(before).includes(JSON.stringify({ type: 'logout' })));
  check(`${label} → logoutPending 유지·안내`, result.kind === 'pending' && isLogoutPending() && getAuthSnapshot().notice === 'logout-pending');
  check(`${label} → 자동 반복 없음`, server.count('POST /auth/logout') === 1);
  check(`${label} → 저장 값은 '1' 뿐(토큰·계정 없음)`, [...tab.storage.map.values()].join() === '1');
}
{
  setupTab();
  setAuthenticated('t1', SELLER_1);
  const server = createServer({ 'POST /auth/logout': [async () => (await sleep(15), json(204, null))] });
  await Promise.all([logout(), logout()]);
  check('로그아웃을 두 번 눌러도 요청 1회', server.count('POST /auth/logout') === 1);
}

console.log('\n[logoutPending — 앱 진입]');
{
  const tab = setupTab();
  const server = createServer({ 'POST /auth/logout': [async () => json(204, null)] });
  const result = await resumePendingLogout();
  check('대기 기록 없음 → 로그아웃 요청 없이 정상 복원 진행(null)', result === null && server.count('POST /auth/logout') === 0 && tab.navigations.length === 0);
}
{
  const tab = setupTab({ path: '/' });
  markLogoutPending();
  const server = createServer({ 'POST /auth/logout': [async () => json(204, null)], 'POST /auth/refresh': [okRefresh('never')] });
  const before = wireLog.length;
  const result = await resumePendingLogout();
  check('대기 있음 → refresh 보다 로그아웃(쿠키만) 먼저', server.calls[0]?.key === 'POST /auth/logout' && server.count('POST /auth/refresh') === 0 && server.last('POST /auth/logout').headers.get('Authorization') === null);
  check('대기 + 204 → 대기 해제·G1·logout 알림', result.kind === 'done' && !isLogoutPending() && tab.navigations.join() === '/login' && wireLog.slice(before).includes(JSON.stringify({ type: 'logout' })));
}
{
  const tab = setupTab({ path: '/' });
  markLogoutPending();
  const server = createServer({ 'POST /auth/logout': [async () => authError(401, 'UNAUTHORIZED', 'refresh_invalid')] });
  const result = await resumePendingLogout();
  check('대기 + refresh_invalid → 대기 해제·로컬 정리·G1', result.kind === 'done' && !isLogoutPending() && getAuthSnapshot().status === 'signed-out' && tab.navigations.join() === '/login');
  check('대기 + refresh_invalid → 서버 폐기 미확인·추가 요청 없음', result.kind === 'done' && result.serverConfirmed === false && server.calls.length === 1);
}
{
  const tab = setupTab({ path: '/' });
  markLogoutPending();
  const server = createServer({ 'POST /auth/logout': [async () => authError(503, 'SERVICE_UNAVAILABLE', null)] });
  const result = await resumePendingLogout();
  check('대기 + 503 → 대기 유지·G1·자동 반복 없음', result.kind === 'pending' && isLogoutPending() && tab.navigations.join() === '/login' && server.calls.length === 1 && getAuthSnapshot().notice === 'logout-pending');
}
{
  setupTab({ path: '/' });
  markLogoutPending();
  const server = createServer({ 'POST /auth/logout': [async () => (await sleep(15), authError(503, 'SERVICE_UNAVAILABLE', null))] });
  await Promise.all([resumePendingLogout(), resumePendingLogout()]);
  check('앱 진입 처리가 두 번 실행돼도(Strict Mode) 로그아웃 재시도는 1회', server.calls.length === 1);
}
{
  setupTab();
  markLogoutPending();
  const server = createServer({ 'POST /auth/logout': [async () => authError(401, 'UNAUTHORIZED', 'invalid_token')] });
  const result = await retryPendingLogout();
  check('쿠키만 보낸 요청의 invalid_token 은 다시 보내지 않고 대기 유지', result.kind === 'pending' && server.calls.length === 1 && isLogoutPending());
}
{
  setupTab();
  markLogoutPending();
  const server = createServer({ 'POST /auth/logout': [async () => json(204, null)] });
  const result = await retryPendingLogout();
  check('[다시 시도] → Authorization 없이 보내고 204 면 대기 해제', result.kind === 'done' && !isLogoutPending() && server.last('POST /auth/logout').headers.get('Authorization') === null);
}

// ── 전체: 채널에 토큰이 실린 적 없음 ──────────
console.log('\n[cross-tab payload]');
check(`채널 메시지 ${wireLog.length}건 모두 토큰 없음`, wireLog.length > 0 && wireLog.every((m) => !/token|t1|t2|t3|social-t|secret|email/i.test(m)), wireLog.find((m) => /token|secret|email/i.test(m)) ?? '');

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
