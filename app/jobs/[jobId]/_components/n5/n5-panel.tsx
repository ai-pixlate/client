import type { ReviewResponse } from '@/lib/api/types';

// ─────────────────────────────────────────────────────────────────
// N5 — 우측 검수 panel (Figma 544:3168 기준, 오늘은 컨테이너 + hierarchy만)
//
// 포함: 번역 결과 제목 영역, 검수/편집 콘텐츠가 들어갈 본문 영역, 하단 CTA.
// 미포함(오늘 범위 아님): Figma의 "직접 수정하기"/"번역근거" 카드 내용,
// 기존 N5의 "다른 번역 보기" 후보 UI.
//
// 9/9 TODO: 본문 영역을 block table 구조로 교체한다. 오늘은 특정 카드
// 구조에 결합하지 않기 위해 요약 정보만 표시한다.
// ─────────────────────────────────────────────────────────────────

export function N5Panel({
  job,
  blockCount,
}: {
  job: ReviewResponse['job'];
  blockCount: number;
}) {
  return (
    <div data-testid="n5-panel" className="flex h-full w-[430px] shrink-0 flex-col">
      <div className="shrink-0 pb-4">
        <h2 className="text-[18px] font-medium tracking-[-0.03em] text-[#171717]">번역 결과</h2>
        <p className="mt-1 text-[12px] tracking-[-0.02em] text-[#999]">
          {job.targetCountry} ({job.targetLanguage.toUpperCase()}) · {blockCount}개 텍스트 블록
        </p>
      </div>

      {/* 9/9 TODO: block table 구조로 교체 예정 — 오늘은 특정 카드 구조와 결합하지 않는다 */}
      <div
        data-testid="n5-panel-body"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto rounded-[6px] bg-[#f5f5f5] px-6 text-center"
      >
        <p className="text-sm text-[#999]">검수 콘텐츠 영역 — 9/9에 block table로 구현 예정</p>
      </div>

      <div className="shrink-0 pt-6">
        <button
          type="button"
          disabled
          title="N6 저장 화면은 아직 구현되지 않았습니다."
          className="w-full rounded-md bg-[#171717] px-8 py-3.5 text-[14px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          저장하러 가기
        </button>
      </div>
    </div>
  );
}
