/**
 * N5 섹션 제외/복원 저장 중 계정 전환 검증 — BE 요청 3조건.
 *   1. 이전 계정의 늦은 저장 응답이 새 계정의 화면·캐시·편집 상태에 반영되지 않음
 *   2. 이전 계정의 요청이 새 계정 토큰으로 자동 재전송되지 않음
 *   3. 저장 여부가 불명확하면 그 계정으로 다시 들어왔을 때 서버 정본을 조회해 확인
 *
 * 실제 코드를 그대로 쓴다: TanStack QueryClient·MutationObserver·QueryObserver(useQuery 와 같은 관찰자),
 * lib/queries/section-bucket-mutation.ts(useUpdateSectionBucketMutation 옵션), lib/auth/authorized-request.ts
 * fetchWithSessionRecovery(authorizedFetch 의 session 모드 경로), lib/auth/runtime.ts(계정 전환·탭 알림 처리).
 * 서버는 fetch 대역, 탭 사이 채널은 대역이다. 실제 BE·브라우저를 검증하지 않는다.
 *
 * 실행: npm run verify:auth-n5-switch
 */

import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core';

import { AuthSessionChangedError, fetchWithSessionRecovery } from '../lib/auth/authorized-request.ts';
import { createAuthChannel } from '../lib/auth/cross-tab.ts';
import { setLogoutPendingStorageForTest } from '../lib/auth/logout-pending.ts';
import { setCallbackStateStorageForTest } from '../lib/auth/callback-state.ts';
import { configureAuthRuntimeForTest, handleAuthTabEvent } from '../lib/auth/runtime.ts';
import { getAccessToken, getAuthEpoch, resetAuthStoreForTest, setAuthenticated } from '../lib/auth/session-store.ts';
import { sectionBucketMutationOptions } from '../lib/queries/section-bucket-mutation.ts';

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
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const SELLER_A = { id: 1, email: 'a@pixlate.test' };
const SELLER_B = { id: 2, email: 'b@pixlate.test' };
const JOB = '7';
const SECTIONS_KEY = ['pixlate', 'job', JOB, 'sections'];
const PREVIEW_KEY = ['pixlate', 'job', JOB, 'n5-preview'];
const LIBRARY_KEY = ['pixlate', 'library'];

function json(status, body) {
  return new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const authError = (status, code, reason) => json(status, { error: { code, message: 'x', retryable: false, details: reason ? { reason } : null, traceId: 't' } });
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * 서버 대역 — 계정 A 의 job 7 섹션 정본을 가진다. 토큰 a* 는 계정 A, b* 는 계정 B(job 7 은 A 소유라 B 에게 404).
 * PATCH 는 도착 즉시 서버 정본에 적용하고, 응답은 hold 가 풀릴 때 돌려준다(「서버엔 반영, 응답은 늦게」).
 */
function createServer({ patchFirst401 = false, refreshTo = null, meReturns = null } = {}) {
  const section = (id, bucket) => ({ id, bucket, excludedStage: bucket === 'exclude' ? 'n5' : null });
  const state = { include: [section(1, 'include'), section(2, 'include')], exclude: [] };
  const calls = [];
  const patchArrived = deferred();
  const patchHold = deferred();
  let patch401Left = patchFirst401 ? 1 : 0;
  const owner = (auth) => (auth?.startsWith('Bearer a') ? 'A' : auth?.startsWith('Bearer b') ? 'B' : null);

  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const auth = new Headers(init.headers).get('Authorization');
    calls.push({ key: `${method} ${url}`, auth });
    if (url === '/auth/refresh') return refreshTo ? json(200, { accessToken: refreshTo }) : authError(401, 'UNAUTHORIZED', 'refresh_invalid');
    if (url === '/auth/me') return json(200, meReturns);
    if (url === `/jobs/${JOB}/sections` && method === 'GET') {
      if (owner(auth) !== 'A') return authError(404, 'NOT_FOUND', null);
      return json(200, structuredClone({ include: state.include, exclude: state.exclude }));
    }
    const match = url.match(/^\/jobs\/7\/sections\/(\d+)$/);
    if (match && method === 'PATCH') {
      if (patch401Left > 0) {
        patch401Left -= 1;
        return authError(401, 'TOKEN_EXPIRED', null);
      }
      if (owner(auth) !== 'A') return authError(404, 'NOT_FOUND', null);
      const id = Number(match[1]);
      const { action } = JSON.parse(init.body);
      const target = action === 'exclude' ? 'exclude' : 'include';
      const moving = [...state.include, ...state.exclude].find((s) => s.id === id);
      state.include = state.include.filter((s) => s.id !== id);
      state.exclude = state.exclude.filter((s) => s.id !== id);
      const saved = section(id, target);
      state[target].push(saved);
      patchArrived.resolve();
      await patchHold.promise;
      return json(200, { ...moving, ...saved });
    }
    return authError(404, 'NOT_FOUND', null);
  };
  return {
    state,
    calls,
    count: (key) => calls.filter((c) => c.key === key).length,
    patchArrived: patchArrived.promise,
    releasePatch: () => patchHold.resolve(),
  };
}

/** 앱 API 요청(lib/api/pixlate.ts authorizedFetch 'session' 경로와 같은 모양) */
async function apiFetch(url, init = {}) {
  const res = await fetchWithSessionRecovery(() => {
    const headers = new Headers(init.headers);
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
const getSections = () => apiFetch(`/jobs/${JOB}/sections`);
const updateSection = (sectionId, payload) =>
  apiFetch(`/jobs/${JOB}/sections/${sectionId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

/** 한 탭 — app/providers.tsx 와 같은 clearClientData(진행 중 query 취소 + 캐시 비움) */
function setupTab() {
  resetAuthStoreForTest();
  setLogoutPendingStorageForTest(memoryStorage());
  setCallbackStateStorageForTest(memoryStorage());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  const navigations = [];
  const members = new Set();
  const channel = createAuthChannel(() => {
    const member = { postMessage() {}, addEventListener() {}, removeEventListener() {}, close() { members.delete(member); } };
    members.add(member);
    return member;
  });
  configureAuthRuntimeForTest({
    hooks: {
      navigate: (path) => navigations.push(path),
      currentPath: () => `/jobs/${JOB}`,
      clearClientData: () => {
        void queryClient.cancelQueries();
        queryClient.clear();
      },
    },
    channel,
    lock: (task) => task(),
    recoveryDeps: { eventWaitMs: 10 },
  });
  const mutation = new MutationObserver(
    queryClient,
    sectionBucketMutationOptions({ queryClient, sectionsKey: SECTIONS_KEY, previewKey: PREVIEW_KEY, update: updateSection }),
  );
  return { queryClient, navigations, mutation };
}

const bucketOf = (list, id) => (list?.include?.some((s) => s.id === id) ? 'include' : list?.exclude?.some((s) => s.id === id) ? 'exclude' : null);
const cacheKeys = (queryClient) => queryClient.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));

// ── A. 늦은 성공 응답 ─────────────────────────
console.log('\n[A. 계정 A 저장 중 다른 탭에서 계정 B 로그인 → A 응답이 늦게 도착]');
{
  const { queryClient, mutation, navigations } = setupTab();
  const server = createServer();
  setAuthenticated('a1', SELLER_A);
  await queryClient.fetchQuery({ queryKey: SECTIONS_KEY, queryFn: getSections });
  queryClient.setQueryData(PREVIEW_KEY, { sections: [{ id: 1, bucket: 'include' }, { id: 2, bucket: 'include' }] });
  const epochA = getAuthEpoch();

  const saving = mutation.mutate({ sectionId: 1, bucket: 'exclude' }).then(() => null, (error) => error);
  await server.patchArrived;
  check('A 저장 요청이 서버에 도착·적용됨(응답 대기 중)', bucketOf(server.state, 1) === 'exclude');
  check('A 화면에는 optimistic 반영', bucketOf(queryClient.getQueryData(SECTIONS_KEY), 1) === 'exclude');

  // 다른 탭에서 계정 B 로그인 완료 알림
  handleAuthTabEvent({ type: 'login-complete', sellerId: SELLER_B.id });
  check('계정 전환 → epoch 변경·캐시 비움·M1 이동', getAuthEpoch() !== epochA && cacheKeys(queryClient).length === 0 && navigations.at(-1) === '/');

  // B 화면이 같은 key 를 가진 상황(새 계정 데이터)도 덮이지 않는지 본다 — B 소유 데이터라고 표시한 값을 둔다
  queryClient.setQueryData(LIBRARY_KEY, [{ jobId: 99, owner: 'B' }]);
  const keysBefore = cacheKeys(queryClient);

  server.releasePatch();
  const error = await saving;
  await tick();
  check('A 의 늦은 응답은 버려짐(AuthSessionChangedError)', error instanceof AuthSessionChangedError, String(error));
  check('A 의 섹션 캐시가 다시 만들어지지 않음(rollback 미적용)', queryClient.getQueryData(SECTIONS_KEY) === undefined, JSON.stringify(queryClient.getQueryData(SECTIONS_KEY)));
  check('A 의 프리뷰 캐시가 다시 만들어지지 않음', queryClient.getQueryData(PREVIEW_KEY) === undefined);
  check('B 캐시는 그대로(키 추가·변경 없음)', JSON.stringify(cacheKeys(queryClient)) === JSON.stringify(keysBefore) && queryClient.getQueryData(LIBRARY_KEY)?.[0]?.owner === 'B');
  check('B 컨텍스트에서 A 작업의 재조회 없음(GET sections 추가 0회)', server.count(`GET /jobs/${JOB}/sections`) === 1);
}
{
  // B 가 같은 key 를 이미 보고 있던 경우 — A 의 rollback·invalidate 가 B 데이터를 건드리지 않는다
  const { queryClient, mutation } = setupTab();
  const server = createServer();
  setAuthenticated('a1', SELLER_A);
  await queryClient.fetchQuery({ queryKey: SECTIONS_KEY, queryFn: getSections });
  const saving = mutation.mutate({ sectionId: 1, bucket: 'exclude' }).then(() => null, (error) => error);
  await server.patchArrived;
  handleAuthTabEvent({ type: 'login-complete', sellerId: SELLER_B.id });
  const bData = { include: [], exclude: [], marker: 'B' };
  queryClient.setQueryData(SECTIONS_KEY, bData);
  server.releasePatch();
  await saving;
  await tick();
  const query = queryClient.getQueryCache().find({ queryKey: SECTIONS_KEY });
  check('같은 key 의 B 데이터를 A rollback 으로 덮지 않음', queryClient.getQueryData(SECTIONS_KEY)?.marker === 'B', JSON.stringify(queryClient.getQueryData(SECTIONS_KEY)));
  check('같은 key 의 B 데이터를 A onSettled 로 invalidate 하지 않음', query?.state.isInvalidated === false);
}

// ── B. 401 + 계정 변경 ───────────────────────
console.log('\n[B. 계정 A 저장 → 401 → refresh + /auth/me → 계정 B]');
{
  const { queryClient, mutation, navigations } = setupTab();
  const server = createServer({ patchFirst401: true, refreshTo: 'b1', meReturns: SELLER_B });
  setAuthenticated('a1', SELLER_A);
  await queryClient.fetchQuery({ queryKey: SECTIONS_KEY, queryFn: getSections });
  const error = await mutation.mutate({ sectionId: 1, bucket: 'exclude' }).then(() => null, (e) => e);
  await tick();
  const patches = server.calls.filter((c) => c.key === `PATCH /jobs/${JOB}/sections/1`);
  check('원 요청 전송 1회', patches.length === 1, JSON.stringify(patches));
  check('A 저장을 B access 로 다시 보내지 않음', patches.every((c) => c.auth === 'Bearer a1'));
  check('refresh·/auth/me 각 1회', server.count('POST /auth/refresh') === 1 && server.count('GET /auth/me') === 1);
  check('계정 전환 처리(M1 이동)', navigations.at(-1) === '/');
  check('A 저장은 실패로 끝남(재전송 없이 버림)', error instanceof AuthSessionChangedError, String(error));
  check('B 로 전환 뒤 A 섹션 캐시 없음(rollback 미적용)', queryClient.getQueryData(SECTIONS_KEY) === undefined, JSON.stringify(queryClient.getQueryData(SECTIONS_KEY)));
  check('B 로 전환 뒤 캐시 비어 있음', cacheKeys(queryClient).length === 0, cacheKeys(queryClient).join());
  check('서버 정본은 바뀌지 않음(401 이라 적용 안 됨)', bucketOf(server.state, 1) === 'include');
}

// ── C. 저장 결과 불명확 → A 재접속 ────────────
console.log('\n[C. 서버엔 적용됐지만 FE 는 응답을 버림 → 계정 A 로 다시 로그인 → 같은 N5 재진입]');
{
  // A 시나리오를 이어서 쓴다: 서버 정본에서 섹션 1 은 exclude, FE 는 응답을 버렸다
  const { queryClient, mutation } = setupTab();
  const server = createServer();
  setAuthenticated('a1', SELLER_A);
  await queryClient.fetchQuery({ queryKey: SECTIONS_KEY, queryFn: getSections });
  const saving = mutation.mutate({ sectionId: 1, bucket: 'exclude' }).then(() => null, (e) => e);
  await server.patchArrived;
  handleAuthTabEvent({ type: 'login-complete', sellerId: SELLER_B.id });
  server.releasePatch();
  await saving;
  await tick();
  check('전제: 서버 정본은 섹션 1 exclude', bucketOf(server.state, 1) === 'exclude');

  // 다시 계정 A 로 로그인 → 같은 N5 진입(useQuery 와 같은 QueryObserver, staleTime 60초)
  setAuthenticated('a2', SELLER_A);
  const getsBefore = server.count(`GET /jobs/${JOB}/sections`);
  const observer = new QueryObserver(queryClient, { queryKey: SECTIONS_KEY, queryFn: getSections, staleTime: 60_000 });
  const first = observer.getOptimisticResult(observer.options);
  check('재진입 첫 화면에 이전 local 추측(rollback·optimistic)이 없음', first.data === undefined, JSON.stringify(first.data));
  const unsubscribe = observer.subscribe(() => {});
  const settled = await new Promise((resolve) => {
    const stop = observer.subscribe((result) => {
      if (result.status !== 'pending') {
        stop();
        resolve(result);
      }
    });
    const current = observer.getCurrentResult();
    if (current.status !== 'pending') resolve(current);
  });
  unsubscribe();
  check('재진입 시 서버 정본을 다시 조회(GET sections 1회)', server.count(`GET /jobs/${JOB}/sections`) === getsBefore + 1);
  check('화면에는 서버에 실제 저장된 상태(섹션 1 exclude)', bucketOf(settled.data, 1) === 'exclude', JSON.stringify(settled.data));
  check('재조회는 A 의 새 access 로', server.calls.at(-1)?.auth === 'Bearer a2');
}

// ── onMutate 대기 중 계정 전환 ────────────────
console.log('\n[onMutate 의 진행 중 query 취소를 기다리는 사이 계정 전환]');
{
  const { queryClient, mutation } = setupTab();
  const server = createServer();
  setAuthenticated('a1', SELLER_A);
  await queryClient.fetchQuery({ queryKey: SECTIONS_KEY, queryFn: getSections });
  // 취소를 기다리는 동안 계정이 바뀌는 상황 — cancelQueries 가 끝나기 직전에 다른 탭 알림이 처리된다
  const originalCancel = queryClient.cancelQueries.bind(queryClient);
  queryClient.cancelQueries = async (...args) => {
    await originalCancel(...args);
    handleAuthTabEvent({ type: 'login-complete', sellerId: SELLER_B.id });
  };
  const error = await mutation.mutate({ sectionId: 1, bucket: 'exclude' }).then(() => null, (e) => e);
  await tick();
  check('저장 요청을 보내지 않음(PATCH 0회)', server.count(`PATCH /jobs/${JOB}/sections/1`) === 0);
  check('세션 변경 오류로 끝나고 캐시를 다시 만들지 않음', error instanceof AuthSessionChangedError && cacheKeys(queryClient).length === 0, String(error));
}

// ── 같은 계정이면 기존 동작 유지 ──────────────
console.log('\n[회귀: 계정이 그대로면 기존 optimistic·rollback·invalidate 유지]');
{
  const { queryClient, mutation } = setupTab();
  createServer();
  globalThis.fetch = (() => {
    const original = globalThis.fetch;
    return async (url, init = {}) => ((init.method ?? 'GET') === 'PATCH' ? json(500, { error: { code: 'INTERNAL' } }) : original(url, init));
  })();
  setAuthenticated('a1', SELLER_A);
  await queryClient.fetchQuery({ queryKey: SECTIONS_KEY, queryFn: getSections });
  const error = await mutation.mutate({ sectionId: 1, bucket: 'exclude' }).then(() => null, (e) => e);
  await tick();
  const query = queryClient.getQueryCache().find({ queryKey: SECTIONS_KEY });
  check('같은 계정 저장 실패 → rollback(섹션 1 include)', error instanceof Error && bucketOf(queryClient.getQueryData(SECTIONS_KEY), 1) === 'include');
  check('같은 계정 → onSettled invalidate 유지', query?.state.isInvalidated === true);
}
{
  const { queryClient, mutation } = setupTab();
  const server = createServer();
  setAuthenticated('a1', SELLER_A);
  await queryClient.fetchQuery({ queryKey: SECTIONS_KEY, queryFn: getSections });
  queryClient.setQueryData(PREVIEW_KEY, { sections: [{ id: 1, bucket: 'include' }] });
  const saving = mutation.mutate({ sectionId: 1, bucket: 'exclude' });
  await server.patchArrived;
  server.releasePatch();
  await saving;
  await tick();
  check('같은 계정 저장 성공 → 프리뷰 bucket 반영', queryClient.getQueryData(PREVIEW_KEY)?.sections?.[0]?.bucket === 'exclude');
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
