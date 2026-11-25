'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useAuthSnapshot } from '@/app/_components/auth/use-auth-snapshot';

// ─────────────────────────────────────────────────────────────────
// 작업용 헤더 [내 계정] 드롭다운 — Figma header 1809:42006 「작업용」(1809:42007 닫힘) · 「작업용_오픈」(1876:40072 열림) ·
// 내 계정 메뉴 1890:58502.
//
// 1920×1080: 버튼 x1623 y24 80×24(안쪽 pl 4 · 글자 14px · gap 4 · chevron 12). 닫힘 = 글자 #707070 · chevron down,
//   열림 = 글자 #171717 · chevron up. 메뉴 = 버튼 왼쪽 -10 · 버튼 아래 +8(x1613 y56) · 102×(38 × 행 수) · 흰 배경 · radius 8 ·
//   DS(2,2 · 24 · 6%) · 행 사이 #EAEAEA 1px · 글자 10px #707070(호버 변형은 이메일만 #FF6A38).
//
// 내용 — 정적인 계정 정보라 role="menu" 를 쓰지 않는다(고를 항목이 없다). 버튼 aria-expanded · aria-controls 로 묶은 영역이다.
// Figma 의 dabduck · dabduck@email.com · 카카오 로그인 은 예시 값이다. FE 인증 모델(AuthSeller)에 있는 것은 email 뿐이라
// 이메일 한 행만 실제 값으로 그린다. 이름·로그인 제공자는 서버 필드가 없어 만들지 않는다(TODO(ACCOUNT-CONTRACT)).
// 값은 기존 인증 세션 저장소(useAuthSnapshot — 메모리)에서 읽고 새 API 를 부르지 않는다. email=null(소셜 계정)은 「이메일 정보 없음」,
// 이 탭이 아직 계정을 모르면(새로고침 직후 401→refresh→/auth/me 전 · Mock 처럼 401 이 없는 환경) 「계정 정보 없음」이다.
//
// 닫힘: 버튼 다시 누름 · 바깥 누름 · 포커스가 바깥으로 감 · Escape(버튼으로 포커스 복귀) · 브라우저 뒤로 가기 ·
// 계정 세대(epoch — 로그아웃·계정 전환)나 화면 단계가 바뀜. 메뉴를 여는 것은 작업 나가기가 아니라 확인·요청이 없다.
// ─────────────────────────────────────────────────────────────────

export function JobHeaderAccountMenu({ step }: { step: string }) {
  const { seller, epoch } = useAuthSnapshot();
  // 연 시점의 계정 세대·단계에 묶는다 — 로그아웃·계정 전환·단계 전환이 일어나면 effect 없이 닫힌 상태가 된다
  const scope = `${epoch}:${step}`;
  const [openScope, setOpenScope] = useState<string | null>(null);
  const open = openScope === scope;
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback((returnFocus = false) => {
    setOpenScope(null);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const isOutside = (target: EventTarget | null) => !(target instanceof Node && containerRef.current?.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      if (isOutside(event.target)) close();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isOutside(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    const onPopState = () => close();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
    };
  }, [open, close]);

  const email = seller?.email ?? null;
  const fallback = seller ? '이메일 정보 없음' : '계정 정보 없음';

  return (
    <div ref={containerRef} data-account-open={open} className="pointer-events-auto relative flex">
      <button
        ref={buttonRef}
        type="button"
        data-testid="job-header-account"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenScope(open ? null : scope)}
        // N5 캔버스는 window 에서 Space keydown 을 막아 pan 에 쓴다 — 이 버튼의 Space 는 버튼 누름으로 남긴다(n5-toolbar 와 같은 방식)
        onKeyDown={(event) => {
          if (event.code === 'Space') event.stopPropagation();
        }}
        className="flex h-6 w-20 items-center justify-center rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
      >
        <span className="flex items-center gap-1 pl-1">
          <span
            className={`text-[14px] leading-[normal] tracking-[-0.14px] whitespace-nowrap ${open ? 'text-[#171717]' : 'text-[#707070]'}`}
          >
            내 계정
          </span>
          {/* Figma Navigation/Chevron Down·Up 12 — 12×12 칸 안 glyph 7.35×4.05(down top 4.125 · up top 3.825, left 2.325) */}
          <span aria-hidden="true" className="relative size-3 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={open ? '/jobs/icons/chevron-up-12.svg' : '/jobs/icons/chevron-down-12.svg'}
              alt=""
              data-testid="job-header-account-chevron"
              data-direction={open ? 'up' : 'down'}
              className={`absolute left-[2.325px] block h-[4.05px] w-[7.35px] max-w-none ${open ? 'top-[3.825px]' : 'top-[4.125px]'}`}
            />
          </span>
        </span>
      </button>

      <div
        id={panelId}
        role="group"
        aria-label="내 계정 정보"
        hidden={!open}
        data-testid="job-header-account-menu"
        className="absolute top-[calc(100%+8px)] left-[-10px] flex w-max min-w-[102px] max-w-[240px] flex-col rounded-[8px] bg-white drop-shadow-[2px_2px_12px_rgba(0,0,0,0.06)]"
      >
        <p
          data-testid="job-header-account-email"
          title={email ?? undefined}
          className={`flex h-[38px] items-center justify-center px-4 text-[10px] leading-[normal] font-light tracking-[-0.4px] text-[#707070] ${email ? 'hover:text-[#ff6a38]' : ''}`}
        >
          <span className="truncate">{email ?? fallback}</span>
        </p>
      </div>
    </div>
  );
}
