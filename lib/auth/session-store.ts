import type { AuthSeller } from './types.ts';

/**
 * 인증 세션 메모리 저장소. access token 은 이 모듈 변수에만 둔다 — localStorage·sessionStorage·IndexedDB 에 쓰지 않는다.
 * 새로고침하면 사라지고, refresh 쿠키(HttpOnly, FE 는 읽지 못함)로 다시 받는다.
 *
 * epoch 는 「이 탭이 보고 있는 계정·세션」의 세대다. 계정 전환·로그아웃·세션 종료 때 올라가며,
 * 요청을 보낼 때의 epoch 와 응답 시점 epoch 가 다르면 이전 계정 응답으로 보고 버린다(lib/auth/authorized-request.ts).
 * 세대마다 AbortSignal 이 하나 있고, 세대가 바뀌는 순간 abort 된다 — 이전 세대로 보낸 API 요청(본문 수신 포함)이 네트워크에서 끊긴다.
 *
 * 불변식(session 모드): access 가 있으면 seller 도 있다. access 는 setAuthenticated(소셜 완료 응답의 seller 와 함께) 또는
 * 복구가 /auth/me 로 계정을 확인한 뒤(refresh.ts)에만 들어온다. 그래서 seller=null 인 세대에는 인증된 응답이 없고,
 * 그 세대의 cache 에는 다른 계정 데이터가 있을 수 없다.
 */
export type AuthStatus =
  /** 아직 확인하지 않음(새로고침 직후 등). 첫 401 에서 refresh 로 복구한다 */
  | 'unknown'
  | 'authenticated'
  | 'signed-out'
  /** refresh_rotated 가 상한을 넘어 자동 복구를 멈춤. 서버 세션 폐기로 단정하지 않는다 — G1 로 갈 수 있는 상태 */
  | 'recovery-stopped';

/** 화면이 알려야 할 인증 사건. 표시 UI(Figma)는 아직 없어 상태만 둔다 */
export type AuthNotice = 'account-changed' | 'auth-unavailable' | 'auth-failed' | 'recovery-stopped' | 'logout-pending';

export interface AuthSnapshot {
  status: AuthStatus;
  seller: AuthSeller | null;
  epoch: number;
  notice: AuthNotice | null;
}

let accessToken: string | null = null;
let snapshot: AuthSnapshot = { status: 'unknown', seller: null, epoch: 0, notice: null };
let epochController = new AbortController();
const listeners = new Set<() => void>();

function publish(next: Partial<AuthSnapshot>): void {
  const epochChanged = next.epoch !== undefined && next.epoch !== snapshot.epoch;
  snapshot = { ...snapshot, ...next };
  if (epochChanged) {
    // 새 세대를 먼저 세운 뒤 이전 세대 요청을 끊는다 — abort 를 받은 쪽이 보는 epoch 는 이미 새 값이다
    const previous = epochController;
    epochController = new AbortController();
    previous.abort();
  }
  listeners.forEach((listener) => listener());
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAuthSnapshot(): AuthSnapshot {
  return snapshot;
}

export function getAuthEpoch(): number {
  return snapshot.epoch;
}

/** 지금 세대의 AbortSignal — 세대가 바뀌면 abort 된다. 요청은 보낼 때 이 값을 붙잡는다 */
export function getAuthEpochSignal(): AbortSignal {
  return epochController.signal;
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 로그인 완료(소셜 콜백) — 이 탭의 계정이 정해진다. 이전 계정이 있었다면 세대를 올린다 */
export function setAuthenticated(token: string, seller: AuthSeller): void {
  const changed = snapshot.seller != null && snapshot.seller.id !== seller.id;
  accessToken = token;
  publish({ status: 'authenticated', seller, epoch: changed ? snapshot.epoch + 1 : snapshot.epoch });
}

/** refresh 뒤 /auth/me 가 같은 계정이거나, 아직 계정을 몰랐던 탭이 계정을 알게 됨 */
export function confirmSeller(seller: AuthSeller): void {
  publish({ status: 'authenticated', seller });
}

/**
 * 계정 경계 — 이 탭의 이전 계정 세션을 끝낸다. 세대를 올리고(이전 세대 요청 abort·응답 폐기·복구 stale) access·seller 를 비운 뒤 안내를 남긴다.
 * 새 계정은 여기서 넣지 않는다 — 호출부(lib/auth/runtime.ts)가 이전 계정 데이터를 지운 다음 confirmSeller·setAccessToken 으로 넣는다.
 */
export function switchAccount(): void {
  accessToken = null;
  publish({ status: 'unknown', seller: null, epoch: snapshot.epoch + 1, notice: 'account-changed' });
}

/** 로그아웃·세션 종료 — access 와 계정 정보를 지우고 세대를 올린다 */
export function clearAuth(notice: AuthNotice | null = null): void {
  accessToken = null;
  publish({ status: 'signed-out', seller: null, epoch: snapshot.epoch + 1, notice });
}

/** 자동 복구 중단. 계정 정보는 두되 만료된 access 는 쓰지 않는다 */
export function stopRecovery(): void {
  accessToken = null;
  publish({ status: 'recovery-stopped', notice: 'recovery-stopped' });
}

export function setAuthNotice(notice: AuthNotice | null): void {
  publish({ notice });
}

/** 검증 스크립트 전용 초기화 */
export function resetAuthStoreForTest(): void {
  accessToken = null;
  epochController.abort();
  epochController = new AbortController();
  snapshot = { status: 'unknown', seller: null, epoch: 0, notice: null };
  listeners.clear();
}
