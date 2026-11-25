'use client';

import Link from 'next/link';

import { AccountLogoutButton } from '@/app/_components/auth/account-logout-button';
import { isAccountLogoutEnabled } from '@/lib/auth/capability';

import type { StepNavStep } from './step-nav';

// ─────────────────────────────────────────────────────────────────
// N1~N6 작업용 공통 헤더 — Figma header component set 1809:42006 「속성 1=작업용」(N1 525:3023 instance 1792:21551).
//
// 1920×1080: header 0/0/1920/72 · 좌우 padding 124 · 배경·border·shadow 없음.
//   좌측 x124 y12 h48 = home button 102×48(로고 78×24, 버튼 안 y12) + gap 12 + 화면명(14px · -1% · #171717, y27.5 h17)
//   우측 x1547 y24 249×24 = 브랜드관리 72×24 + gap 12 + 내 계정 72×24 + gap 16 + divider 1×12(#707070) + gap 16 + 로그아웃 60×24
//
// 배치: 화면마다 본문 시작 y 가 다르다(N1·N2·N4 = 96, N3 우측·N6 프리뷰 = 72). 그래서 헤더는 흐름에 72px 행을 넣지 않고
// 가장 가까운 positioned 조상(화면 전체)의 맨 위에 겹쳐 놓는다 — 본문 geometry 를 밀지 않는다.
// 컨테이너는 pointer-events 를 받지 않는다. z-10 은 S0 rail(z-20)과 dialog(z-50)보다 아래다.
//
// 로고 · [브랜드 관리] · [로그아웃]은 작업 나가기다(PRD F-JOB-07 · 화면정의서 HD) — 같은 확인은 페이지의 useJobExitGuard 가 맡는다.
// 링크 두 개는 가드가 클릭을 가로채고, 로그아웃은 버튼이라 실행 함수를 가드에 넘겨 확인(작업 취소 성공) 뒤에만 로그아웃한다.
// 로고의 PRD 목적지는 H0 홈이지만 H0 화면이 아직 없어 기존 보관함(/)으로 둔다.
// ─────────────────────────────────────────────────────────────────

/**
 * 화면명 SSOT — Figma 각 화면 header instance 의 「화면 분기」 문구.
 * N4 는 Figma(1821:48003)에 「이미지 분석」으로 남아 있지만 N4 프레임 이름·서비스 단계가 「번역 중」이라 복사 잔여로 보고 「번역 중」을 쓴다.
 */
export const JOB_HEADER_TITLES: Record<StepNavStep, string> = {
  N1: '정보 입력',
  N2: '이미지 분석',
  N3: '섹션 확인',
  N4: '번역 중',
  N5: '번역 중',
  N6: '저장 및 내보내기',
};

export function JobHeader({
  step,
  onLogoutRequest,
}: {
  step: StepNavStep;
  /** 작업 나가기 확인(useJobExitGuard requestLogout) — 확인 뒤에만 로그아웃한다 */
  onLogoutRequest?: (runLogout: () => Promise<void>) => void;
}) {
  const showLogout = isAccountLogoutEnabled();
  return (
    <header
      data-testid="job-header"
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-[72px] items-center justify-between px-[124px]"
    >
      <div className="flex h-12 items-center gap-3">
        <Link
          href="/"
          aria-label="보관함으로 이동"
          data-testid="job-header-home"
          className="pointer-events-auto flex h-12 w-[102px] items-center rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
        >
          {/* 기존 워드마크(128×39)를 Figma 로고 칸 78×24 에 비율 유지로 맞춘다 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/auth/pixlate-wordmark-on-light.svg" alt="pix/ate" className="block h-6 w-[78px] max-w-none object-contain" />
        </Link>
        <p data-testid="job-header-title" className="text-[14px] leading-[normal] tracking-[-0.14px] whitespace-nowrap text-[#171717]">
          {JOB_HEADER_TITLES[step]}
        </p>
      </div>

      <div data-testid="job-header-actions" className="flex h-6 items-center gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/brand"
            data-testid="job-header-brand"
            className="pointer-events-auto flex h-6 w-[72px] items-center justify-center rounded-[4px] text-[14px] leading-[normal] tracking-[-0.14px] whitespace-nowrap text-[#171717] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
          >
            브랜드관리
          </Link>
          {/* TODO(ACCOUNT-CONTRACT): 내 계정 화면·메뉴·사용자 정보 계약이 아직 없다. Figma 모양만 두고 이동·dropdown 은 만들지 않는다.
              type="button" 이라 눌러도 아무 일도 일어나지 않는다(가짜 route·메뉴 금지). 비활성처럼 흐리게 만들지 않는다. */}
          <button
            type="button"
            data-testid="job-header-account"
            className="pointer-events-auto flex h-6 w-[72px] items-center justify-center gap-[2px] rounded-[4px] bg-white px-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
          >
            <span className="px-[2px] text-[12px] leading-[normal] tracking-[-0.24px] whitespace-nowrap text-[#171717]">내 계정</span>
            {/* Figma Navigation/Chevron Down 12 — 12×12 칸 안 glyph(7.35×4.05)가 left 2.325 · top 4.125 */}
            <span aria-hidden="true" className="relative size-3 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/jobs/icons/chevron-down-12.svg" alt="" className="absolute top-[4.125px] left-[2.325px] block h-[4.05px] w-[7.35px] max-w-none" />
            </span>
          </button>
        </div>
        {/* 로그아웃은 기존 AccountLogoutButton(노출 조건·진행 중 잠금·logout())을 그대로 쓴다. 숨겨지는 환경에서는 divider 도 함께 숨긴다 */}
        {showLogout && (
          <>
            <span aria-hidden="true" data-testid="job-header-divider" className="h-3 w-px shrink-0 bg-[#707070]" />
            <span className="pointer-events-auto flex">
              <AccountLogoutButton appearance="header" onRequest={onLogoutRequest} />
            </span>
          </>
        )}
      </div>
    </header>
  );
}
