import Link from 'next/link';

import type { LibraryCardViewModel } from '@/lib/library/adapter';
import { formatSavedDate, getSpecTypeLabel } from '@/lib/library/view';

import { CompactCheckbox, PlusGlyph12, PlusGlyph16, SELECTED_BORDER_CLASS, UNSELECTED_BORDER_CLASS } from './library-controls';

// M1 보관함 카드 — Figma 719:7428 "card" 인스턴스.
//   frame: white, border #EAEAEA(선택 시 #FF6A38 — 1056:9759), radius 6, padding 12, 세로 Auto Layout gap 12, 높이 280(Fixed)
//   폭은 grid 칸을 채운다(1920에서 400) — 내부 요소도 고정 폭 없이 부모를 따른다.
//   상단 row(24): Checkbox/Compact 20 + gap 8 + 상품명(14 Medium, -0.42) ↔ 다른 버전 만들기(Circle/XXS 24)
//   Slot: 남은 높이를 채우고(1920에서 374×192) 그 안 placeholder는 좌우 4px 들인 #F5F5F5
//   하단 row(14): "M1 카드 사이즈"(1211:6585) ↔ 국가(12 Regular, -0.24)·언어(12 Light, -0.48)
//     M1 카드 사이즈: 규격(12 Light #707070) + gap 12 + [날짜(#707070) + gap 4 + 완료(#999)], 모두 12 Light -0.48
//     규격 명칭은 N1 결과물 규격 선택과 같다(original 원본 유지 · site 판매처 맞춤 · custom 커스텀, F-LST-02 ①).
//
// 표시 필드는 Figma에 있는 것만 둔다. 카드 자체 클릭(F-LST-05)은 상세 route/계약이 없어 연결하지 않는다.

/** GET /library는 job(is_saved=true) 투영만 돌려준다 — 현재 계약에서 카드 = 완료 결과물. */
const COMPLETED_STATUS_LABEL = '완료';

export function LibraryCard({
  card,
  countryName,
  languageName,
  selected,
  onToggleSelect,
  onCreateVersion,
}: {
  card: LibraryCardViewModel;
  countryName: string | null;
  languageName: string | null;
  selected: boolean;
  onToggleSelect: () => void;
  /** F-VER-01. POST /jobs/{jobId}/versions 계약이 확정되기 전에는 넘기지 않는다. */
  onCreateVersion?: () => void;
}) {
  const productName = card.productName ?? '';
  const savedDate = formatSavedDate(card.savedAt);
  const specLabel = getSpecTypeLabel(card.specType);
  const versionDisabled = !onCreateVersion;

  return (
    <article
      data-testid={`library-card-${card.jobId}`}
      className={`flex h-[280px] w-full min-w-0 flex-col gap-3 rounded-[6px] border bg-white p-3 ${selected ? SELECTED_BORDER_CLASS : UNSELECTED_BORDER_CLASS}`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <CompactCheckbox
            id={`library-card-select-${card.jobId}`}
            checked={selected}
            onChange={onToggleSelect}
            label={`${productName} 선택`}
            testId={`library-card-select-${card.jobId}`}
          />
          {/* Figma 텍스트는 한 줄(whitespace-nowrap)이다. 카드 폭을 넘는 상품명은 말줄임하고
              title로 전문을 확인할 수 있게 한다 — 우측 버튼이 밀려나지 않게 한다. */}
          <p
            title={productName}
            className="min-w-0 truncate text-[14px] leading-[17px] font-medium tracking-[-0.42px] text-[#171717]"
          >
            {productName}
          </p>
        </div>
        {/* F-VER-01 "다른 버전 만들기" — Icon Button Circle/XXS(24, Plus 12 glyph).
              Secondary(285:2110): white, border #EAEAEA, glyph #707070
              Disabled(285:2116):  bg #F5F5F5, border 없음, glyph #999
            계약 미확정 동안에는 Disabled로 두고 클릭·포커스 대상에서 뺀다(가짜 생성 금지). */}
        <button
          type="button"
          aria-label={`${productName} 다른 버전 만들기`}
          disabled={versionDisabled}
          onClick={onCreateVersion}
          data-testid={`library-card-version-${card.jobId}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[#eaeaea] bg-white text-[#707070] disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[#f5f5f5] disabled:text-[#999]"
        >
          <PlusGlyph12 />
        </button>
      </div>

      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        {card.thumbnailUrl ? (
          // presigned URL(만료 5분)을 그대로 쓴다 — next/image 최적화 경유 시 서버가 원본을 다시
          // 요청하므로 일반 img로 직접 렌더한다.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.thumbnailUrl}
            alt={`${productName} 결과물`}
            data-testid={`library-card-thumbnail-${card.jobId}`}
            className="absolute top-0 left-1 h-full w-[calc(100%-8px)] object-contain"
          />
        ) : (
          <div
            data-testid={`library-card-thumbnail-placeholder-${card.jobId}`}
            className="absolute inset-y-0 right-1 left-1 bg-[#f5f5f5]"
          />
        )}
      </div>

      <div className="flex w-full items-center justify-between gap-2 text-[12px] leading-[normal] whitespace-nowrap">
        <div className="flex items-center gap-3 font-light tracking-[-0.48px]">
          {specLabel && (
            <span data-testid={`library-card-spec-${card.jobId}`} className="text-[#707070]">
              {specLabel}
            </span>
          )}
          <div className="flex items-center gap-1">
            {savedDate && (
              <span data-testid={`library-card-date-${card.jobId}`} className="text-[#707070]">
                {savedDate}
              </span>
            )}
            <span className="text-[#999]">{COMPLETED_STATUS_LABEL}</span>
          </div>
        </div>
        <div data-testid={`library-card-locale-${card.jobId}`} className="flex min-w-0 items-center gap-1 text-[#171717]">
          {countryName && <span className="tracking-[-0.24px]">{countryName}</span>}
          {languageName && <span className="font-light tracking-[-0.48px]">{languageName}</span>}
        </div>
      </div>
    </article>
  );
}

/**
 * F-LST-07 "이미지 추가 생성하기" — Figma FileUploader(925:7308).
 *   frame: white, border #EAEAEA, radius 8, px 24 / py 32, 높이 280, 내용 중앙
 *   내부 세로 gap 20: Icon Button Circle 40(Plus 16) / 제목(16 Medium, -0.48)·보조(12 Regular, -0.12) gap 8 /
 *   Button Primary MD 107×37(px 20, label px 8, 14 Medium, -0.42)
 *
 * N1(/jobs/new)은 brandId 쿼리가 있어야 제출할 수 있는데, M1에서 넘길 brandId 계약이 없어
 * 쿼리 없이 연결한다(임의 brandId를 만들지 않는다).
 */
export function LibraryAddCard() {
  return (
    <div
      data-testid="library-add-card"
      className="flex h-[280px] w-full min-w-0 flex-col items-center justify-center rounded-[8px] border border-[#eaeaea] bg-white px-6 py-8"
    >
      <div className="flex w-full flex-col items-center justify-center gap-5">
        <div className="flex size-10 items-center justify-center rounded-full border border-[#eaeaea] bg-white">
          <PlusGlyph16 />
        </div>
        <div className="flex flex-col items-center gap-2 leading-[normal] whitespace-nowrap">
          <p className="text-[16px] font-medium tracking-[-0.48px] text-[#171717]">이미지 추가 생성하기</p>
          <p className="text-[12px] tracking-[-0.12px] text-[#707070]">생성하러 가기</p>
        </div>
        <Link
          href="/jobs/new"
          data-testid="library-add-card-link"
          className="flex h-[37px] w-[107px] items-center justify-center rounded-[6px] bg-[#171717] px-5 py-2.5 hover:opacity-90"
        >
          <span className="px-2 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">
            이미지 생성
          </span>
        </Link>
      </div>
    </div>
  );
}
