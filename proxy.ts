import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Proxy — 지금은 내부 렌더 경로(/internal/typeset-render, BE N6 렌더러 전용)만 다룬다. matcher 로 다른 경로에는 실행하지 않는다.
 * 페이지가 렌더되기 전에 토큰·ALB 조건을 확인하고, 통과하지 못하면 경로 존재를 드러내지 않도록 404 를 돌려준다.
 * app/internal/typeset-render/page.tsx 가 아래 isInternalRenderRequestAllowed 를 그대로 import 해 한 번 더 확인한다
 * (matcher 변경에 대비한 방어 — 판정 코드를 두 벌 두지 않는다).
 */

export const INTERNAL_RENDER_TOKEN_HEADER = 'x-pixlate-internal-render';
export const ALB_TRACE_HEADER = 'x-amzn-trace-id';

/**
 * 내부 렌더 접근 판정.
 *  - 토큰은 runtime env(PIXLATE_INTERNAL_RENDER_TOKEN)에서만 읽는다. NEXT_PUBLIC_ 접두어·Docker build arg·이미지 안에 두지 않는다.
 *  - 토큰 없음·불일치·env 없음(빈 문자열 포함)은 거부한다.
 *  - X-Amzn-Trace-Id 가 있으면 ALB 를 거친 외부 요청이므로 토큰이 맞아도 거부한다. 인증 수단이 아니라 보조 차단 조건이다.
 * node:crypto 를 쓰므로 client 번들에 들어가면 빌드가 실패한다 — 토큰 env 이름·값이 브라우저로 새지 않게 하는 장치이기도 하다.
 * 기대 토큰 인자는 검증 스크립트(scripts/verify-internal-render-access.mjs)에서만 넘긴다.
 */
export function isInternalRenderRequestAllowed(
  headers: Pick<Headers, 'get' | 'has'>,
  expectedToken: string | undefined = process.env.PIXLATE_INTERNAL_RENDER_TOKEN,
): boolean {
  if (!expectedToken) return false;
  if (headers.has(ALB_TRACE_HEADER)) return false;
  const provided = headers.get(INTERNAL_RENDER_TOKEN_HEADER);
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expectedToken, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function proxy(request: NextRequest) {
  if (!isInternalRenderRequestAllowed(request.headers)) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
}

export const config = {
  matcher: ['/internal/:path*'],
};
