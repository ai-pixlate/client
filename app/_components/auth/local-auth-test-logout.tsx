'use client';

import { useState } from 'react';

import { isLocalAuthTestMode } from '@/lib/auth/capability';
import { logout } from '@/lib/auth/logout';

/**
 * 로컬 실서버 인증 연동 시험용 임시 진입점이며 정식 로그아웃 UX 위치는 별도 디자인 확정 대상이다.
 *
 * - 목적: 이미 구현된 lib/auth/logout.ts logout() 을 실제 브라우저에서 불러 BE 로그아웃 계약을 시험한다.
 * - 노출: lib/auth/capability.ts isLocalAuthTestMode()(next dev + NEXT_PUBLIC_AUTH_MODE=session + Mock 꺼짐)일 때만.
 *   일반 Mock 개발 환경·production build 에서는 렌더하지 않는다. 화면에서 환경변수를 직접 해석하지 않는다.
 * - GNB·계정 메뉴·프로필 메뉴 같은 제품 navigation 을 만들지 않는다. M1 에 로그아웃 위치를 확정한 것이 아니다.
 * - 응답 분기(204·invalid_token 쿠키만 1회·refresh_invalid·미완료 pending), G1 이동, 모든 탭 logout 알림, logout-pending 안내는
 *   모두 logout() 이 맡는다. 같은 탭 중복 클릭은 logout() 의 single-flight 와 이 버튼의 진행 중 잠금이 함께 막는다.
 */
export function LocalAuthTestLogout() {
  const [pending, setPending] = useState(false);
  if (!isLocalAuthTestMode()) return null;

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
      data-testid="local-auth-test-logout"
      aria-disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => void onClick()}
      className="absolute top-10 right-10 rounded-[4px] border border-dashed border-[#999] bg-white px-3 py-[6px] text-[12px] leading-[normal] tracking-[-0.24px] whitespace-nowrap text-[#707070] aria-disabled:cursor-not-allowed aria-disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
    >
      로그아웃(인증 시험)
    </button>
  );
}
