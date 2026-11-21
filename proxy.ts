import { NextResponse, type NextRequest } from 'next/server';

import { isInternalRenderRequestAllowed } from './lib/internal-render/access';

/**
 * Proxy — 지금은 내부 렌더 경로(/internal/typeset-render)만 다룬다(matcher 로 다른 경로에는 실행하지 않는다).
 * 페이지가 렌더되기 전에 토큰·ALB 조건을 확인하고, 통과하지 못하면 경로 존재를 드러내지 않도록 404 를 돌려준다.
 * page.tsx 도 같은 판정을 한 번 더 한다(proxy matcher 변경에 대비한 방어).
 */
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
