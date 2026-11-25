'use client';

import { useState } from 'react';

import { isAccountLogoutEnabled } from '@/lib/auth/capability';
import { logout } from '@/lib/auth/logout';

/**
 * 세션 사용자용 로그아웃 버튼(정식 진입점). Figma 확정 전이라 M1 우측 상단에 임시로 둔다 — 계정 메뉴·아바타·dropdown 은 만들지 않는다.
 *
 * - 노출: lib/auth/capability.ts isAccountLogoutEnabled()(session 모드 + 로컬 인증 시험 모드 아님). 화면에서 환경변수를 해석하지 않는다.
 * - 스타일: 기존 Secondary 버튼(흰 배경·#EAEAEA border·#171717 글자)을 작은 크기로 쓴다. 임시 시험 버튼의 dashed 스타일은 쓰지 않는다.
 * - 동작: 클릭 → 진행 중 잠금 → 기존 logout() 호출뿐이다. 응답 분기(204·invalid_token 쿠키만 1회·refresh_invalid·미완료 pending),
 *   G1 이동, 모든 탭 logout 알림, logout-pending 안내는 모두 logout() 이 맡는다.
 * - appearance: 'floating'(기본) = M1 우측 상단 임시 위치. 'header' = N1~N6 작업용 헤더(Figma header 1809:42006 「작업용」의
 *   「로그인/로그아웃」 60×24 · pl 12 · 14px #707070) 안의 글자 버튼. 동작은 둘이 같다 — 모양만 다르다.
 */
const APPEARANCE_CLASS = {
  floating:
    'absolute top-10 right-10 rounded-[6px] border border-[#eaeaea] bg-white px-3 py-[6px] text-[12px] leading-[normal] tracking-[-0.24px] text-[#171717]',
  header: 'flex h-6 min-w-[60px] items-center justify-center pl-3 text-[14px] leading-[normal] tracking-[-0.14px] text-[#707070]',
} as const;

export function AccountLogoutButton({
  appearance = 'floating',
  onRequest,
}: {
  appearance?: keyof typeof APPEARANCE_CLASS;
  /**
   * 로그아웃 전에 확인이 필요한 화면(N1~N6 작업 나가기 — PRD F-JOB-07)이 넘긴다. 버튼은 로그아웃을 바로 하지 않고 실행 함수를
   * 넘기며, 받은 쪽이 확인(작업 취소 성공) 뒤에만 부른다. 없으면 바로 로그아웃한다.
   */
  onRequest?: (runLogout: () => Promise<void>) => void;
} = {}) {
  const [pending, setPending] = useState(false);
  if (!isAccountLogoutEnabled()) return null;

  const runLogout = async () => {
    if (pending) return;
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
    }
  };
  const onClick = () => {
    if (pending) return;
    if (onRequest) onRequest(runLogout);
    else void runLogout();
  };

  return (
    <button
      type="button"
      data-testid="account-logout"
      aria-disabled={pending}
      aria-busy={pending || undefined}
      onClick={onClick}
      className={`${APPEARANCE_CLASS[appearance]} whitespace-nowrap aria-disabled:cursor-not-allowed aria-disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]`}
    >
      {pending ? '로그아웃 중...' : '로그아웃'}
    </button>
  );
}
