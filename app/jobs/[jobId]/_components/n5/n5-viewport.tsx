'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReviewSection, PreviewSourceImage } from '@/lib/api/types';
import {
  ZOOM_BUTTON_STEP,
  computeWheelZoomFactor,
  computeZoomAroundPoint,
  computeUsableViewportSize,
  computeFitWidthScale,
  computeFitHeightScale,
  hasMissingRenderedPreview,
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
// sourceImages는 /review가 아니라 /preview(API-CFM-03, v3.4.1) 응답이다 —
// originalUrl/renderedUrl/scale/previewHeight 모두 서버가 계산해 내려주는
// 값을 그대로 쓰고, FE는 scale을 다시 계산하지 않는다. scale은 v3.4.1
// 백엔드 최종 확정으로 단일 숫자다(scaleX/scaleY 두 축이 아니다). section의
// bucket/height/topOffset/textBlocks는 여전히 /review가 정본이라 sections
// prop은 그대로 ReviewSection[]을 받는다.
//
// previewWidth는 /preview 계약에 없다(v3.4.1 백엔드 최종 확정) — API에 다시
// 추가하지 않는다. 대신 originalUrl 이미지 "자체의" 실제 픽셀 폭(naturalWidth)을
// 그대로 쓴다(useNaturalWidths). originalUrl/renderedUrl은 이미 다운스케일된
// preview 이미지 파일이다(백엔드 최종 확정) — 즉 naturalWidth가 이미 preview
// 좌표계의 폭이라, 여기에 scale을 또 곱하면 이중 스케일 적용이 된다. scale은
// section.height/topOffset처럼 "원본 해상도 좌표"를 preview 좌표로 바꿀 때만
// 쓰고, 이미지 자체의 폭(naturalWidth)에는 쓰지 않는다. CSS transform 결과를
// 다시 측정하는 것과는 다르다 — naturalWidth는 원본 asset 고유값이라 zoom/pan/fit을
// 아무리 반복해도 오차가 쌓이지 않는다.
//
// 미포함(오늘 범위 아님): block selection overlay, 우측 block table,
// virtualization, 텍스트 수정, delete interaction, 툴바 전체 기능.
// ─────────────────────────────────────────────────────────────────

/**
 * sourceImages의 originalUrl을 로드해 실제 픽셀 폭(naturalWidth)을 얻는다.
 * /preview가 previewWidth를 내려주지 않으므로, 폭이 필요한 곳(canvas/background
 * 크기)은 이 값을 그대로 쓴다 — originalUrl/renderedUrl 자체가 이미 다운스케일된
 * preview 이미지라(백엔드 최종 확정) naturalWidth가 이미 preview 좌표계의
 * 폭이고, scale을 또 곱하면 안 된다(이중 스케일 적용). originalUrl만
 * 측정한다 — originalUrl/renderedUrl은 같은 원본 이미지의 전/후 버전이라
 * 같은 크기를 공유하고, originalUrl은(renderedUrl과 달리) null이 아니므로
 * 항상 측정 가능하다.
 */
function useNaturalWidths(sourceImages: PreviewSourceImage[]): Map<string, number> {
  const [widths, setWidths] = useState<Map<string, number>>(new Map());
  const startedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    sourceImages.forEach((image) => {
      if (startedRef.current.has(image.sourceImageId)) return;
      startedRef.current.add(image.sourceImageId);

      const img = new Image();
      img.onload = () => {
        setWidths((prev) => {
          const next = new Map(prev);
          next.set(image.sourceImageId, img.naturalWidth);
          return next;
        });
      };
      img.src = image.originalUrl;
    });
  }, [sourceImages]);

  return widths;
}

interface CanvasSlice {
  sectionId: string;
  /** 스택 안에서 이 section이 차지하는 높이 (scale 적용됨) */
  height: number;
  /**
   * 이 section이 속한 sourceImage의 표시 폭 (naturalWidth 그대로 — 이미
   * preview 좌표계 폭이라 scale을 곱하지 않는다).
   */
  width: number;
  backgroundSize: string;
  backgroundPositionY: number;
  originalUrl: string;
  /** render_image_key가 없으면(렌더 미완료) null. 「번역 후」가 disabled인 동안은 쓰이지 않는다. */
  renderedUrl: string | null;
}

function buildIncludeSlices(
  sections: ReviewSection[],
  sourceImages: PreviewSourceImage[],
  naturalWidthBySourceImageId: Map<string, number>,
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

      // naturalWidth를 아직 못 구했으면(이미지 로드 전) 이 section은 잠깐
      // 건너뛴다 — 로드가 끝나면 useNaturalWidths가 갱신되어 다시 그려진다.
      const naturalWidth = naturalWidthBySourceImageId.get(image.sourceImageId);
      if (naturalWidth == null) return [];

      // image.scale은 /preview가 서버에서 계산해 내려준 단일 배율이다 —
      // 여기서 다시 구하지 않는다. originalUrl/renderedUrl 자체가 이미
      // 다운스케일된 preview 이미지이므로(백엔드 최종 확정) naturalWidth는
      // 이미 preview 좌표계의 폭이다 — scale을 또 곱하면 이중 스케일 적용이
      // 된다. scale은 section.height/topOffset처럼 "원본 해상도 좌표"에만 쓴다.
      const { scale } = image;
      const previewWidth = naturalWidth;

      return [
        {
          sectionId: section.sectionId,
          height: section.height * scale,
          width: previewWidth,
          backgroundSize: `${previewWidth}px ${image.previewHeight}px`,
          // section.topOffset(원본 이미지 내부 절대 위치)을 그대로 쓴다 —
          // section.height 누적으로 만든 값이 아니다.
          backgroundPositionY: -(section.topOffset * scale),
          originalUrl: image.originalUrl,
          renderedUrl: image.renderedUrl,
        },
      ];
    });
}

function ImageLayer({ slices, mode }: { slices: CanvasSlice[]; mode: N5ViewMode }) {
  return (
    <>
      {slices.map((slice) => {
        // renderedUrl이 null인 채로 'translated' 모드가 되는 경우는 없다 —
        // 상위(N5Viewport)가 hasMissingRenderedPreview일 때 초기 모드를
        // 'original'로 두고 「번역 후」 버튼도 disabled 처리하기 때문이다.
        // 그래도 url(null)을 그대로 CSS에 넣지 않도록 방어적으로 처리한다.
        const url = mode === 'original' ? slice.originalUrl : slice.renderedUrl;
        return (
          <div
            key={slice.sectionId}
            data-testid={`n5-slice-${mode}-${slice.sectionId}`}
            style={{
              height: slice.height,
              width: slice.width,
              backgroundColor: '#e5e5e5',
              backgroundImage: url ? `url(${url})` : 'none',
              backgroundSize: slice.backgroundSize,
              backgroundPosition: `0px ${slice.backgroundPositionY}px`,
              backgroundRepeat: 'no-repeat',
            }}
          />
        );
      })}
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
  sourceImages: PreviewSourceImage[];
  sections: ReviewSection[];
}) {
  // renderedUrl(render_image_key)이 없는 sourceImage가 하나라도 있으면 렌더가
  // 아직 없다는 뜻이다 — 이때는 기본 진입도 'translated'가 아니라 'original'로
  // 시작한다(보여줄 이미지가 없으므로). props는 이 컴포넌트가 마운트되는
  // 시점(N5View가 로딩 완료 후에만 렌더한다)에 이미 최종 값이라 useState
  // lazy initializer로 한 번만 계산해도 안전하다.
  const [viewMode, setViewMode] = useState<N5ViewMode>(() =>
    hasMissingRenderedPreview(sourceImages) ? 'original' : 'translated',
  );
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

  const naturalWidths = useNaturalWidths(sourceImages);

  const slices = useMemo(
    () => buildIncludeSlices(sections, sourceImages, naturalWidths),
    [sections, sourceImages, naturalWidths],
  );

  const translatedDisabled = useMemo(
    () => hasMissingRenderedPreview(sourceImages),
    [sourceImages],
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

  const cursor = isPanning ? 'grabbing' : isSpaceHeld ? 'grab' : 'default';

  // slices가 비어 있을 수 있는 두 경우 — (a) include section이 실제로 없음,
  // (b) naturalWidth 측정이 아직 끝나지 않아 잠깐 비어 있음(useNaturalWidths) —
  // 어느 쪽이든 이 바깥 div는 그대로 유지한다. 이 div를 통째로 다른 subtree로
  // 바꿔치기하면(예: 조건부로 완전히 다른 return을 타면) viewportRef가 그
  // 순간 null이 되고, wheel 리스너 useEffect([])가 마운트 시점의 null을
  // 캡처해 이후 canvas가 나타나도 wheel이 영영 붙지 않는 버그가 생긴다.
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
      {slices.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-gray-400">
          표시할 include section이 없습니다.
        </div>
      ) : (
        <>
          <div className="absolute top-5 left-5 z-10">
            <ViewModeToggle
              mode={viewMode}
              onChange={setViewMode}
              translatedDisabled={translatedDisabled}
            />
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
        </>
      )}
    </div>
  );
}
