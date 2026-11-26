/**
 * H 홈 화면 로직 — 인증 진입 상태 · 사용자 상태별 뷰 판정 · 최근 작업 행.
 *
 * React 없이 Node 에서 검증할 수 있는 순수 함수만 둔다(scripts/verify-home-view.mjs).
 *
 * /home 한 경로가 두 책임을 나눠 가진다(구현 결정 — 요구사항의 H0 는 로그인 후 홈이고, 공개 랜딩 경로는 요구사항에 없다):
 *   공개 랜딩  Home / landing page 1492:10051 — 세션이 없을 때. 보호 API(브랜드·보관함)를 부르지 않는다
 *   H0        Home / scroll 1776:4171 · Home / for new 1779:4227 — 계정이 확정된 뒤에만 브랜드·보관함을 부른다
 *
 * 진입 상태(resolveHomeEntry):
 *   checking      새로고침 직후(unknown) — 세션 확인 중. 랜딩도 H0 도 그리지 않는다(깜빡임·보호 데이터 노출 방지)
 *   signed-out    세션 없음 → 랜딩
 *   authenticated 계정 확정 → H0
 *   check-failed  서버·네트워크 문제·자동 복구 중단으로 확인하지 못함 — 로그아웃으로 보지 않는다(랜딩도 H0 도 아님)
 *
 * 최근 작업: 현재 계약에서 작업 목록(GET /jobs)은 🔵12월 stub 이라 쓸 수 없다. 조회 가능한 것은 GET /library(저장 완료 job 투영)뿐이라
 * 그 카드를 savedAt 내림차순으로 보여 주고, 상태는 계약상 모두 「완료」다. 검수·번역중 같은 진행 상태는 만들지 않는다.
 */

import type { AuthStatus } from '../auth/session-store.ts';
import type { LibraryCardViewModel } from '../library/adapter.ts';

export type HomeEntry = 'checking' | 'signed-out' | 'authenticated' | 'check-failed';

export function resolveHomeEntry(input: {
  authStatus: AuthStatus;
  /** 실백엔드 개발용 간이 로그인(dev-login) — 앱 시작 때 세션을 이미 만들었다(lib/api/session.ts) */
  devLogin: boolean;
  /** 이 탭에서 방금 한 세션 확인이 서버·네트워크 문제로 실패했다 */
  probeFailed: boolean;
}): HomeEntry {
  if (input.devLogin || input.authStatus === 'authenticated') return 'authenticated';
  if (input.authStatus === 'signed-out') return 'signed-out';
  if (input.authStatus === 'recovery-stopped') return 'check-failed';
  return input.probeFailed ? 'check-failed' : 'checking';
}

export type HomeView = 'checking' | 'check-failed' | 'landing' | 'loading' | 'error' | 'returning' | 'new';

export function resolveHomeView(input: {
  entry: HomeEntry;
  brands: { status: 'pending' | 'error' | 'success'; count: number };
}): HomeView {
  if (input.entry === 'checking') return 'checking';
  if (input.entry === 'check-failed') return 'check-failed';
  if (input.entry === 'signed-out') return 'landing';
  if (input.brands.status === 'error') return 'error';
  if (input.brands.status === 'pending') return 'loading';
  return input.brands.count > 0 ? 'returning' : 'new';
}

/** Figma 최근 작업 목록(1778:4273)은 머리행 + 4행이다 */
export const HOME_RECENT_LIMIT = 4;

export interface HomeRecentRow {
  jobId: number;
  productName: string;
  brandName: string;
  /** 코드값 — 표시 이름은 화면이 master 조회로 바꾼다 */
  targetCountry: string | null;
  targetLanguage: string | null;
  statusLabel: string;
  /** 「YYYY.MM.DD  HH:mm」(Figma 표기 — 날짜와 시각 사이 공백 2칸). 시각이 없으면 null */
  changedAt: string | null;
}

/** GET /library 는 저장(완료)된 job 만 준다 */
const SAVED_STATUS_LABEL = '완료';

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

export function formatRecentChangedAt(value: string | null): string | null {
  const t = parseTime(value);
  if (t === null) return null;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 최신 변경순(savedAt 내림차순, 시각 없는 카드는 뒤) 상위 limit 개 */
export function toHomeRecentRows(cards: readonly LibraryCardViewModel[], limit: number = HOME_RECENT_LIMIT): HomeRecentRow[] {
  return [...cards]
    .sort((a, b) => {
      const ta = parseTime(a.savedAt);
      const tb = parseTime(b.savedAt);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    })
    .slice(0, limit)
    .map((card) => ({
      jobId: card.jobId,
      productName: card.productName ?? '',
      brandName: card.brandName ?? '',
      targetCountry: card.targetCountry,
      targetLanguage: card.targetLanguage,
      statusLabel: SAVED_STATUS_LABEL,
      changedAt: formatRecentChangedAt(card.savedAt),
    }));
}
