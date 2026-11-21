/**
 * 내부 렌더 경로(/internal/typeset-render) 접근 판정 — 서버 전용(proxy.ts·page.tsx 에서만 import).
 *
 * BE 렌더러가 N5 와 같은 FE 조판 코드로 N6 최종 이미지를 만들 때만 쓰는 경로다. 외부 사용자 화면이 아니다.
 *  - 토큰은 runtime env(PIXLATE_INTERNAL_RENDER_TOKEN)에서만 읽는다. NEXT_PUBLIC_ 접두어·Docker build arg·이미지 안에 두지 않는다.
 *  - 토큰 없음·불일치·env 없음은 모두 거부한다(호출부가 404 로 응답한다 — 경로 존재를 드러내지 않는다).
 *  - X-Amzn-Trace-Id 가 있으면 ALB 를 거친 외부 요청이므로 토큰이 맞아도 거부한다. 인증 수단이 아니라 보조 차단 조건이다.
 *
 * node:crypto 를 쓰므로 client 번들에 들어가면 빌드가 실패한다 — 토큰 env 이름·값이 브라우저로 새지 않게 하는 장치이기도 하다.
 * 순수 함수라 scripts/verify-internal-render-access.mjs 로 Node 에서 검증한다.
 */

import { timingSafeEqual } from 'node:crypto';

export const INTERNAL_RENDER_PATH = '/internal/typeset-render';
export const INTERNAL_RENDER_TOKEN_HEADER = 'x-pixlate-internal-render';
export const ALB_TRACE_HEADER = 'x-amzn-trace-id';

type HeaderReader = Pick<Headers, 'get' | 'has'>;

/** 기대 토큰은 테스트에서만 넘긴다. 기본은 요청 시점의 runtime env */
export function isInternalRenderRequestAllowed(
  headers: HeaderReader,
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
