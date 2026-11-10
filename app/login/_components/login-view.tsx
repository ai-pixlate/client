'use client';

/* eslint-disable @next/next/no-img-element -- GIF 와 고정 크기 Figma 자산은 next/image 최적화 대상이 아니다 */

import { type CSSProperties, useRef } from 'react';

import { splitGraphemes } from '@/lib/auth/login-gif-contrast';

import { useLoginGifContrast } from './use-login-gif-contrast';

/**
 * 세로 리듬(Figma 1920×1080 기준). 높이가 1080 이상이면 Figma 값 그대로이고, 낮아지면 요소·글자 크기는 두고 여백만 줄인다.
 *   --g1-unit : 여백 공통 배율. 0.0926vh 는 1080 에서 1px 을 살짝 넘겨 min() 이 정확히 1px 을 고르게 하는 값이다.
 *   --g1-edge : 위·아래 바깥 여백(120). 왼쪽 패널 로고도 같은 값을 써서 양쪽 로고 높이가 같다.
 */
const VERTICAL_RHYTHM = {
  '--g1-unit': 'min(1px, 0.0926vh)',
  '--g1-micro-to-headline': 'max(64px, calc(91.19 * var(--g1-unit)))',
  '--g1-edge': 'max(24px, calc(120 * var(--g1-unit)))',
} as CSSProperties;

const LOGIN_GIF_SRC = '/auth/pixlate_login.gif';

/** 오른쪽 제목·소셜 버튼 묶음의 폭(Figma 432). 패널이 더 좁을 때만 줄어든다 */
const AUTH_CONTROL_WIDTH = 'w-[432px] max-w-full';

/** 글자별로 색이 바뀌는 GIF 위 문구 한 줄. 읽기는 문장 단위로 하도록 글자 span 은 보조기기에서 숨긴다. 색만 바뀌어 위치가 변하지 않는다 */
function ContrastLine({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  return (
    <p role="group" aria-label={text} data-testid={testId} className={className}>
      {splitGraphemes(text).map((grapheme, index) => (
        <span key={index} aria-hidden="true" data-g1-grapheme="" className="text-[#999] transition-colors duration-[80ms] ease-linear data-[on-orange]:text-[#171717]">
          {grapheme}
        </span>
      ))}
    </p>
  );
}

function BrandLayer() {
  const panelRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLoginGifContrast(LOGIN_GIF_SRC, panelRef, imageRef, canvasRef);

  return (
    <section
      ref={panelRef}
      data-testid="g1-brand-layer"
      className="relative min-h-screen w-[min(1120px,58.3334%)] shrink-0 overflow-hidden bg-black"
    >
      {/* Figma IMAGE FILL 과 같은 의미. 장식이므로 대체 텍스트를 비운다. 파일이 없어도 검은 배경 위 문구는 유지된다 */}
      <img ref={imageRef} data-testid="g1-brand-gif" alt="" src={LOGIN_GIF_SRC} className="absolute inset-0 size-full max-w-none object-cover" />
      <canvas ref={canvasRef} hidden aria-hidden="true" data-testid="g1-brand-gif-canvas" className="absolute inset-0 size-full object-cover" />
      {/* 오른쪽 로고와 같은 위쪽 여백을 쓴다. 문구는 한 흐름이라 줄이 바뀌어도 겹치지 않는다 */}
      <div className="absolute inset-x-[60px] top-[var(--g1-edge)]">
        <img data-testid="g1-brand-logo" alt="pix/ate" src="/auth/pixlate-wordmark-on-dark.svg" className="block h-[39.22px] w-[128px] max-w-none" />
        <ContrastLine testId="g1-brand-micro" text="AI LOCALIZATION WORKSPACE" className="mt-[19.59px] text-[11px] font-light leading-[13px] tracking-[0.88px] whitespace-nowrap" />
        <div data-testid="g1-brand-headline" className="mt-[var(--g1-micro-to-headline)] text-[46px] font-semibold leading-[1.28] text-white">
          <p>상세페이지를 번역하는 것에서,</p>
          <p>현지에 맞게 완성하는 것까지.</p>
        </div>
        {/* 제목과 보조 문구는 한 묶음이라 줄이지 않는다 */}
        <div data-testid="g1-brand-subcopy" className="mt-[32.24px] text-[16px] leading-[19px] tracking-[-0.48px]">
          <ContrastLine text="AI가 분석하고 번역하고 검수합니다." />
          <ContrastLine text="필요한 순간, 당신 옆엔 픽슬레이트" />
        </div>
      </div>
      <ContrastLine testId="g1-brand-footer" text="LOCALIZE · VERIFY · EXPORT" className="absolute bottom-[64px] left-[60px] text-[12px] font-light leading-[14px] tracking-[-0.48px] whitespace-nowrap" />
    </section>
  );
}

/** 소셜 인증 API 계약이 확정되지 않아 아직 연결하지 않은 동작. 가짜 로그인·토큰·이동을 만들지 않으려고 눌러도 아무 일도 일어나지 않게 둔다 */
const INERT_BUTTON = { type: 'button', 'aria-disabled': true } as const;
const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]';

function SocialButtons() {
  return (
    <div data-testid="g1-social" className={`flex ${AUTH_CONTROL_WIDTH} flex-col gap-4`}>
      <button
        {...INERT_BUTTON}
        data-testid="g1-social-kakao"
        className={`box-border flex h-[45px] w-full cursor-default items-center justify-center gap-2 rounded-[6px] bg-[#fee500] text-[16px] leading-[19px] tracking-[-0.48px] text-black/85 ${FOCUS_RING}`}
      >
        <img alt="" src="/auth/kakao-logo-18.svg" className="block size-[18px] max-w-none" />
        카카오로 시작하기
      </button>
      <button
        {...INERT_BUTTON}
        data-testid="g1-social-google"
        className={`box-border flex h-[45px] w-full cursor-default items-center justify-center gap-2 rounded-[6px] border border-[#eaeaea] bg-white text-[16px] leading-[19px] tracking-[-0.48px] text-black/85 ${FOCUS_RING}`}
      >
        <span className="relative block size-6 shrink-0 overflow-hidden">
          <img alt="" src="/auth/google-mark.svg" className="absolute inset-[10.18%_10.42%_10.19%_11.54%] block max-w-none" />
        </span>
        Google로 계속하기
      </button>
    </div>
  );
}

/**
 * 이용약관·개인정보 처리방침 표기(Figma 1667:14345 의 밑줄 강조). 문서 페이지가 아직 없어 링크를 만들지 않는다.
 * 페이지가 생기면 이 요소만 같은 스타일의 링크로 바꾼다.
 */
function LegalTerm({ children }: { children: string }) {
  return <span className="font-medium underline decoration-solid [text-underline-position:from-font]">{children}</span>;
}

/** 소셜 버튼 아래 동의 고지. 체크박스 없이 계속 진행하면 동의한 것으로 본다(Figma 2줄, 가운데 정렬) */
function ConsentNotice() {
  return (
    <p data-testid="g1-consent" className="text-center text-[14px] leading-[22px] tracking-[-0.42px] text-[#707070]">
      <span className="block">
        계속하면 픽슬레이트 <LegalTerm>이용약관</LegalTerm>과 <LegalTerm>개인정보 처리방침</LegalTerm>에
      </span>{' '}
      <span className="block">동의하는 것으로 봅니다.</span>
    </p>
  );
}

/**
 * G1 로그인(Figma 835:6511) — 카카오·Google 소셜 로그인 전용 화면이다. 이메일 로그인·회원가입·자동 로그인은 제품 범위에서 제외되었다.
 * 소셜 인증 API 가 확정되지 않아 어떤 요청도 보내지 않는다. 실제 인증은 계약 확정 후 별도 작업으로 연결한다.
 * 세로 배치: 로고 아래 남은 공간을 Figma 비율(위 242 : 아래 233)로 나눠 제목·소셜·고지 묶음을 놓는다.
 */
export function LoginView() {
  return (
    <main data-testid="g1-login" style={VERTICAL_RHYTHM} className="flex min-h-screen w-full">
      <BrandLayer />
      <section
        data-testid="g1-auth-panel"
        className="flex min-w-0 flex-1 flex-col bg-white pl-[min(156px,8.1251vw)] pr-6 pt-[var(--g1-edge)] pb-[var(--g1-edge)]"
      >
        <img data-testid="g1-auth-logo" alt="pix/ate" src="/auth/pixlate-wordmark-on-light.svg" className="block h-[39px] w-[128px] max-w-none shrink-0" />

        <div aria-hidden="true" className="min-h-6 grow-[242]" />
        <div data-testid="g1-content" className={`flex ${AUTH_CONTROL_WIDTH} shrink-0 flex-col`}>
          <div data-testid="g1-heading" className="flex flex-col gap-4">
            <p className="text-[12px] font-light leading-[14px] tracking-[-0.48px] text-[#999]">WELCOME</p>
            <h1 className="text-[32px] font-bold leading-[38px] tracking-[-0.64px] text-[#171717]">만나서 반가워요.</h1>
          </div>
          <div className="mt-[52px]">
            <SocialButtons />
          </div>
          <div className="mt-[56px]">
            <ConsentNotice />
          </div>
        </div>
        <div aria-hidden="true" className="min-h-6 grow-[233]" />
      </section>
    </main>
  );
}
