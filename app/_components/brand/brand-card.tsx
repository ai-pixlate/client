'use client';

import Link from 'next/link';
import { useState } from 'react';

import { CompactCheckbox, PlusGlyph16, SELECTED_BORDER_CLASS, UNSELECTED_BORDER_CLASS } from '@/app/_components/library/library-controls';
import { getBrandDisplayName, getBrandWordmark, pickBrandLogoUrl, type M0Brand } from '@/lib/brand/m0-view';
import { useBrandLogosQuery } from '@/lib/queries/pixlate';

// ─────────────────────────────────────────────────────────────────
// 브랜드 카드 — Figma 「브랜드」 component(849:7154 default · 1056:9052 checked), M0 1792:20008 · H 1776:4171 공용.
//
//   frame: border #EAEAEA(선택 #FF6A38), radius 8, padding 16, 세로 gap 12, 400×264(폭은 grid 칸을 채운다)
//   이미지 칸(Group 10): #F5F5F5, radius 4, 남은 높이(1920에서 366×199) — Brand Image Slot 이 같은 자리 위에 겹친다
//   하단 행(px 4): [Checkbox/Compact 20 + gap 8] 브랜드명(16 Regular −0.48 #171717) ↔ 정보 수정(12 Light −0.48 #171717)
//   로고 없음: 「워드마크」 변형(1839:36610) — #F9F9F9 바탕에 영문명(Inter Medium 42 −0.84 #141414) 가운데
//
// 로고는 GET /brands/{brandId}/logos 의 첫 로고(서버 순서)를 비율 그대로(contain) 보인다. Figma 표본 로고 칸 최대치(269×84)를 상자로 쓴다.
// presigned URL 은 만료되므로 이미지가 깨지면 워드마크로 바꿔 보인다(빈 칸·깨진 아이콘 금지).
//
// 카드 본문은 이동하지 않는다 — 「브랜드 카드 → 그 브랜드의 M1」(F-ACC-02)은 브랜드별 보관함 조회 계약이 없어 대기 중이다(GET /library 에 브랜드 조건 없음).
// N1 로도 보내지 않는다(작업 생성은 M1 새 작업에서만).
// 선택(시각 상태)은 checkbox 로만 바뀌고 진입 동작과 섞지 않는다. [정보 수정]은 그 브랜드의 M2(/brand?brandId=)다.
// ─────────────────────────────────────────────────────────────────

export function BrandCard({
  brand,
  selection,
  showEdit = true,
}: {
  brand: M0Brand;
  /** M0 — 선택 checkbox. H 홈 카드는 넘기지 않는다(Figma H 카드에는 선택이 없다) */
  selection?: { selected: boolean; onToggle: () => void };
  /** H 홈 카드는 [정보 수정]을 숨긴다(Figma hidden) */
  showEdit?: boolean;
}) {
  const name = getBrandDisplayName(brand);
  const logosQuery = useBrandLogosQuery(brand.id);
  const logoUrl = pickBrandLogoUrl(logosQuery.data);
  const selected = selection?.selected ?? false;

  return (
    <article
      data-testid={`brand-card-${brand.id}`}
      data-selected={selected}
      className={`flex h-[264px] w-full min-w-0 shrink-0 flex-col gap-3 rounded-[8px] border bg-white p-4 ${selected ? SELECTED_BORDER_CLASS : UNSELECTED_BORDER_CLASS}`}
    >
      <div data-testid={`brand-card-slot-${brand.id}`} className="relative min-h-0 w-full flex-1 overflow-hidden rounded-[4px] bg-[#f5f5f5]">
        <BrandImage key={logoUrl ?? 'none'} brandId={brand.id} logoUrl={logoUrl} loading={logosQuery.isPending} wordmark={getBrandWordmark(brand)} name={name} />
      </div>

      <div className="flex w-full min-w-0 items-center justify-between gap-3 px-1 leading-[normal] text-[#171717]">
        <div className="flex min-w-0 items-center gap-2">
          {selection && (
            <CompactCheckbox
              id={`brand-card-select-${brand.id}`}
              checked={selected}
              onChange={selection.onToggle}
              label={`${name} 선택`}
              testId={`brand-card-select-${brand.id}`}
            />
          )}
          <p title={name} data-testid={`brand-card-name-${brand.id}`} className="min-w-0 truncate text-[16px] tracking-[-0.48px]">
            {name}
          </p>
        </div>
        {showEdit && (
          <Link
            href={`/brand?brandId=${brand.id}`}
            aria-label={`${name} 정보 수정`}
            data-testid={`brand-card-edit-${brand.id}`}
            className="shrink-0 rounded-[4px] text-[12px] font-light tracking-[-0.48px] whitespace-nowrap hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
          >
            정보 수정
          </Link>
        )}
      </div>
    </article>
  );
}

function BrandImage({
  brandId,
  logoUrl,
  loading,
  wordmark,
  name,
}: {
  brandId: number;
  logoUrl: string | null;
  loading: boolean;
  wordmark: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  // 로고 목록을 받는 동안은 빈 #F5F5F5 칸 — 워드마크를 잠깐 보였다가 로고로 바뀌는 깜빡임을 막는다
  if (loading) return null;
  if (logoUrl && !failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        {/* presigned URL(만료 5분) — next/image 최적화를 거치면 서버가 원본을 다시 요청하므로 일반 img 로 그린다 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={`${name} 로고`}
          data-testid={`brand-card-logo-${brandId}`}
          onError={() => setFailed(true)}
          className="block max-h-[84px] max-w-[min(269px,73%)] object-contain"
        />
      </div>
    );
  }
  return (
    <div data-testid={`brand-card-wordmark-${brandId}`} className="absolute inset-0 flex items-center justify-center bg-[#f9f9f9] px-4">
      <p
        aria-hidden="true"
        // Figma 워드마크 글꼴은 Inter 다. 프로젝트에 Inter 를 따로 싣지 않아(시스템에 없으면) 기본 Pretendard 로 보인다
        style={{ fontFamily: 'Inter, Pretendard, sans-serif' }}
        className="truncate text-[42px] leading-[normal] font-medium tracking-[-0.84px] text-[#141414]"
      >
        {wordmark}
      </p>
    </div>
  );
}

/**
 * 브랜드 추가 카드 — Figma M0 FileUploader(1821:45235).
 *   white, border #EAEAEA, radius 8, px 24 · py 32, 높이 264, 내용 가운데 · 세로 gap 20
 *   Icon Button Circle/MD 40(Plus 16) / 제목 16 Medium −0.48 · 보조 12 Regular −0.12 #707070(gap 8) / Button Primary MD 107×37
 *
 * 셀러 1:N(요구사항 v3.6.4 F-ACC-02) — 브랜드가 있어도 M2 신규 등록으로 간다. 서버 POST /brands 는 개수 제한이 없다.
 * from=brands 는 등록 화면 [취소]가 M0 로 돌아오게 한다.
 */
export function BrandAddCard() {
  return (
    <div
      data-testid="brand-add-card"
      className="flex h-[264px] w-full min-w-0 flex-col items-center justify-center rounded-[8px] border border-[#eaeaea] bg-white px-6 py-8"
    >
      <div className="flex w-full flex-col items-center justify-center gap-5">
        <div className="flex size-10 items-center justify-center rounded-full border border-[#eaeaea] bg-white">
          <PlusGlyph16 />
        </div>
        <div className="flex flex-col items-center gap-2 text-center leading-[normal]">
          <p className="text-[16px] font-medium tracking-[-0.48px] text-[#171717]">브랜드 추가하기</p>
          <p data-testid="brand-add-card-help" className="text-[12px] tracking-[-0.12px] text-[#707070]">
            추가하러 가기
          </p>
        </div>
        <Link
          href="/brand?mode=create&from=brands"
          data-testid="brand-add-card-link"
          className="flex h-[37px] w-[107px] items-center justify-center rounded-[6px] bg-[#171717] px-5 py-2.5 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a38]"
        >
          <span className="px-2 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">브랜드 추가</span>
        </Link>
      </div>
    </div>
  );
}
