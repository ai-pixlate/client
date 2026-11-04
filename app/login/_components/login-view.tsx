'use client';

/* eslint-disable @next/next/no-img-element -- GIF 와 고정 크기 Figma 자산은 next/image 최적화 대상이 아니다 */

import { type FormEvent, useRef, useState } from 'react';

import { CompactCheckbox } from '@/app/_components/library/library-controls';
import { type LoginFormErrors, validateLoginForm } from '@/lib/auth/login-form';

function BrandLayer() {
  return (
    <section
      data-testid="g1-brand-layer"
      className="relative min-h-screen w-[min(1120px,58.3334%)] shrink-0 overflow-hidden bg-black"
    >
      {/* Figma IMAGE FILL 과 같은 의미. 장식이므로 대체 텍스트를 비운다. 파일이 없어도 검은 배경 위 문구는 유지된다 */}
      <img data-testid="g1-brand-gif" alt="" src="/auth/pixlate_login.gif" className="absolute inset-0 size-full max-w-none object-cover" />
      <img
        data-testid="g1-brand-logo"
        alt="pix/ate"
        src="/auth/pixlate-wordmark-on-dark.svg"
        className="absolute left-[60px] top-[120px] h-[39.22px] w-[128px] max-w-none"
      />
      <p data-testid="g1-brand-micro" className="absolute left-[60px] top-[178.81px] text-[11px] font-light leading-[13px] tracking-[0.88px] whitespace-nowrap text-[#999]">
        AI LOCALIZATION WORKSPACE
      </p>
      <div data-testid="g1-brand-headline" className="absolute left-[60px] top-[283px] max-w-[calc(100%-120px)] text-[46px] font-semibold leading-[1.28] text-white">
        <p>상세페이지를 번역하는 것에서,</p>
        <p>현지에 맞게 완성하는 것까지.</p>
      </div>
      <div data-testid="g1-brand-subcopy" className="absolute left-[60px] top-[433px] text-[16px] leading-[19px] tracking-[-0.48px] text-[#999]">
        <p>AI가 분석하고 번역하고 검수합니다.</p>
        <p>필요한 순간, 당신 옆엔 픽슬레이트</p>
      </div>
      <p data-testid="g1-brand-footer" className="absolute bottom-[64px] left-[60px] text-[12px] font-light leading-[14px] tracking-[-0.48px] whitespace-nowrap text-[#999]">
        LOCALIZE · VERIFY · EXPORT
      </p>
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
    <div data-testid="g1-social" className="flex w-full max-w-[432px] flex-col gap-3">
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
    <main data-testid="g1-login" className="flex min-h-screen w-full">
      <BrandLayer />
      <section
        data-testid="g1-auth-panel"
        className="flex min-w-0 flex-1 flex-col bg-white pl-[min(156px,8.1251vw)] pr-6 pt-[min(120px,11.12vh)] pb-[min(120px,11.12vh)]"
      >
        <img data-testid="g1-auth-logo" alt="pix/ate" src="/auth/pixlate-wordmark-on-light.svg" className="block h-[39px] w-[128px] max-w-none shrink-0" />

        <form
          data-testid="g1-form"
          noValidate
          onSubmit={handleSubmit}
          className="mb-6 mt-[min(115px,10.65vh)] flex w-full max-w-[432px] flex-col gap-[60px]"
        >
          <div className="flex flex-col gap-3">
            <p className="text-[12px] font-light leading-[14px] tracking-[-0.48px] text-[#999]">WELCOME BACK</p>
            <h1 className="text-[32px] font-bold leading-[38px] tracking-[-0.64px] text-[#171717]">다시 만나서 반가워요.</h1>
          </div>

          <div className="flex flex-col gap-3">
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

          <div className="flex flex-col items-center gap-8">
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
