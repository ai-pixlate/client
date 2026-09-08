import type { ReviewSection, ReviewSourceImage } from '@/lib/api/types';
import { N5CompareStack } from './n5-compare-stack';

// ─────────────────────────────────────────────────────────────────
// N5 — 중앙 결과 이미지 workspace (Figma 544:3168 기준, 8일차)
//
// 포함: 긴 상세페이지 scroll viewport, zoom control 위치, 원본/번역
// Before/After 비교 스택(N5CompareStack) — 두 레이어를 완전히 겹쳐 그리고
// 세로 divider로 drag하면 노출 비율이 바뀐다.
// 미포함(오늘 범위 아님): 실제 zoom 동작, block 선택 interaction.
//
// 기존 "번역문/원문" toggle(ImageViewer mode prop)은 여기서는 쓰지 않는다 —
// Before/After 슬라이더가 그 자리를 대체한다. ImageViewer 자체는 perf
// harness(app/perf/long-page)가 그대로 쓰고 있으므로 건드리지 않는다.
// ─────────────────────────────────────────────────────────────────

export function N5Viewer({
  sourceImages,
  sections,
}: {
  sourceImages: ReviewSourceImage[];
  sections: ReviewSection[];
}) {
  return (
    <div
      data-testid="n5-viewer"
      className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-[6px] bg-[#f5f5f5]"
    >
      <ZoomControl />

      <div
        data-testid="n5-viewer-scroll"
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <N5CompareStack sourceImages={sourceImages} sections={sections} />
      </div>
    </div>
  );
}

// zoom 값은 표시만 하고 아직 동작하지 않는다 — 실제 zoom은 오늘 범위가 아니다.
function ZoomControl() {
  return (
    <div className="absolute top-5 right-5 z-10 flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12px] text-[#999] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)]">
      <button
        type="button"
        disabled
        aria-label="축소"
        title="줌 기능은 아직 구현되지 않았습니다."
        className="flex size-4 items-center justify-center disabled:cursor-not-allowed"
      >
        −
      </button>
      <span className="tabular-nums">100%</span>
      <button
        type="button"
        disabled
        aria-label="확대"
        title="줌 기능은 아직 구현되지 않았습니다."
        className="flex size-4 items-center justify-center disabled:cursor-not-allowed"
      >
        +
      </button>
    </div>
  );
}
