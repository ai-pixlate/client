'use client';

/* eslint-disable @next/next/no-img-element -- GIF 와 고정 크기 Figma 자산은 next/image 최적화 대상이 아니다 */

import { type CSSProperties, type FormEvent, useRef, useState } from 'react';

import { CompactCheckbox } from '@/app/_components/library/library-controls';
import { type LoginFormErrors, validateLoginForm } from '@/lib/auth/login-form';
import { splitGraphemes } from '@/lib/auth/login-gif-contrast';

import { useLoginGifContrast } from './use-login-gif-contrast';

/**
 * 세로 리듬(Figma 1920×1080 기준). 높이가 1080 이상이면 Figma 값 그대로이고, 낮아지면 요소·글자 크기는 두고 여백만 줄인다.
 *   --g1-unit  : 내부 여백 공통 배율. 모든 내부 여백이 같은 비율(115 : 60 : 60 : 32)로 줄어든다.
 *   --g1-outer : 바깥 큰 여백(위 120 · 폼과 소셜 사이 148 · 아래 120) 배율. 내부 여백을 뺀 남은 높이를 나눠 쓴다.
 * 고정 높이 425 = 로고 39 + 제목 64 + 입력 158 + 버튼 45 + 링크 17 + 소셜 102, 바깥 여백 합 388 = 120 + 148 + 120.
 * 0.0926vh·424.9px 는 1080 에서 1px 을 살짝 넘겨 min() 이 정확히 1px 을 고르게 하는 값이다(부동소수 오차로 0.02px 줄어드는 것 방지).
 */
const VERTICAL_RHYTHM = {
  '--g1-unit': 'min(1px, 0.0926vh)',
  '--g1-logo-to-heading': 'max(80px, calc(115 * var(--g1-unit)))',
  '--g1-section': 'max(40px, calc(60 * var(--g1-unit)))',
  '--g1-button-to-links': 'max(24px, calc(32 * var(--g1-unit)))',
  '--g1-micro-to-headline': 'max(64px, calc(91.19 * var(--g1-unit)))',
  '--g1-outer': 'min(1px, calc((100vh - 424.9px - var(--g1-logo-to-heading) - 2 * var(--g1-section) - var(--g1-button-to-links)) / 388))',
  '--g1-edge': 'max(24px, calc(120 * var(--g1-outer)))',
} as CSSProperties;

const LOGIN_GIF_SRC = '/auth/pixlate_login.gif';

/** 오른쪽 입력·버튼 묶음의 폭(Figma 432). 폼과 소셜이 같은 값을 쓰고, 패널이 더 좁을 때만 줄어든다 */
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

function TextField({
  id,
  label,
  type,
  value,
  placeholder,
  autoComplete,
  error,
  inputRef,
  onChange,
}: {
  id: string;
  label: string;
  type: 'email' | 'password';
  value: string;
  placeholder: string;
  autoComplete: string;
  error?: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={id} className="text-[12px] font-light leading-[14px] tracking-[-0.48px] text-[#171717]">
        {label}
      </label>
      {/* Figma Text Input 28:47 — Focus #FF6A38, Error #E5484D, 입력값 #171717, placeholder #707070 */}
      <input
        ref={inputRef}
        id={id}
        name={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`box-border h-[39px] w-full rounded-[6px] border bg-white px-4 pb-[2px] text-[14px] leading-[17px] tracking-[-0.14px] text-[#171717] outline-none placeholder:text-[#707070] ${
          error ? 'border-[#e5484d]' : 'border-[#eaeaea] focus:border-[#ff6a38]'
        }`}
      />
      {error && (
        <p id={errorId} data-testid={errorId} className="text-[12px] leading-[14px] tracking-[-0.48px] text-[#e5484d]">
          {error}
        </p>
      )}
    </div>
  );
}

/** 라우트·서버 기능이 아직 없는 동작. 가짜 이동이나 가짜 로그인을 만들지 않으려고 눌러도 아무 일도 일어나지 않게 둔다 */
const INERT_BUTTON = { type: 'button', 'aria-disabled': true } as const;
const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]';

function SocialButtons() {
  return (
    <div data-testid="g1-social" className={`flex ${AUTH_CONTROL_WIDTH} flex-col gap-3`}>
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
 * G1 로그인(Figma 835:6511) — 화면만 구현한다. 로그인 API 가 실제 서버에 없어 어떤 요청도 보내지 않는다.
 * 제출은 입력 검증만 하고, 값이 유효해도 이동·성공 표시·저장을 하지 않는다. 실제 인증은 API 가 나오면 별도 작업으로 연결한다.
 */
export function LoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // 자동 로그인의 세션 유지 의미가 요구사항에 없어 화면 상태로만 둔다. 저장소에 쓰거나 서버로 보내지 않는다
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateLoginForm({ email, password });
    setErrors(nextErrors);
    if (nextErrors.email) emailRef.current?.focus();
    else if (nextErrors.password) passwordRef.current?.focus();
  };

  const clearError = (field: keyof LoginFormErrors) => {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  return (
    <main data-testid="g1-login" style={VERTICAL_RHYTHM} className="flex min-h-screen w-full">
      <BrandLayer />
      <section
        data-testid="g1-auth-panel"
        className="flex min-w-0 flex-1 flex-col bg-white pl-[min(156px,8.1251vw)] pr-6 pt-[var(--g1-edge)] pb-[var(--g1-edge)]"
      >
        <img data-testid="g1-auth-logo" alt="pix/ate" src="/auth/pixlate-wordmark-on-light.svg" className="block h-[39px] w-[128px] max-w-none shrink-0" />

        <form
          data-testid="g1-form"
          noValidate
          onSubmit={handleSubmit}
          className={`mb-6 mt-[var(--g1-logo-to-heading)] flex ${AUTH_CONTROL_WIDTH} flex-col gap-[var(--g1-section)]`}
        >
          <div data-testid="g1-heading" className="flex flex-col gap-3">
            <p className="text-[12px] font-light leading-[14px] tracking-[-0.48px] text-[#999]">WELCOME BACK</p>
            <h1 className="text-[32px] font-bold leading-[38px] tracking-[-0.64px] text-[#171717]">다시 만나서 반가워요.</h1>
          </div>

          <div data-testid="g1-fields" className="flex flex-col gap-3">
            <TextField
              id="login-email"
              label="이메일"
              type="email"
              value={email}
              placeholder="name@example.com"
              autoComplete="email"
              error={errors.email}
              inputRef={emailRef}
              onChange={(value) => {
                setEmail(value);
                clearError('email');
              }}
            />
            <TextField
              id="login-password"
              label="비밀번호"
              type="password"
              value={password}
              placeholder="비밀번호를 입력해주세요"
              autoComplete="current-password"
              error={errors.password}
              inputRef={passwordRef}
              onChange={(value) => {
                setPassword(value);
                clearError('password');
              }}
            />
            <div data-testid="g1-remember" className="flex h-5 items-center gap-2 self-start">
              <CompactCheckbox id="login-remember" checked={remember} onChange={() => setRemember((value) => !value)} testId="g1-remember-checkbox" />
              <label htmlFor="login-remember" className="-mt-px cursor-pointer text-[14px] leading-[17px] tracking-[-0.14px] whitespace-nowrap text-[#171717]">
                자동 로그인
              </label>
            </div>
          </div>

          <div className="flex flex-col items-center gap-[var(--g1-button-to-links)]">
            {/* Figma Button LG Primary */}
            <button
              type="submit"
              data-testid="g1-submit"
              className={`box-border flex h-[45px] w-full cursor-pointer items-center justify-center rounded-[6px] bg-[#171717] text-[14px] font-medium leading-[17px] tracking-[-0.42px] text-white ${FOCUS_RING}`}
            >
              로그인
            </button>
            <div data-testid="g1-links" className="flex items-center gap-[18px]">
              <button {...INERT_BUTTON} data-testid="g1-find-password" className={`cursor-default text-[14px] leading-[17px] tracking-[-0.14px] whitespace-nowrap text-black ${FOCUS_RING}`}>
                비밀번호 찾기
              </button>
              <span aria-hidden="true" className="relative block h-[13px] w-0 shrink-0">
                <span className="absolute inset-[-3.85%_-0.5px] block">
                  <img alt="" src="/auth/link-divider.svg" className="block size-full max-w-none" />
                </span>
              </span>
              <button {...INERT_BUTTON} data-testid="g1-signup" className={`cursor-default text-[14px] leading-[17px] tracking-[-0.14px] whitespace-nowrap text-black ${FOCUS_RING}`}>
                회원가입
              </button>
            </div>
          </div>
        </form>

        <div className="mt-auto">
          <SocialButtons />
        </div>
      </section>
    </main>
  );
}
