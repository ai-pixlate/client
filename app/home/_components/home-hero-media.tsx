'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// ─────────────────────────────────────────────────────────────────
// H 히어로 미디어 — 랜딩(1492:10051) 전체 배경 VIDEO · 로그인 후(1776:4171 · 1779:4227) 배너 정지 이미지(1776:4858).
//
// 파일(public/home/hero/):
//   hero-poster.webp — Figma 배너 이미지(Rectangle 24)를 Export 한 원본. 랜딩 영상의 포스터·대체 화면도 같은 이미지를 쓴다.
//   hero-video.mp4   — 사용자가 제공한 랜딩 배경 원본(1920×1080 · H.264 · 6초). Figma 랜딩 프레임(1920×1080)과 비율이 같아
//                      1920×1080 에서는 cover 크롭이 없고, 다른 비율의 화면에서는 가운데 기준으로 위아래 또는 좌우만 잘린다.
//
// 대체 순서: 영상(있고 · 모션 허용 · 재생 성공) → 포스터 이미지 → 중립 배경색. 어느 단계에서 실패해도 위에 겹친 제목·버튼은 그대로 쓸 수 있다.
// prefers-reduced-motion: reduce 에서는 영상을 만들지 않고 정지 이미지만 쓴다. object-fit: cover 로 채운다.
// ─────────────────────────────────────────────────────────────────

export const HERO_POSTER_SRC = '/home/hero/hero-poster.webp';
export const HERO_VIDEO_SRC: string | null = '/home/hero/hero-video.mp4';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** 서버 렌더에서는 「줄임」으로 본다 — 영상을 먼저 만들었다가 지우지 않는다 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => true,
  );
}

export function HomeHeroMedia({
  kind,
  videoSrc = HERO_VIDEO_SRC,
  fallbackClassName,
}: {
  /** video = 랜딩 전체 배경, image = 로그인 후 배너 */
  kind: 'video' | 'image';
  videoSrc?: string | null;
  /** 이미지도 실패했을 때의 중립 배경 */
  fallbackClassName: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [videoFailed, setVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const useVideo = kind === 'video' && videoSrc != null && !reducedMotion && !videoFailed;

  // 자동 재생이 막히면(브라우저 정책·저전력 모드) 멈춘 첫 프레임 대신 포스터 이미지로 바꾼다
  useEffect(() => {
    if (!useVideo) return;
    const video = videoRef.current;
    if (!video) return;
    const played = video.play();
    if (played) played.catch(() => setVideoFailed(true));
  }, [useVideo]);

  return (
    <div aria-hidden="true" data-testid="home-hero-media" data-media={useVideo ? 'video' : posterFailed ? 'fallback' : 'image'} className={`absolute inset-0 overflow-hidden ${fallbackClassName}`}>
      {useVideo ? (
        <video
          ref={videoRef}
          src={videoSrc}
          poster={HERO_POSTER_SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onError={() => setVideoFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        !posterFailed && (
          // 장식 배경 이미지 — 크기 고정 레이아웃 안에서 cover 로 채운다(next/image 최적화 대상 아님)
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={HERO_POSTER_SRC}
            alt=""
            data-testid="home-hero-image"
            onError={() => setPosterFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        )
      )}
    </div>
  );
}
