import Link from 'next/link';

import type { LibraryCardViewModel } from '@/lib/library/adapter';
import { formatSavedDate } from '@/lib/library/view';

import { CompactCheckbox, PlusGlyph12, PlusIcon16 } from './library-controls';

// M1 보관함 카드 — Figma 719:7428 카드 노드(400×280, white, border #EAEAEA, radius 6,
// padding 12, 내부 gap 12, shadow 없음).
//
// 표시 필드는 Figma에 있는 것만 둔다: 상품명 / 썸네일 / 저장일 / 상태 / 국가 / 언어.
// specType(규격)은 PRD F-LST-02 표시 항목이지만 Figma 카드에 위치가 없어 ViewModel에만
// 유지하고 화면에 임의로 추가하지 않는다.
//
// 카드 자체 클릭(F-LST-05 결과물 확인·수정)은 상세 route/계약이 없어 연결하지 않는다.

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

  return (
    <article
      data-testid={`library-card-${card.jobId}`}
      className="flex h-[280px] w-[400px] flex-col gap-3 rounded-[6px] border border-[#eaeaea] bg-white p-3"
    >
      <div className="flex h-6 items-center gap-2">
        <CompactCheckbox
          id={`library-card-select-${card.jobId}`}
          checked={selected}
          onChange={onToggleSelect}
          label={`${productName} 선택`}
          testId={`library-card-select-${card.jobId}`}
        />
        {/* 긴 상품명은 말줄임하되 title로 전문을 확인할 수 있게 한다. */}
        <p
          title={productName}
          className="min-w-0 flex-1 truncate text-[14px] font-medium tracking-[-0.42px] text-[#171717]"
        >
          {productName}
        </p>
        {/* F-VER-01 "다른 버전 만들기" 진입점 — Circle/XXS/Secondary(24×24, glyph 12px).
            계약 미확정 동안에는 동작을 붙이지 않고 aria-disabled로만 알린다(가짜 생성 금지,
            시각 스타일은 Figma 그대로 유지). */}
        <button
          type="button"
          aria-label={`${productName} 다른 버전 만들기`}
          aria-disabled={onCreateVersion ? undefined : true}
          onClick={onCreateVersion}
          data-testid={`library-card-version-${card.jobId}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[#eaeaea] bg-white"
        >
          <PlusGlyph12 />
        </button>
      </div>

      <div className="h-[192px] w-full shrink-0 overflow-hidden">
        {card.thumbnailUrl ? (
          // presigned URL(만료 5분)을 그대로 쓴다 — next/image 최적화 경유 시 원본 URL이
          // 서버에서 다시 요청되므로 만료 URL을 일반 img로 직접 렌더한다.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.thumbnailUrl}
            alt={`${productName} 결과물`}
            data-testid={`library-card-thumbnail-${card.jobId}`}
            className="size-full object-contain"
          />
        ) : (
          <div data-testid={`library-card-thumbnail-placeholder-${card.jobId}`} className="size-full bg-[#f5f5f5]" />
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {savedDate && (
            <span data-testid={`library-card-date-${card.jobId}`} className="text-[12px] font-light text-[#707070]">
              {savedDate}
            </span>
          )}
          <span className="text-[12px] text-[#999]">{COMPLETED_STATUS_LABEL}</span>
        </div>
        <div data-testid={`library-card-locale-${card.jobId}`} className="flex items-center gap-1">
          {countryName && <span className="text-[12px] text-[#171717]">{countryName}</span>}
          {languageName && <span className="text-[12px] font-light text-[#171717]">{languageName}</span>}
        </div>
      </div>
    </article>
  );
}

/**
 * F-LST-07 "이미지 추가 생성하기" 카드 — Figma 719:7428 grid 마지막 칸(400×280, radius 8).
 * 구성은 N1 업로드 빈 타일(40px Circle + plus 16, 16px Medium 제목, 12px 보조문구,
 * 검정 CTA)과 같은 컴포넌트다.
 *
 * N1(/jobs/new)은 brandId 쿼리가 있어야 제출할 수 있는데, M1에서 넘길 brandId 계약이
 * 없어 쿼리 없이 연결한다(임의 brandId를 만들지 않는다).
 */
export function LibraryAddCard() {
  return (
    <div
      data-testid="library-add-card"
      className="flex h-[280px] w-[400px] flex-col items-center justify-center gap-5 rounded-[8px] border border-[#eaeaea] bg-white"
    >
      <div className="flex size-10 items-center justify-center rounded-full border border-[#eaeaea] bg-white">
        <PlusIcon16 />
      </div>
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-[16px] font-medium tracking-[-0.03em] whitespace-nowrap text-[#171717]">이미지 추가 생성하기</p>
        <p className="text-[12px] tracking-[-0.01em] whitespace-nowrap text-[#707070]">생성하러 가기</p>
      </div>
      <Link
        href="/jobs/new"
        data-testid="library-add-card-link"
        // Figma 버튼 크기(107×37)를 그대로 고정한다 — padding만으로는 글자 폭·줄 높이 차이로
        // 101×41이 되어 실측과 어긋났다.
        className="inline-flex h-[37px] w-[107px] items-center justify-center rounded-[6px] bg-[#171717] text-[14px] font-medium tracking-[-0.03em] whitespace-nowrap text-white hover:opacity-90"
      >
        이미지 생성
      </Link>
    </div>
  );
}
