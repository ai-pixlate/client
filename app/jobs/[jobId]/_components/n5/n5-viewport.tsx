'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReviewSection, ReviewSourceImage } from '@/lib/api/types';
import { getPreviewScale } from '@/lib/n5/coordinates';
import {
  ZOOM_BUTTON_STEP,
  computeWheelZoomFactor,
  computeZoomAroundPoint,
  computeUsableViewportSize,
  computeFitWidthScale,
  computeFitHeightScale,
  type N5ViewMode,
  type Point,
  type Size,
} from '@/lib/n5/viewport';
import { ViewModeToggle, ZoomControls, FitControls } from './n5-toolbar';

// ─────────────────────────────────────────────────────────────────
// N5 — 캔버스형 viewport (Figma 544:3168 기준, 9일차)
//
// Before/After 비교 슬라이더(8일차, N5CompareStack/BeforeAfterSlider)는
// 오늘 방향 전환으로 폐기했다. 대신 원문/번역문을 "같은 viewport"에서
// image source만 교체하는 단일 canvas로 바꾸고, 그 위에 Ctrl/Cmd+Wheel
// zoom, 일반/Shift+Wheel pan, Space+drag pan, +/- zoom, Fit Width/Height
// 조작 기반을 얹는다.
//
// pan의 정본은 transform.pan 하나뿐이다 — native scrollTop/overflow-y-auto는
// 두지 않는다. 일반 wheel/Shift+Wheel/Space+drag 세 입력 모두 같은
// transform.pan을 옮기기만 할 뿐, 별도의 scroll state를 두지 않는다.
//
// canvas(원문/번역 stack)의 크기는 zoom과 무관하게 고정된 값이다 — section
// 목록과 preview scale로부터 한 번만 계산하고(useMemo), 화면에는 그 위에
// `translate(pan) scale(zoom)` transform만 얹는다(transform-origin 0 0).
// fit 계산이 이 원본 크기와 viewport clientWidth/Height만으로 이뤄지는 것도
// 이 때문이다 — CSS transform 결과(getBoundingClientRect 등)를 다시 측정해
// 누적하지 않으므로 fit을 여러 번 눌러도 오차가 쌓이지 않는다.
//
// mode(원문/번역문)는 zoom/pan과 완전히 독립된 state다 — 전환해도 같은
// transform 값을 그대로 쓰므로 "보고 있던 위치"가 유지된다.
//
// 미포함(오늘 범위 아님): block selection overlay, 우측 block table,
// virtualization, 텍스트 수정, delete interaction, 툴바 전체 기능.
// ─────────────────────────────────────────────────────────────────

interface CanvasSlice {
  sectionId: string;
  /** 스택 안에서 이 section이 차지하는 높이 (scaleY 적용됨) */
  height: number;
  /** 이 section이 속한 sourceImage의 표시 폭 (scaleX 적용됨) */
  width: number;
  backgroundSize: string;
  backgroundPositionY: number;
  originalUrl: string;
  translatedUrl: string;
}

function buildIncludeSlices(
  sections: ReviewSection[],
  sourceImages: ReviewSourceImage[],
): CanvasSlice[] {
  const previewById = new Map(sourceImages.map((image) => [image.sourceImageId, image]));

  // job 전체 표시 순서 = sectionOrder 오름차순 (fixtures/handler가 이 순서로
  // displayTop을 계산했으므로, 렌더 순서도 반드시 같은 순서를 따라야 한다).
  const ordered = [...sections].sort((a, b) => a.sectionOrder - b.sectionOrder);

  return ordered
    .filter((section) => section.bucket === 'include')
    .flatMap((section): CanvasSlice[] => {
      const image = previewById.get(section.sourceImageId);
      if (!image) return [];

      const scale = getPreviewScale(image.preview);

      return [
        {
          sectionId: section.sectionId,
          height: section.height * scale.scaleY,
          width: image.preview.previewWidth,
          backgroundSize: `${image.preview.previewWidth}px ${image.preview.previewHeight}px`,
          // section.topOffset(원본 이미지 내부 절대 위치)을 그대로 쓴다 —
          // section.height 누적으로 만든 값이 아니다.
          backgroundPositionY: -(section.topOffset * scale.scaleY),
          originalUrl: image.originalPreviewUrl,
          translatedUrl: image.translatedPreviewUrl,
        },
      ];
    });
}

function ImageLayer({ slices, mode }: { slices: CanvasSlice[]; mode: N5ViewMode }) {
  return (
    <>
      {slices.map((slice) => (
        <div
          key={slice.sectionId}
          data-testid={`n5-slice-${mode}-${slice.sectionId}`}
          style={{
            height: slice.height,
            width: slice.width,
            backgroundColor: '#e5e5e5',
            backgroundImage: `url(${mode === 'original' ? slice.originalUrl : slice.translatedUrl})`,
            backgroundSize: slice.backgroundSize,
            backgroundPosition: `0px ${slice.backgroundPositionY}px`,
            backgroundRepeat: 'no-repeat',
          }}
        />
      ))}
    </>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function readPadding(el: HTMLElement) {
  const style = getComputedStyle(el);
  return {
    left: parseFloat(style.paddingLeft) || 0,
    right: parseFloat(style.paddingRight) || 0,
    top: parseFloat(style.paddingTop) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
  };
}

interface Transform {
  zoom: number;
  pan: Point;
}

const INITIAL_TRANSFORM: Transform = { zoom: 1, pan: { x: 0, y: 0 } };

export function N5Viewport({
  sourceImages,
  sections,
}: {
  sourceImages: ReviewSourceImage[];
  sections: ReviewSection[];
}) {
  const [viewMode, setViewMode] = useState<N5ViewMode>('translated');
  const [transform, setTransform] = useState<Transform>(INITIAL_TRANSFORM);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const spaceHeldRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ pointer: Point; pan: Point } | null>(null);

  // pointerdown 시점의 최신 transform.pan을 읽기 위한 ref — handlePointerDown을
  // useCallback([]) 로 한 번만 만들면서도 최신 pan 값을 참조하기 위함이다.
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const slices = useMemo(
    () => buildIncludeSlices(sections, sourceImages),
    [sections, sourceImages],
  );

  // canvas(원본, zoom과 무관한) 크기 — fit 계산의 기준값. 매 렌더 다시 측정하지 않는다.
  const canvasSize = useMemo<Size>(
    () => ({
      width: slices.reduce((max, s) => Math.max(max, s.width), 0),
      height: slices.reduce((sum, s) => sum + s.height, 0),
    }),
    [slices],
  );

  // ── Space 키 상태 추적 — 텍스트 입력창에 focus가 있으면 pan을 발동하지 않는다 ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return;
      // Space의 기본 동작(포커스된 button 재클릭, 문서 스크롤)을 막는다 —
      // 막지 않으면 툴바 버튼을 클릭한 직후 pan을 시작하려고 Space를 누를 때
      // 그 버튼이 다시 클릭된 것처럼 동작해 버린다.
      e.preventDefault();
      if (spaceHeldRef.current) return; // key repeat 무시
      spaceHeldRef.current = true;
      setIsSpaceHeld(true);
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      spaceHeldRef.current = false;
      setIsSpaceHeld(false);
    }

    // alt-tab 등으로 keyup 없이 포커스를 잃으면 pan 모드가 눌어붙는다 — 방지
    function handleBlur() {
      spaceHeldRef.current = false;
      setIsSpaceHeld(false);
      isPanningRef.current = false;
      setIsPanning(false);
      panStartRef.current = null;
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // ── Wheel — transform.pan/zoom을 움직이는 유일한 입력 경로.
  //    Ctrl/Cmd+Wheel = pointer 중심 zoom, 그 외(Shift 포함)는 canvas pan.
  //    native scrollTop/overflow-y-auto는 새로 만들지 않는다 — pan은 항상
  //    transform.pan 하나만 정본으로 쓴다(scroll state를 별도로 두지 않는다).
  //    브라우저 기본 page zoom/scroll을 막아야 하므로 React onWheel이 아니라
  //    { passive: false } native listener로 등록해야 preventDefault가 먹는다. ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        const rect = el!.getBoundingClientRect();
        const pointer: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setTransform((prev) => {
          const nextZoomRaw = prev.zoom * computeWheelZoomFactor(e.deltaY);
          return computeZoomAroundPoint(prev.zoom, prev.pan, pointer, nextZoomRaw);
        });
        return;
      }

      // 일반 wheel/trackpad pan. Shift+Wheel은 (주로 마우스 휠 전용) 세로
      // delta(e.deltaY)를 가로 이동으로 재해석한다 — 이 경우 e.deltaX는 쓰지
      // 않는다(트랙패드가 이미 deltaX/deltaY를 축별로 분리해 주는 것과 별개로,
      // 일반 마우스 휠 + Shift 조합을 위한 명시적 매핑이다).
      setTransform((prev) => ({
        ...prev,
        pan: e.shiftKey
          ? { x: prev.pan.x - e.deltaY, y: prev.pan.y }
          : { x: prev.pan.x - e.deltaX, y: prev.pan.y - e.deltaY },
      }));
    }

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!spaceHeldRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isPanningRef.current = true;
    setIsPanning(true);
    panStartRef.current = { pointer: { x: e.clientX, y: e.clientY }, pan: transformRef.current.pan };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current || !panStartRef.current) return;
    const { pointer, pan } = panStartRef.current;
    const nextPan: Point = {
      x: pan.x + (e.clientX - pointer.x),
      y: pan.y + (e.clientY - pointer.y),
    };
    setTransform((prev) => ({ ...prev, pan: nextPan }));
  }, []);

  const endPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    setIsPanning(false);
    panStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const handleZoomButton = useCallback((direction: 1 | -1) => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const center: Point = { x: rect.width / 2, y: rect.height / 2 };
    setTransform((prev) =>
      computeZoomAroundPoint(prev.zoom, prev.pan, center, prev.zoom + direction * ZOOM_BUTTON_STEP),
    );
  }, []);

  const handleFitWidth = useCallback(() => {
    const el = viewportRef.current;
    if (!el || canvasSize.width <= 0) return;
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    setTransform({ zoom: computeFitWidthScale(usable, canvasSize), pan: { x: 0, y: 0 } });
  }, [canvasSize]);

  const handleFitHeight = useCallback(() => {
    const el = viewportRef.current;
    if (!el || canvasSize.height <= 0) return;
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    setTransform({ zoom: computeFitHeightScale(usable, canvasSize), pan: { x: 0, y: 0 } });
  }, [canvasSize]);

  if (slices.length === 0) {
    return (
      <div
        data-testid="n5-viewport"
        className="flex h-full min-w-0 flex-1 items-center justify-center rounded-[6px] bg-[#f5f5f5] text-sm text-gray-400"
      >
        표시할 include section이 없습니다.
      </div>
    );
  }

  const cursor = isPanning ? 'grabbing' : isSpaceHeld ? 'grab' : 'default';

  return (
    <div
      ref={viewportRef}
      data-testid="n5-viewport"
      className="relative h-full min-w-0 flex-1 touch-none overflow-hidden rounded-[6px] bg-[#f5f5f5] p-6"
      style={{ cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div className="absolute top-5 left-5 z-10">
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      </div>

      <div className="absolute top-5 right-5 z-10 flex items-center gap-2">
        <ZoomControls
          zoom={transform.zoom}
          onZoomIn={() => handleZoomButton(1)}
          onZoomOut={() => handleZoomButton(-1)}
        />
        <FitControls onFitWidth={handleFitWidth} onFitHeight={handleFitHeight} />
      </div>

      <div
        data-testid="n5-canvas"
        // data-zoom/pan-*은 화면에 보이지 않는 테스트 전용 hook이다 — e2e가
        // transform CSS 문자열을 파싱하지 않고 현재 zoom/pan 값을 읽을 수 있게 한다.
        data-zoom={transform.zoom}
        data-pan-x={transform.pan.x}
        data-pan-y={transform.pan.y}
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
          transform: `translate(${transform.pan.x}px, ${transform.pan.y}px) scale(${transform.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <ImageLayer slices={slices} mode={viewMode} />
      </div>
    </div>
  );
}
