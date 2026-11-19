'use client';

import type { AuthNotice } from '@/lib/auth/session-store';

import { useAuthSnapshot } from './use-auth-snapshot';

const NOTICE_TEXT: Record<AuthNotice, string> = {
  'account-changed': '다른 탭에서 계정이 바뀌어 새 계정으로 전환했습니다. 저장하지 않은 편집은 사라졌습니다.',
  'auth-unavailable': '일시적으로 로그인 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  'auth-failed': '로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.',
  'recovery-stopped': '로그인 상태를 자동으로 되살리지 못했습니다. 다시 로그인해 주세요.',
  'logout-pending': '로그아웃했지만 서버 로그아웃을 확인하지 못했습니다.',
};

/**
 * 인증 사건을 보조기기에 알리는 live region. 화면에 보이는 안내(토스트·배너)는 Figma 가 정해지지 않아 만들지 않았다 —
 * 표시 디자인이 나오면 같은 notice 상태를 그 컴포넌트에 연결한다.
 */
export function AuthNoticeAnnouncer() {
  const { notice } = useAuthSnapshot();
  return (
    <div role="status" aria-live="polite" data-testid="auth-notice" data-notice={notice ?? ''} className="sr-only">
      {notice ? NOTICE_TEXT[notice] : ''}
    </div>
  );
}
