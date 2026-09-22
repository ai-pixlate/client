'use client';

import { useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import type { ApiSection, ApiSectionBucket, ApiSourceImage } from '@/lib/api/n3-schema';
import { N3_DRAG_ACTIVATION_DISTANCE } from '@/lib/n3/constants';
import { SectionCropThumbnail } from './section-crop-thumbnail';

// ─────────────────────────────────────────────────────────────────
// N3 — 썸네일 (drag source). exclude/include 두 리스트에서 공용으로
// 사용한다. variant로 폭만 다르다.
// Figma 540:3119 실측: 삭제 썸네일 120px 고정, 번역 썸네일 206px(넓은
// 화면 기준, 좁은 화면에서는 clamp로 소폭 축소 — n3-view.tsx가 결정).
//
// 4단계(drag 후 click 미발화 조사)에서 확인한 원인 및 대응은 아래
// handlePointerUp/handleNativeClick 주석 참고. n3-view.tsx의
// PointerSensor activationConstraint.distance와 반드시 같은 값을 써야
// 하므로 lib/n3/constants.ts의 공용 상수를 양쪽에서 import해서 쓴다 —
// UI 컴포넌트인 이 파일이 그 공용 값의 정본이 되지 않는다.
// ─────────────────────────────────────────────────────────────────

export const EXCLUDE_THUMB_WIDTH = 120;

export function SectionThumbnail({
  section,
  sourceImage,
  variant,
  targetWidth,
  isActive = false,
  onClick,
}: {
  section: ApiSection;
  sourceImage: ApiSourceImage | null | undefined;
  variant: 'exclude' | 'include';
  targetWidth: number | string;
  isActive?: boolean;
  onClick?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `thumb-${section.id}`,
    data: { sectionId: section.id, sourceBucket: section.bucket as ApiSectionBucket },
  });

  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);

  /**
   * 원인(4단계 조사로 재현·확정): dnd-kit의 PointerSensor는 drag가
   * activate된 뒤 끝나면(AbstractPointerSensor.detach) document capture
   * 단계에 걸어둔 click 억제 리스너(브라우저가 drag 종료 시 자동으로 만드는
   * "post-drag 합성 click"이 드래그 대상 자체를 다시 클릭한 것처럼 오작동하지
   * 않게 막는 라이브러리 자체 안전장치)를 즉시 지우지 않고 setTimeout(...,50)
   * 으로 50ms 뒤에 지운다. 그 사이에 어디를 클릭하든(꼭 방금 드래그한
   * 엘리먼트가 아니어도) 그 click 이벤트는 capture 단계에서 stopPropagation
   * 되어 target까지 도달하지 못한다 — 그래서 React onClick도, 같은 엘리먼트에
   * 직접 붙인 native addEventListener('click')도 전혀 발화하지 않았다
   * (실측: document capture 리스너 로그에는 click이 찍히지만 target의
   * 리스너는 실행되지 않음). 사람이 쓸 때는 50ms 안에 다음 클릭이 거의
   * 없어 드물게만 겪지만, drop 직후 낙관적 갱신으로 화면이 바로 갱신되고
   * 나면 그 다음 클릭이 이 창 안에 들어가는 게 충분히 재현 가능하다.
   *
   * 해결: 포인터로 인한 선택은 native click이 아니라 pointerup에서 직접
   * 판별한다 — pointerdown 위치와 pointerup 위치의 거리가
   * N3_DRAG_ACTIVATION_DISTANCE보다 작으면(=dnd-kit 자신도 이 정도면 drag를
   * activate하지 않았을 거리) click으로 본다. 이 경로는 dnd-kit이 억제하는
   * "click" 이벤트 자체를 아예 쓰지 않으므로 그 억제와 무관하다. 실제 drag가
   * activate된 경우 pointerup은 (pointer capture를 쓰지 않는 dnd-kit 특성상)
   * drop 대상 위에서 발생해 이 엘리먼트의 onPointerUp 자체가 안 불린다 —
   * 그래도 방어적으로 거리 체크를 남겨 둔다(같은 자리에서 살짝 흔들린 클릭 등).
   *
   * 키보드(Enter/Space)로 활성화된 click은 이 억제와 무관하고(포인터 드래그가
   * 없었으므로) pointerup 경로를 타지도 않는다 — 그래서 native onClick을
   * 완전히 없애지 않고, event.detail===0(키보드로 활성화된 click의 표준
   * 판별법 — 포인터 click은 1 이상)일 때만 그 경로로 선택을 처리해 키보드
   * 접근성을 유지한다. 포인터 클릭은 detail>=1이라 이 분기를 타지 않으므로
   * pointerup 경로와 중복 호출되지 않는다.
   */
  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    pointerDownAt.current = { x: event.clientX, y: event.clientY };
    listeners?.onPointerDown?.(event);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const start = pointerDownAt.current;
    pointerDownAt.current = null;
    if (!start || !onClick) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance < N3_DRAG_ACTIVATION_DISTANCE) onClick();
  }

  function handleNativeClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) onClick?.();
  }

  return (
    <button
      type="button"
      ref={setNodeRef}
      data-testid={`n3-thumb-${variant}-${section.id}`}
      {...listeners}
      {...attributes}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onClick={handleNativeClick}
      style={{ transform: CSS.Translate.toString(transform), touchAction: 'none' }}
      className={`n3-thumb-settle group relative block shrink-0 cursor-grab text-left transition-opacity duration-150 active:cursor-grabbing ${
        isDragging ? 'opacity-30' : 'opacity-100'
      } ${isActive ? 'ring-4 ring-[#ff6a38]' : ''}`}
    >
      <SectionCropThumbnail
        sourceImage={sourceImage}
        bbox={section.bbox}
        targetWidth={targetWidth}
        alt={`섹션 ${section.sectionOrder ?? ''} 미리보기`}
        className="rounded-[4px] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)]"
      />
    </button>
  );
}

/** drag 중 target 리스트에 표시되는 placeholder — 실제 drop 위치를 미리 보여준다 */
export function ThumbnailPlaceholder({ width }: { width: number }) {
  return (
    <div
      style={{ width, height: width * 1.1 }}
      className="shrink-0 rounded-[4px] border-2 border-dashed border-[#ff6a38]/40 bg-[#ff6a38]/5"
    />
  );
}
