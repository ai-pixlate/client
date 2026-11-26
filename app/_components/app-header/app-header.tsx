'use client';

import Link from 'next/link';

import { AccountLogoutButton } from '@/app/_components/auth/account-logout-button';
import { LocalAuthTestLogout } from '@/app/_components/auth/local-auth-test-logout';
import { JobHeaderAccountMenu } from '@/app/jobs/_components/job-header-account-menu';
import { isAccountLogoutEnabled, isLocalAuthTestMode } from '@/lib/auth/capability';

// ─────────────────────────────────────────────────────────────────
// M·H 공통 헤더 — Figma header component set 1809:42006 의 M·H 변형.
//
//   work(M0 1792:20853 · M1 1806:32280 · M2 1809:37847): 1920×72 · px 124 · 배경 white
//     좌측 = home button 102×48(로고 78×24, pr 24 · py 12) + gap 12 + 화면명(14 Regular −0.14 #171717)
//     우측 = [브랜드 관리 72×24(#171717)] gap 12 [내 계정 80×24] · gap 16 · divider 1×12 #707070 · gap 16 · 로그아웃(pl 12, #707070)
//     M0 은 자기 자신이 브랜드 목록이라 [브랜드 관리]가 없다(showBrandManage=false).
//   home(H scroll 1792:18607 · H for new 1815:29736): 1920×131 · pt 40 · pb 28 · px 60
//     좌측 = home button(로고 128×39, pr 24 · py 12) + 「AI LOCALIZATION WORKSPACE」(12 Light −0.48 #707070), 우측은 work 와 같다.
//
// N1~N6 작업용 헤더(app/jobs/_components/job-header.tsx)는 작업 나가기 가드 때문에 따로 두고 여기서 바꾸지 않는다.
// [내 계정] 드롭다운은 작업용 헤더와 같은 컴포넌트(JobHeaderAccountMenu)를, 로그아웃은 AccountLogoutButton(노출 조건·잠금·logout())을 그대로 쓴다.
// 로고 목적지는 H 홈(/home)이다 — 기존 M1(/)·N 화면 경로는 바꾸지 않는다.
// [브랜드 관리]는 M0 브랜드 선택(/brand/select)으로 간다.
// ─────────────────────────────────────────────────────────────────

export const HOME_PATH = '/home';
export const BRAND_SELECT_PATH = '/brand/select';

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]';

export function AppHeader({
  variant,
  title,
  scope,
  showBrandManage = true,
  onLogoutRequest,
}: {
  variant: 'work' | 'home';
  /** work 변형의 화면명(Figma 「화면 분기」 문구) */
  title?: string;
  /** 계정 메뉴를 닫는 기준 — 화면이 바뀌면 열려 있던 메뉴가 닫힌다 */
  scope: string;
  showBrandManage?: boolean;
  /** 미저장 변경이 있는 화면(M2)이 확인 뒤에만 로그아웃하도록 넘긴다 */
  onLogoutRequest?: (runLogout: () => Promise<void>) => void;
}) {
  const showLogout = isAccountLogoutEnabled();
  // 로컬 실서버 인증 시험 모드의 임시 로그아웃 — 정식 버튼과 노출 조건이 겹치지 않아 같은 자리에 둘 중 하나만 보인다
  const showTestLogout = !showLogout && isLocalAuthTestMode();
  const isHome = variant === 'home';

  return (
    <header
      data-testid="app-header"
      data-variant={variant}
      className={`relative z-10 flex w-full shrink-0 items-center justify-between bg-white has-[[data-account-open=true]]:z-30 ${
        isHome ? 'px-[60px] pt-10 pb-7' : 'h-[72px] px-[124px]'
      }`}
    >
      <div className={`flex min-w-0 items-center ${isHome ? '' : 'gap-3'}`}>
        <Link
          href={HOME_PATH}
          aria-label="홈으로 이동"
          data-testid="app-header-home"
          className={`flex shrink-0 items-center rounded-[4px] py-3 pr-6 ${FOCUS_RING}`}
        >
          {/* 기존 워드마크(128×39)를 Figma 로고 칸에 비율 유지로 맞춘다(work 78×24 · home 128×39) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/auth/pixlate-wordmark-on-light.svg"
            alt="pix/ate"
            className={`block max-w-none object-contain ${isHome ? 'h-[39px] w-32' : 'h-6 w-[78px]'}`}
          />
        </Link>
        {isHome ? (
          <p className="text-[12px] leading-[normal] font-light tracking-[-0.48px] whitespace-nowrap text-[#707070]">
            AI LOCALIZATION WORKSPACE
          </p>
        ) : (
          <p data-testid="app-header-title" className="truncate text-[14px] leading-[normal] tracking-[-0.14px] whitespace-nowrap text-[#171717]">
            {title}
          </p>
        )}
      </div>

      <div data-testid="app-header-actions" className="flex h-6 shrink-0 items-center gap-4">
        <div className="flex items-center gap-3">
          {showBrandManage && (
            <Link
              href={BRAND_SELECT_PATH}
              data-testid="app-header-brand"
              className={`flex h-6 w-[72px] items-center justify-center rounded-[4px] text-[14px] leading-[normal] tracking-[-0.14px] whitespace-nowrap text-[#171717] ${FOCUS_RING}`}
            >
              브랜드 관리
            </Link>
          )}
          <JobHeaderAccountMenu step={scope} />
        </div>
        {(showLogout || showTestLogout) && (
          <>
            <span aria-hidden="true" data-testid="app-header-divider" className="h-3 w-px shrink-0 bg-[#707070]" />
            {showLogout ? (
              <AccountLogoutButton appearance="header" onRequest={onLogoutRequest} />
            ) : (
              <LocalAuthTestLogout appearance="header" onRequest={onLogoutRequest} />
            )}
          </>
        )}
      </div>
    </header>
  );
}
