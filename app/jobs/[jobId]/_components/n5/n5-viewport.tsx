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
  computeCenteredPan,
  clampPan,
  type N5ViewMode,
  type Point,
  type Size,
} from '@/lib/n5/viewport';
import { ZoomControls, FitControls } from './n5-toolbar';

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
// 두지 않는다. 일반 wheel/Shift+Wheel/Space+drag/+-버튼/배율 직접 입력 모두
// 같은 transform.pan을 옮기기만 할 뿐, 별도의 scroll state를 두지 않는다.
// 이 다섯 경로 전부 lib/n5/viewport.ts의 clampPan을 거쳐 같은 pan 경계
// 규칙(11일차)을 적용한다 — 빈 공간이 viewport 중앙보다 더 넓게 보이지
// 않고, 캔버스가 viewport보다 작은 축은 그 축을 가운데 고정해 pan 자체가
// 안 먹는다.
//
// canvas(원문/번역 stack)의 크기는 zoom과 무관하게 고정된 값이다 — section
// 목록과 preview scale로부터 한 번만 계산하고(useMemo), 화면에는 그 위에
// `translate(pan) scale(zoom)` transform만 얹는다(transform-origin 0 0).
// fit 계산이 이 원본 크기와 viewport clientWidth/Height만으로 이뤄지는 것도
// 이 때문이다 — CSS transform 결과(getBoundingClientRect 등)를 다시 측정해
// 누적하지 않으므로 fit을 여러 번 눌러도 오차가 쌓이지 않는다. Fit Width/
// Height는 11일차부터 zoom만이 아니라 computeCenteredPan으로 pan도 함께
// 계산해 캔버스를 viewport 정중앙에 놓는다.
//
// mode(번역 전/번역 후)는 11일차부터 이 컴포넌트가 소유하지 않는다 — 상위
// (N5View)가 소유하고 이 컴포넌트는 viewMode를 prop으로만 받는다(우측
// N5Panel 상단으로 토글 UI 자체가 이동했기 때문). zoom/pan과는 여전히
// 완전히 독립된 state라 토글해도 같은 transform 값을 그대로 쓰므로 "보고
// 있던 위치"가 유지된다 — 이 불변은 mode의 소유자가 바뀌어도 그대로다.
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
// F-CFM-14 — N5에서 제외된 section의 회색 오버레이 + 제외하기/되돌리기 (10일차).
// N3에서 제외된 section은 /review 응답 자체에서 걸러져 여기 도달하지 않지만,
// N5에서 제외된 section(bucket==='exclude' && excludedStage==='N5', 또는 이번
// 세션에서 「제외하기」를 눌러 로컬로 제외한 section)은 캔버스에서 제거하지
// 않는다 — buildSectionSlices가 그대로 slice로 만들어 같은 자리·같은 높이를
// 유지하고, 그 위에 회색 오버레이 + 되돌리기 버튼(포함 상태면 반대로 「제외하기」
// 버튼)만 덮는다. 제외 상태는 sectionId 기준 로컬 state(excludedSectionIds)로만
// 관리하고 서버로 왕복하지 않는다 — 제외하기/되돌리기 둘 다 이 state를
// add/delete할 뿐이고, slices/canvasSize를 계산하는 useMemo의 의존성에는
// 들어가지 않으므로 스택 재계산/재배치가 절대 일어나지 않는다(같은 slices
// 배열, 같은 canvasSize를 그대로 재사용). N6 최종 렌더에서만 실제 제외 스택
// 반영이 이뤄진다 — N5는 여기서 표시만 담당한다.
//
// 미포함(오늘 범위 아님): block selection overlay(텍스트 블록 선택 하이라이트,
// F-CFM-14의 제외 오버레이와는 다른 개념), 우측 block table, virtualization,
// 텍스트 수정, delete interaction, 툴바 전체 기능.
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

/**
 * job의 section 목록으로부터 캔버스에 그릴 slice 목록을 만든다.
 *
 * "include"라는 이름과 달리 N5에서 제외된 section(bucket==='exclude' &&
 * excludedStage==='N5')도 slice로 만든다 — F-CFM-14가 그 자리에 회색
 * 오버레이를 덮어야 하므로, 위치/높이를 그대로 유지한 채 남겨둔다. 걸러내는
 * 것은 N3에서 제외된 section뿐이다(excludedStage==='N3') — 다만 /review
 * 응답 자체가 이미 N3 제외분을 필터링해 내려주므로, 여기 도달하는 section
 * 중 N3 제외는 원래 없다. 이 필터는 그 계약이 깨졌을 때를 대비한 방어용이다.
 */
function buildSectionSlices(
  sections: ReviewSection[],
  sourceImages: PreviewSourceImage[],
  naturalWidthBySourceImageId: Map<string, number>,
): CanvasSlice[] {
  const previewById = new Map(sourceImages.map((image) => [image.sourceImageId, image]));

  // job 전체 표시 순서 = sectionOrder 오름차순 (fixtures/handler가 이 순서로
  // displayTop을 계산했으므로, 렌더 순서도 반드시 같은 순서를 따라야 한다).
  const ordered = [...sections].sort((a, b) => a.sectionOrder - b.sectionOrder);

  return ordered
    .filter((section) => section.excludedStage !== 'N3')
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

function ImageLayer({
  slices,
  mode,
  excludedSectionIds,
  onExcludeSection,
  onRestoreSection,
}: {
  slices: CanvasSlice[];
  mode: N5ViewMode;
  /** F-CFM-14 — 로컬로 제외 처리된 sectionId 집합. slice 자체는 그대로 두고 위에 오버레이만 덮는다. */
  excludedSectionIds: Set<string>;
  onExcludeSection: (sectionId: string) => void;
  onRestoreSection: (sectionId: string) => void;
}) {
  return (
    <>
      {slices.map((slice) => {
        // renderedUrl이 null인 채로 'translated' 모드가 되는 경우는 없다 —
        // 상위(N5Viewport)가 hasMissingRenderedPreview일 때 초기 모드를
        // 'original'로 두고 「번역 후」 버튼도 disabled 처리하기 때문이다.
        // 그래도 url(null)을 그대로 CSS에 넣지 않도록 방어적으로 처리한다.
        const url = mode === 'original' ? slice.originalUrl : slice.renderedUrl;
        const isExcluded = excludedSectionIds.has(slice.sectionId);
        return (
          <div
            key={slice.sectionId}
            data-testid={`n5-slice-${mode}-${slice.sectionId}`}
            style={{
              position: 'relative',
              height: slice.height,
              width: slice.width,
              backgroundColor: '#e5e5e5',
              backgroundImage: url ? `url(${url})` : 'none',
              backgroundSize: slice.backgroundSize,
              backgroundPosition: `0px ${slice.backgroundPositionY}px`,
              backgroundRepeat: 'no-repeat',
            }}
          >
            {isExcluded ? (
              // F-CFM-14: slice의 height/width는 절대 건드리지 않는다 — 오버레이는
              // 같은 slice 내부에 absolute로 얹을 뿐이라, 스택 재배치가 일어나지 않는다.
              <div
                data-testid={`n5-section-excluded-${slice.sectionId}`}
                className="absolute inset-0 flex items-center justify-center"
                style={{ backgroundColor: 'rgba(23, 23, 23, 0.55)' }}
              >
                <button
                  type="button"
                  data-testid={`n5-section-restore-${slice.sectionId}`}
                  onClick={() => onRestoreSection(slice.sectionId)}
                  className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-[#171717] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)] hover:bg-gray-50"
                >
                  되돌리기
                </button>
              </div>
            ) : (
              // 포함 상태 section에 대한 「제외하기」 진입점 — 기존 toolbar
              // 버튼과 같은 시각 언어(rounded-full, 흰 배경, 옅은 그림자)를
              // 그대로 따른다. 클릭해도 slice/canvas는 전혀 다시 계산되지
              // 않는다 — excludedSectionIds에 sectionId만 추가될 뿐이다.
              <div className="absolute top-2 right-2 z-10">
                <button
                  type="button"
                  data-testid={`n5-section-exclude-${slice.sectionId}`}
                  onClick={() => onExcludeSection(slice.sectionId)}
                  className="rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-[#171717] shadow-[2px_2px_24px_0px_rgba(0,0,0,0.06)] hover:bg-white"
                >
                  제외하기
                </button>
              </div>
            )}
          </div>
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
  viewMode,
}: {
  sourceImages: PreviewSourceImage[];
  sections: ReviewSection[];
  /** 11일차부터 이 컴포넌트가 소유하지 않는다 — 토글 UI가 N5Panel로 이동했다. */
  viewMode: N5ViewMode;
}) {
  const [transform, setTransform] = useState<Transform>(INITIAL_TRANSFORM);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // F-CFM-14 — N5에서 제외된 section의 회색 오버레이(sectionId 기준 로컬
  // state). 서버 bucket/excludedStage를 초기값으로만 씨드하고, 이후로는
  // 서버와 왕복하지 않는다 — 제외하기/되돌리기 둘 다 이 Set을 add/delete할
  // 뿐이다. props는 N5Viewport가 마운트되는 시점(N5View가 로딩 완료 후에만
  // 렌더한다)에 이미 최종 값이라 lazy initializer로 한 번만 계산해도 안전하다.
  const [excludedSectionIds, setExcludedSectionIds] = useState<Set<string>>(
    () =>
      new Set(
        sections
          .filter((section) => section.bucket === 'exclude' && section.excludedStage === 'N5')
          .map((section) => section.sectionId),
      ),
  );

  const handleExcludeSection = useCallback((sectionId: string) => {
    setExcludedSectionIds((prev) => {
      if (prev.has(sectionId)) return prev;
      const next = new Set(prev);
      next.add(sectionId);
      return next;
    });
  }, []);

  const handleRestoreSection = useCallback((sectionId: string) => {
    setExcludedSectionIds((prev) => {
      if (!prev.has(sectionId)) return prev;
      const next = new Set(prev);
      next.delete(sectionId);
      return next;
    });
  }, []);

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

  // excludedSectionIds는 일부러 이 의존성 배열에 넣지 않는다 — F-CFM-14
  // 되돌리기는 오버레이 표시 여부만 바꿀 뿐, slices(위치/높이) 자체를
  // 다시 계산하면 안 된다(스택 재배치 금지).
  const slices = useMemo(
    () => buildSectionSlices(sections, sourceImages, naturalWidths),
    [sections, sourceImages, naturalWidths],
  );

  // canvas(원본, zoom과 무관한) 크기 — fit 계산의 기준값. 매 렌더 다시 측정하지 않는다.
  const canvasSize = useMemo<Size>(
    () => ({
      width: slices.reduce((max, s) => Math.max(max, s.width), 0),
      height: slices.reduce((sum, s) => sum + s.height, 0),
    }),
    [slices],
  );

  // wheel/pointer 핸들러는 useCallback([])/useEffect([])로 한 번만 만들어
  // el(viewportRef)을 재사용한다 — 그 안에서 canvasSize를 직접 closure로
  // 참조하면 naturalWidths가 나중에 채워져 canvasSize가 바뀌어도 마운트
  // 시점의 값(보통 {0,0})에 갇힌다. transformRef와 같은 이유로 ref에 최신값을
  // 미러링해 둔다. canvasSize.width/height가 모두 0이면 "표시할 이미지가
  // 없는" 상태다 — 이때 wheel/drag는 완전히 비활성화된다(zoom/fit 버튼은
  // 애초에 이 조건일 때 렌더되지 않는다).
  const canvasSizeRef = useRef(canvasSize);
  useEffect(() => {
    canvasSizeRef.current = canvasSize;
  }, [canvasSize]);

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
  //    { passive: false } native listener로 등록해야 preventDefault가 먹는다.
  //    두 경로 모두 마지막에 clampPan을 거친다(11일차 pan 경계). ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      if (canvasSizeRef.current.width <= 0 && canvasSizeRef.current.height <= 0) return; // 빈 상태 — 조작 비활성화

      if (e.ctrlKey || e.metaKey) {
        const rect = el!.getBoundingClientRect();
        const pointer: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const usable = computeUsableViewportSize(el!.clientWidth, el!.clientHeight, readPadding(el!));
        setTransform((prev) => {
          const nextZoomRaw = prev.zoom * computeWheelZoomFactor(e.deltaY);
          const result = computeZoomAroundPoint(prev.zoom, prev.pan, pointer, nextZoomRaw);
          return { zoom: result.zoom, pan: clampPan(result.pan, canvasSizeRef.current, result.zoom, usable) };
        });
        return;
      }

      // 일반 wheel/trackpad pan. Shift+Wheel은 (주로 마우스 휠 전용) 세로
      // delta(e.deltaY)를 가로 이동으로 재해석한다 — 이 경우 e.deltaX는 쓰지
      // 않는다(트랙패드가 이미 deltaX/deltaY를 축별로 분리해 주는 것과 별개로,
      // 일반 마우스 휠 + Shift 조합을 위한 명시적 매핑이다).
      const usable = computeUsableViewportSize(el!.clientWidth, el!.clientHeight, readPadding(el!));
      setTransform((prev) => {
        const rawPan: Point = e.shiftKey
          ? { x: prev.pan.x - e.deltaY, y: prev.pan.y }
          : { x: prev.pan.x - e.deltaX, y: prev.pan.y - e.deltaY };
        return { ...prev, pan: clampPan(rawPan, canvasSizeRef.current, prev.zoom, usable) };
      });
    }

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!spaceHeldRef.current) return;
    if (canvasSizeRef.current.width <= 0 && canvasSizeRef.current.height <= 0) return; // 빈 상태 — pan 비활성화
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
    const el = viewportRef.current;
    setTransform((prev) => {
      if (!el) return { ...prev, pan: nextPan };
      const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
      return { ...prev, pan: clampPan(nextPan, canvasSizeRef.current, prev.zoom, usable) };
    });
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
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    setTransform((prev) => {
      const result = computeZoomAroundPoint(prev.zoom, prev.pan, center, prev.zoom + direction * ZOOM_BUTTON_STEP);
      return { zoom: result.zoom, pan: clampPan(result.pan, canvasSizeRef.current, result.zoom, usable) };
    });
  }, []);

  // 배율 직접 입력(11일차) — n5-toolbar.tsx의 ZoomControls가
  // parseZoomPercentInput으로 이미 유효한 zoom 배수로 보정해서 넘겨준다.
  // +/- 버튼과 같은 방식(viewport 중심 기준 zoom) 뒤 clampPan을 거친다.
  const handleSetZoom = useCallback((nextZoom: number) => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const center: Point = { x: rect.width / 2, y: rect.height / 2 };
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    setTransform((prev) => {
      const result = computeZoomAroundPoint(prev.zoom, prev.pan, center, nextZoom);
      return { zoom: result.zoom, pan: clampPan(result.pan, canvasSizeRef.current, result.zoom, usable) };
    });
  }, []);

  // Fit Width/Height(11일차) — zoom뿐 아니라 computeCenteredPan으로 pan도
  // 함께 계산해 캔버스를 viewport 정중앙에 놓는다. clampPan이 아니라
  // computeCenteredPan을 쓴다 — fit은 "범위 안에서 이동 허용"이 아니라
  // 항상 정확히 가운데 배치가 목표이기 때문이다.
  const handleFitWidth = useCallback(() => {
    const el = viewportRef.current;
    if (!el || canvasSize.width <= 0) return;
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    const zoom = computeFitWidthScale(usable, canvasSize);
    setTransform({ zoom, pan: computeCenteredPan(canvasSize, zoom, usable) });
  }, [canvasSize]);

  const handleFitHeight = useCallback(() => {
    const el = viewportRef.current;
    if (!el || canvasSize.height <= 0) return;
    const usable = computeUsableViewportSize(el.clientWidth, el.clientHeight, readPadding(el));
    const zoom = computeFitHeightScale(usable, canvasSize);
    setTransform({ zoom, pan: computeCenteredPan(canvasSize, zoom, usable) });
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
          <div className="absolute top-5 right-5 z-10 flex items-center gap-2">
            <ZoomControls
              zoom={transform.zoom}
              onZoomIn={() => handleZoomButton(1)}
              onZoomOut={() => handleZoomButton(-1)}
              onSetZoom={handleSetZoom}
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
            <ImageLayer
              slices={slices}
              mode={viewMode}
              excludedSectionIds={excludedSectionIds}
              onExcludeSection={handleExcludeSection}
              onRestoreSection={handleRestoreSection}
            />
          </div>
        </>
      )}
    </div>
  );
}
