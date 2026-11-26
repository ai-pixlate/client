import Link from 'next/link';

import type { NewJobEntry } from '@/lib/brand/m2-adapter';
import type { LibraryCardViewModel } from '@/lib/library/adapter';

import { CompactCheckbox, PlusGlyph16, SELECTED_BORDER_CLASS, UNSELECTED_BORDER_CLASS } from './library-controls';

// M1 보관함 카드 — Figma 719:7428 「card」 인스턴스(component 21:246, 2026-11 최신본).
//   frame: white, border #EAEAEA(선택 시 #FF6A38), radius 6, padding 12, 높이 264(Fixed). 폭은 grid 칸을 채운다(1920에서 400).
//   내부 세로 Auto Layout gap 8: Slot(남은 높이 — 1920에서 374×195, placeholder #F5F5F5) / 텍스트 묶음(gap 4)
//     상품명 14 Medium −0.42 #171717 · 상태 12 Light −0.48 #999 「완료」
//
// 최신 카드에는 규격·저장일·국가/언어·다른 버전 만들기 버튼이 없어 그리지 않는다(Figma 에 있는 것만 둔다).
// 선택(전체선택·다운로드 대상)은 필터1 의 전체선택이 있는데 최신 카드에 체크 자리가 없다 — M0 브랜드 카드의 선택 변형(1056:9053
// 「Checkbox / Compact 20 + gap 8 + 이름」)과 같은 방식으로 상품명 앞에 Checkbox/Compact 를 두는 최소 보완이다.
// 카드 자체 클릭(F-LST-05)은 상세 route/계약이 없어 연결하지 않는다.

/** GET /library는 job(is_saved=true) 투영만 돌려준다 — 현재 계약에서 카드 = 완료 결과물. */
const COMPLETED_STATUS_LABEL = '완료';

export function LibraryCard({
  card,
  selected,
  onToggleSelect,
}: {
  card: LibraryCardViewModel;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const productName = card.productName ?? '';

  return (
    <article
      data-testid={`library-card-${card.jobId}`}
      className={`flex h-[264px] w-full min-w-0 flex-col gap-2 rounded-[6px] border bg-white p-3 ${selected ? SELECTED_BORDER_CLASS : UNSELECTED_BORDER_CLASS}`}
    >
      <div data-testid={`library-card-slot-${card.jobId}`} className="relative min-h-0 w-full flex-1 overflow-hidden bg-[#f5f5f5]">
        {card.thumbnailUrl ? (
          // presigned URL(만료 5분)을 그대로 쓴다 — next/image 최적화 경유 시 서버가 원본을 다시
          // 요청하므로 일반 img로 직접 렌더한다. 결과물 비율을 지키도록 contain 으로 맞춘다.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.thumbnailUrl}
            alt={`${productName} 결과물`}
            data-testid={`library-card-thumbnail-${card.jobId}`}
            className="absolute inset-0 size-full object-contain"
          />
        ) : (
          <div data-testid={`library-card-thumbnail-placeholder-${card.jobId}`} className="absolute inset-0 bg-[#f5f5f5]" />
        )}
      </div>

      <div className="flex w-full min-w-0 flex-col gap-1 leading-[normal]">
        <div className="flex min-w-0 items-center gap-2">
          <CompactCheckbox
            id={`library-card-select-${card.jobId}`}
            checked={selected}
            onChange={onToggleSelect}
            label={`${productName} 선택`}
            testId={`library-card-select-${card.jobId}`}
          />
          {/* Figma 텍스트는 한 줄이다. 카드 폭을 넘는 상품명은 말줄임하고 title로 전문을 확인할 수 있게 한다. */}
          <p
            title={productName}
            data-testid={`library-card-title-${card.jobId}`}
            className="min-w-0 truncate text-[14px] font-medium tracking-[-0.42px] text-[#171717]"
          >
            {productName}
          </p>
        </div>
        <p data-testid={`library-card-status-${card.jobId}`} className="text-[12px] font-light tracking-[-0.48px] text-[#999]">
          {COMPLETED_STATUS_LABEL}
        </p>
      </div>
    </article>
  );
}

/**
 * F-LST-07 "이미지 추가 생성하기" — Figma FileUploader(1833:54561).
 *   frame: white, border #EAEAEA, radius 8, px 24 / py 32, 높이 264, 내용 중앙
 *   내부 세로 gap 20: Icon Button Circle 40(Plus 16) / 제목(16 Medium, -0.48)·보조(12 Regular, -0.12) gap 8 /
 *   Button Primary MD 107×37(px 20, label px 8, 14 Medium, -0.42)
 *
 * 갈 곳은 GET /brands 로 정한다(resolveNewJobEntry — 0개 등록 · 1개 N1?brandId · 2개 이상은 링크 없음). 임의 brandId 를 만들지 않는다.
 * 목록을 받는 동안은 버튼을 잠그고, 받지 못하면 brandId 없이 N1 으로 보내지 않고 안내만 한다.
 * 브랜드가 여러 개면 이 전체 보관함에는 브랜드 맥락이 없다 — 최종 동작(브랜드별 M1 새 작업 → 그 브랜드 N1)은 브랜드별 보관함 계약 대기라
 * 잘못 귀속하지 않도록 잠그고 이유를 보인다.
 */
export function LibraryAddCard({ entry }: { entry: NewJobEntry | 'loading' | 'error' }) {
  const href = typeof entry === 'object' ? entry.href : null;
  return (
    <div
      data-testid="library-add-card"
      className="flex h-[264px] w-full min-w-0 flex-col items-center justify-center rounded-[8px] border border-[#eaeaea] bg-white px-6 py-8"
    >
      <div className="flex w-full flex-col items-center justify-center gap-5">
        <div className="flex size-10 items-center justify-center rounded-full border border-[#eaeaea] bg-white">
          <PlusGlyph16 />
        </div>
        <div className="flex flex-col items-center gap-2 leading-[normal] whitespace-nowrap">
          <p className="text-[16px] font-medium tracking-[-0.48px] text-[#171717]">이미지 추가 생성하기</p>
          {entry === 'error' ? (
            <p role="alert" data-testid="library-add-card-error" className="text-[12px] tracking-[-0.12px] text-red-500">
              브랜드 정보를 불러오지 못해 작업을 시작할 수 없습니다.
            </p>
          ) : typeof entry === 'object' && entry.kind === 'needs-brand-scope' ? (
            <p id="library-add-card-scope" data-testid="library-add-card-scope" className="max-w-[300px] text-center text-[12px] tracking-[-0.12px] whitespace-normal text-[#707070]">
              브랜드가 여러 개일 때는 브랜드별 보관함에서 작업을 시작할 수 있습니다(준비 중).
            </p>
          ) : (
            <p className="text-[12px] tracking-[-0.12px] text-[#707070]">생성하러 가기</p>
          )}
        </div>
        {href ? (
          <Link
            href={href}
            data-testid="library-add-card-link"
            data-entry={typeof entry === 'object' ? entry.kind : undefined}
            className="flex h-[37px] w-[107px] items-center justify-center rounded-[6px] bg-[#171717] px-5 py-2.5 hover:opacity-90"
          >
            <span className="px-2 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">
              이미지 생성
            </span>
          </Link>
        ) : (
          // 목록 조회 중·실패 — 같은 자리·모습의 잠긴 버튼(새 레이아웃 없음)
          <button
            type="button"
            disabled
            aria-busy={entry === 'loading' || undefined}
            aria-describedby={typeof entry === 'object' && entry.kind === 'needs-brand-scope' ? 'library-add-card-scope' : undefined}
            data-testid="library-add-card-link"
            className="flex h-[37px] w-[107px] cursor-not-allowed items-center justify-center rounded-[6px] bg-[#171717] px-5 py-2.5 opacity-40"
          >
            <span className="px-2 text-[14px] leading-[17px] font-medium tracking-[-0.42px] whitespace-nowrap text-white">
              이미지 생성
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
