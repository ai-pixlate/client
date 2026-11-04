'use client';

import { type RefObject, useEffect } from 'react';

import {
  type CoverMapping,
  LOGIN_GIF_SAMPLE_INTERVAL_MS,
  LOGIN_GIF_SAMPLE_SCALE,
  type PanelRect,
  computeCoverMapping,
  isGraphemeOnOrange,
} from '@/lib/auth/login-gif-contrast';

const GIF_TYPE = 'image/gif';

/**
 * GIF 현재 프레임에서 주황 위에 있는 글자만 어둡게 표시한다.
 *
 * 브라우저는 애니메이션 <img> 를 canvas 에 그리면 항상 첫 프레임을 준다(HTML 표준, Chromium 실측). <img> 의 현재 프레임은 읽을 방법이 없다.
 * 그래서 내장 ImageDecoder 로 같은 파일을 직접 재생해 화면 canvas 에 그리고, 그 프레임을 샘플링한다. 화면과 판정이 항상 같은 프레임이다.
 * <img> 는 canvas 첫 프레임 전까지와 ImageDecoder 미지원·실패·모션 감소 환경의 폴백이며, 이때 문구는 기본 #999 로 남는다.
 *
 * 글자 색은 data-on-orange 속성만 바꾼다. React 렌더와 레이아웃 변화가 없다.
 */
export function useLoginGifContrast(
  gifSrc: string,
  panelRef: RefObject<HTMLElement | null>,
  imageRef: RefObject<HTMLImageElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  useEffect(() => {
    const panel = panelRef.current;
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!panel || !image || !canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof ImageDecoder === 'undefined') return;
    const display = canvas.getContext('2d');
    const sampleCanvas = document.createElement('canvas');
    const sample = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!display || !sample) return;

    const abort = new AbortController();
    let stopped = false;
    let decoder: ImageDecoder | null = null;
    let wake: (() => void) | null = null;
    let sourceSize = { width: 0, height: 0 };
    let cover: CoverMapping | null = null;
    let graphemes: { element: HTMLElement; rect: PanelRect }[] = [];

    // 위치는 크기·폰트가 바뀔 때만 다시 잰다. 재생 중에는 캐시를 쓴다
    const measure = () => {
      const panelRect = panel.getBoundingClientRect();
      graphemes = Array.from(panel.querySelectorAll<HTMLElement>('[data-g1-grapheme]'))
        .filter((element) => element.textContent?.trim())
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { element, rect: { left: rect.left - panelRect.left, top: rect.top - panelRect.top, width: rect.width, height: rect.height } };
        });
      cover = sourceSize.width > 0 ? computeCoverMapping(panelRect, sourceSize) : null;
    };
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(panel);
    document.fonts.addEventListener('loadingdone', measure);

    const applySample = (frame: VideoFrame) => {
      if (!cover) return;
      sample.drawImage(frame, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const { data, width, height } = sample.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
      const readPixel = (sourceX: number, sourceY: number) => {
        const x = Math.min(width - 1, Math.max(0, Math.floor(sourceX * LOGIN_GIF_SAMPLE_SCALE)));
        const y = Math.min(height - 1, Math.max(0, Math.floor(sourceY * LOGIN_GIF_SAMPLE_SCALE)));
        const offset = (y * width + x) * 4;
        return [data[offset], data[offset + 1], data[offset + 2]] as const;
      };
      for (const { element, rect } of graphemes) {
        element.toggleAttribute('data-on-orange', isGraphemeOnOrange(rect, cover, readPixel));
      }
    };

    const clearGraphemes = () => {
      panel.querySelectorAll('[data-on-orange]').forEach((element) => element.removeAttribute('data-on-orange'));
    };

    const waitUntil = (time: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, Math.max(0, time - performance.now()));
        wake = () => {
          window.clearTimeout(timer);
          resolve();
        };
      });

    const play = async () => {
      const response = await fetch(gifSrc, { signal: abort.signal });
      if (!response.ok || !(await ImageDecoder.isTypeSupported(GIF_TYPE))) return;
      decoder = new ImageDecoder({ data: await response.arrayBuffer(), type: GIF_TYPE });
      await decoder.tracks.ready;
      await decoder.completed;
      const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
      if (frameCount === 0) return;

      let frameIndex = 0;
      let dueAt = performance.now();
      let sampledAt = Number.NEGATIVE_INFINITY;
      while (!stopped) {
        const { image: frame } = await decoder.decode({ frameIndex });
        try {
          await waitUntil(dueAt);
          if (stopped) return;
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
            sampleCanvas.width = Math.round(frame.displayWidth * LOGIN_GIF_SAMPLE_SCALE);
            sampleCanvas.height = Math.round(frame.displayHeight * LOGIN_GIF_SAMPLE_SCALE);
            sourceSize = { width: frame.displayWidth, height: frame.displayHeight };
            measure();
          }
          display.drawImage(frame, 0, 0);
          if (canvas.hidden) {
            canvas.hidden = false;
            image.style.visibility = 'hidden';
            panel.dataset.gifContrast = 'running';
          }
          const now = performance.now();
          if (now - sampledAt >= LOGIN_GIF_SAMPLE_INTERVAL_MS) {
            sampledAt = now;
            applySample(frame);
          }
          // 밀렸을 때 프레임을 몰아서 재생하지 않는다
          dueAt = Math.max(now, dueAt) + (frame.duration ?? 40_000) / 1000;
        } finally {
          frame.close();
        }
        frameIndex = (frameIndex + 1) % frameCount;
      }
    };

    const restoreFallback = () => {
      canvas.hidden = true;
      image.style.visibility = '';
      delete panel.dataset.gifContrast;
      clearGraphemes();
    };

    play().catch(() => {
      // 파일·디코딩 실패는 화면을 깨지 않고 <img> 와 기본 #999 로 돌아간다
      if (!stopped) restoreFallback();
    });

    return () => {
      stopped = true;
      abort.abort();
      wake?.();
      resizeObserver.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
      decoder?.close();
      restoreFallback();
    };
  }, [gifSrc, panelRef, imageRef, canvasRef]);
}
