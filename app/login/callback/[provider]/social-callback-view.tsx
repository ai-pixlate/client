'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { isSocialLoginEnabled } from '@/lib/auth/capability';
import { AUTH_HOME_PATH, AUTH_LOGIN_PATH, isSocialProvider } from '@/lib/auth/constants';
import { socialLoginErrorMessage, type SocialLoginErrorKind } from '@/lib/auth/errors';
import { completeSocialLogin } from '@/lib/auth/social-login';

type CallbackState = { kind: 'working' } | { kind: 'error'; error: SocialLoginErrorKind };

/**
 * 콜백 처리 화면. 성공하면 M1(2차 — 신규·기존 계정 모두)로 바로 이동한다.
 * 같은 provider+code+state 의 완료 요청은 effect 가 다시 실행돼도 한 번만 나간다(lib/auth/social-login.ts completeSocialLogin).
 * 진행·오류 화면은 Figma 가 없어 G1 고지와 같은 글자 크기·색으로 최소한만 둔다. 자동으로 다시 요청하지 않는다.
 */
export function SocialCallbackView({
  provider,
  code,
  state,
  providerError,
}: {
  provider: string;
  code: string | null;
  state: string | null;
  providerError: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<CallbackState>({ kind: 'working' });

  useEffect(() => {
    let active = true;
    const fail = (error: SocialLoginErrorKind) => {
      if (active) setView({ kind: 'error', error });
    };
    if (!isSocialLoginEnabled() || !isSocialProvider(provider)) return fail('not-available');
    // 사용자가 제공자 화면에서 취소했거나 제공자가 오류를 돌려줌 — 완료 요청을 보내지 않는다
    if (providerError) return fail('cancelled');
    if (!code || !state) return fail('state-invalid');

    void completeSocialLogin({ provider, code, state }).then((result) => {
      if (!active) return;
      if (result.kind === 'success') router.replace(AUTH_HOME_PATH);
      // 완료 여부를 알 수 없음(응답 전 새로고침·login_in_progress 등) — G1 에서 안내하고 새 start 를 기다린다
      else if (result.error === 'callback-unconfirmed') router.replace(AUTH_LOGIN_PATH);
      else setView({ kind: 'error', error: result.error });
    });
    return () => {
      active = false;
    };
  }, [provider, code, state, providerError, router]);

  return (
    <main data-testid="g1-callback" className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-white px-6 text-center">
      {view.kind === 'working' ? (
        <p role="status" data-testid="g1-callback-working" className="text-[14px] leading-[22px] tracking-[-0.42px] text-[#707070]">
          로그인하는 중입니다.
        </p>
      ) : (
        <>
          <p role="alert" data-testid="g1-callback-error" data-error={view.error} className="text-[14px] leading-[22px] tracking-[-0.42px] text-[#e5484d]">
            {socialLoginErrorMessage(view.error)}
          </p>
          <Link href={AUTH_LOGIN_PATH} data-testid="g1-callback-retry" className="text-[14px] leading-[22px] tracking-[-0.42px] text-[#171717] underline">
            로그인 화면으로
          </Link>
        </>
      )}
    </main>
  );
}
