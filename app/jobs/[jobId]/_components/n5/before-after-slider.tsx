'use client';

import { useCallback, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────
// N5 — Before/After 비교 슬라이더 (Figma 544:3168 기준, 8일차)
//
// 순수 UI 컨트롤이다 — 이미지 레이어를 모른다. value(0~100)를 받아서
// 그 위치에 세로 divider를 그리고, drag/keyboard로 value를 바꾸면
// onChange만 호출한다. 실제 clip-path 적용은 부모(n5-compare-stack)가 한다.
//
// containerRef가 가리키는 요소의 가로 폭 기준으로 0~100%를 계산한다 —
// 세로 스크롤 위치는 요소의 left/width에 영향을 주지 않으므로,
// 페이지 중간까지 스크롤한 상태에서 drag해도 계산이 흔들리지 않는다.
//
// spring/bounce 등 애니메이션은 넣지 않는다 — pointer 위치를 그대로 반영하는
// 즉각적인 움직임만 사용한다 (transition 없음).
// ─────────────────────────────────────────────────────────────────

const KEYBOARD_STEP = 5;

export function BeforeAfterSlider({
  value,
  onChange,
  containerRef,
}: {
  /** 0~100. 왼쪽에서부터 원본(before)이 노출되는 비율 */
  value: number;
  onChange: (value: number) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const draggingRef = useRef(false);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = (clientX - rect.left) / rect.width;
      onChange(clamp(ratio * 100, 0, 100));
    },
    [containerRef, onChange],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    updateFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // pointer capture 덕분에, 컨테이너 밖으로 나가거나 버튼을 뗀 상태가
    // 아니면 이 핸들러가 계속 호출된다 — 별도 document 리스너가 필요 없다.
    if (!draggingRef.current) return;
    updateFromClientX(e.clientX);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      onChange(clamp(value - KEYBOARD_STEP, 0, 100));
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      onChange(clamp(value + KEYBOARD_STEP, 0, 100));
      e.preventDefault();
    } else if (e.key === 'Home') {
      onChange(0);
      e.preventDefault();
    } else if (e.key === 'End') {
      onChange(100);
      e.preventDefault();
    }
  };

  return (
    <div
      data-testid="n5-before-after-slider"
      role="slider"
      tabIndex={0}
      aria-label="원본/번역 비교 슬라이더"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className="absolute inset-y-0 z-30 flex w-6 -translate-x-1/2 cursor-ew-resize touch-none items-stretch justify-center outline-none"
      style={{ left: `${value}%` }}
    >
      <div className="w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]" />
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
