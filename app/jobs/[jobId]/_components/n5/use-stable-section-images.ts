'use client';

import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────
// N5 캔버스 섹션 면 이미지 — 같은 asset 이면 보이는 URL 을 바꾸지 않는다.
//
// /preview 는 같은 S3 객체도 조회마다 새 presigned URL 을 만든다(서명·시각만 다름). URL 문자열을 asset 으로 보면 조회마다
// backgroundImage 가 바뀌어 브라우저가 다시 받고, 그동안 회색 빈 면이 보인다. 그래서 서버가 준 안정적인 값으로 asset 을 구분한다
// (identity — 호출부가 만든다: 결과 이미지 = render.result.taskId + inputFingerprint, 바탕 = background.sha256, 원본 = 섹션·sourceImageId).
//
// - identity 가 같으면 지금 보이는 URL 을 그대로 둔다(새 URL 을 받아도 갈아 끼우지 않는다).
//   presigned URL 은 만료되는 값이라, 보인 지 오래된(REFRESH_AFTER_MS) URL 은 같은 asset 의 새 URL 을 먼저 받아 둔 뒤 조용히 바꾼다.
// - identity 가 바뀌면 지금 이미지를 둔 채 새 URL 을 먼저 받고(preload), 받은 뒤에 바꾼다. 받지 못하면 지금 이미지를 그대로 둔다.
// - 처음 보이는 slot 은 바로 그 URL 을 쓴다(보일 이전 이미지가 없다).
// slot 은 섹션 × 보기(번역 후·번역 전)마다 따로 둔다 — 번역 전/후를 오가도 각자 마지막으로 받은 이미지를 그대로 쓴다.
// 효과(crossfade 등)는 넣지 않는다.
// ─────────────────────────────────────────────────────────────────

const REFRESH_AFTER_MS = 4 * 60_000;

export interface SectionImageRequest {
  /** slot — 예: `${sectionId}:translated` */
  key: string;
  /** asset 구분 값. 앞부분(':' 앞)은 종류다(bg·render·orig·url·none) */
  identity: string;
  url: string | null;
}

export interface ShownSectionImage {
  identity: string;
  url: string | null;
}

export function useStableSectionImages(requests: readonly SectionImageRequest[]): ReadonlyMap<string, ShownSectionImage> {
  const [shown, setShown] = useState<ReadonlyMap<string, ShownSectionImage>>(() => new Map());
  // 처음 보이는 slot 은 render 중에 바로 채운다(effect 를 기다리면 한 frame 빈 면이 보인다)
  const missing = requests.filter((request) => !shown.has(request.key));
  let current = shown;
  if (missing.length > 0) {
    const next = new Map(shown);
    for (const request of missing) next.set(request.key, { identity: request.identity, url: request.url });
    current = next;
    setShown(next);
  }

  const latestRef = useRef(requests);
  useEffect(() => {
    latestRef.current = requests;
  });
  // slot → 받는 중인 URL. 같은 URL 을 두 번 받지 않는다
  const loadingRef = useRef(new Map<string, string>());
  // slot → 지금 URL 을 보이기 시작한 시각(만료 전 새 URL 로 조용히 바꾸는 기준)
  const shownAtRef = useRef(new Map<string, { url: string | null; at: number }>());
  const requestKey = requests.map((request) => `${request.key}=${request.identity}@${request.url ?? ''}`).join('|');
  useEffect(() => {
    const now = Date.now();
    for (const request of latestRef.current) {
      const visible = current.get(request.key);
      if (!visible) continue;
      const since = shownAtRef.current.get(request.key);
      if (!since || since.url !== visible.url) shownAtRef.current.set(request.key, { url: visible.url, at: now });
      if (visible.url === request.url) continue;
      const sameAsset = visible.identity === request.identity;
      const shownFor = now - (shownAtRef.current.get(request.key)?.at ?? now);
      if (sameAsset && shownFor < REFRESH_AFTER_MS) continue; // 같은 asset — URL 문자열만 바뀌었다
      if (request.url == null) {
        // 보일 이미지가 없어졌다(예: 결과 없음) — 받을 것이 없으니 바로 반영한다
        if (!sameAsset) setShown((prev) => new Map(prev).set(request.key, { identity: request.identity, url: null }));
        continue;
      }
      if (loadingRef.current.get(request.key) === request.url) continue;
      loadingRef.current.set(request.key, request.url);
      const { key, identity, url } = request;
      const image = new Image();
      image.onload = () => {
        if (loadingRef.current.get(key) !== url) return;
        loadingRef.current.delete(key);
        // 받는 사이 요청이 다른 asset 으로 바뀌었으면 넣지 않는다(그 asset 은 다음 effect 가 받는다)
        const latest = latestRef.current.find((candidate) => candidate.key === key);
        if (!latest || latest.identity !== identity) return;
        setShown((prev) => new Map(prev).set(key, { identity, url }));
      };
      image.onerror = () => {
        // 받지 못했다 — 지금 보이는 이미지를 그대로 둔다
        if (loadingRef.current.get(key) === url) loadingRef.current.delete(key);
      };
      image.src = url;
    }
    // requestKey(요청 값)·shown 이 바뀔 때만 다시 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, shown]);

  return current;
}

/** identity 의 종류(앞부분) */
export function sectionImageKind(identity: string | undefined): string | null {
  return identity ? identity.slice(0, identity.indexOf(':') < 0 ? undefined : identity.indexOf(':')) : null;
}
