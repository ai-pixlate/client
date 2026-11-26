'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppHeader, BRAND_SELECT_PATH } from '@/app/_components/app-header/app-header';
import { useAuthSnapshot } from '@/app/_components/auth/use-auth-snapshot';
import { BrandCard } from '@/app/_components/brand/brand-card';
import { toLibraryCardViewModels } from '@/lib/library/adapter';
import { getCodeLabel, toNameMap } from '@/lib/library/view';
import { sortBrandsByNewest, toM0Brands, type M0Brand } from '@/lib/brand/m0-view';
import { resolveHomeEntry, resolveHomeView, toHomeRecentRows, type HomeRecentRow, type HomeView as HomeViewKind } from '@/lib/home/view';
import { getAuthMode } from '@/lib/auth/capability';
import { probeSessionForPublicEntry } from '@/lib/auth/runtime';
import { useBrandsQuery, useLibraryQuery, useMasterCountriesQuery, useMasterLanguagesQuery } from '@/lib/queries/pixlate';

import { HomeHeroMedia } from './home-hero-media';

// ─────────────────────────────────────────────────────────────────
// H 홈 — 한 컴포넌트가 사용자 상태별 뷰를 고른다(lib/home/view.ts resolveHomeView).
//   landing   Home / landing page (1492:10051) 1920×1080 — 로그인 전, 전체 배경 VIDEO + 헤더 + 메인 문구
//   returning Home / scroll       (1776:4171)  1920×1612 — 브랜드 1개 이상: 배너 · 브랜드 선택 · 최근 작업 · 푸터
//   new       Home / for new      (1779:4227)  1920×1612 — 브랜드 0개: 배너 · 첫 브랜드 등록 · 최근 작업 Empty State · 푸터
//
// 로그인 후 레이아웃(1920 기준): 헤더 131 → 배너 x60 1800×488(y131) → 60 → 브랜드 영역(y679, 313) → 60 → 최근 작업(y1052, 403)
//   → 100 → 푸터(y1555, 57 · pb 40). 좌우 여백 60 은 고정이고 폭은 viewport 를 따른다(가로 넘침 없음). 세로는 페이지 스크롤이다.
//   「for new」 프레임은 배너가 y159·높이 460 으로 28px 내려가 있지만 메인 문구 위치(y396)는 두 프레임이 같다 — 공통 배너는 scroll 프레임 값을 쓴다.
//
// 데이터 — Figma 의 브랜드·작업은 예시다:
//   브랜드 목록: GET /brands(최신순 — updatedAt). 「최근 작업 순」 정렬 근거(브랜드별 최근 작업)는 계약에 없다.
//   최근 작업: GET /library 의 저장 완료 카드(lib/home/view.ts). 상태는 모두 「완료」, 최근 변경 = savedAt.
//   이동: 브랜드 카드 → 그 브랜드의 M1 은 계약 대기라 연결하지 않는다(GET /library 에 브랜드 조건 없음). 최근 작업 목록은 Figma 도 「표시 전용 · 클릭 없음」이다.
//     [모든 브랜드 보기] → M0 · [새 브랜드 등록] → M2 신규 등록(셀러 1:N — F-ACC-02).
//     임시: 최근 작업 제목 행의 [전체 보관함 보기] → 전체 보관함('/'). 브랜드별 M1 이 생기기 전까지 보관함으로 가는 길이다 — Figma 에 없는 최소 보완.
//     「전체」라는 이름으로 특정 브랜드의 보관함과 구분한다. 그 화면의 새 작업은 브랜드가 하나일 때만 그 브랜드로 시작한다(resolveNewJobEntry).
//   푸터 링크(이용약관 등)는 목적지 페이지가 없어 글자로만 둔다.
// ─────────────────────────────────────────────────────────────────

export default function HomeView() {
  const { status: authStatus, epoch } = useAuthSnapshot();
  // 세션 확인 실패는 그 세대(epoch)에만 묶는다 — 다른 탭 알림 등으로 세대가 바뀌면 effect 없이 다시 확인 대상이 된다
  const [failedEpoch, setFailedEpoch] = useState<number | null>(null);
  const entry = resolveHomeEntry({ authStatus, devLogin: getAuthMode() === 'dev-login', probeFailed: failedEpoch === epoch });

  // 새로고침 직후(unknown) — 보호 API 대신 세션만 확인한다. 결과는 인증 저장소(useAuthSnapshot)로 들어오고, 실패만 여기 남긴다
  useEffect(() => {
    if (entry !== 'checking') return;
    let cancelled = false;
    void probeSessionForPublicEntry().then((result) => {
      if (!cancelled && result === 'unavailable') setFailedEpoch(epoch);
    });
    return () => {
      cancelled = true;
    };
  }, [entry, epoch]);

  // 계정이 확정된 뒤에만 브랜드를 부른다 — 공개 랜딩·확인 중에는 인증이 필요한 API 를 호출하지 않는다
  const brandsQuery = useBrandsQuery(entry === 'authenticated');
  const brands = brandsQuery.data ? toM0Brands(brandsQuery.data) : [];
  const view = resolveHomeView({
    entry,
    brands: { status: brandsQuery.isError ? 'error' : brandsQuery.isSuccess ? 'success' : 'pending', count: brands.length },
  });

  if (view === 'checking') {
    return (
      <main data-testid="home-checking" data-home-view="checking" aria-busy="true" className="min-h-screen bg-white">
        <p role="status" className="sr-only">
          로그인 상태를 확인하는 중입니다.
        </p>
      </main>
    );
  }
  if (view === 'check-failed') return <HomeCheckFailed onRetry={() => setFailedEpoch(null)} />;
  if (view === 'landing') return <HomeLanding />;
  return <HomeWorkspace view={view} brands={brands} />;
}

/**
 * 세션 확인 실패 — 서버·네트워크 문제라 로그아웃으로 보지 않는다(랜딩을 보이지 않고, 이전 계정 데이터도 부르지 않는다).
 * Figma 표본이 없어 흰 화면 가운데 안내 한 줄 + [다시 시도] + G1 링크만 둔다(최소 보완). 자동 반복하지 않는다.
 */
function HomeCheckFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <main data-testid="home-check-failed" data-home-view="check-failed" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white">
      <p role="alert" className="text-[16px] leading-[normal] tracking-[-0.48px] text-[#171717]">
        로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          data-testid="home-check-retry"
          className="flex h-[37px] items-center justify-center rounded-[6px] bg-[#171717] px-5 text-[14px] leading-[17px] font-medium tracking-[-0.42px] text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
        >
          다시 시도
        </button>
        <Link
          href="/login"
          data-testid="home-check-login"
          className="flex h-[37px] items-center justify-center rounded-[6px] border border-[#eaeaea] bg-white px-5 text-[14px] leading-[17px] font-medium tracking-[-0.42px] text-[#171717] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
        >
          로그인 화면으로
        </Link>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * 로그인 전 — Home / landing page
 *   헤더 x60 y60 w1800: 로고(흰색 128×39) gap 24 「AI LOCALIZATION WORKSPACE」(12 Light −0.48 white) ↔ 로그인 | 회원가입(14 Regular white, gap 24, divider #F5F5F5 1×12)
 *   메인 문구 x92 y762 w540: 72 SemiBold −1.44 · 줄높이 85 / gap 16 / 18 Medium −0.54 #F5F5F5 → 아래 여백 111
 *   [로그인]·[회원가입]은 같은 G1(/login)이다 — 소셜 로그인이 가입을 겸하고 별도 가입 화면은 없다.
 * ------------------------------------------------------------------ */
function HomeLanding() {
  return (
    <main data-testid="home-landing" data-home-view="landing" className="relative h-screen min-h-[640px] w-full overflow-hidden bg-[#0a0a0a] text-white">
      <HomeHeroMedia kind="video" fallbackClassName="bg-[#0a0a0a]" />

      <header data-testid="home-landing-header" className="absolute inset-x-[60px] top-[60px] z-10 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/auth/pixlate-wordmark-on-dark.svg" alt="pix/ate" className="block h-[39px] w-32 max-w-none object-contain" />
          <p className="text-[12px] leading-[normal] font-light tracking-[-0.48px] whitespace-nowrap">AI LOCALIZATION WORKSPACE</p>
        </div>
        <nav aria-label="계정" className="flex shrink-0 items-center gap-6 text-[14px] leading-[normal] tracking-[-0.14px]">
          <Link href="/login" data-testid="home-landing-login" className="rounded-[4px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            로그인
          </Link>
          <span aria-hidden="true" className="h-3 w-px bg-[#f5f5f5]" />
          <Link href="/login" data-testid="home-landing-signup" className="rounded-[4px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            회원가입
          </Link>
        </nav>
      </header>

      <div data-testid="home-landing-copy" className="absolute bottom-[111px] left-[92px] z-10 flex w-[540px] max-w-[calc(100%-184px)] flex-col gap-4">
        <h1 className="text-[72px] leading-[85px] font-semibold tracking-[-1.44px]">
          상세페이지를,
          <br />
          다른 시장의 언어로.
        </h1>
        <p className="text-[18px] leading-[normal] font-medium tracking-[-0.54px] text-[#f5f5f5]">
          분석부터 번역, 검수까지. 새로운 시장으로 향하는 가장 정교한 방법.
        </p>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * 로그인 후 — Home / scroll · Home / for new 공용 틀
 * ------------------------------------------------------------------ */
function HomeWorkspace({ view, brands }: { view: Exclude<HomeViewKind, 'landing' | 'checking' | 'check-failed'>; brands: M0Brand[] }) {
  return (
    <div data-testid="home-workspace" data-home-view={view} className="flex min-h-screen flex-col bg-white">
      <AppHeader variant="home" scope="H" />

      <main className="flex flex-col gap-[60px] px-[60px]">
        {/* 배너(1776:4858) 1800×488 · 메인 문구(1772:13593) 배너 왼쪽 54 · 아래 72 */}
        <section data-testid="home-banner" aria-labelledby="home-banner-title" className="relative h-[488px] w-full overflow-hidden">
          <HomeHeroMedia kind="image" fallbackClassName="bg-[#171717]" />
          <div className="absolute bottom-[72px] left-[54px] z-10 flex max-w-[calc(100%-108px)] flex-col gap-3 text-white">
            <h1 id="home-banner-title" className="text-[48px] leading-[60px] font-semibold">
              상세페이지를,
              <br />
              다른 시장의 언어로.
            </h1>
            <p className="text-[16px] leading-[normal] tracking-[-0.48px] text-[#f5f5f5]">분석부터 번역, 검수까지. 새로운 시장으로 향하는 가장 정교한 방법.</p>
          </div>
        </section>

        {view === 'loading' ? (
          <p role="status" data-testid="home-loading" className="sr-only">
            브랜드 정보를 불러오는 중입니다.
          </p>
        ) : view === 'error' ? (
          <p role="alert" data-testid="home-error" className="px-5 text-[12px] text-red-500">
            브랜드 정보를 불러오지 못했습니다.
          </p>
        ) : (
          <>
            {view === 'returning' ? <HomeBrandList brands={brands} /> : <HomeFirstBrand />}
            <HomeRecentWork />
          </>
        )}
      </main>

      <HomeFooter />
    </div>
  );
}

/** 섹션 제목 — overline(12 Light −0.48 #999) gap 8 제목(28 SemiBold −0.42 #171717) */
function SectionHeading({ id, overline, title }: { id: string; overline: string; title: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {/* Figma 줄높이 normal 을 측정값(14 · 33)으로 고정한다 — 브라우저 normal 은 0.3~0.4px 커서 아래 섹션이 밀린다 */}
      <p className="text-[12px] leading-[14px] font-light tracking-[-0.48px] text-[#999]">{overline}</p>
      <h2 id={id} className="text-[28px] leading-[33px] font-semibold tracking-[-0.42px] text-[#171717]">
        {title}
      </h2>
    </div>
  );
}

/* 브랜드 1개 이상 — 「브랜드를 선택하세요.」(1772:16034) ------------------------------------------- *
 *   헤더 px 20: 제목 ↔ [모든 브랜드 보기 >](Tertiary/XS — pl 10 · pr 8 · py 5, 12 Regular, Chevron Right 12, gap 4) → M0
 *   목록 gap 16 아래, 높이 242(넘치는 위아래는 잘린다 — 카드 264 가 가운데 정렬), pr 16, 카드 400 gap 24 + 새 브랜드 등록 404×242
 *   오른쪽 [다음] Icon Button Circle/MD Hover(40, #F5F5F5, Chevron Right 16) — 목록이 넘칠 때만 보이고 끝에 닿으면 비활성
 * --------------------------------------------------------------------------------------------- */
function HomeBrandList({ brands }: { brands: M0Brand[] }) {
  const sorted = useMemo(() => sortBrandsByNewest(brands), [brands]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ overflow: false, atEnd: true });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setScroll((prev) => (prev.overflow === overflow && prev.atEnd === atEnd ? prev : { overflow, atEnd }));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, sorted.length]);

  return (
    <section data-testid="home-brands" aria-labelledby="home-brands-title" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 px-5">
        <SectionHeading id="home-brands-title" overline="YOUR BRANDS" title="브랜드를 선택하세요." />
        <ChevronLink href={BRAND_SELECT_PATH} testId="home-all-brands" label="모든 브랜드 보기" />
      </div>

      <div className="flex h-[242px] items-center justify-between gap-4 overflow-hidden pr-4">
        <div
          ref={scrollerRef}
          onScroll={measure}
          data-testid="home-brand-scroller"
          className="n3-scroll-hidden flex h-full min-w-0 flex-1 items-center gap-6 overflow-x-auto overflow-y-hidden"
        >
          {sorted.map((brand) => (
            <div key={brand.id} className="w-[400px] shrink-0">
              <BrandCard brand={brand} showEdit={false} />
            </div>
          ))}
          <NewBrandCard />
        </div>
        {scroll.overflow && (
          <button
            type="button"
            aria-label="다음 브랜드 보기"
            disabled={scroll.atEnd}
            onClick={() => scrollerRef.current?.scrollBy({ left: 424, behavior: 'smooth' })}
            data-testid="home-brand-next"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f5f5f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {/* Card/Navigation/Chevron Right 16 — inset 22.5% 35% 22.5% 37.5% */}
            <span aria-hidden="true" className="relative block size-4 overflow-hidden">
              <span className="absolute inset-[22.5%_35%_22.5%_37.5%]">
                <span className="absolute inset-[-7.1%_-14.2%]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" src="/home/icons/chevron-right-16.svg" className="block size-full max-w-none" />
                </span>
              </span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

/* 브랜드 0개 — 「첫 브랜드를 등록해 주세요.」(1792:19305) ---------------------------------------- *
 *   제목 pl 20 → gap 16 → [새 브랜드 등록 404×242] ↔ 안내(x455 · w550, 24 SemiBold −0.48 / gap 12 / 14 Regular #707070), 세로 가운데
 * --------------------------------------------------------------------------------------------- */
function HomeFirstBrand() {
  return (
    <section data-testid="home-first-brand" aria-labelledby="home-first-brand-title" className="flex flex-col gap-4">
      <div className="pl-5">
        <SectionHeading id="home-first-brand-title" overline="YOUR BRANDS" title="첫 브랜드를 등록해 주세요." />
      </div>
      <div className="flex items-center gap-[51px]">
        <NewBrandCard />
        <div className="flex w-[550px] min-w-0 flex-col gap-3 leading-[normal]">
          <p className="text-[24px] font-semibold tracking-[-0.48px] text-[#171717]">브랜드를 등록하면 첫 상세페이지 번역을 시작할 수 있습니다.</p>
          <p className="text-[14px] tracking-[-0.14px] text-[#707070]">브랜드명과 브랜드 정보를 입력한 뒤 작업을 만들어 보세요.</p>
        </div>
      </div>
    </section>
  );
}

/** Button Tertiary/XS + Chevron Right 12(1772:16023) — pl 10 · pr 8 · py 5, 12 Regular, gap 4 */
function ChevronLink({ href, testId, label }: { href: string; testId: string; label: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="flex shrink-0 items-center gap-1 rounded-[4px] bg-white py-[5px] pr-2 pl-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
    >
      <span className="px-0.5 text-[12px] leading-[normal] tracking-[-0.24px] whitespace-nowrap text-[#171717]">{label}</span>
      {/* Card/Navigation/Chevron Right 12 — glyph 상자 inset 22.5% 35% 22.5% 37.5% */}
      <span aria-hidden="true" className="relative block size-3 shrink-0 overflow-hidden">
        <span className="absolute inset-[22.5%_35%_22.5%_37.5%]">
          <span className="absolute inset-[-5.68%_-11.36%]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" src="/library/icons/chevron-right-12.svg" className="block size-full max-w-none" />
          </span>
        </span>
      </span>
    </Link>
  );
}

/**
 * 「Home / 브랜드 등록 + → M2」(1786:16145) — 404×242, border #EAEAEA, radius 8, 세로 gap 12 가운데
 *   Icon Button Circle/LG Secondary 48(Plus 20) / 「새 브랜드 등록」 18 Medium −0.54 / 안내 14 Regular #707070
 * 셀러 1:N(F-ACC-02) — 브랜드가 있어도 M2 신규 등록으로 간다. from=home 은 등록 화면 [취소]가 H0 로 돌아오게 한다.
 */
function NewBrandCard() {
  return (
    <Link
      href="/brand?mode=create&from=home"
      data-testid="home-new-brand"
      className="flex h-[242px] w-[404px] shrink-0 flex-col items-center justify-center gap-3 overflow-hidden rounded-[8px] border border-[#eaeaea] bg-white hover:bg-[#fafafa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
    >
      <span className="flex size-12 items-center justify-center rounded-full border border-[#eaeaea] bg-white">
        {/* Card/Action/Plus 20 — inset 20%, bleed −6.25% */}
        <span aria-hidden="true" className="relative block size-5 overflow-hidden">
          <span className="absolute inset-[20%]">
            <span className="absolute inset-[-6.25%]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" src="/home/icons/plus-20.svg" className="block size-full max-w-none" />
            </span>
          </span>
        </span>
      </span>
      <span className="text-[18px] leading-[normal] font-medium tracking-[-0.54px] whitespace-nowrap text-[#171717]">새 브랜드 등록</span>
      <span className="px-4 text-center text-[14px] leading-[normal] tracking-[-0.14px] text-[#707070]">브랜드 정보를 등록하고 작업을 시작하세요.</span>
    </Link>
  );
}

/* 최근 작업(1786:16054 · Empty 1779:5026) ------------------------------------------------------- *
 *   헤더 px 20: 제목 ↔ 설명(14 Regular #707070) · gap 20 · 목록(표시 전용)
 *   머리행 h48 #F5F5F5 px 28 14 #707070 · 행 h70 하단 border #EAEAEA, 16 Regular −0.48(상품명 #171717 · 나머지 #707070)
 *   열 폭 500 · 320 · 200 · 200 · 나머지 1:1 — 좁은 화면에서도 같은 비율로 줄어든다
 *   Empty: h328 #F5F5F5 · border #EAEAEA · radius 4 · 「최근 작업이 없습니다.」 20 SemiBold / 14 #707070, gap 8
 * --------------------------------------------------------------------------------------------- */
const RECENT_GRID = 'grid grid-cols-[minmax(0,500fr)_minmax(0,320fr)_minmax(0,200fr)_minmax(0,200fr)_minmax(0,262fr)_minmax(0,262fr)] items-center px-7';

function HomeRecentWork() {
  const libraryQuery = useLibraryQuery();
  const countriesQuery = useMasterCountriesQuery();
  const languagesQuery = useMasterLanguagesQuery();
  const countryNames = useMemo(() => toNameMap(countriesQuery.data), [countriesQuery.data]);
  const languageNames = useMemo(() => toNameMap(languagesQuery.data), [languagesQuery.data]);
  const rows = useMemo(() => toHomeRecentRows(toLibraryCardViewModels(libraryQuery.data ?? [])), [libraryQuery.data]);

  return (
    <section data-testid="home-recent" aria-labelledby="home-recent-title" className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4 px-5">
        <SectionHeading id="home-recent-title" overline="RECENT ACTIVITY" title="최근 작업" />
        <div className="flex shrink-0 items-center gap-4">
          <p className="text-[14px] leading-[normal] tracking-[-0.14px] text-[#707070]">모든 브랜드의 최신 변경순으로 표시됩니다.</p>
          {/* 임시 — 브랜드별 M1 계약 전까지 전체 보관함('/')으로 가는 길(Figma 에 없는 최소 보완, 「모든 브랜드 보기」와 같은 버튼) */}
          <ChevronLink href="/" testId="home-all-library" label="전체 보관함 보기" />
        </div>
      </div>

      {libraryQuery.isError ? (
        <p role="alert" data-testid="home-recent-error" className="px-5 text-[12px] text-red-500">
          최근 작업을 불러오지 못했습니다.
        </p>
      ) : libraryQuery.isPending ? (
        <p role="status" className="sr-only">
          최근 작업을 불러오는 중입니다.
        </p>
      ) : rows.length === 0 ? (
        <div
          role="status"
          data-testid="home-recent-empty"
          className="flex h-[328px] w-full flex-col items-center justify-center gap-2 rounded-[4px] border border-[#eaeaea] bg-[#f5f5f5] leading-[normal]"
        >
          <p className="text-[20px] font-semibold tracking-[-0.4px] text-[#171717]">최근 작업이 없습니다.</p>
          <p className="text-[14px] tracking-[-0.14px] text-[#707070]">첫 작업을 시작해 보세요.</p>
        </div>
      ) : (
        <div role="table" aria-label="최근 작업" data-testid="home-recent-table" className="flex w-full flex-col leading-[normal]">
          <div role="row" className={`${RECENT_GRID} h-12 bg-[#f5f5f5] text-[14px] tracking-[-0.14px] text-[#707070]`}>
            {['상품명', '브랜드명', '국가', '언어', '상태', '최근 변경'].map((label) => (
              <span key={label} role="columnheader" className="truncate">
                {label}
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <RecentRow key={row.jobId} row={row} countryNames={countryNames} languageNames={languageNames} />
          ))}
        </div>
      )}
    </section>
  );
}

function RecentRow({
  row,
  countryNames,
  languageNames,
}: {
  row: HomeRecentRow;
  countryNames: ReadonlyMap<string, string>;
  languageNames: ReadonlyMap<string, string>;
}) {
  const cells = [
    row.brandName,
    row.targetCountry ? getCodeLabel(row.targetCountry, countryNames) : '',
    row.targetLanguage ? getCodeLabel(row.targetLanguage, languageNames) : '',
    row.statusLabel,
    row.changedAt ?? '',
  ];
  return (
    <div role="row" data-testid={`home-recent-row-${row.jobId}`} className={`${RECENT_GRID} h-[70px] border-b border-[#eaeaea] text-[16px] tracking-[-0.48px]`}>
      <span role="cell" title={row.productName} className="truncate pr-4 text-[#171717]">
        {row.productName}
      </span>
      {cells.map((text, index) => (
        <span key={index} role="cell" title={text || undefined} className="truncate pr-4 whitespace-pre text-[#707070]">
          {text}
        </span>
      ))}
    </div>
  );
}

/* 푸터(1786:16056) — px 20 · pb 40, 14 Regular #171717: 링크 4개(불투명도 62%, gap 20) ↔ © 2026 pix/ate(52%) ---- *
 * 이용약관 등 목적지 페이지가 아직 없어 링크로 만들지 않는다(빈 링크 금지). 대비 확보를 위해 글자색은 그대로 두고 불투명도만 Figma 값이다. */
function HomeFooter() {
  return (
    <footer data-testid="home-footer" className="mt-[100px] flex items-center justify-between gap-4 px-20 pb-10 text-[14px] leading-[17px] tracking-[-0.14px] whitespace-nowrap text-[#171717]">
      <ul className="flex items-center gap-5">
        {['이용약관', '개인정보처리방침', 'AI·데이터 이용 안내', '고객지원'].map((label) => (
          <li key={label} className="opacity-[0.62]">
            {label}
          </li>
        ))}
      </ul>
      <p className="opacity-[0.52]">© 2026 pix/ate</p>
    </footer>
  );
}
