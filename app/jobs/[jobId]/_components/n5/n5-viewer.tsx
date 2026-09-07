import type { ReviewSourceImage } from '@/lib/api/types';
import { ImageViewer } from '../image-viewer';

// ─────────────────────────────────────────────────────────────────
// N5 — 중앙 결과 이미지 workspace (Figma 544:3168 기준, 오늘은 골격만)
//
// 포함: 긴 상세페이지 scroll viewport, zoom control 위치, block overlay를
// 올릴 relative 기준.
// 미포함(오늘 범위 아님): 전/후 slider, 실제 zoom, block bbox overlay.
//
// 9/8 TODO: 이 컴포넌트 안에 원본 레이어를 번역 레이어 위에 절대 위치로
// 겹쳐 그리고 슬라이더로 clip-path를 조절하는 overlap slider를 추가한다.
// 지금은 번역 결과(mode="translated") 레이어 하나만 렌더링한다 —
// Figma의 "번역문/원문" 토글은 그 슬라이더로 대체될 예정이라 오늘은 만들지 않는다.
// ─────────────────────────────────────────────────────────────────

export function N5Viewer({ sourceImages }: { sourceImages: ReviewSourceImage[] }) {
  return (
    <div
      data-testid="n5-viewer"
      className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-[6px] bg-[#f5f5f5]"
    >
      <ZoomControl />

      {/* 9/8 TODO: 원본 레이어(overlap) + 슬라이더 핸들이 이 relative 컨테이너 안에 절대 위치로 추가될 예정 */}
      <div
        data-testid="n5-viewer-scroll"
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <ImageViewer sourceImages={sourceImages} mode="translated" />
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
