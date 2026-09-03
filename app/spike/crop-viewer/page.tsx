'use client';

/**
 * FE Spike ① — 긴 원본 뷰어 (F-CRP-01a)
 *
 * 이 파일이 왜 필요한가
 *   "세로 10,000px 원본을 브라우저에서 스크롤·확대하며 크롭할 수 있는가"를
 *   실제 코드로 확인하기 위한 검증 화면입니다. S2 프로덕션 UI가 아닙니다.
 *
 * state 가 어디에 있는가
 *   전부 이 컴포넌트의 useState 입니다. Zustand 를 쓰지 않습니다.
 *   화면 하나 안에서만 쓰이는 상태라 전역으로 올릴 이유가 없습니다.
 *   (S2 실제 구현에서 좌측 목록·우측 패널로 갈라질 때 그때 판단합니다)
 *
 *   canonical state 는 crops 배열 하나뿐이고, 안에는 source 좌표만 들어갑니다.
 *   zoomScale 은 "화면을 어떻게 보여줄지"일 뿐 crops 를 건드리지 않습니다.
 *
 * 좌표 변환이 어디서 일어나는가
 *   이 파일에서는 toDisplayPoint() 한 곳에서만 화면 좌표를 만듭니다.
 *   실제 나눗셈·곱셈은 전부 lib/spike/coordinates.ts 안에 있습니다.
 *   그래서 좌표 버그가 나면 볼 곳이 두 군데뿐입니다.
 *
 * 나중에 실제 API 로 무엇을 교체하는가
 *   1) getSpikeSourceImages()  → GET /jobs/{jobId}/source-images
 *   2) setCrops(...) 로 끝나는 부분 → POST /jobs/{jobId}/pieces (조각 생성)
 *   3) 삭제 버튼 → DELETE /pieces/{pieceId}
 *   좌표 변환 코드는 그대로 둡니다.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  buildCropFromDrag,
  getDisplayScale,
  isValidScale,
  measureRoundTripDrift,
  sourceRectToDisplay,
  type Crop,
  type DisplayPoint,
  type SourceImage,
} from '@/lib/spike/coordinates';
import {
  CROP_WARN_MIN_HEIGHT,
  CROP_WARN_MIN_WIDTH,
  MIN_CROP_SOURCE_PX,
  MODULE_SPEC,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from '@/lib/spike/constants';
import { getSpikeSourceImages } from '@/lib/spike/fixtures';

/** 이미지 로딩 상태. crop 을 허용할지 판단하는 근거가 됩니다. */
type ImageStatus = 'loading' | 'loaded' | 'error';

/** 드래그 중에만 존재하는 값. 끝나면 버립니다. 저장하지 않습니다. */
type DragState = { start: DisplayPoint; current: DisplayPoint } | null;

/** 자체 검증 결과 한 줄 */
type SelfTestLine = { ok: boolean; name: string; detail: string };

/** 다음 화면 그리기까지 기다립니다. setState 직후 DOM 을 읽으면 옛날 값이 나옵니다. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

const FAIL_MESSAGE: Record<string, string> = {
  INVALID_SCALE: 'previewScale 또는 zoom 값이 올바르지 않아 좌표를 계산할 수 없습니다.',
  ZERO_SIZE: '너비 또는 높이가 0인 영역은 만들 수 없습니다.',
  TOO_SMALL: `너무 작은 영역입니다. (원본 기준 ${MIN_CROP_SOURCE_PX}px 미만)`,
  OUT_OF_BOUNDS: '이미지 바깥에서만 드래그했습니다.',
};

export default function CropViewerSpikePage() {
  // 실제 API 교체 지점 ①
  const images = useMemo(() => getSpikeSourceImages(), []);

  const [imageId, setImageId] = useState(images[0].sourceImageId);
  const [zoomScale, setZoomScale] = useState(ZOOM_DEFAULT);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);
  const [status, setStatus] = useState<ImageStatus>('loading');
  const [drag, setDrag] = useState<DragState>(null);
  const [pointer, setPointer] = useState<DisplayPoint | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** 저장→초기화→복원 테스트에 쓰는 임시 보관함 */
  const [snapshot, setSnapshot] = useState<string | null>(null);
  /** 브라우저 자체 검증 결과 */
  const [selfTest, setSelfTest] = useState<SelfTestLine[]>([]);
  const [testing, setTesting] = useState(false);
  /** 이미지 로드에 걸린 시간(ms). 성능 판단 근거로 씁니다. */
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const loadStartedAt = useRef<number>(0);

  const imageBoxRef = useRef<HTMLDivElement>(null);
  const nextCropNo = useRef(0);

  const image = images.find((i) => i.sourceImageId === imageId) as SourceImage;

  /* ------------------------------------------------------------ *
   * 배율 계산 — previewScale 과 zoomScale 을 절대 한 변수에 섞지 않는다
   * ------------------------------------------------------------ */
  const previewScaleOk = isValidScale(image.previewScale);
  const zoomOk = isValidScale(zoomScale);
  const displayScale = previewScaleOk && zoomOk
    ? getDisplayScale(image.previewScale, zoomScale)
    : NaN;
  const scaleOk = isValidScale(displayScale);
  const sizeOk = image.originalWidth > 0 && image.originalHeight > 0;

  /** crop 을 만들 수 있는 조건. 하나라도 어긋나면 드래그를 막습니다. */
  const canCrop = status === 'loaded' && scaleOk && sizeOk;

  /** 화면에 그릴 이미지 크기. 원본 크기 × displayScale 로 매번 계산합니다. */
  const renderedWidth = sizeOk && scaleOk ? image.originalWidth * displayScale : 0;
  const renderedHeight = sizeOk && scaleOk ? image.originalHeight * displayScale : 0;

  const cropsForImage = crops.filter((c) => c.sourceImageId === imageId);

  /* ------------------------------------------------------------ *
   * 화면 좌표 구하기 — 이 함수 하나만 브라우저 좌표를 다룹니다.
   *
   * getBoundingClientRect() 는 "지금 화면에 보이는 위치"를 돌려주므로
   * 스크롤을 아무리 내려도 clientX - rect.left 는 항상 이미지 안에서의
   * 위치가 됩니다. scrollTop 을 직접 더하고 빼면 오차가 생깁니다.
   * ------------------------------------------------------------ */
  const toDisplayPoint = useCallback((e: React.PointerEvent): DisplayPoint | null => {
    const box = imageBoxRef.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    return { displayX: e.clientX - rect.left, displayY: e.clientY - rect.top };
  }, []);

  /* ------------------------------------------------------------ *
   * 드래그로 crop 만들기
   * ------------------------------------------------------------ */
  function handlePointerDown(e: React.PointerEvent) {
    if (!canCrop) {
      setMessage(
        status !== 'loaded'
          ? '이미지가 아직 준비되지 않았습니다. (로딩 중이거나 실패)'
          : '배율 또는 이미지 크기 정보가 올바르지 않아 크롭할 수 없습니다.',
      );
      return;
    }
    const p = toDisplayPoint(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ start: p, current: p });
    setMessage(null);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const p = toDisplayPoint(e);
    if (p) setPointer(p);
    if (drag) setDrag({ start: drag.start, current: p ?? drag.current });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drag) return;
    const end = toDisplayPoint(e) ?? drag.current;
    setDrag(null);

    // ★ 여기가 유일한 "화면 좌표 → source 좌표" 확정 지점입니다.
    const result = buildCropFromDrag(
      drag.start,
      end,
      displayScale,
      image,
      MIN_CROP_SOURCE_PX,
    );

    if (!result.ok) {
      setMessage(FAIL_MESSAGE[result.reason] ?? result.reason);
      return;
    }

    // 임시 ID. 실제로는 POST /pieces 응답의 pieceId 를 씁니다.
    // 랜덤·시각 대신 증가 카운터를 쓰는 이유: 렌더 결과를 예측 가능하게 두기 위함입니다.
    nextCropNo.current += 1;
    const crop: Crop = {
      id: `crop-${nextCropNo.current}`,
      sourceImageId: imageId,
      ...result.rect,
    };
    setCrops((prev) => [...prev, crop]);
    setSelectedCropId(crop.id);

    // F-CRP-01 예외 — 모듈 최소 해상도 미달은 "경고"이며 차단이 아닙니다.
    const notes: string[] = [];
    if (result.clamped) notes.push('이미지 경계를 넘어 잘라냈습니다.');
    if (
      crop.sourceWidth < CROP_WARN_MIN_WIDTH ||
      crop.sourceHeight < CROP_WARN_MIN_HEIGHT
    ) {
      notes.push(
        `모듈 규격(${MODULE_SPEC.width}x${MODULE_SPEC.height})보다 작습니다. 확대 시 화질이 떨어질 수 있습니다.`,
      );
    }
    setMessage(notes.length ? `경고 · ${notes.join(' ')}` : null);
  }

  /* ------------------------------------------------------------ *
   * zoom — crops 를 절대 건드리지 않습니다
   * ------------------------------------------------------------ */
  function changeZoom(next: number) {
    const clamped = Math.min(Math.max(Number(next.toFixed(4)), ZOOM_MIN), ZOOM_MAX);
    setZoomScale(clamped);
  }

  /* ------------------------------------------------------------ *
   * 저장 → 초기화 → 복원 : source 좌표만으로 다시 그릴 수 있는지 확인
   * ------------------------------------------------------------ */
  function saveAndClear() {
    setSnapshot(JSON.stringify(crops));
    setCrops([]);
    setSelectedCropId(null);
    setMessage('crops 를 비웠습니다. [복원]을 누르면 저장된 source 좌표로만 다시 그립니다.');
  }

  function restore() {
    if (!snapshot) return;
    setCrops(JSON.parse(snapshot) as Crop[]);
    setMessage('저장된 source 좌표로 복원했습니다. 위치가 같으면 통과입니다.');
  }

  /* ------------------------------------------------------------ *
   * 브라우저 자체 검증
   *
   * 계산식이 맞는지는 scripts/verify-coordinates.mjs 가 이미 봅니다.
   * 여기서 보는 것은 "실제 DOM 이 그 계산대로 그려졌는가" 입니다.
   * getBoundingClientRect() 로 브라우저가 진짜 그린 위치를 읽어 비교합니다.
   * ------------------------------------------------------------ */
  async function runSelfTest() {
    if (!canCrop) {
      setMessage('이미지가 준비된 정상 fixture 에서만 실행할 수 있습니다.');
      return;
    }
    setTesting(true);
    const lines: SelfTestLine[] = [];

    // 원본 좌표를 직접 지정한 crop 3개를 넣습니다. 드래그가 아니라 값 주입입니다.
    const w = image.originalWidth;
    const h = image.originalHeight;
    const probes: Crop[] = [
      { id: 'st-1', sourceImageId: imageId, sourceX: 120, sourceY: 240, sourceWidth: 400, sourceHeight: 600 },
      { id: 'st-2', sourceImageId: imageId, sourceX: 0, sourceY: Math.round(h / 2), sourceWidth: Math.round(w / 2), sourceHeight: 500 },
      { id: 'st-3', sourceImageId: imageId, sourceX: Math.round(w * 0.6), sourceY: h - 800, sourceWidth: Math.round(w * 0.4), sourceHeight: 800 },
    ];
    const before = JSON.stringify(probes);
    setCrops(probes);
    await nextFrame();

    const scroller = imageBoxRef.current?.closest('main');
    const TOLERANCE = 1; // 브라우저 서브픽셀 렌더링 때문에 1px 는 허용합니다

    async function measureAt(zoom: number, label: string) {
      setZoomScale(zoom);
      await nextFrame();
      const box = imageBoxRef.current;
      if (!box) return;
      const boxRect = box.getBoundingClientRect();
      const scale = getDisplayScale(image.previewScale, zoom);

      for (const c of probes) {
        const el = document.querySelector<HTMLElement>(`[data-crop-id="${c.id}"]`);
        if (!el) {
          lines.push({ ok: false, name: `${label} ${c.id}`, detail: 'DOM 요소를 찾지 못함' });
          continue;
        }
        const r = el.getBoundingClientRect();
        const actualLeft = r.left - boxRect.left;
        const actualTop = r.top - boxRect.top;
        const expected = sourceRectToDisplay(c, scale);
        const dx = Math.abs(actualLeft - expected.left);
        const dy = Math.abs(actualTop - expected.top);
        const dw = Math.abs(r.width - expected.width);
        const dh = Math.abs(r.height - expected.height);
        const worst = Math.max(dx, dy, dw, dh);
        lines.push({
          ok: worst <= TOLERANCE,
          name: `${label} ${c.id}`,
          detail: `실제(${actualLeft.toFixed(1)}, ${actualTop.toFixed(1)}, ${r.width.toFixed(1)}x${r.height.toFixed(1)}) / 기대(${expected.left.toFixed(1)}, ${expected.top.toFixed(1)}, ${expected.width.toFixed(1)}x${expected.height.toFixed(1)}) → 최대 오차 ${worst.toFixed(2)}px`,
        });
      }
    }

    // 1) 스크롤 맨 위에서 여러 배율로 측정
    if (scroller) scroller.scrollTop = 0;
    for (const z of [0.25, 0.5, 1, 1.5, 2, 4]) {
      await measureAt(z, `zoom ${z}x · 상단`);
    }

    // 2) 맨 아래까지 스크롤한 뒤 다시 측정 (스크롤 위치 독립성)
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      await nextFrame();
      await measureAt(1, 'zoom 1x · 최하단 스크롤');
      scroller.scrollTop = Math.round(scroller.scrollHeight / 2);
      await nextFrame();
      await measureAt(2, 'zoom 2x · 중간 스크롤');
    }

    // 3) 저장값이 한 번도 안 바뀌었는지
    setZoomScale(ZOOM_DEFAULT);
    await nextFrame();
    lines.unshift({
      ok: JSON.stringify(probes) === before,
      name: '저장된 source 좌표 불변',
      detail: '줌·스크롤을 모두 거친 뒤 crop 객체 비교',
    });

    setSelfTest(lines);
    setTesting(false);
    const failed = lines.filter((l) => !l.ok).length;
    setMessage(
      failed === 0
        ? `자체 검증 통과 — ${lines.length}건 전부 PASS`
        : `자체 검증 실패 ${failed}건 / 전체 ${lines.length}건`,
    );
  }

  /** 드래그 중인 사각형(미확정)의 화면 좌표. 저장하지 않습니다. */
  const dragRect = drag
    ? {
        left: Math.min(drag.start.displayX, drag.current.displayX),
        top: Math.min(drag.start.displayY, drag.current.displayY),
        width: Math.abs(drag.current.displayX - drag.start.displayX),
        height: Math.abs(drag.current.displayY - drag.start.displayY),
      }
    : null;

  const pointerSource =
    pointer && scaleOk
      ? {
          x: pointer.displayX / displayScale,
          y: pointer.displayY / displayScale,
        }
      : null;

  const maxDrift = scaleOk
    ? cropsForImage.reduce(
        (m, c) => Math.max(m, measureRoundTripDrift(c, displayScale)),
        0,
      )
    : NaN;

  return (
    <div className="flex h-screen flex-col text-sm">
      {/* ── 상단 도구 막대 ────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-3 border-b border-gray-400 p-2">
        <strong>FE Spike ① 긴 원본 뷰어</strong>

        <select
          className="border border-gray-400 p-1"
          value={imageId}
          onChange={(e) => {
            setImageId(e.target.value);
            setStatus('loading');
            setMessage(null);
            setSelectedCropId(null);
            setSelfTest([]);
            setLoadMs(null);
            loadStartedAt.current = performance.now();
          }}
        >
          {images.map((img) => (
            <option key={img.sourceImageId} value={img.sourceImageId}>
              {img.label}
            </option>
          ))}
        </select>

        <span className="border border-gray-400 px-2 py-1">
          원본 {image.originalWidth} x {image.originalHeight}
        </span>

        <button
          type="button"
          className="border border-gray-400 px-2 py-1 disabled:opacity-40"
          onClick={() => changeZoom(zoomScale - ZOOM_STEP)}
          disabled={zoomScale <= ZOOM_MIN}
        >
          축소 −
        </button>
        <button
          type="button"
          className="border border-gray-400 px-2 py-1 disabled:opacity-40"
          onClick={() => changeZoom(zoomScale + ZOOM_STEP)}
          disabled={zoomScale >= ZOOM_MAX}
        >
          확대 +
        </button>
        <button
          type="button"
          className="border border-gray-400 px-2 py-1"
          onClick={() => changeZoom(ZOOM_DEFAULT)}
        >
          100%
        </button>
        {/* 잘못된 zoom 값 검증용 — 실제 UI 에는 없을 버튼입니다 */}
        <button
          type="button"
          className="border border-dashed border-gray-400 px-2 py-1"
          onClick={() => setZoomScale(0)}
          title="에러 케이스: zoom=0"
        >
          zoom=0 (에러)
        </button>

        <button
          type="button"
          className="border border-gray-400 px-2 py-1"
          onClick={saveAndClear}
        >
          저장 후 비우기
        </button>
        <button
          type="button"
          className="border border-gray-400 px-2 py-1 disabled:opacity-40"
          onClick={restore}
          disabled={!snapshot}
        >
          복원
        </button>

        <button
          type="button"
          className="border-2 border-gray-700 px-2 py-1 font-bold disabled:opacity-40"
          onClick={runSelfTest}
          disabled={testing || !canCrop}
        >
          {testing ? '검증 중…' : '브라우저 자체 검증 실행'}
        </button>

        {/* F-CRP-03 예외 — 크롭 0개로 다음 단계 시도 차단 */}
        <button
          type="button"
          className="border border-gray-400 px-2 py-1 disabled:opacity-40"
          disabled={cropsForImage.length === 0}
          onClick={() => setMessage('다음 단계로 진행 가능 (스파이크에서는 이동하지 않습니다)')}
        >
          다음 ({cropsForImage.length})
        </button>
      </header>

      {/* ── 개발용 HUD ────────────────────────────────────── */}
      <div className="flex flex-wrap gap-4 border-b border-gray-300 bg-gray-100 p-2 font-mono text-xs">
        <span>previewScale = {String(image.previewScale)}</span>
        <span>zoomScale = {zoomScale}</span>
        <span>displayScale = {scaleOk ? displayScale.toFixed(4) : '계산 불가'}</span>
        <span>status = {status}</span>
        <span>이미지 로드 = {loadMs === null ? '-' : `${loadMs}ms`}</span>
        <span>
          pointer display ={' '}
          {pointer
            ? `${pointer.displayX.toFixed(1)}, ${pointer.displayY.toFixed(1)}`
            : '-'}
        </span>
        <span>
          → source ={' '}
          {pointerSource
            ? `${pointerSource.x.toFixed(1)}, ${pointerSource.y.toFixed(1)}`
            : '-'}
        </span>
        <span>
          왕복 오차(max drift) ={' '}
          {Number.isFinite(maxDrift) ? `${maxDrift.toFixed(6)} px` : '-'}
        </span>
      </div>

      {message && (
        <div className="border-b border-gray-400 bg-gray-200 p-2">{message}</div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── 이미지 스크롤 영역 ─────────────────────────── */}
        <main className="flex-1 overflow-auto bg-gray-300 p-4">
          {!scaleOk && (
            <p className="border border-gray-500 bg-white p-3">
              배율을 계산할 수 없습니다. previewScale={String(image.previewScale)},
              zoomScale={zoomScale} — 0·음수·NaN 은 좌표를 망가뜨리므로 표시를 중단합니다.
            </p>
          )}
          {!sizeOk && (
            <p className="border border-gray-500 bg-white p-3">
              원본 width/height 를 받지 못했습니다. 크롭을 진행할 수 없습니다.
            </p>
          )}

          {scaleOk && sizeOk && (
            <div
              ref={imageBoxRef}
              className="relative select-none bg-white"
              style={{
                width: renderedWidth,
                height: renderedHeight,
                cursor: canCrop ? 'crosshair' : 'not-allowed',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => setPointer(null)}
            >
              {/*
                next/image 를 쓰지 않는 이유:
                줌에 따라 폭이 계속 바뀌는 초대형 이미지라 최적화가 오히려 방해가 됩니다.
                스파이크 범위이므로 순수 <img> 로 둡니다.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.previewUrl}
                alt="원본 프리뷰"
                width={renderedWidth}
                height={renderedHeight}
                draggable={false}
                onLoad={() => {
                  setStatus('loaded');
                  setLoadMs(Math.round(performance.now() - loadStartedAt.current));
                }}
                onError={() => {
                  setStatus('error');
                  setMessage('이미지를 불러오지 못했습니다. (F-CRP-01a 예외: 재시도 후 중단)');
                }}
                style={{ width: renderedWidth, height: renderedHeight, display: 'block' }}
              />

              {status === 'error' && (
                <div className="absolute inset-0 flex items-start justify-center bg-gray-200 pt-10">
                  이미지 로딩 실패
                </div>
              )}

              {/* 확정된 crop — 매 렌더마다 source 좌표에서 다시 계산합니다 */}
              {cropsForImage.map((c, idx) => {
                const d = sourceRectToDisplay(c, displayScale);
                const selected = c.id === selectedCropId;
                return (
                  <div
                    key={c.id}
                    data-crop-id={c.id}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedCropId(c.id);
                    }}
                    className="absolute"
                    style={{
                      left: d.left,
                      top: d.top,
                      width: d.width,
                      height: d.height,
                      border: selected ? '3px solid #1d4ed8' : '2px solid #444',
                      background: selected
                        ? 'rgba(29,78,216,0.15)'
                        : 'rgba(0,0,0,0.06)',
                    }}
                  >
                    <span className="absolute left-0 top-0 bg-white px-1 text-xs">
                      #{idx + 1}
                    </span>
                  </div>
                );
              })}

              {/* 드래그 중인 사각형 (미확정) */}
              {dragRect && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed border-blue-700"
                  style={dragRect}
                />
              )}
            </div>
          )}
        </main>

        {/* ── crop 목록 ─────────────────────────────────── */}
        <aside className="w-96 shrink-0 overflow-auto border-l border-gray-400 p-2">
          {selfTest.length > 0 && (
            <details open className="mb-3 border border-gray-500 p-2">
              <summary className="cursor-pointer font-bold">
                자체 검증 결과 — PASS {selfTest.filter((l) => l.ok).length} / FAIL{' '}
                {selfTest.filter((l) => !l.ok).length}
              </summary>
              <ul className="mt-2 flex flex-col gap-1 font-mono text-[11px]">
                {selfTest.map((l, i) => (
                  <li key={i} style={{ color: l.ok ? '#166534' : '#b91c1c' }}>
                    [{l.ok ? 'PASS' : 'FAIL'}] {l.name}
                    <br />
                    <span className="text-gray-600">{l.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="mb-2 font-bold">
            crop 목록 ({cropsForImage.length})
          </p>
          {cropsForImage.length === 0 && (
            <p className="border border-dashed border-gray-400 p-3 text-gray-600">
              아직 크롭이 없습니다. 이미지 위에서 드래그하세요.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {cropsForImage.map((c, idx) => (
              <li
                key={c.id}
                className="border border-gray-400 p-2"
                style={{
                  background: c.id === selectedCropId ? '#e5edff' : undefined,
                }}
              >
                <button
                  type="button"
                  className="block w-full text-left font-mono text-xs"
                  onClick={() => setSelectedCropId(c.id)}
                >
                  <div>#{idx + 1} {c.id}</div>
                  <div>sourceX: {c.sourceX}</div>
                  <div>sourceY: {c.sourceY}</div>
                  <div>sourceWidth: {c.sourceWidth}</div>
                  <div>sourceHeight: {c.sourceHeight}</div>
                  <div>
                    drift:{' '}
                    {scaleOk
                      ? measureRoundTripDrift(c, displayScale).toFixed(6)
                      : '-'}
                  </div>
                </button>
                <button
                  type="button"
                  className="mt-1 border border-gray-500 px-2 py-0.5"
                  onClick={() => {
                    setCrops((prev) => prev.filter((x) => x.id !== c.id));
                    if (selectedCropId === c.id) setSelectedCropId(null);
                  }}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
