'use client';

import { useState } from 'react';

import { useAuthSnapshot } from '@/app/_components/auth/use-auth-snapshot';
import { retryPendingLogout } from '@/lib/auth/logout';
import { setAuthNotice } from '@/lib/auth/session-store';

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]';

/**
 * 「서버 로그아웃 미완료」(AuthSnapshot.notice === 'logout-pending') 화면 안내와 [다시 시도].
 * 소셜 로그인 오류(g1-social-error)와 다른 인증 계약 상태라 따로 둔다. 보조기기 알림은 AuthNoticeAnnouncer 가 이미 하므로
 * 이 블록은 live region 을 두지 않는다(같은 문구가 두 번 읽히지 않게).
 *
 * 재시도는 lib/auth/logout.ts retryPendingLogout() 만 쓴다(쿠키만 전송·refresh 없음).
 *   204·refresh_invalid → 대기 기록은 retryPendingLogout 이 지운다. 여기서는 안내만 지운다. G1 유지
 *   그 밖(503·origin_not_allowed·422 …) → 대기·안내 유지. 자동 반복 없음 — 사용자가 다시 누를 때만 보낸다
 *
 * Figma 에 이 상태 디자인이 없어 G1 고지 글자 크기·Border·Secondary 버튼 스타일로 최소한만 둔다.
 */
export function LogoutPendingNotice() {
  const { notice } = useAuthSnapshot();
  const [retrying, setRetrying] = useState(false);

  if (notice !== 'logout-pending') return null;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const result = await retryPendingLogout();
      if (result.kind === 'done') setAuthNotice(null);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      data-testid="g1-logout-pending"
      className="flex items-center justify-between gap-3 rounded-[6px] border border-[#eaeaea] bg-white py-3 pr-3 pl-4"
    >
      <p className="min-w-0 text-[14px] leading-[22px] tracking-[-0.42px] text-[#171717]">로그아웃했지만 서버 로그아웃을 확인하지 못했습니다.</p>
      <button
        type="button"
        data-testid="g1-logout-pending-retry"
        aria-disabled={retrying}
        aria-busy={retrying || undefined}
        onClick={() => void retry()}
        className={`shrink-0 rounded-[4px] border border-[#eaeaea] bg-white px-3 py-[6px] text-[12px] leading-[normal] tracking-[-0.24px] whitespace-nowrap text-[#171717] aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${FOCUS_RING}`}
      >
        다시 시도
      </button>
    </div>
  );
}
