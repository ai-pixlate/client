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
 */
export function AccountLogoutButton() {
  const [pending, setPending] = useState(false);
  if (!isAccountLogoutEnabled()) return null;

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      await logout();
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      data-testid="account-logout"
      aria-disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => void onClick()}
      className="absolute top-10 right-10 rounded-[6px] border border-[#eaeaea] bg-white px-3 py-[6px] text-[12px] leading-[normal] tracking-[-0.24px] whitespace-nowrap text-[#171717] aria-disabled:cursor-not-allowed aria-disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
    >
      {pending ? '로그아웃 중...' : '로그아웃'}
    </button>
  );
}
